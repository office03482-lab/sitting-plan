"""Approved examination AI workflows for question preview generation."""

from __future__ import annotations

import re
from typing import Any

from fastapi import HTTPException

from app.services.ai_provider import AIProviderError, AIQuotaError, generate_json
from app.services import supabase_question_bank as qb_service


def _normalize(value: Any) -> str:
    return str(value or "").strip()


def _normalized_prompt(text: str) -> str:
    return re.sub(r"\s+", " ", _normalize(text)).strip().lower()


def _build_question_generation_prompt(payload: dict[str, Any]) -> str:
    return (
        "You are an examination question generation engine for a school ERP question bank.\n"
        "Task: generate academically correct questions only for the requested context.\n"
        "Trusted context:\n"
        f"- Exam pattern: {_normalize(payload.get('exam_pattern')) or 'standard'}\n"
        f"- Class: {_normalize(payload.get('class_name')) or 'not provided'}\n"
        f"- Subject: {_normalize(payload.get('subject'))}\n"
        f"- Chapter: {_normalize(payload.get('chapter'))}\n"
        f"- Topic: {_normalize(payload.get('topic'))}\n"
        f"- Difficulty: {_normalize(payload.get('difficulty')) or 'medium'}\n"
        f"- Question type: {_normalize(payload.get('question_type')) or 'single_choice'}\n"
        f"- Language: {_normalize(payload.get('language')) or 'en'}\n"
        f"- Number of questions: {int(payload.get('question_count') or 5)}\n"
        f"- Marks per question: {float(payload.get('marks') or 1)}\n"
        "Constraints:\n"
        "- Return only JSON.\n"
        "- Do not invent unrelated chapters or topics.\n"
        "- For MCQ, provide exactly 4 distinct options and a correct_answer that matches one option.\n"
        "- Explanations must be concise and academically grounded.\n"
        "- Use null or empty string instead of inventing unsupported media.\n"
        "Output schema:\n"
        "{"
        "\"questions\": ["
        "{"
        "\"question_text\": \"...\", "
        "\"question_type\": \"single_choice\", "
        "\"options\": [\"...\"], "
        "\"correct_answer\": \"...\", "
        "\"explanation\": \"...\", "
        "\"subject\": \"...\", "
        "\"chapter\": \"...\", "
        "\"topic\": \"...\", "
        "\"difficulty\": \"...\", "
        "\"marks\": 1"
        "}"
        "]"
        "}"
    )


def _validate_generated_question(item: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    question_text = _normalize(item.get("question_text") or item.get("prompt_text"))
    if not question_text:
        raise HTTPException(status_code=422, detail="AI returned a question without question_text")

    question_type = _normalize(item.get("question_type") or payload.get("question_type") or "single_choice")
    difficulty = _normalize(item.get("difficulty") or payload.get("difficulty") or "medium")
    subject = _normalize(item.get("subject") or payload.get("subject"))
    chapter = _normalize(item.get("chapter") or payload.get("chapter"))
    topic = _normalize(item.get("topic") or payload.get("topic"))
    explanation = _normalize(item.get("explanation"))
    marks = float(item.get("marks") or payload.get("marks") or 1)

    options = [str(option).strip() for option in list(item.get("options") or []) if str(option or "").strip()]
    correct_answer = _normalize(item.get("correct_answer"))
    if question_type in {"single_choice", "multiple_choice"}:
        if len(options) < 2:
            raise HTTPException(status_code=422, detail="AI returned an MCQ without enough options")
        normalized_options = [_normalized_prompt(option) for option in options]
        if len(normalized_options) != len(set(normalized_options)):
            raise HTTPException(status_code=422, detail="AI returned duplicate MCQ options")
        if _normalized_prompt(correct_answer) not in normalized_options:
            raise HTTPException(status_code=422, detail="AI returned a correct answer that does not match any option")

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
    }


def _duplicate_summary(school_id: str, question_text: str) -> dict[str, Any]:
    existing = qb_service.list_questions(school_id, {"search": question_text[:80]}, 0, 50)
    normalized_candidate = _normalized_prompt(question_text)
    exact_matches = []
    normalized_matches = []
    for row in existing:
        prompt_text = _normalize(row.get("prompt_text"))
        if not prompt_text:
            continue
        if prompt_text == question_text:
            exact_matches.append({"id": row.get("id"), "prompt_text": prompt_text})
        elif _normalized_prompt(prompt_text) == normalized_candidate:
            normalized_matches.append({"id": row.get("id"), "prompt_text": prompt_text})
    return {
        "is_duplicate": bool(exact_matches or normalized_matches),
        "exact_matches": exact_matches,
        "normalized_matches": normalized_matches,
    }


def _raise_exam_ai_http_error(exc: Exception, *, operation: str) -> None:
    if isinstance(exc, AIQuotaError):
        raise HTTPException(
            status_code=503,
            detail=f"Gemini quota exhausted during {operation}. Please try again later.",
        ) from exc
    if isinstance(exc, AIProviderError):
        raise HTTPException(
            status_code=503,
            detail=f"AI service unavailable during {operation}. Please try again later.",
        ) from exc
    raise exc


def generate_question_preview(school_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        generated = generate_json(_build_question_generation_prompt(payload))
    except Exception as exc:
        _raise_exam_ai_http_error(exc, operation="question generation")

    raw_questions = list(generated.get("questions") or [])
    if not raw_questions:
        raise HTTPException(status_code=422, detail="AI returned no questions")

    expected_count = max(1, int(payload.get("question_count") or 5))
    if len(raw_questions) != expected_count:
        raise HTTPException(
            status_code=422,
            detail=f"AI returned {len(raw_questions)} questions, expected exactly {expected_count}",
        )

    validated_questions = []
    for item in raw_questions:
        if not isinstance(item, dict):
            raise HTTPException(status_code=422, detail="AI returned malformed question items")
        question = _validate_generated_question(item, payload)
        question["duplicate_check"] = _duplicate_summary(school_id, question["question_text"])
        validated_questions.append(question)

    return {
        "questions": validated_questions,
        "generated_count": len(validated_questions),
        "requires_human_review": True,
        "source": "gemini_preview_generation",
    }
