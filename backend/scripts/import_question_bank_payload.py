from __future__ import annotations

import json
import os
from typing import Any

from app.services import supabase_question_bank as qb_service


DEFAULT_SCHOOL_ID = "2a427cb2-4194-43ba-9e4a-f2558c508162"


RAW_QUESTIONS = r"""
[
  {
    "exam_type": "NEET",
    "subject": "Physics",
    "question_code": "NEET-2023-PHY-01",
    "question_type": "MCQ",
    "difficulty": "Easy",
    "marks": 4,
    "negative": -1,
    "time_seconds": 60,
    "language": "English",
    "source": "NEET Previous Year",
    "source_name": "NEET 2023",
    "tags": ["Previous Year", "Formula Based", "NCERT"],
    "status": "Draft",
    "visibility": "School",
    "prompt": "The ratio of the radius of gyration of a thin uniform disc about an axis passing through its centre and normal to its plane to the radius of gyration of the disc about its diameter is:",
    "options": [
      { "key": "A", "text": "2 : 1" },
      { "key": "B", "text": "\\sqrt{2} : 1" },
      { "key": "C", "text": "4 : 1" },
      { "key": "D", "text": "1 : \\sqrt{2}" }
    ],
    "correct_answer": "\\sqrt{2} : 1",
    "explanation": "Radius of gyration about perpendicular central axis is k1 = R / \\sqrt{2}. About diameter it is k2 = R / 2. Therefore, k1 / k2 = (R/\\sqrt{2}) / (R/2) = \\sqrt{2} : 1."
  },
  {
    "exam_type": "NEET",
    "subject": "Chemistry",
    "question_code": "NEET-2022-CHE-05",
    "question_type": "MCQ",
    "difficulty": "Medium",
    "marks": 4,
    "negative": -1,
    "time_seconds": 60,
    "language": "English",
    "source": "NEET Previous Year",
    "source_name": "NEET 2022",
    "tags": ["Previous Year", "Conceptual", "Important", "NCERT"],
    "status": "Draft",
    "visibility": "School",
    "prompt": "Which amongst the following is incorrect statement regarding IUPAC nomenclature of coordination compounds?",
    "options": [
      { "key": "A", "text": "The central atom/ion is listed once with oxidation state in Roman numerals in parentheses." },
      { "key": "B", "text": "Ligands are named in alphabetical order before the name of the central atom/ion." },
      { "key": "C", "text": "Names of anionic ligands end in -o, whereas neutral ligands have special names." },
      { "key": "D", "text": "In a complex ion, the positive ligand is named before the negative ligand." }
    ],
    "correct_answer": "In a complex ion, the positive ligand is named before the negative ligand.",
    "explanation": "According to IUPAC rules, ligands are named in alphabetical order regardless of their charge, before the central metal atom/ion."
  },
  {
    "exam_type": "NEET",
    "subject": "Biology",
    "question_code": "NEET-2023-BIO-12",
    "question_type": "MCQ",
    "difficulty": "Easy",
    "marks": 4,
    "negative": -1,
    "time_seconds": 45,
    "language": "English",
    "source": "NEET Previous Year",
    "source_name": "NEET 2023",
    "tags": ["Previous Year", "NCERT", "Repeated"],
    "status": "Draft",
    "visibility": "School",
    "prompt": "During DNA replication, the term 'Okazaki fragments' refers to:",
    "options": [
      { "key": "A", "text": "The short segments of DNA synthesized continuously on the leading strand." },
      { "key": "B", "text": "The short segments of DNA synthesized discontinuously on the lagging strand." },
      { "key": "C", "text": "The RNA primers required to start DNA synthesis." },
      { "key": "D", "text": "The fragments generated during PCR amplification." }
    ],
    "correct_answer": "The short segments of DNA synthesized discontinuously on the lagging strand.",
    "explanation": "DNA polymerase synthesizes DNA only in 5' to 3' direction. Hence, on the lagging strand (3' to 5' template), synthesis occurs in small discontinuous segments known as Okazaki fragments."
  }
]
"""


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


def _build_option_items(options: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for option in options:
        key = str(option.get("key") or "").strip()
        text = str(option.get("text") or "").strip()
        if not key or not text:
            continue
        items.append({"id": key, "label": key, "value": text})
    return items


def _resolve_correct_option_id(option_items: list[dict[str, Any]], correct_answer: str) -> str:
    target = str(correct_answer or "").strip()
    for option in option_items:
        if str(option.get("value") or "").strip() == target:
            return str(option.get("id") or "")
    return ""


def _build_payload(item: dict[str, Any]) -> dict[str, Any]:
    option_items = _build_option_items(list(item.get("options") or []))
    correct_option_id = _resolve_correct_option_id(option_items, str(item.get("correct_answer") or ""))
    metadata = {
        "import_source": "backend/scripts/import_question_bank_payload.py",
        "original_exam_type": item.get("exam_type"),
        "original_question_type": item.get("question_type"),
        "source": item.get("source"),
        "source_name": item.get("source_name"),
    }
    return {
        "question_code": item.get("question_code"),
        "exam_type_slug": str(item.get("exam_type") or "custom").strip().lower(),
        "subject": item.get("subject"),
        "question_type": _normalize_question_type(item.get("question_type")),
        "difficulty_level": _normalize_difficulty(item.get("difficulty")),
        "prompt_text": item.get("prompt"),
        "option_items": option_items,
        "answer_key": {"correct_option_id": correct_option_id} if correct_option_id else {},
        "explanation": item.get("explanation"),
        "marks": float(item.get("marks") or 1),
        "negative_marks": abs(float(item.get("negative") or 0)),
        "estimated_time_seconds": int(item.get("time_seconds") or 60),
        "source_name": item.get("source_name"),
        "language": _normalize_language(item.get("language")),
        "visibility": _normalize_visibility(item.get("visibility")),
        "tags": list(item.get("tags") or []),
        "status": _normalize_status(item.get("status")),
        "metadata": metadata,
    }


def main() -> None:
    school_id = os.getenv("SUPABASE_TARGET_SCHOOL_ID", DEFAULT_SCHOOL_ID).strip() or DEFAULT_SCHOOL_ID
    questions = json.loads(RAW_QUESTIONS)
    inserted_codes: list[str] = []
    skipped_codes: list[str] = []

    for item in questions:
        prompt_text = str(item.get("prompt") or "")
        duplicate = qb_service.find_duplicate_question(school_id, prompt_text)
        if duplicate:
            skipped_codes.append(str(item.get("question_code") or duplicate.get("id") or "unknown"))
            continue
        created = qb_service.create_question(school_id, _build_payload(item))
        inserted_codes.append(str(created.get("question_code") or item.get("question_code") or "unknown"))

    print(json.dumps({
        "school_id": school_id,
        "inserted_count": len(inserted_codes),
        "inserted_codes": inserted_codes,
        "skipped_count": len(skipped_codes),
        "skipped_codes": skipped_codes,
    }, indent=2))


if __name__ == "__main__":
    main()
