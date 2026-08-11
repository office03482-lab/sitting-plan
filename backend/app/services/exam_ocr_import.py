"""Examination OCR/PDF/image import preview service."""

from __future__ import annotations

import io
import mimetypes
import re
from typing import Any

import fitz  # type: ignore
from fastapi import HTTPException, UploadFile
from PIL import Image

from app.config import settings
from app.services.ai_provider import AIProviderError, AIQuotaError, generate_json, generate_json_parts
from app.services.approved_exam_ai import _duplicate_summary, _raise_exam_ai_http_error
from app.services.supabase_storage import upload_file_to_supabase_storage

ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
ALLOWED_PDF_EXTENSIONS = {".pdf"}
ALLOWED_EXTENSIONS = ALLOWED_IMAGE_EXTENSIONS | ALLOWED_PDF_EXTENSIONS
ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
    "application/octet-stream",
}


def _normalize(value: Any) -> str:
    return str(value or "").strip()


def _normalized_prompt(text: str) -> str:
    return re.sub(r"\s+", " ", _normalize(text)).strip().lower()


def _guess_content_type(file: UploadFile) -> str:
    if file.content_type:
        return str(file.content_type).strip().lower()
    guessed, _ = mimetypes.guess_type(file.filename or "")
    return str(guessed or "application/octet-stream").strip().lower()


def _validate_file(file: UploadFile, file_bytes: bytes) -> tuple[str, str]:
    file_name = _normalize(file.filename)
    if not file_name:
        raise HTTPException(status_code=400, detail="File name is required")
    extension = file_name[file_name.rfind(".") :].lower() if "." in file_name else ""
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only PDF, PNG, JPG, JPEG, and WEBP files are supported")
    content_type = _guess_content_type(file)
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported content type: {content_type}")
    max_bytes = int(settings.max_upload_size_mb or 50) * 1024 * 1024
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(file_bytes) > max_bytes:
        raise HTTPException(status_code=400, detail=f"File exceeds max size of {settings.max_upload_size_mb} MB")
    return file_name, extension


def _ocr_page_prompt(page_number: int) -> str:
    return (
        "You are extracting text from an exam paper page.\n"
        "Return only JSON.\n"
        "Do not invent missing text.\n"
        "Preserve numbering, MCQ options, formulas, and line breaks as faithfully as possible.\n"
        "If something is unreadable, mention it in low_confidence_segments instead of guessing.\n"
        "{"
        f"\"page_number\": {page_number}, "
        "\"extracted_text\": \"...\", "
        "\"detected_question_numbers\": [\"1\", \"2\"], "
        "\"low_confidence_segments\": [\"...\"]"
        "}"
    )


def _structure_prompt(payload: dict[str, Any], extracted_text: str) -> str:
    return (
        "You are an examination OCR structuring engine for a school ERP question bank.\n"
        "The OCR text below came from a real uploaded exam document.\n"
        "Convert only the clearly supported content into structured question records.\n"
        "Do not invent answers, explanations, or options that are not supported by the source.\n"
        "If an answer is unavailable, use an empty string and include 'answer_unavailable' in missing_fields.\n"
        "If question type is unclear, infer cautiously from visible structure only.\n"
        "Return only JSON.\n"
        "Requested context:\n"
        f"- Subject: {_normalize(payload.get('subject')) or 'unknown'}\n"
        f"- Chapter: {_normalize(payload.get('chapter')) or 'unknown'}\n"
        f"- Topic: {_normalize(payload.get('topic')) or 'unknown'}\n"
        f"- Difficulty: {_normalize(payload.get('difficulty')) or 'medium'}\n"
        f"- Default marks: {float(payload.get('marks') or 1)}\n"
        "Output schema:\n"
        "{"
        "\"questions\": ["
        "{"
        "\"question_text\": \"...\", "
        "\"question_type\": \"single_choice|multiple_choice|descriptive|short_answer\", "
        "\"options\": [\"...\"], "
        "\"correct_answer\": \"\", "
        "\"explanation\": \"\", "
        "\"subject\": \"...\", "
        "\"chapter\": \"...\", "
        "\"topic\": \"...\", "
        "\"difficulty\": \"...\", "
        "\"marks\": 1, "
        "\"page_numbers\": [1], "
        "\"missing_fields\": [\"answer_unavailable\"], "
        "\"review_required\": true"
        "}"
        "]"
        "}\n"
        "OCR text:\n"
        f"{extracted_text}"
    )


