"""Supabase-native offline exam repository and lifecycle helpers."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import HTTPException

from app.services.supabase_admin import get_supabase_admin_client

OFFLINE_EXAMS_MODULE_KEY = "offline_exams"
_OFFLINE_EXAMS_PUBLIC_PREFIX = "exam_"


def _client():
    return get_supabase_admin_client()


def _table(name: str):
    return _client().table(f"{_OFFLINE_EXAMS_PUBLIC_PREFIX}{name}")


def _normalize(value: Any) -> str:
    return str(value or "").strip()


def _normalize_optional_uuid(value: Any) -> str | None:
    text = _normalize(value)
    if not text:
        return None
    try:
        return str(UUID(text))
    except (TypeError, ValueError, AttributeError):
        return None


def _to_iso_datetime(value: Any) -> str | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    text = _normalize(value)
    return text or None


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_json_object(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _log_audit_entry(
    *,
    school_id: str | None,
    profile_id: str | None,
    action: str,
    entity_id: str | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    row: dict[str, Any] = {
        "school_id": _normalize_optional_uuid(school_id),
        "profile_id": _normalize_optional_uuid(profile_id),
        "action": action,
        "module_key": OFFLINE_EXAMS_MODULE_KEY,
        "payload": payload or {},
    }
    entity_uuid = _normalize_optional_uuid(entity_id)
    if entity_uuid:
        row["entity_id"] = entity_uuid
    _client().table("audit_logs").insert(row).execute()


def _serialize_section(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _normalize(row.get("id")),
        "exam_id": _normalize(row.get("exam_id")),
        "school_id": _normalize(row.get("school_id")),
        "title": _normalize(row.get("title")),
        "description": row.get("description"),
        "display_order": int(row.get("display_order") or 1),
        "question_type": _normalize(row.get("question_type")) or "mcq",
        "marks_per_question": float(row.get("marks_per_question") or 0),
        "negative_marks": float(row.get("negative_marks") or 0),
        "question_count": int(row.get("question_count") or 0),
        "is_active": bool(row.get("is_active", True)),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _serialize_exam(row: dict[str, Any], sections: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {
        "id": _normalize(row.get("id")),
        "school_id": _normalize(row.get("school_id")),
        "title": _normalize(row.get("title")),
        "description": row.get("description"),
        "instructions": row.get("instructions"),
        "exam_code": row.get("exam_code"),
        "subject_id": _normalize(row.get("subject_id")) or None,
        "batch_id": _normalize(row.get("batch_id")) or None,
        "exam_type": _normalize(row.get("exam_type")) or "custom",
        "paper_format": _normalize(row.get("paper_format")) or "mcq",
        "status": _normalize(row.get("status")) or "draft",
        "duration_minutes": int(row.get("duration_minutes") or 120),
        "total_marks": float(row.get("total_marks") or 0),
        "pass_marks": float(row.get("pass_marks")) if row.get("pass_marks") is not None else None,
        "total_sets": int(row.get("total_sets") or 1),
        "shuffle_questions": bool(row.get("shuffle_questions", False)),
        "allow_negative_marking": bool(row.get("allow_negative_marking", False)),
        "exam_date": row.get("exam_date"),
        "exam_start_time": row.get("exam_start_time"),
        "exam_end_time": row.get("exam_end_time"),
        "question_source": _normalize(row.get("question_source")) or "question_bank",
        "seating_required": bool(row.get("seating_required", True)),
        "invigilators_required": bool(row.get("invigilators_required", True)),
        "hall_tickets_required": bool(row.get("hall_tickets_required", True)),
        "published_at": row.get("published_at"),
        "metadata": _normalize_json_object(row.get("metadata")),
        "is_active": bool(row.get("is_active", True)),
        "sections": sections or [],
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _serialize_question(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _normalize(row.get("id")),
        "school_id": _normalize(row.get("school_id")),
        "exam_id": _normalize(row.get("exam_id")),
        "section_id": _normalize(row.get("section_id")),
        "question_code": row.get("question_code"),
        "display_order": int(row.get("display_order") or 1),
        "question_type": _normalize(row.get("question_type")) or "mcq",
        "difficulty_level": _normalize(row.get("difficulty_level")) or "medium",
        "prompt_text": _normalize(row.get("prompt_text")),
        "option_items": list(row.get("option_items") or []),
        "answer_key": _normalize_json_object(row.get("answer_key")),
        "explanation": row.get("explanation"),
        "marks": float(row.get("marks") or 0),
        "negative_marks": float(row.get("negative_marks") or 0),
        "set_labels": list(row.get("set_labels") or ["A"]),
        "metadata": _normalize_json_object(row.get("metadata")),
        "is_active": bool(row.get("is_active", True)),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _serialize_hall_ticket(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _normalize(row.get("id")),
        "school_id": _normalize(row.get("school_id")),
        "exam_id": _normalize(row.get("exam_id")),
        "student_id": _normalize(row.get("student_id")),
        "roll_number": _normalize(row.get("roll_number")),
        "room_id": _normalize(row.get("room_id")) or None,
        "seat_number": row.get("seat_number"),
        "set_label": row.get("set_label"),
        "status": _normalize(row.get("status")) or "issued",
        "metadata": _normalize_json_object(row.get("metadata")),
        "is_active": bool(row.get("is_active", True)),
        "student": row.get("student"),
        "room": row.get("room"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _serialize_attendance(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _normalize(row.get("id")),
        "school_id": _normalize(row.get("school_id")),
        "exam_id": _normalize(row.get("exam_id")),
        "student_id": _normalize(row.get("student_id")),
        "hall_ticket_id": _normalize(row.get("hall_ticket_id")) or None,
        "status": _normalize(row.get("status")) or "present",
        "entry_time": row.get("entry_time"),
        "exit_time": row.get("exit_time"),
        "remarks": row.get("remarks"),
        "marked_by": _normalize(row.get("marked_by")) or None,
        "is_active": bool(row.get("is_active", True)),
        "student": row.get("student"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _serialize_evaluation(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _normalize(row.get("id")),
        "school_id": _normalize(row.get("school_id")),
        "exam_id": _normalize(row.get("exam_id")),
        "student_id": _normalize(row.get("student_id")),
        "question_id": _normalize(row.get("question_id")),
        "set_label": _normalize(row.get("set_label")) or "A",
        "marks_awarded": float(row.get("marks_awarded") or 0),
        "max_marks": float(row.get("max_marks") or 0),
        "evaluator_id": _normalize(row.get("evaluator_id")) or None,
        "evaluation_method": _normalize(row.get("evaluation_method")) or "manual",
        "remarks": row.get("remarks"),
        "evaluated_at": row.get("evaluated_at"),
        "is_active": bool(row.get("is_active", True)),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _serialize_result(row: dict[str, Any]) -> dict[str, Any]:
    metadata = _normalize_json_object(row.get("metadata"))
    return {
        "id": _normalize(row.get("id")),
        "school_id": _normalize(row.get("school_id")),
        "exam_id": _normalize(row.get("exam_id")),
        "student_id": _normalize(row.get("student_id")),
        "total_questions": int(row.get("total_questions") or 0),
        "attempted_questions": int(row.get("attempted_questions") or 0),
        "correct_answers": int(row.get("correct_answers") or 0),
        "incorrect_answers": int(row.get("incorrect_answers") or 0),
        "unanswered_questions": int(row.get("unanswered_questions") or 0),
        "score_obtained": float(row.get("score_obtained") or 0),
        "max_score": float(row.get("max_score") or 0),
        "percentage": float(row.get("percentage")) if row.get("percentage") is not None else None,
        "rank_in_batch": int(row.get("rank_in_batch")) if row.get("rank_in_batch") is not None else None,
        "rank_in_school": int(row.get("rank_in_school")) if row.get("rank_in_school") is not None else None,
        "passed": metadata.get("passed") if "passed" in metadata else None,
        "pass_marks": float(metadata.get("pass_marks")) if metadata.get("pass_marks") is not None else None,
        "published_at": row.get("published_at"),
        "metadata": metadata,
        "is_active": bool(row.get("is_active", True)),
        "student": row.get("student"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _serialize_seating(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _normalize(row.get("id")),
        "school_id": _normalize(row.get("school_id")),
        "exam_id": _normalize(row.get("exam_id")),
        "room_id": _normalize(row.get("room_id")),
        "student_id": _normalize(row.get("student_id")),
        "seat_number": int(row.get("seat_number") or 0),
        "row_number": int(row.get("row_number")) if row.get("row_number") is not None else None,
        "column_number": int(row.get("column_number")) if row.get("column_number") is not None else None,
        "set_label": row.get("set_label"),
        "invigilator_id": _normalize(row.get("invigilator_id")) or None,
        "is_active": bool(row.get("is_active", True)),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _load_sections_map(school_id: str, exam_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    if not exam_ids:
        return {}
    rows = list(
        _table("exam_sections")
        .select("*")
        .eq("school_id", school_id)
        .in_("exam_id", exam_ids)
        .is_("deleted_at", "null")
        .order("display_order", desc=False)
        .execute()
        .data
        or []
    )
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        exam_id = _normalize(row.get("exam_id"))
        grouped.setdefault(exam_id, []).append(_serialize_section(dict(row)))
    return grouped


def _get_exam_row(school_id: str, exam_id: str) -> dict[str, Any]:
    rows = list(
        _table("exams")
        .select("*")
        .eq("school_id", school_id)
        .eq("id", exam_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Offline exam not found")
    return dict(rows[0])


def _ensure_default_section(school_id: str, exam_id: str) -> dict[str, Any]:
    existing_rows = list(
        _table("exam_sections")
        .select("*")
        .eq("school_id", school_id)
        .eq("exam_id", exam_id)
        .is_("deleted_at", "null")
        .order("display_order", desc=False)
        .limit(1)
        .execute()
        .data
        or []
    )
    if existing_rows:
        return dict(existing_rows[0])
    created = (
        _table("exam_sections")
        .insert(
            {
                "school_id": school_id,
                "exam_id": exam_id,
                "title": "Section 1",
                "display_order": 1,
                "question_type": "mcq",
                "marks_per_question": 1,
                "negative_marks": 0,
                "question_count": 0,
            }
        )
        .execute()
    )
    rows = list(created.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Default exam section could not be created")
    return dict(rows[0])


def _recount_section_questions(school_id: str, section_id: str) -> None:
    response = (
        _table("exam_questions")
        .select("id", count="exact")
        .eq("school_id", school_id)
        .eq("section_id", section_id)
        .is_("deleted_at", "null")
        .limit(0)
        .execute()
    )
    (
        _table("exam_sections")
        .update({"question_count": int(response.count or 0)})
        .eq("school_id", school_id)
        .eq("id", section_id)
        .execute()
    )


def _resolve_section_id(school_id: str, exam_id: str, section_id: str | None) -> str:
    candidate = _normalize(section_id)
    if candidate:
        rows = list(
            _table("exam_sections")
            .select("id")
            .eq("school_id", school_id)
            .eq("exam_id", exam_id)
            .eq("id", candidate)
            .is_("deleted_at", "null")
            .limit(1)
            .execute()
            .data
            or []
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Exam section not found")
        return candidate

    sections = list(
        _table("exam_sections")
        .select("id")
        .eq("school_id", school_id)
        .eq("exam_id", exam_id)
        .is_("deleted_at", "null")
        .order("display_order", desc=False)
        .execute()
        .data
        or []
    )
    if len(sections) == 1:
        return _normalize(sections[0].get("id"))
    if not sections:
        return _normalize(_ensure_default_section(school_id, exam_id).get("id"))
    raise HTTPException(status_code=400, detail="section_id is required when an exam has multiple sections")


# ─── CRUD operations ────────────────────────────────────────────────────

def list_exams(school_id: str) -> list[dict[str, Any]]:
    rows = list(
        _table("exams")
        .select("*")
        .eq("school_id", school_id)
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    exam_ids = [_normalize(row.get("id")) for row in rows]
    sections_map = _load_sections_map(school_id, exam_ids)
    return [_serialize_exam(dict(row), sections_map.get(_normalize(row.get("id")), [])) for row in rows]


def get_exam(school_id: str, exam_id: str) -> dict[str, Any]:
    row = _get_exam_row(school_id, exam_id)
    sections = list(
        _table("exam_sections")
        .select("*")
        .eq("school_id", school_id)
        .eq("exam_id", exam_id)
        .is_("deleted_at", "null")
        .order("display_order", desc=False)
        .execute()
        .data
        or []
    )
    return _serialize_exam(row, [_serialize_section(dict(s)) for s in sections])


def create_exam(school_id: str, profile_id: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    title = _normalize(payload.get("title"))
    if not title:
        raise HTTPException(status_code=400, detail="Exam title is required")
    desired_status = _normalize(payload.get("status")) or "draft"
    insert_payload = {
        "school_id": school_id,
        "subject_id": _normalize_optional_uuid(payload.get("subject_id")),
        "batch_id": _normalize_optional_uuid(payload.get("batch_id")),
        "created_by_profile_id": _normalize_optional_uuid(profile_id),
        "exam_code": _normalize(payload.get("exam_code")) or None,
        "title": title,
        "description": payload.get("description"),
        "instructions": payload.get("instructions"),
        "exam_type": _normalize(payload.get("exam_type")) or "custom",
        "paper_format": _normalize(payload.get("paper_format")) or "mcq",
        "status": desired_status,
        "duration_minutes": int(payload.get("duration_minutes") or 120),
        "total_marks": float(payload.get("total_marks") or 0),
        "pass_marks": float(payload.get("pass_marks")) if payload.get("pass_marks") is not None else None,
        "total_sets": int(payload.get("total_sets") or 1),
        "shuffle_questions": bool(payload.get("shuffle_questions", False)),
        "allow_negative_marking": bool(payload.get("allow_negative_marking", False)),
        "exam_date": payload.get("exam_date"),
        "exam_start_time": payload.get("exam_start_time"),
        "exam_end_time": payload.get("exam_end_time"),
        "question_source": _normalize(payload.get("question_source")) or "question_bank",
        "seating_required": bool(payload.get("seating_required", True)),
        "invigilators_required": bool(payload.get("invigilators_required", True)),
        "hall_tickets_required": bool(payload.get("hall_tickets_required", True)),
        "published_at": _utc_now_iso() if desired_status == "published" else None,
        "metadata": _normalize_json_object(payload.get("metadata")),
        "is_active": True,
    }
    response = _table("exams").insert(insert_payload).execute()
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Exam create returned no row")
    created = dict(rows[0])
    created_id = _normalize(created.get("id"))
    _ensure_default_section(school_id, created_id)

    sections_payload = payload.get("sections") or []
    if sections_payload:
        _create_sections(school_id, created_id, sections_payload)

    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action="offline_exams.exam_created",
        entity_id=created_id,
        payload={"title": title, "status": desired_status},
    )
    return get_exam(school_id, created_id)


def _create_sections(school_id: str, exam_id: str, sections: list[dict[str, Any]]) -> None:
    for idx, section in enumerate(sections, start=1):
        _table("exam_sections").insert(
            {
                "school_id": school_id,
                "exam_id": exam_id,
                "title": _normalize(section.get("title")) or f"Section {idx}",
                "description": section.get("description"),
                "display_order": int(section.get("display_order") or idx),
                "question_type": _normalize(section.get("question_type")) or "mcq",
                "marks_per_question": float(section.get("marks_per_question") or 1),
                "negative_marks": float(section.get("negative_marks") or 0),
                "question_count": int(section.get("question_count") or 0),
            }
        ).execute()


def update_exam(school_id: str, exam_id: str, profile_id: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    existing = _get_exam_row(school_id, exam_id)
    update_payload: dict[str, Any] = {}
    for key in (
        "title", "description", "instructions", "exam_code", "exam_type",
        "paper_format", "status", "shuffle_questions", "allow_negative_marking",
        "question_source", "seating_required", "invigilators_required",
        "hall_tickets_required", "is_active",
    ):
        if key in payload:
            update_payload[key] = payload.get(key)
    if "subject_id" in payload:
        update_payload["subject_id"] = _normalize_optional_uuid(payload.get("subject_id"))
    if "batch_id" in payload:
        update_payload["batch_id"] = _normalize_optional_uuid(payload.get("batch_id"))
    if "duration_minutes" in payload and payload.get("duration_minutes") is not None:
        update_payload["duration_minutes"] = int(payload.get("duration_minutes"))
    if "total_marks" in payload and payload.get("total_marks") is not None:
        update_payload["total_marks"] = float(payload.get("total_marks"))
    if "pass_marks" in payload:
        update_payload["pass_marks"] = float(payload.get("pass_marks")) if payload.get("pass_marks") is not None else None
    if "total_sets" in payload and payload.get("total_sets") is not None:
        update_payload["total_sets"] = int(payload.get("total_sets"))
    if "exam_date" in payload:
        update_payload["exam_date"] = payload.get("exam_date")
    if "exam_start_time" in payload:
        update_payload["exam_start_time"] = payload.get("exam_start_time")
    if "exam_end_time" in payload:
        update_payload["exam_end_time"] = payload.get("exam_end_time")
    if "metadata" in payload and payload.get("metadata") is not None:
        update_payload["metadata"] = _normalize_json_object(payload.get("metadata"))

    new_status = _normalize(update_payload.get("status") or existing.get("status"))
    old_status = _normalize(existing.get("status"))
    if new_status == "published" and old_status != "published":
        update_payload["published_at"] = _utc_now_iso()

    _table("exams").update(update_payload).eq("school_id", school_id).eq("id", exam_id).execute()
    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action="offline_exams.exam_updated",
        entity_id=exam_id,
        payload={"updated_fields": list(update_payload.keys())},
    )
    return get_exam(school_id, exam_id)


def delete_exam(school_id: str, exam_id: str, profile_id: str | None) -> None:
    _get_exam_row(school_id, exam_id)
    _table("exams").update({"deleted_at": _utc_now_iso(), "is_active": False}).eq("school_id", school_id).eq("id", exam_id).execute()
    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action="offline_exams.exam_deleted",
        entity_id=exam_id,
    )


def publish_exam(school_id: str, exam_id: str, profile_id: str | None) -> dict[str, Any]:
    return update_exam(school_id, exam_id, profile_id, {"status": "published"})


def unpublish_exam(school_id: str, exam_id: str, profile_id: str | None) -> dict[str, Any]:
    return update_exam(school_id, exam_id, profile_id, {"status": "draft"})


def duplicate_exam(school_id: str, exam_id: str, profile_id: str | None) -> dict[str, Any]:
    existing = get_exam(school_id, exam_id)
    payload = {
        "title": f"{existing['title']} (Copy)",
        "description": existing.get("description"),
        "instructions": existing.get("instructions"),
        "exam_code": existing.get("exam_code"),
        "subject_id": existing.get("subject_id"),
        "batch_id": existing.get("batch_id"),
        "exam_type": existing.get("exam_type"),
        "paper_format": existing.get("paper_format"),
        "duration_minutes": existing.get("duration_minutes"),
        "total_marks": existing.get("total_marks"),
        "pass_marks": existing.get("pass_marks"),
        "total_sets": existing.get("total_sets"),
        "shuffle_questions": existing.get("shuffle_questions"),
        "allow_negative_marking": existing.get("allow_negative_marking"),
        "question_source": existing.get("question_source"),
        "seating_required": existing.get("seating_required"),
        "invigilators_required": existing.get("invigilators_required"),
        "hall_tickets_required": existing.get("hall_tickets_required"),
        "status": "draft",
        "sections": [
            {"title": s["title"], "question_type": s["question_type"],
             "marks_per_question": s["marks_per_question"], "negative_marks": s["negative_marks"]}
            for s in existing.get("sections", [])
        ],
    }
    return create_exam(school_id, profile_id, payload)


# ─── Questions ──────────────────────────────────────────────────────────

def list_questions(school_id: str, exam_id: str) -> list[dict[str, Any]]:
    _get_exam_row(school_id, exam_id)
    rows = list(
        _table("exam_questions")
        .select("*")
        .eq("school_id", school_id)
        .eq("exam_id", exam_id)
        .is_("deleted_at", "null")
        .order("section_id", desc=False)
        .order("display_order", desc=False)
        .execute()
        .data
        or []
    )
    return [_serialize_question(dict(row)) for row in rows]


def create_question(school_id: str, exam_id: str, profile_id: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    _get_exam_row(school_id, exam_id)
    section_id = _resolve_section_id(school_id, exam_id, payload.get("section_id"))
    prompt_text = _normalize(payload.get("prompt_text"))
    if not prompt_text:
        raise HTTPException(status_code=400, detail="prompt_text is required")
    insert_payload = {
        "school_id": school_id,
        "exam_id": exam_id,
        "section_id": section_id,
        "question_code": _normalize(payload.get("question_code")) or None,
        "display_order": int(payload.get("display_order") or 1),
        "question_type": _normalize(payload.get("question_type")) or "mcq",
        "difficulty_level": _normalize(payload.get("difficulty_level")) or "medium",
        "prompt_text": prompt_text,
        "option_items": list(payload.get("option_items") or []),
        "answer_key": _normalize_json_object(payload.get("answer_key")),
        "explanation": payload.get("explanation"),
        "marks": float(payload.get("marks") or 1),
        "negative_marks": float(payload.get("negative_marks") or 0),
        "set_labels": list(payload.get("set_labels") or ["A"]),
        "metadata": _normalize_json_object(payload.get("metadata")),
    }
    response = _table("exam_questions").insert(insert_payload).execute()
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Question create returned no row")
    _recount_section_questions(school_id, section_id)
    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action="offline_exams.question_created",
        entity_id=_normalize(rows[0].get("id")),
        payload={"exam_id": exam_id},
    )
    return _serialize_question(dict(rows[0]))


def update_question(school_id: str, question_id: str, profile_id: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    rows = list(
        _table("exam_questions")
        .select("*")
        .eq("school_id", school_id)
        .eq("id", question_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Question not found")
    update_payload: dict[str, Any] = {}
    for key in ("question_code", "display_order", "question_type", "difficulty_level",
                "prompt_text", "option_items", "answer_key", "explanation",
                "marks", "negative_marks", "set_labels", "metadata", "is_active"):
        if key in payload:
            update_payload[key] = payload.get(key)
    if "section_id" in payload:
        update_payload["section_id"] = _resolve_section_id(
            school_id, _normalize(rows[0].get("exam_id")), payload.get("section_id")
        )
    _table("exam_questions").update(update_payload).eq("school_id", school_id).eq("id", question_id).execute()
    _recount_section_questions(school_id, _normalize(rows[0].get("section_id")))
    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action="offline_exams.question_updated",
        entity_id=question_id,
    )
    updated_rows = list(
        _table("exam_questions").select("*").eq("school_id", school_id).eq("id", question_id).limit(1).execute().data or []
    )
    return _serialize_question(dict(updated_rows[0])) if updated_rows else _serialize_question(dict(rows[0]))


def delete_question(school_id: str, question_id: str, profile_id: str | None) -> None:
    rows = list(
        _table("exam_questions")
        .select("section_id, exam_id")
        .eq("school_id", school_id)
        .eq("id", question_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Question not found")
    section_id = _normalize(rows[0].get("section_id"))
    _table("exam_questions").update({"deleted_at": _utc_now_iso(), "is_active": False}).eq("school_id", school_id).eq("id", question_id).execute()
    _recount_section_questions(school_id, section_id)
    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action="offline_exams.question_deleted",
        entity_id=question_id,
    )


# ─── Hall Tickets ───────────────────────────────────────────────────────

def list_hall_tickets(school_id: str, exam_id: str) -> list[dict[str, Any]]:
    _get_exam_row(school_id, exam_id)
    rows = list(
        _table("hall_tickets")
        .select("*")
        .eq("school_id", school_id)
        .eq("exam_id", exam_id)
        .is_("deleted_at", "null")
        .order("roll_number", desc=False)
        .execute()
        .data
        or []
    )
    student_ids = list({_normalize(r.get("student_id")) for r in rows if r.get("student_id")})
    student_map = _student_rows_by_ids(school_id, student_ids)
    for row in rows:
        sid = _normalize(row.get("student_id"))
        row["student"] = student_map.get(sid)
    return [_serialize_hall_ticket(dict(row)) for row in rows]


def generate_hall_tickets(school_id: str, exam_id: str, profile_id: str | None) -> list[dict[str, Any]]:
    exam = _get_exam_row(school_id, exam_id)
    batch_id = _normalize(exam.get("batch_id"))
    existing_tickets = list(
        _table("hall_tickets")
        .select("id")
        .eq("school_id", school_id)
        .eq("exam_id", exam_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    if existing_tickets:
        raise HTTPException(status_code=400, detail="Hall tickets already generated for this exam")

    student_query = _client().table("students").select("id, full_name").eq("school_id", school_id).eq("is_active", True)
    if batch_id:
        student_query = student_query.eq("batch_id", batch_id)
    students = list(student_query.execute().data or [])
    if not students:
        raise HTTPException(status_code=400, detail="No active students found for this exam")

    total_sets = int(exam.get("total_sets") or 1)
    set_labels = [chr(65 + i) for i in range(total_sets)]
    hall_ticket_rows = []
    for idx, student in enumerate(students, start=1):
        hall_ticket_rows.append({
            "school_id": school_id,
            "exam_id": exam_id,
            "student_id": _normalize(student.get("id")),
            "roll_number": f"HT-{exam_id[:8]}-{idx:04d}",
            "set_label": set_labels[(idx - 1) % total_sets],
            "status": "issued",
        })
    if hall_ticket_rows:
        _table("hall_tickets").insert(hall_ticket_rows).execute()
    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action="offline_exams.hall_tickets_generated",
        entity_id=exam_id,
        payload={"count": len(hall_ticket_rows)},
    )
    return list_hall_tickets(school_id, exam_id)


def _student_rows_by_ids(school_id: str, student_ids: list[str]) -> dict[str, dict[str, Any]]:
    cleaned_ids = [_normalize(sid) for sid in student_ids if _normalize(sid)]
    if not cleaned_ids:
        return {}
    rows = list(
        _client()
        .table("students")
        .select("id, full_name, batch_id")
        .eq("school_id", school_id)
        .in_("id", cleaned_ids)
        .execute()
        .data
        or []
    )
    return {_normalize(row.get("id")): dict(row) for row in rows}


# ─── Attendance ─────────────────────────────────────────────────────────

def list_attendance(school_id: str, exam_id: str) -> list[dict[str, Any]]:
    _get_exam_row(school_id, exam_id)
    rows = list(
        _table("exam_attendance")
        .select("*")
        .eq("school_id", school_id)
        .eq("exam_id", exam_id)
        .is_("deleted_at", "null")
        .order("created_at", desc=False)
        .execute()
        .data
        or []
    )
    student_ids = list({_normalize(r.get("student_id")) for r in rows if r.get("student_id")})
    student_map = _student_rows_by_ids(school_id, student_ids)
    for row in rows:
        sid = _normalize(row.get("student_id"))
        row["student"] = student_map.get(sid)
    return [_serialize_attendance(dict(row)) for row in rows]


def mark_attendance(school_id: str, exam_id: str, profile_id: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    _get_exam_row(school_id, exam_id)
    student_id = _normalize(payload.get("student_id"))
    if not student_id:
        raise HTTPException(status_code=400, detail="student_id is required")
    insert_payload = {
        "school_id": school_id,
        "exam_id": exam_id,
        "student_id": student_id,
        "hall_ticket_id": _normalize_optional_uuid(payload.get("hall_ticket_id")),
        "status": _normalize(payload.get("status")) or "present",
        "entry_time": payload.get("entry_time"),
        "exit_time": payload.get("exit_time"),
        "remarks": payload.get("remarks"),
        "marked_by": _normalize_optional_uuid(profile_id),
    }
    response = _table("exam_attendance").insert(insert_payload).execute()
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Attendance mark returned no row")
    return _serialize_attendance(dict(rows[0]))


# ─── Evaluations ────────────────────────────────────────────────────────

def list_evaluations(school_id: str, exam_id: str) -> list[dict[str, Any]]:
    _get_exam_row(school_id, exam_id)
    rows = list(
        _table("exam_evaluations")
        .select("*")
        .eq("school_id", school_id)
        .eq("exam_id", exam_id)
        .is_("deleted_at", "null")
        .order("student_id", desc=False)
        .execute()
        .data
        or []
    )
    return [_serialize_evaluation(dict(row)) for row in rows]


def save_evaluation(school_id: str, exam_id: str, profile_id: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    _get_exam_row(school_id, exam_id)
    student_id = _normalize(payload.get("student_id"))
    question_id = _normalize(payload.get("question_id"))
    if not student_id or not question_id:
        raise HTTPException(status_code=400, detail="student_id and question_id are required")
    existing = list(
        _table("exam_evaluations")
        .select("id")
        .eq("school_id", school_id)
        .eq("exam_id", exam_id)
        .eq("student_id", student_id)
        .eq("question_id", question_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    update_payload = {
        "school_id": school_id,
        "exam_id": exam_id,
        "student_id": student_id,
        "question_id": question_id,
        "set_label": _normalize(payload.get("set_label")) or "A",
        "marks_awarded": float(payload.get("marks_awarded") or 0),
        "max_marks": float(payload.get("max_marks") or 1),
        "evaluator_id": _normalize_optional_uuid(profile_id),
        "evaluation_method": _normalize(payload.get("evaluation_method")) or "manual",
        "remarks": payload.get("remarks"),
        "evaluated_at": _utc_now_iso(),
    }
    if existing:
        eval_id = _normalize(existing[0].get("id"))
        _table("exam_evaluations").update(update_payload).eq("school_id", school_id).eq("id", eval_id).execute()
        rows = list(_table("exam_evaluations").select("*").eq("school_id", school_id).eq("id", eval_id).limit(1).execute().data or [])
        return _serialize_evaluation(dict(rows[0])) if rows else update_payload
    else:
        response = _table("exam_evaluations").insert(update_payload).execute()
        rows = list(response.data or [])
        return _serialize_evaluation(dict(rows[0])) if rows else update_payload


def import_evaluations_from_excel(school_id: str, exam_id: str, profile_id: str | None, rows_data: list[dict[str, Any]]) -> dict[str, Any]:
    _get_exam_row(school_id, exam_id)
    created_count = 0
    for row in rows_data:
        student_id = _normalize(row.get("student_id"))
        question_id = _normalize(row.get("question_id"))
        if student_id and question_id:
            save_evaluation(school_id, exam_id, profile_id, row)
            created_count += 1
    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action="offline_exams.evaluations_imported",
        entity_id=exam_id,
        payload={"created_count": created_count},
    )
    return {"created_count": created_count}


# ─── Results ────────────────────────────────────────────────────────────

def list_results(school_id: str, exam_id: str) -> list[dict[str, Any]]:
    _get_exam_row(school_id, exam_id)
    rows = list(
        _table("exam_results")
        .select("*")
        .eq("school_id", school_id)
        .eq("exam_id", exam_id)
        .is_("deleted_at", "null")
        .order("score_obtained", desc=True)
        .execute()
        .data
        or []
    )
    student_ids = list({_normalize(r.get("student_id")) for r in rows if r.get("student_id")})
    student_map = _student_rows_by_ids(school_id, student_ids)
    for row in rows:
        sid = _normalize(row.get("student_id"))
        row["student"] = student_map.get(sid)
    return [_serialize_result(dict(row)) for row in rows]


def publish_results(school_id: str, exam_id: str, profile_id: str | None) -> dict[str, Any]:
    _get_exam_row(school_id, exam_id)
    now = _utc_now_iso()
    _table("exam_results").update({"published_at": now}).eq("school_id", school_id).eq("exam_id", exam_id).is_("deleted_at", "null").execute()
    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action="offline_exams.results_published",
        entity_id=exam_id,
    )
    count = list(
        _table("exam_results").select("id", count="exact").eq("school_id", school_id).eq("exam_id", exam_id).limit(0).execute()
    )
    return {"published_count": int(count[1] if isinstance(count, tuple) else 0)}


# ─── Seating ────────────────────────────────────────────────────────────

def list_seating(school_id: str, exam_id: str) -> list[dict[str, Any]]:
    _get_exam_row(school_id, exam_id)
    rows = list(
        _table("exam_seating")
        .select("*")
        .eq("school_id", school_id)
        .eq("exam_id", exam_id)
        .is_("deleted_at", "null")
        .order("room_id", desc=False)
        .order("seat_number", desc=False)
        .execute()
        .data
        or []
    )
    return [_serialize_seating(dict(row)) for row in rows]


def generate_seating(school_id: str, exam_id: str, profile_id: str | None, config: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    _get_exam_row(school_id, exam_id)
    existing = list(
        _table("exam_seating")
        .select("id")
        .eq("school_id", school_id)
        .eq("exam_id", exam_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    if existing:
        raise HTTPException(status_code=400, detail="Seating plan already exists for this exam. Delete it first.")
    hall_tickets = list_hall_tickets(school_id, exam_id)
    if not hall_tickets:
        raise HTTPException(status_code=400, detail="Generate hall tickets first before generating seating plan")
    rooms = list(
        _client()
        .table("rooms")
        .select("id, capacity")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .execute()
        .data
        or []
    )
    if not rooms:
        raise HTTPException(status_code=400, detail="No active rooms found for seating")

    seating_rows = []
    seat_counter = 0
    for room in rooms:
        room_id = _normalize(room.get("id"))
        capacity = int(room.get("capacity") or 30)
        for seat_num in range(1, capacity + 1):
            if seat_counter >= len(hall_tickets):
                break
            ticket = hall_tickets[seat_counter]
            seating_rows.append({
                "school_id": school_id,
                "exam_id": exam_id,
                "room_id": room_id,
                "student_id": ticket["student_id"],
                "seat_number": seat_num,
                "set_label": ticket.get("set_label"),
            })
            seat_counter += 1
        if seat_counter >= len(hall_tickets):
            break

    if seating_rows:
        _table("exam_seating").insert(seating_rows).execute()
    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action="offline_exams.seating_generated",
        entity_id=exam_id,
        payload={"seats_allocated": len(seating_rows)},
    )
    return list_seating(school_id, exam_id)


# ─── Analytics ──────────────────────────────────────────────────────────

def get_analytics(school_id: str, exam_id: str) -> dict[str, Any]:
    _get_exam_row(school_id, exam_id)
    results = list_results(school_id, exam_id)
    attendance = list_attendance(school_id, exam_id)
    total_students = len(results)
    scores = [r["score_obtained"] for r in results]
    percentages = [r["percentage"] for r in results if r.get("percentage") is not None]
    present_count = sum(1 for a in attendance if a["status"] == "present")
    return {
        "scope": "exam",
        "exam_id": exam_id,
        "total_exams": 1,
        "total_students": total_students,
        "average_score": sum(scores) / len(scores) if scores else 0,
        "average_percentage": sum(percentages) / len(percentages) if percentages else 0,
        "highest_score": max(scores) if scores else 0,
        "lowest_score": min(scores) if scores else 0,
        "pass_rate": sum(1 for r in results if r.get("passed")) / total_students * 100 if total_students else 0,
        "attendance_rate": present_count / len(attendance) * 100 if attendance else 0,
        "subject_wise_analysis": [],
        "question_wise_analysis": [],
        "student_ranking": [
            {"student_id": r["student_id"], "student_name": (r.get("student") or {}).get("full_name", "Unknown"),
             "score_obtained": r["score_obtained"], "percentage": r.get("percentage"), "rank": idx + 1}
            for idx, r in enumerate(results[:10])
        ],
    }
