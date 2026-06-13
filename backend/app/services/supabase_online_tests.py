"""Supabase-native online test repository and lifecycle helpers."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import HTTPException

from app.services.supabase_admin import get_supabase_admin_client

ONLINE_TESTS_SCHEMA = "online_tests"
ONLINE_TESTS_MODULE_KEY = "online_tests"


def _client():
    return get_supabase_admin_client()


def _table(name: str):
    return _client().schema(ONLINE_TESTS_SCHEMA).table(name)


def _normalize(value: Any) -> str:
    return str(value or "").strip()


def _normalize_optional_uuid(value: Any) -> str | None:
    text = _normalize(value)
    if not text:
        return None
    try:
        return str(UUID(text))
    except (TypeError, ValueError, AttributeError) as exc:
        raise HTTPException(status_code=400, detail="Expected a valid UUID value") from exc


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
        "module_key": ONLINE_TESTS_MODULE_KEY,
        "payload": payload or {},
    }
    entity_uuid = _normalize_optional_uuid(entity_id)
    if entity_uuid:
        row["entity_id"] = entity_uuid
    _client().table("audit_logs").insert(row).execute()


def _serialize_section(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _normalize(row.get("id")),
        "test_id": _normalize(row.get("test_id")),
        "school_id": _normalize(row.get("school_id")),
        "title": _normalize(row.get("title")),
        "description": row.get("description"),
        "display_order": int(row.get("display_order") or 1),
        "question_type": _normalize(row.get("question_type")) or "mixed",
        "marks_per_question": float(row.get("marks_per_question") or 0),
        "negative_marks": float(row.get("negative_marks") or 0),
        "question_count": int(row.get("question_count") or 0),
        "is_active": bool(row.get("is_active", True)),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _serialize_test(row: dict[str, Any], sections: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {
        "id": _normalize(row.get("id")),
        "school_id": _normalize(row.get("school_id")),
        "title": _normalize(row.get("title")),
        "description": row.get("description"),
        "instructions": row.get("instructions"),
        "test_code": row.get("test_code"),
        "subject_id": _normalize(row.get("subject_id")) or None,
        "batch_id": _normalize(row.get("batch_id")) or None,
        "test_type": _normalize(row.get("test_type")) or "objective",
        "delivery_mode": _normalize(row.get("delivery_mode")) or "scheduled",
        "status": _normalize(row.get("status")) or "draft",
        "duration_minutes": int(row.get("duration_minutes") or 0),
        "total_marks": float(row.get("total_marks") or 0),
        "pass_marks": float(row.get("pass_marks")) if row.get("pass_marks") is not None else None,
        "max_attempts": int(row.get("max_attempts") or 1),
        "shuffle_questions": bool(row.get("shuffle_questions", False)),
        "shuffle_options": bool(row.get("shuffle_options", False)),
        "show_result_immediately": bool(row.get("show_result_immediately", False)),
        "allow_review": bool(row.get("allow_review", True)),
        "starts_at": row.get("starts_at"),
        "ends_at": row.get("ends_at"),
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
        "test_id": _normalize(row.get("test_id")),
        "section_id": _normalize(row.get("section_id")),
        "question_code": row.get("question_code"),
        "display_order": int(row.get("display_order") or 1),
        "question_type": _normalize(row.get("question_type")) or "single_choice",
        "difficulty_level": _normalize(row.get("difficulty_level")) or "medium",
        "prompt_text": _normalize(row.get("prompt_text")),
        "option_items": list(row.get("option_items") or []),
        "answer_key": _normalize_json_object(row.get("answer_key")),
        "explanation": row.get("explanation"),
        "marks": float(row.get("marks") or 0),
        "negative_marks": float(row.get("negative_marks") or 0),
        "metadata": _normalize_json_object(row.get("metadata")),
        "is_active": bool(row.get("is_active", True)),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _sanitize_question_for_student(question: dict[str, Any]) -> dict[str, Any]:
    sanitized = dict(question)
    sanitized["answer_key"] = {}
    sanitized["explanation"] = None
    return sanitized


def _serialize_response(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _normalize(row.get("id")),
        "school_id": _normalize(row.get("school_id")),
        "attempt_id": _normalize(row.get("attempt_id")),
        "test_id": _normalize(row.get("test_id")),
        "question_id": _normalize(row.get("question_id")),
        "student_id": _normalize(row.get("student_id")),
        "response_payload": _normalize_json_object(row.get("response_payload")),
        "is_marked_for_review": bool(row.get("is_marked_for_review", False)),
        "is_correct": row.get("is_correct"),
        "marks_awarded": float(row.get("marks_awarded")) if row.get("marks_awarded") is not None else None,
        "answered_at": row.get("answered_at"),
        "evaluated_at": row.get("evaluated_at"),
        "metadata": _normalize_json_object(row.get("metadata")),
        "is_active": bool(row.get("is_active", True)),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _serialize_attempt(row: dict[str, Any], responses: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {
        "id": _normalize(row.get("id")),
        "school_id": _normalize(row.get("school_id")),
        "test_id": _normalize(row.get("test_id")),
        "student_id": _normalize(row.get("student_id")),
        "attempt_number": int(row.get("attempt_number") or 1),
        "status": _normalize(row.get("status")) or "in_progress",
        "started_at": row.get("started_at"),
        "submitted_at": row.get("submitted_at"),
        "auto_submitted_at": row.get("auto_submitted_at"),
        "evaluated_at": row.get("evaluated_at"),
        "total_questions_snapshot": int(row.get("total_questions_snapshot") or 0),
        "answered_questions_snapshot": int(row.get("answered_questions_snapshot") or 0),
        "time_spent_seconds": int(row.get("time_spent_seconds") or 0),
        "metadata": _normalize_json_object(row.get("metadata")),
        "is_active": bool(row.get("is_active", True)),
        "responses": responses or [],
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _serialize_result(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _normalize(row.get("id")),
        "school_id": _normalize(row.get("school_id")),
        "attempt_id": _normalize(row.get("attempt_id")),
        "test_id": _normalize(row.get("test_id")),
        "student_id": _normalize(row.get("student_id")),
        "status": _normalize(row.get("status")) or "evaluated",
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
        "published_at": row.get("published_at"),
        "metadata": _normalize_json_object(row.get("metadata")),
        "is_active": bool(row.get("is_active", True)),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _load_sections_map(school_id: str, test_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    if not test_ids:
        return {}
    rows = list(
        _table("test_sections")
        .select("*")
        .eq("school_id", school_id)
        .in_("test_id", test_ids)
        .is_("deleted_at", "null")
        .order("display_order", desc=False)
        .execute()
        .data
        or []
    )
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        test_id = _normalize(row.get("test_id"))
        grouped.setdefault(test_id, []).append(_serialize_section(dict(row)))
    return grouped


def _get_test_row(school_id: str, test_id: str) -> dict[str, Any]:
    rows = list(
        _table("tests")
        .select("*")
        .eq("school_id", school_id)
        .eq("id", test_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Online test not found")
    return dict(rows[0])


def _get_attempt_row(school_id: str, attempt_id: str) -> dict[str, Any]:
    rows = list(
        _table("test_attempts")
        .select("*")
        .eq("school_id", school_id)
        .eq("id", attempt_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Test attempt not found")
    return dict(rows[0])


def _get_result_row(school_id: str, result_id: str) -> dict[str, Any]:
    rows = list(
        _table("test_results")
        .select("*")
        .eq("school_id", school_id)
        .eq("id", result_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Test result not found")
    return dict(rows[0])


def _get_student_by_profile_id(school_id: str, profile_id: str) -> dict[str, Any]:
    rows = list(
        _client()
        .table("students")
        .select("id, school_id, profile_id, batch_id, full_name")
        .eq("school_id", school_id)
        .eq("profile_id", profile_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=403, detail="Student profile is not linked to an active student record")
    return dict(rows[0])


def _ensure_default_section(school_id: str, test_id: str) -> dict[str, Any]:
    existing_rows = list(
        _table("test_sections")
        .select("*")
        .eq("school_id", school_id)
        .eq("test_id", test_id)
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
        _table("test_sections")
        .insert(
            {
                "school_id": school_id,
                "test_id": test_id,
                "section_code": "SEC-1",
                "title": "Section 1",
                "display_order": 1,
                "question_type": "mixed",
                "marks_per_question": 1,
                "negative_marks": 0,
                "question_count": 0,
            }
        )
        .execute()
    )
    rows = list(created.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Default test section could not be created")
    return dict(rows[0])


def _resolve_section_id(school_id: str, test_id: str, section_id: str | None) -> str:
    candidate = _normalize(section_id)
    if candidate:
        rows = list(
            _table("test_sections")
            .select("id")
            .eq("school_id", school_id)
            .eq("test_id", test_id)
            .eq("id", candidate)
            .is_("deleted_at", "null")
            .limit(1)
            .execute()
            .data
            or []
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Test section not found")
        return candidate

    sections = list(
        _table("test_sections")
        .select("id")
        .eq("school_id", school_id)
        .eq("test_id", test_id)
        .is_("deleted_at", "null")
        .order("display_order", desc=False)
        .execute()
        .data
        or []
    )
    if len(sections) == 1:
        return _normalize(sections[0].get("id"))
    if not sections:
        return _normalize(_ensure_default_section(school_id, test_id).get("id"))
    raise HTTPException(status_code=400, detail="section_id is required when a test has multiple sections")


def _recount_section_questions(school_id: str, section_id: str) -> None:
    response = (
        _table("test_questions")
        .select("id", count="exact")
        .eq("school_id", school_id)
        .eq("section_id", section_id)
        .is_("deleted_at", "null")
        .limit(0)
        .execute()
    )
    (
        _table("test_sections")
        .update({"question_count": int(response.count or 0)})
        .eq("school_id", school_id)
        .eq("id", section_id)
        .execute()
    )


def _question_rows_for_test(school_id: str, test_id: str) -> list[dict[str, Any]]:
    rows = list(
        _table("test_questions")
        .select("*")
        .eq("school_id", school_id)
        .eq("test_id", test_id)
        .is_("deleted_at", "null")
        .order("section_id", desc=False)
        .order("display_order", desc=False)
        .execute()
        .data
        or []
    )
    return [dict(row) for row in rows]


def _attempt_responses_rows(school_id: str, attempt_id: str) -> list[dict[str, Any]]:
    rows = list(
        _table("test_responses")
        .select("*")
        .eq("school_id", school_id)
        .eq("attempt_id", attempt_id)
        .is_("deleted_at", "null")
        .order("created_at", desc=False)
        .execute()
        .data
        or []
    )
    return [dict(row) for row in rows]


def _extract_candidate_answers(payload: dict[str, Any]) -> list[str]:
    if not isinstance(payload, dict):
        return []
    candidates: list[str] = []
    for key in ("selected_option_id", "selected_option", "value", "answer", "text"):
        value = payload.get(key)
        if value not in (None, ""):
            candidates.append(_normalize(value).lower())
    values = payload.get("selected_option_ids")
    if isinstance(values, list):
        candidates.extend(_normalize(item).lower() for item in values if _normalize(item))
    return [item for item in candidates if item]


def _extract_expected_answers(answer_key: dict[str, Any]) -> list[str]:
    if not isinstance(answer_key, dict):
        return []
    candidates: list[str] = []
    for key in ("correct_option_id", "correct_value", "expected_value"):
        value = answer_key.get(key)
        if value not in (None, ""):
            candidates.append(_normalize(value).lower())
    values = answer_key.get("correct_option_ids") or answer_key.get("accepted_values")
    if isinstance(values, list):
        candidates.extend(_normalize(item).lower() for item in values if _normalize(item))
    if "expected_bool" in answer_key:
        candidates.append(str(bool(answer_key.get("expected_bool"))).lower())
    return [item for item in candidates if item]


def _score_response(question: dict[str, Any], response_payload: dict[str, Any]) -> tuple[bool | None, float]:
    question_type = _normalize(question.get("question_type"))
    marks = float(question.get("marks") or 0)
    negative_marks = float(question.get("negative_marks") or 0)
    if question_type in {"short_answer", "long_answer"}:
        return None, 0.0
    given = sorted(set(_extract_candidate_answers(response_payload)))
    expected = sorted(set(_extract_expected_answers(_normalize_json_object(question.get("answer_key")))))
    if not given:
        return False, 0.0
    is_correct = given == expected and bool(expected)
    return is_correct, marks if is_correct else max(0.0, -negative_marks)


def _assert_student_can_access_test(student: dict[str, Any], test: dict[str, Any]) -> None:
    status = _normalize(test.get("status"))
    if not bool(test.get("is_active", True)) or status not in {"published", "in_progress", "completed", "closed"}:
        raise HTTPException(status_code=403, detail="This test is not available for student access")
    test_batch_id = _normalize(test.get("batch_id"))
    student_batch_id = _normalize(student.get("batch_id"))
    if test_batch_id and student_batch_id and test_batch_id != student_batch_id:
        raise HTTPException(status_code=403, detail="This test is not assigned to the student's batch")


def list_tests(
    school_id: str,
    *,
    include_inactive: bool = False,
    student_batch_id: str | None = None,
    skip: int = 0,
    limit: int = 100,
) -> list[dict[str, Any]]:
    query = _table("tests").select("*").eq("school_id", school_id).is_("deleted_at", "null")
    if not include_inactive:
        query = query.eq("is_active", True)
    if student_batch_id:
        query = query.or_(f"batch_id.eq.{student_batch_id},batch_id.is.null")
        query = query.in_("status", ["published", "in_progress", "completed", "closed"])
    rows = list(
        query
        .order("created_at", desc=True)
        .range(max(skip, 0), max(skip, 0) + max(limit, 1) - 1)
        .execute()
        .data
        or []
    )
    sections_map = _load_sections_map(school_id, [_normalize(row.get("id")) for row in rows])
    return [_serialize_test(dict(row), sections_map.get(_normalize(row.get("id")), [])) for row in rows]


def get_test(school_id: str, test_id: str) -> dict[str, Any]:
    row = _get_test_row(school_id, test_id)
    sections = _load_sections_map(school_id, [test_id]).get(test_id, [])
    return _serialize_test(row, sections)


def get_test_for_student(school_id: str, test_id: str, profile_id: str) -> dict[str, Any]:
    student = _get_student_by_profile_id(school_id, profile_id)
    test = _get_test_row(school_id, test_id)
    _assert_student_can_access_test(student, test)
    sections = _load_sections_map(school_id, [test_id]).get(test_id, [])
    return _serialize_test(test, sections)


def create_test(school_id: str, profile_id: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    title = _normalize(payload.get("title"))
    if not title:
        raise HTTPException(status_code=400, detail="Test title is required")
    desired_status = _normalize(payload.get("status")) or "draft"
    insert_payload = {
        "school_id": school_id,
        "subject_id": _normalize_optional_uuid(payload.get("subject_id")),
        "batch_id": _normalize_optional_uuid(payload.get("batch_id")),
        "created_by_profile_id": _normalize_optional_uuid(profile_id),
        "published_by_profile_id": _normalize_optional_uuid(profile_id) if desired_status == "published" else None,
        "test_code": _normalize(payload.get("test_code")) or None,
        "title": title,
        "description": payload.get("description"),
        "instructions": payload.get("instructions"),
        "test_type": _normalize(payload.get("test_type")) or "objective",
        "delivery_mode": _normalize(payload.get("delivery_mode")) or "scheduled",
        "status": desired_status,
        "duration_minutes": int(payload.get("duration_minutes") or 60),
        "total_marks": float(payload.get("total_marks") or 0),
        "pass_marks": float(payload.get("pass_marks")) if payload.get("pass_marks") is not None else None,
        "max_attempts": int(payload.get("max_attempts") or 1),
        "shuffle_questions": bool(payload.get("shuffle_questions", False)),
        "shuffle_options": bool(payload.get("shuffle_options", False)),
        "show_result_immediately": bool(payload.get("show_result_immediately", False)),
        "allow_review": bool(payload.get("allow_review", True)),
        "starts_at": _to_iso_datetime(payload.get("starts_at")),
        "ends_at": _to_iso_datetime(payload.get("ends_at")),
        "published_at": _utc_now_iso() if desired_status == "published" else None,
        "metadata": _normalize_json_object(payload.get("metadata")),
        "is_active": bool(payload.get("is_active", True)),
    }
    response = _table("tests").insert(insert_payload).execute()
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Test create returned no row")
    created = dict(rows[0])
    _ensure_default_section(school_id, _normalize(created.get("id")))
    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action="online_tests.test_created",
        entity_id=_normalize(created.get("id")),
        payload={"title": title, "status": desired_status},
    )
    return get_test(school_id, _normalize(created.get("id")))


def update_test(school_id: str, test_id: str, profile_id: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    existing = _get_test_row(school_id, test_id)
    update_payload: dict[str, Any] = {}
    for key in (
        "title",
        "description",
        "instructions",
        "test_code",
        "test_type",
        "delivery_mode",
        "status",
        "shuffle_questions",
        "shuffle_options",
        "show_result_immediately",
        "allow_review",
        "is_active",
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
    if "max_attempts" in payload and payload.get("max_attempts") is not None:
        update_payload["max_attempts"] = int(payload.get("max_attempts"))
    if "starts_at" in payload:
        update_payload["starts_at"] = _to_iso_datetime(payload.get("starts_at"))
    if "ends_at" in payload:
        update_payload["ends_at"] = _to_iso_datetime(payload.get("ends_at"))
    if "metadata" in payload and payload.get("metadata") is not None:
        update_payload["metadata"] = _normalize_json_object(payload.get("metadata"))

    new_status = _normalize(update_payload.get("status") or existing.get("status"))
    old_status = _normalize(existing.get("status"))
    if new_status == "published" and old_status != "published":
        update_payload["published_at"] = _utc_now_iso()
        update_payload["published_by_profile_id"] = _normalize_optional_uuid(profile_id)

    _table("tests").update(update_payload).eq("school_id", school_id).eq("id", test_id).execute()
    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action="online_tests.test_updated",
        entity_id=test_id,
        payload={"updated_fields": sorted(update_payload.keys())},
    )
    return get_test(school_id, test_id)


def publish_test(school_id: str, test_id: str, profile_id: str | None) -> dict[str, Any]:
    _get_test_row(school_id, test_id)
    update_payload = {
        "status": "published",
        "published_at": _utc_now_iso(),
        "published_by_profile_id": _normalize_optional_uuid(profile_id),
        "is_active": True,
    }
    _table("tests").update(update_payload).eq("school_id", school_id).eq("id", test_id).execute()
    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action="online_tests.test_published",
        entity_id=test_id,
        payload={"status": "published"},
    )
    return get_test(school_id, test_id)


def close_test(school_id: str, test_id: str, profile_id: str | None) -> dict[str, Any]:
    _get_test_row(school_id, test_id)
    _table("tests").update({"status": "closed"}).eq("school_id", school_id).eq("id", test_id).execute()
    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action="online_tests.test_closed",
        entity_id=test_id,
        payload={"status": "closed"},
    )
    return get_test(school_id, test_id)


def delete_test(school_id: str, test_id: str, profile_id: str | None) -> dict[str, Any]:
    _get_test_row(school_id, test_id)
    now = _utc_now_iso()
    deleted_by = _normalize_optional_uuid(profile_id)
    _table("tests").update(
        {
            "is_active": False,
            "deleted_at": now,
            "deleted_by_profile_id": deleted_by,
            "status": "archived",
        }
    ).eq("school_id", school_id).eq("id", test_id).execute()
    _table("test_sections").update(
        {"is_active": False, "deleted_at": now, "deleted_by_profile_id": deleted_by}
    ).eq("school_id", school_id).eq("test_id", test_id).is_("deleted_at", "null").execute()
    _table("test_questions").update(
        {"is_active": False, "deleted_at": now, "deleted_by_profile_id": deleted_by}
    ).eq("school_id", school_id).eq("test_id", test_id).is_("deleted_at", "null").execute()
    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action="online_tests.test_deleted",
        entity_id=test_id,
        payload={"soft_delete": True},
    )
    return {"message": "Online test deleted successfully"}


def list_questions(
    school_id: str,
    *,
    test_id: str,
    section_id: str | None = None,
    skip: int = 0,
    limit: int = 100,
) -> list[dict[str, Any]]:
    _get_test_row(school_id, test_id)
    query = (
        _table("test_questions")
        .select("*")
        .eq("school_id", school_id)
        .eq("test_id", test_id)
        .is_("deleted_at", "null")
    )
    if section_id:
        query = query.eq("section_id", section_id)
    rows = list(
        query
        .order("display_order", desc=False)
        .range(max(skip, 0), max(skip, 0) + max(limit, 1) - 1)
        .execute()
        .data
        or []
    )
    return [_serialize_question(dict(row)) for row in rows]


def list_questions_for_student(
    school_id: str,
    *,
    test_id: str,
    profile_id: str,
    section_id: str | None = None,
    skip: int = 0,
    limit: int = 100,
) -> list[dict[str, Any]]:
    student = _get_student_by_profile_id(school_id, profile_id)
    test = _get_test_row(school_id, test_id)
    _assert_student_can_access_test(student, test)
    questions = list_questions(school_id, test_id=test_id, section_id=section_id, skip=skip, limit=limit)
    return [_sanitize_question_for_student(question) for question in questions]


def create_question(school_id: str, payload: dict[str, Any], profile_id: str | None = None) -> dict[str, Any]:
    test_id = _normalize(payload.get("test_id"))
    if not test_id:
        raise HTTPException(status_code=400, detail="test_id is required")
    _get_test_row(school_id, test_id)
    section_id = _resolve_section_id(school_id, test_id, _normalize(payload.get("section_id")) or None)
    prompt_text = _normalize(payload.get("prompt_text"))
    if not prompt_text:
        raise HTTPException(status_code=400, detail="prompt_text is required")
    insert_payload = {
        "school_id": school_id,
        "test_id": test_id,
        "section_id": section_id,
        "question_code": _normalize(payload.get("question_code")) or None,
        "display_order": int(payload.get("display_order") or 1),
        "question_type": _normalize(payload.get("question_type")) or "single_choice",
        "difficulty_level": _normalize(payload.get("difficulty_level")) or "medium",
        "prompt_text": prompt_text,
        "option_items": list(payload.get("option_items") or []),
        "answer_key": _normalize_json_object(payload.get("answer_key")),
        "explanation": payload.get("explanation"),
        "marks": float(payload.get("marks") or 1),
        "negative_marks": float(payload.get("negative_marks") or 0),
        "metadata": _normalize_json_object(payload.get("metadata")),
        "is_active": bool(payload.get("is_active", True)),
    }
    response = _table("test_questions").insert(insert_payload).execute()
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Question create returned no row")
    created = dict(rows[0])
    _recount_section_questions(school_id, section_id)
    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action="online_tests.question_created",
        entity_id=_normalize(created.get("id")),
        payload={"test_id": test_id, "section_id": section_id},
    )
    return _serialize_question(created)


def update_question(school_id: str, question_id: str, payload: dict[str, Any], profile_id: str | None = None) -> dict[str, Any]:
    existing_rows = list(
        _table("test_questions")
        .select("*")
        .eq("school_id", school_id)
        .eq("id", question_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not existing_rows:
        raise HTTPException(status_code=404, detail="Question not found")
    existing = dict(existing_rows[0])
    update_payload: dict[str, Any] = {}
    for key in ("question_code", "prompt_text", "explanation", "question_type", "difficulty_level", "is_active"):
        if key in payload:
            update_payload[key] = payload.get(key)
    if "display_order" in payload and payload.get("display_order") is not None:
        update_payload["display_order"] = int(payload.get("display_order"))
    if "option_items" in payload and payload.get("option_items") is not None:
        update_payload["option_items"] = list(payload.get("option_items") or [])
    if "answer_key" in payload and payload.get("answer_key") is not None:
        update_payload["answer_key"] = _normalize_json_object(payload.get("answer_key"))
    if "marks" in payload and payload.get("marks") is not None:
        update_payload["marks"] = float(payload.get("marks"))
    if "negative_marks" in payload and payload.get("negative_marks") is not None:
        update_payload["negative_marks"] = float(payload.get("negative_marks"))
    if "metadata" in payload and payload.get("metadata") is not None:
        update_payload["metadata"] = _normalize_json_object(payload.get("metadata"))
    if "section_id" in payload:
        update_payload["section_id"] = _resolve_section_id(
            school_id,
            _normalize(existing.get("test_id")),
            payload.get("section_id"),
        )
    _table("test_questions").update(update_payload).eq("school_id", school_id).eq("id", question_id).execute()
    if update_payload.get("section_id") and _normalize(update_payload.get("section_id")) != _normalize(existing.get("section_id")):
        _recount_section_questions(school_id, _normalize(existing.get("section_id")))
        _recount_section_questions(school_id, _normalize(update_payload.get("section_id")))
    else:
        _recount_section_questions(school_id, _normalize(existing.get("section_id")))
    refreshed = list(
        _table("test_questions")
        .select("*")
        .eq("school_id", school_id)
        .eq("id", question_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action="online_tests.question_updated",
        entity_id=question_id,
        payload={"updated_fields": sorted(update_payload.keys())},
    )
    return _serialize_question(dict(refreshed[0]))


def delete_question(school_id: str, question_id: str, profile_id: str | None) -> dict[str, Any]:
    existing_rows = list(
        _table("test_questions")
        .select("id, section_id, test_id")
        .eq("school_id", school_id)
        .eq("id", question_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not existing_rows:
        raise HTTPException(status_code=404, detail="Question not found")
    section_id = _normalize(existing_rows[0].get("section_id"))
    _table("test_questions").update(
        {
            "is_active": False,
            "deleted_at": _utc_now_iso(),
            "deleted_by_profile_id": _normalize_optional_uuid(profile_id),
        }
    ).eq("school_id", school_id).eq("id", question_id).execute()
    _recount_section_questions(school_id, section_id)
    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action="online_tests.question_deleted",
        entity_id=question_id,
        payload={"test_id": _normalize(existing_rows[0].get("test_id")), "soft_delete": True},
    )
    return {"message": "Question deleted successfully"}


def list_attempts(
    school_id: str,
    *,
    student_id: str | None = None,
    test_id: str | None = None,
    skip: int = 0,
    limit: int = 100,
) -> list[dict[str, Any]]:
    query = _table("test_attempts").select("*").eq("school_id", school_id).is_("deleted_at", "null")
    if student_id:
        query = query.eq("student_id", student_id)
    if test_id:
        query = query.eq("test_id", test_id)
    rows = list(
        query
        .order("created_at", desc=True)
        .range(max(skip, 0), max(skip, 0) + max(limit, 1) - 1)
        .execute()
        .data
        or []
    )
    return [_serialize_attempt(dict(row)) for row in rows]


def get_attempt(school_id: str, attempt_id: str) -> dict[str, Any]:
    row = _get_attempt_row(school_id, attempt_id)
    responses = [_serialize_response(item) for item in _attempt_responses_rows(school_id, attempt_id)]
    return _serialize_attempt(row, responses)


def start_attempt(school_id: str, test_id: str, profile_id: str) -> dict[str, Any]:
    return create_attempt(school_id, profile_id, {"test_id": test_id})


def create_attempt(school_id: str, profile_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    student = _get_student_by_profile_id(school_id, profile_id)
    test_id = _normalize(payload.get("test_id"))
    if not test_id:
        raise HTTPException(status_code=400, detail="test_id is required")
    test = _get_test_row(school_id, test_id)
    _assert_student_can_access_test(student, test)

    existing_in_progress = list(
        _table("test_attempts")
        .select("id")
        .eq("school_id", school_id)
        .eq("test_id", test_id)
        .eq("student_id", _normalize(student.get("id")))
        .eq("status", "in_progress")
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    if existing_in_progress:
        return get_attempt(school_id, _normalize(existing_in_progress[0].get("id")))

    existing_attempts = list(
        _table("test_attempts")
        .select("id")
        .eq("school_id", school_id)
        .eq("test_id", test_id)
        .eq("student_id", _normalize(student.get("id")))
        .is_("deleted_at", "null")
        .execute()
        .data
        or []
    )
    max_attempts = int(test.get("max_attempts") or 1)
    if len(existing_attempts) >= max_attempts:
        raise HTTPException(status_code=400, detail="Maximum attempts reached for this test")
    total_questions = len(_question_rows_for_test(school_id, test_id))
    attempt_number = len(existing_attempts) + 1
    response = _table("test_attempts").insert(
        {
            "school_id": school_id,
            "test_id": test_id,
            "student_id": _normalize(student.get("id")),
            "attempt_number": attempt_number,
            "status": "in_progress",
            "started_at": _utc_now_iso(),
            "total_questions_snapshot": total_questions,
            "answered_questions_snapshot": 0,
            "time_spent_seconds": 0,
            "metadata": {"student_name": student.get("full_name")},
            "is_active": True,
        }
    ).execute()
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Attempt start returned no row")
    created = dict(rows[0])
    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action="online_tests.attempt_started",
        entity_id=_normalize(created.get("id")),
        payload={"test_id": test_id, "attempt_number": attempt_number},
    )
    return _serialize_attempt(created, [])


def save_attempt(school_id: str, attempt_id: str, profile_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    attempt = _get_attempt_row(school_id, attempt_id)
    student = _get_student_by_profile_id(school_id, profile_id)
    if _normalize(attempt.get("student_id")) != _normalize(student.get("id")):
        raise HTTPException(status_code=403, detail="Students can update only their own attempts")
    if _normalize(attempt.get("status")) != "in_progress":
        raise HTTPException(status_code=400, detail="Only in-progress attempts can receive responses")
    question_id = _normalize(payload.get("question_id"))
    if not question_id:
        raise HTTPException(status_code=400, detail="question_id is required")
    question_rows = list(
        _table("test_questions")
        .select("*")
        .eq("school_id", school_id)
        .eq("id", question_id)
        .eq("test_id", _normalize(attempt.get("test_id")))
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not question_rows:
        raise HTTPException(status_code=404, detail="Question not found for this attempt")
    response_payload = _normalize_json_object(payload.get("response_payload"))
    existing_rows = list(
        _table("test_responses")
        .select("*")
        .eq("school_id", school_id)
        .eq("attempt_id", attempt_id)
        .eq("question_id", question_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    save_payload = {
        "school_id": school_id,
        "attempt_id": attempt_id,
        "test_id": _normalize(attempt.get("test_id")),
        "question_id": question_id,
        "student_id": _normalize(student.get("id")),
        "response_payload": response_payload,
        "is_marked_for_review": bool(payload.get("is_marked_for_review", False)),
        "answered_at": _utc_now_iso(),
        "metadata": {},
        "is_active": True,
    }
    if existing_rows:
        _table("test_responses").update(save_payload).eq("school_id", school_id).eq(
            "id", _normalize(existing_rows[0].get("id"))
        ).execute()
    else:
        _table("test_responses").insert(save_payload).execute()
    active_responses = _attempt_responses_rows(school_id, attempt_id)
    _table("test_attempts").update({"answered_questions_snapshot": len(active_responses)}).eq(
        "school_id", school_id
    ).eq("id", attempt_id).execute()
    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action="online_tests.attempt_saved",
        entity_id=attempt_id,
        payload={"question_id": question_id, "response_saved": True},
    )
    return get_attempt(school_id, attempt_id)


def submit_attempt(school_id: str, attempt_id: str, profile_id: str) -> dict[str, Any]:
    attempt = _get_attempt_row(school_id, attempt_id)
    student = _get_student_by_profile_id(school_id, profile_id)
    if _normalize(attempt.get("student_id")) != _normalize(student.get("id")):
        raise HTTPException(status_code=403, detail="Students can submit only their own attempts")
    if _normalize(attempt.get("status")) != "in_progress":
        raise HTTPException(status_code=400, detail="Attempt has already been submitted")
    question_rows = _question_rows_for_test(school_id, _normalize(attempt.get("test_id")))
    question_map = {_normalize(row.get("id")): row for row in question_rows}
    response_rows = _attempt_responses_rows(school_id, attempt_id)

    answered_questions = 0
    correct_answers = 0
    incorrect_answers = 0
    score_obtained = 0.0
    max_score = 0.0
    for question in question_rows:
        max_score += float(question.get("marks") or 0)
    for response_row in response_rows:
        question = question_map.get(_normalize(response_row.get("question_id")))
        if not question:
            continue
        answered_questions += 1
        is_correct, marks_awarded = _score_response(question, _normalize_json_object(response_row.get("response_payload")))
        if is_correct is True:
            correct_answers += 1
        elif is_correct is False:
            incorrect_answers += 1
        score_obtained += marks_awarded
        _table("test_responses").update(
            {
                "is_correct": is_correct,
                "marks_awarded": marks_awarded,
                "evaluated_at": _utc_now_iso(),
            }
        ).eq("school_id", school_id).eq("id", _normalize(response_row.get("id"))).execute()
    total_questions = len(question_rows)
    unanswered_questions = max(total_questions - answered_questions, 0)
    percentage = round((score_obtained / max_score) * 100, 2) if max_score > 0 else 0.0
    submitted_at = _utc_now_iso()
    _table("test_attempts").update(
        {
            "status": "submitted",
            "submitted_at": submitted_at,
            "evaluated_at": submitted_at,
            "answered_questions_snapshot": answered_questions,
        }
    ).eq("school_id", school_id).eq("id", attempt_id).execute()
    existing_result_rows = list(
        _table("test_results")
        .select("*")
        .eq("school_id", school_id)
        .eq("attempt_id", attempt_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    result_payload = {
        "school_id": school_id,
        "attempt_id": attempt_id,
        "test_id": _normalize(attempt.get("test_id")),
        "student_id": _normalize(student.get("id")),
        "status": "evaluated",
        "total_questions": total_questions,
        "attempted_questions": answered_questions,
        "correct_answers": correct_answers,
        "incorrect_answers": incorrect_answers,
        "unanswered_questions": unanswered_questions,
        "score_obtained": round(score_obtained, 2),
        "max_score": round(max_score, 2),
        "percentage": percentage,
        "published_at": submitted_at,
        "metadata": {"auto_evaluated": True},
        "is_active": True,
    }
    if existing_result_rows:
        result_id = _normalize(existing_result_rows[0].get("id"))
        _table("test_results").update(result_payload).eq("school_id", school_id).eq("id", result_id).execute()
        result = get_result(school_id, result_id)
    else:
        response = _table("test_results").insert(result_payload).execute()
        rows = list(response.data or [])
        if not rows:
            raise HTTPException(status_code=500, detail="Result creation failed during attempt submission")
        result = _serialize_result(dict(rows[0]))
    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action="online_tests.attempt_submitted",
        entity_id=attempt_id,
        payload={"test_id": _normalize(attempt.get("test_id")), "result_id": result.get("id")},
    )
    return result


def get_result(school_id: str, result_id: str) -> dict[str, Any]:
    return _serialize_result(_get_result_row(school_id, result_id))


def list_results(
    school_id: str,
    *,
    test_id: str | None = None,
    student_id: str | None = None,
    skip: int = 0,
    limit: int = 100,
) -> list[dict[str, Any]]:
    query = _table("test_results").select("*").eq("school_id", school_id).is_("deleted_at", "null")
    if test_id:
        query = query.eq("test_id", test_id)
    if student_id:
        query = query.eq("student_id", student_id)
    rows = list(
        query
        .order("created_at", desc=True)
        .range(max(skip, 0), max(skip, 0) + max(limit, 1) - 1)
        .execute()
        .data
        or []
    )
    return [_serialize_result(dict(row)) for row in rows]


def get_results_analytics(school_id: str | None, *, test_id: str | None = None, global_scope: bool = False) -> dict[str, Any]:
    tests_query = _table("tests").select("*").is_("deleted_at", "null")
    attempts_query = _table("test_attempts").select("*").is_("deleted_at", "null")
    results_query = _table("test_results").select("*").is_("deleted_at", "null")
    if school_id:
        tests_query = tests_query.eq("school_id", school_id)
        attempts_query = attempts_query.eq("school_id", school_id)
        results_query = results_query.eq("school_id", school_id)
    if test_id:
        tests_query = tests_query.eq("id", test_id)
        attempts_query = attempts_query.eq("test_id", test_id)
        results_query = results_query.eq("test_id", test_id)
    test_rows = list(tests_query.execute().data or [])
    attempt_rows = list(attempts_query.execute().data or [])
    result_rows = [dict(row) for row in list(results_query.execute().data or [])]
    percentages = [float(row.get("percentage") or 0) for row in result_rows]
    scores = [float(row.get("score_obtained") or 0) for row in result_rows]
    return {
        "scope": "global" if global_scope else "school",
        "school_id": school_id,
        "test_id": test_id,
        "total_tests": len(test_rows),
        "total_attempts": len(attempt_rows),
        "completed_attempts": len(
            [row for row in attempt_rows if _normalize(row.get("status")) in {"submitted", "evaluated"}]
        ),
        "evaluated_results": len(result_rows),
        "average_score": round(sum(scores) / len(scores), 2) if scores else 0.0,
        "average_percentage": round(sum(percentages) / len(percentages), 2) if percentages else 0.0,
        "highest_score": round(max(scores), 2) if scores else 0.0,
        "lowest_score": round(min(scores), 2) if scores else 0.0,
        "published_results": len([row for row in result_rows if row.get("published_at")]),
    }
