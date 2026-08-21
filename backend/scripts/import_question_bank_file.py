from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

from app.services import supabase_question_bank as qb_service


DEFAULT_SCHOOL_ID = "2a427cb2-4194-43ba-9e4a-f2558c508162"


def _normalize_question_type(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"mcq", "single_choice", "single correct"}:
        return "single_choice"
    if normalized in {"multiple_choice", "multiple correct"}:
        return "multiple_choice"
    return "single_choice"


def _normalize_difficulty(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"easy", "medium", "hard"}:
        return normalized
    return "medium"


def _normalize_language(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"english", "en"}:
        return "en"
    if normalized in {"hindi", "hi"}:
        return "hi"
    return normalized or "en"


def _normalize_visibility(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"school", "public", "private"}:
        return normalized
    return "school"


def _normalize_status(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"draft", "review", "approved", "published", "archived", "rejected"}:
        return normalized
    return "draft"


def _sanitize_text(value: Any) -> str:
    text = str(value or "").strip()
    return text.replace("Â°", "°")


def _build_option_items(options: list[Any]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for index, option in enumerate(options, start=1):
        key = chr(64 + index)
        text = ""
        if isinstance(option, dict):
            key = str(option.get("key") or option.get("id") or key).strip() or key
            text = _sanitize_text(option.get("text") or option.get("value") or "")
        else:
            text = _sanitize_text(option)
        if not text:
            continue
        items.append({"id": key, "label": key, "value": text})
    return items


def _resolve_correct_option_id(option_items: list[dict[str, Any]], correct_answer: str) -> str:
    target = _sanitize_text(correct_answer)
    for option in option_items:
        if _sanitize_text(option.get("value")) == target:
            return str(option.get("id") or "")
    return ""


def _build_question_code(item: dict[str, Any], index: int) -> str:
    existing = str(item.get("question_code") or "").strip()
    if existing:
        return existing
    exam_type = str(item.get("exam_type") or "CUSTOM").strip().upper()
    subject = str(item.get("subject") or "GEN").strip().upper()[:3]
    class_name = str(item.get("class") or "").strip().replace("Class ", "")
    class_suffix = f"C{class_name}" if class_name else "C0"
    source_id = str(item.get("id") or index).strip()
    return f"{exam_type}-{class_suffix}-{subject}-{source_id}"


def _build_payload(item: dict[str, Any], index: int) -> dict[str, Any]:
    option_items = _build_option_items(list(item.get("options") or []))
    correct_option_id = _resolve_correct_option_id(option_items, str(item.get("correct_answer") or ""))
    tags = [
        str(item.get("class") or "").strip(),
        str(item.get("area") or "").strip(),
    ]
    tags = [tag for tag in tags if tag]
    metadata = {
        "import_source": "backend/scripts/import_question_bank_file.py",
        "original_id": item.get("id"),
        "original_exam_type": item.get("exam_type"),
        "class": item.get("class"),
        "area": item.get("area"),
        "topic": item.get("topic"),
        "source_file": "pasted-text.txt",
    }
    return {
        "question_code": _build_question_code(item, index),
        "exam_type_slug": str(item.get("exam_type") or "custom").strip().lower(),
        "subject": _sanitize_text(item.get("subject")),
        "chapter": _sanitize_text(item.get("chapter")),
        "topic": _sanitize_text(item.get("topic")),
        "question_type": _normalize_question_type(item.get("question_type") or item.get("type") or "mcq"),
        "difficulty_level": _normalize_difficulty(item.get("difficulty")),
        "prompt_text": _sanitize_text(item.get("question") or item.get("prompt")),
        "option_items": option_items,
        "answer_key": {"correct_option_id": correct_option_id} if correct_option_id else {},
        "explanation": _sanitize_text(item.get("explanation")),
        "marks": float(item.get("marks") or 4),
        "negative_marks": abs(float(item.get("negative") or 1)),
        "estimated_time_seconds": int(item.get("time_seconds") or 60),
        "source_name": _sanitize_text(item.get("source_name") or item.get("exam_type") or "Imported JSON"),
        "language": _normalize_language(item.get("language") or "English"),
        "visibility": _normalize_visibility(item.get("visibility") or "School"),
        "tags": tags,
        "status": _normalize_status(item.get("status") or "Draft"),
        "metadata": metadata,
    }


def _load_questions(file_path: Path) -> list[dict[str, Any]]:
    payload = json.loads(file_path.read_text(encoding="utf-8"))
    if isinstance(payload, dict) and isinstance(payload.get("questions"), list):
        return [item for item in payload["questions"] if isinstance(item, dict)]
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    raise ValueError("Unsupported question file format")


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Usage: import_question_bank_file.py <json-file-path>")

    file_path = Path(sys.argv[1]).resolve()
    school_id = os.getenv("SUPABASE_TARGET_SCHOOL_ID", DEFAULT_SCHOOL_ID).strip() or DEFAULT_SCHOOL_ID
    questions = _load_questions(file_path)
    inserted_codes: list[str] = []
    skipped_codes: list[str] = []

    for index, item in enumerate(questions, start=1):
        payload = _build_payload(item, index)
        prompt_text = str(payload.get("prompt_text") or "")
        duplicate = qb_service.find_duplicate_question(school_id, prompt_text)
        if duplicate:
            skipped_codes.append(str(payload.get("question_code") or duplicate.get("id") or "unknown"))
            continue
        created = qb_service.create_question(school_id, payload)
        inserted_codes.append(str(created.get("question_code") or payload.get("question_code") or "unknown"))

    print(json.dumps({
        "file": str(file_path),
        "school_id": school_id,
        "total_questions": len(questions),
        "inserted_count": len(inserted_codes),
        "inserted_codes": inserted_codes,
        "skipped_count": len(skipped_codes),
        "skipped_codes": skipped_codes,
    }, indent=2))


if __name__ == "__main__":
    main()