def _count_detected_questions(text: str) -> int:
    matches = re.findall(r"(?m)^\s*(\d{1,3})[\).:-]\s+", text)
    if matches:
        return len(matches)
    return len(re.findall(r"\bQ\.?\s*\d{1,3}\b", text, flags=re.IGNORECASE))


def _ocr_payload_to_page_result(payload: dict[str, Any], *, page_number: int, method: str) -> dict[str, Any]:
    return {
        "page_number": page_number,
        "method": method,
        "extracted_text": _normalize(payload.get("extracted_text")),
        "detected_question_numbers": [str(item).strip() for item in list(payload.get("detected_question_numbers") or []) if str(item).strip()],
        "low_confidence_segments": [str(item).strip() for item in list(payload.get("low_confidence_segments") or []) if str(item).strip()],
    }


def _validate_structured_question(item: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    question_text = _normalize(item.get("question_text") or item.get("prompt_text"))
    if not question_text:
        raise HTTPException(status_code=422, detail="OCR AI returned a question without question_text")

    options = [str(option).strip() for option in list(item.get("options") or []) if str(option or "").strip()]
    question_type = _normalize(item.get("question_type"))
    if not question_type:
        question_type = "single_choice" if len(options) >= 2 else "descriptive"
    difficulty = _normalize(item.get("difficulty") or payload.get("difficulty") or "medium")
    subject = _normalize(item.get("subject") or payload.get("subject"))
    chapter = _normalize(item.get("chapter") or payload.get("chapter"))
    topic = _normalize(item.get("topic") or payload.get("topic"))
    correct_answer = _normalize(item.get("correct_answer"))
    explanation = _normalize(item.get("explanation"))
    marks = float(item.get("marks") or payload.get("marks") or 1)
    page_numbers = [int(page) for page in list(item.get("page_numbers") or []) if str(page).strip().isdigit()]
    missing_fields = [str(field).strip() for field in list(item.get("missing_fields") or []) if str(field).strip()]
    review_required = bool(item.get("review_required")) or not correct_answer

    if question_type in {"single_choice", "multiple_choice"}:
        if len(options) < 2:
            raise HTTPException(status_code=422, detail="OCR AI returned an MCQ without enough options")
        normalized_options = [_normalized_prompt(option) for option in options]
        if len(normalized_options) != len(set(normalized_options)):
            raise HTTPException(status_code=422, detail="OCR AI returned duplicate MCQ options")
        if correct_answer and _normalized_prompt(correct_answer) not in normalized_options:
            raise HTTPException(status_code=422, detail="OCR AI returned a correct answer that does not match any option")
        if not correct_answer and "answer_unavailable" not in missing_fields:
            missing_fields.append("answer_unavailable")
            review_required = True

    return {
        "question_text": question_text,
        "question_type": question_type,
        "options": options,
        "correct_answer": correct_answer,
        "explanation": explanation,
        "subject": subject,
        "chapter": chapter,
        "topic": topic,
        "difficulty": difficulty,
        "marks": marks,
        "page_numbers": page_numbers,
        "missing_fields": missing_fields,
        "review_required": review_required,
    }


def _render_pdf_page_image(page: fitz.Page) -> Image.Image:
    pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    return Image.open(io.BytesIO(pixmap.tobytes("png"))).convert("RGB")


def _extract_pdf_pages(file_bytes: bytes) -> tuple[list[dict[str, Any]], str, int]:
    try:
        document = fitz.open(stream=file_bytes, filetype="pdf")
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Uploaded PDF could not be opened") from exc

    page_results: list[dict[str, Any]] = []
    methods_used: list[str] = []
    for index in range(document.page_count):
        page_number = index + 1
        page = document.load_page(index)
        extracted_text = _normalize(page.get_text("text"))
        if len(extracted_text) >= 80:
            page_results.append(
                {
                    "page_number": page_number,
                    "method": "direct_pdf_text",
                    "extracted_text": extracted_text,
                    "detected_question_numbers": re.findall(r"(?m)^\s*(\d{1,3})[\).:-]\s+", extracted_text),
                    "low_confidence_segments": [],
                }
            )
            methods_used.append("direct_pdf_text")
            continue

        try:
            image = _render_pdf_page_image(page)
            ocr_payload = generate_json_parts([_ocr_page_prompt(page_number), image], temperature=0.1)
            page_results.append(_ocr_payload_to_page_result(ocr_payload, page_number=page_number, method="gemini_vision"))
            methods_used.append("gemini_vision")
        except Exception as exc:
            _raise_exam_ai_http_error(exc, operation="OCR page extraction")

    combined_text = "\n\n".join(
        f"[Page {item['page_number']}]\n{_normalize(item.get('extracted_text'))}"
        for item in page_results
        if _normalize(item.get("extracted_text"))
    )
    method = "mixed" if len(set(methods_used)) > 1 else (methods_used[0] if methods_used else "unknown")
    return page_results, combined_text, document.page_count


def _extract_image_page(file_bytes: bytes) -> tuple[list[dict[str, Any]], str]:
    try:
        image = Image.open(io.BytesIO(file_bytes)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Uploaded image could not be opened") from exc

    try:
        ocr_payload = generate_json_parts([_ocr_page_prompt(1), image], temperature=0.1)
    except Exception as exc:
        _raise_exam_ai_http_error(exc, operation="image OCR extraction")
    page_result = _ocr_payload_to_page_result(ocr_payload, page_number=1, method="gemini_vision")
    return [page_result], _normalize(page_result.get("extracted_text"))


async def generate_exam_import_preview(
    school_id: str,
    payload: dict[str, Any],
    file: UploadFile,
) -> dict[str, Any]:
    file_bytes = await file.read()
    file_name, extension = _validate_file(file, file_bytes)
    is_pdf = extension in ALLOWED_PDF_EXTENSIONS

    try:
        file.file.seek(0)
    except Exception:
        pass
    uploaded = await upload_file_to_supabase_storage(
        school_id=school_id,
        category="document" if is_pdf else "image",
        file=file,
        folder="question-bank-import",
    )

    if is_pdf:
        page_results, combined_text, page_count = _extract_pdf_pages(file_bytes)
        extraction_method = "pdf_text_or_gemini_vision"
    else:
        page_results, combined_text = _extract_image_page(file_bytes)
        page_count = 1
        extraction_method = "gemini_vision"

    if not _normalize(combined_text):
        raise HTTPException(status_code=422, detail="OCR could not extract readable text from the uploaded file")

    try:
        structured = generate_json(_structure_prompt(payload, combined_text))
    except Exception as exc:
        _raise_exam_ai_http_error(exc, operation="OCR question structuring")

    raw_questions = list(structured.get("questions") or [])
    if not raw_questions:
        raise HTTPException(status_code=422, detail="OCR structuring returned no questions")

    validated_questions: list[dict[str, Any]] = []
    for item in raw_questions:
        if not isinstance(item, dict):
            raise HTTPException(status_code=422, detail="OCR structuring returned malformed question items")
        question = _validate_structured_question(item, payload)
        question["duplicate_check"] = _duplicate_summary(school_id, question["question_text"])
        validated_questions.append(question)

    return {
        "upload": {
            "file_name": file_name,
            "content_type": uploaded.get("content_type"),
            "storage_path": uploaded.get("storage_path"),
            "url": uploaded.get("url"),
            "size": uploaded.get("size"),
        },
        "extraction": {
            "file_kind": "pdf" if is_pdf else "image",
            "page_count": page_count,
            "method": extraction_method,
            "source_question_count": _count_detected_questions(combined_text),
            "pages": page_results,
        },
        "questions": validated_questions,
        "generated_count": len(validated_questions),
        "requires_human_review": True,
        "source": "gemini_ocr_import",
    }
