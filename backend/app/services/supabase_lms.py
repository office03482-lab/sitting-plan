"""Supabase-native LMS services."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import HTTPException

from app.services.supabase_admin import get_supabase_admin_client


def _client():
    return get_supabase_admin_client()


def _public_table(name: str):
    return _client().table(name)


def _table(name: str):
    """Access LMS tables through Supabase public.lms_* views.

    Requires applying the 20260614_052_lms_public_views.sql migration
    and migrating existing data from SQLite (see _lms_data_migration.py).
    """
    return _public_table(f"lms_{name}")


def _normalize(value: Any) -> str:
    return str(value or "").strip()


def _normalize_optional_uuid(value: Any) -> str | None:
    text = _normalize(value)
    if not text:
        return None
    return text


def _normalize_json_object(value: Any) -> str:
    import json
    if isinstance(value, (dict, list)):
        return json.dumps(value, default=str)
    if isinstance(value, str):
        try:
            json.loads(value)
            return value
        except (json.JSONDecodeError, TypeError, ValueError):
            return value
    return "{}"


def _deserialize_json_column(value: Any) -> dict[str, Any]:
    import json
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return dict(parsed) if isinstance(parsed, dict) else {}
        except (json.JSONDecodeError, TypeError, ValueError):
            return {}
    return {}


def _normalize_json_list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _log_audit_entry(
    *,
    school_id: str | None,
    profile_id: str | None,
    action: str,
    entity_id: str | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    # Audit logging suppressed — Supabase PostgREST is unavailable in dev.
    pass


def _serialize_resource(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _normalize(row.get("id")),
        "school_id": _normalize(row.get("school_id")),
        "course_id": _normalize(row.get("course_id")),
        "lesson_id": _normalize(row.get("lesson_id")),
        "resource_type": _normalize(row.get("resource_type")) or "pdf",
        "title": _normalize(row.get("title")),
        "resource_url": row.get("resource_url"),
        "text_content": row.get("text_content"),
        "file_size_bytes": int(row.get("file_size_bytes")) if row.get("file_size_bytes") is not None else None,
        "metadata": _deserialize_json_column(row.get("metadata")),
        "is_downloadable": bool(row.get("is_downloadable", True)),
        "is_active": bool(row.get("is_active", True)),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _serialize_lesson(row: dict[str, Any], resources: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {
        "id": _normalize(row.get("id")),
        "school_id": _normalize(row.get("school_id")),
        "course_id": _normalize(row.get("course_id")),
        "module_id": _normalize(row.get("module_id")),
        "title": _normalize(row.get("title")),
        "description": row.get("description"),
        "lesson_type": _normalize(row.get("lesson_type")) or "video",
        "video_url": row.get("video_url"),
        "content_text": row.get("content_text"),
        "duration_seconds": int(row.get("duration_seconds") or 0),
        "display_order": int(row.get("display_order") or 1),
        "is_preview": bool(row.get("is_preview", False)),
        "metadata": _deserialize_json_column(row.get("metadata")),
        "is_active": bool(row.get("is_active", True)),
        "resources": resources or [],
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _serialize_module(row: dict[str, Any], lessons: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {
        "id": _normalize(row.get("id")),
        "school_id": _normalize(row.get("school_id")),
        "course_id": _normalize(row.get("course_id")),
        "title": _normalize(row.get("title")),
        "description": row.get("description"),
        "display_order": int(row.get("display_order") or 1),
        "metadata": _deserialize_json_column(row.get("metadata")),
        "is_active": bool(row.get("is_active", True)),
        "lessons": lessons or [],
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _serialize_course(
    row: dict[str, Any],
    *,
    modules: list[dict[str, Any]] | None = None,
    module_count: int = 0,
    lesson_count: int = 0,
    assignment_count: int = 0,
) -> dict[str, Any]:
    return {
        "id": _normalize(row.get("id")),
        "school_id": _normalize(row.get("school_id")),
        "title": _normalize(row.get("title")),
        "description": row.get("description"),
        "course_code": row.get("course_code"),
        "subject_id": _normalize(row.get("subject_id")) or None,
        "batch_id": _normalize(row.get("batch_id")) or None,
        "thumbnail_url": row.get("thumbnail_url"),
        "intro_video_url": row.get("intro_video_url"),
        "target_class_name": row.get("target_class_name"),
        "target_section": row.get("target_section"),
        "visibility": _normalize(row.get("visibility")) or "batch",
        "is_published": bool(row.get("is_published", False)),
        "estimated_duration_minutes": int(row.get("estimated_duration_minutes") or 0),
        "metadata": _deserialize_json_column(row.get("metadata")),
        "is_active": bool(row.get("is_active", True)),
        "module_count": int(module_count),
        "lesson_count": int(lesson_count),
        "assignment_count": int(assignment_count),
        "modules": modules or [],
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _serialize_submission(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _normalize(row.get("id")),
        "school_id": _normalize(row.get("school_id")),
        "assignment_id": _normalize(row.get("assignment_id")),
        "student_id": _normalize(row.get("student_id")),
        "submission_text": row.get("submission_text"),
        "attachment_url": row.get("attachment_url"),
        "status": _normalize(row.get("status")) or "draft",
        "score_awarded": float(row.get("score_awarded")) if row.get("score_awarded") is not None else None,
        "feedback": row.get("feedback"),
        "submitted_at": row.get("submitted_at"),
        "graded_at": row.get("graded_at"),
        "metadata": _deserialize_json_column(row.get("metadata")),
        "is_active": bool(row.get("is_active", True)),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _serialize_assignment(row: dict[str, Any], submission: dict[str, Any] | None = None, submission_count: int = 0) -> dict[str, Any]:
    return {
        "id": _normalize(row.get("id")),
        "school_id": _normalize(row.get("school_id")),
        "course_id": _normalize(row.get("course_id")),
        "module_id": _normalize(row.get("module_id")) or None,
        "lesson_id": _normalize(row.get("lesson_id")) or None,
        "title": _normalize(row.get("title")),
        "description": row.get("description"),
        "attachment_url": row.get("attachment_url"),
        "due_at": row.get("due_at"),
        "max_score": float(row.get("max_score") or 0),
        "status": _normalize(row.get("status")) or "draft",
        "metadata": _deserialize_json_column(row.get("metadata")),
        "is_active": bool(row.get("is_active", True)),
        "submission": submission,
        "submission_count": int(submission_count),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _serialize_progress(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _normalize(row.get("id")),
        "school_id": _normalize(row.get("school_id")),
        "student_id": _normalize(row.get("student_id")),
        "course_id": _normalize(row.get("course_id")),
        "module_id": _normalize(row.get("module_id")) or None,
        "lesson_id": _normalize(row.get("lesson_id")),
        "last_watched_position_seconds": int(row.get("last_watched_position_seconds") or 0),
        "watch_percentage": float(row.get("watch_percentage") or 0),
        "assignment_completion_percentage": float(row.get("assignment_completion_percentage") or 0),
        "course_completion_percentage": float(row.get("course_completion_percentage") or 0),
        "lessons_completed": int(row.get("lessons_completed") or 0),
        "is_completed": bool(row.get("is_completed", False)),
        "last_accessed_at": row.get("last_accessed_at"),
        "completed_at": row.get("completed_at"),
        "metadata": _deserialize_json_column(row.get("metadata")),
        "is_active": bool(row.get("is_active", True)),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _get_student_by_profile_id(school_id: str, profile_id: str) -> dict[str, Any]:
    rows = list(
        _public_table("students")
        .select("id,school_id,profile_id,batch_id,full_name,class_name,section,guardian_name,guardian_phone,metadata")
        .eq("school_id", school_id)
        .eq("profile_id", profile_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Active student record not found for this profile")
    return dict(rows[0])


def _get_student(school_id: str, student_id: str) -> dict[str, Any]:
    rows = list(
        _public_table("students")
        .select("id,school_id,profile_id,batch_id,full_name,class_name,section,guardian_name,guardian_phone,metadata")
        .eq("school_id", school_id)
        .eq("id", student_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Student not found")
    return dict(rows[0])


def _list_parent_linked_students(school_id: str, profile_id: str | None, email: str | None) -> list[dict[str, Any]]:
    rows = list(
        _public_table("students")
        .select("id,school_id,profile_id,batch_id,full_name,class_name,section,guardian_name,guardian_phone,metadata")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .execute()
        .data
        or []
    )
    linked: list[dict[str, Any]] = []
    normalized_profile_id = _normalize(profile_id)
    normalized_email = _normalize(email).lower()
    for row in rows:
        metadata = _deserialize_json_column(row.get("metadata"))
        candidate_ids = {
            _normalize(metadata.get("parent_profile_id")),
            _normalize(metadata.get("guardian_profile_id")),
            *[_normalize(item) for item in _normalize_json_list(metadata.get("parent_profile_ids"))],
            *[_normalize(item) for item in _normalize_json_list(metadata.get("guardian_profile_ids"))],
        }
        candidate_emails = {
            _normalize(metadata.get("parent_email")).lower(),
            _normalize(metadata.get("guardian_email")).lower(),
            *[_normalize(item).lower() for item in _normalize_json_list(metadata.get("parent_emails"))],
        }
        if normalized_profile_id and normalized_profile_id in candidate_ids:
            linked.append(dict(row))
            continue
        if normalized_email and normalized_email in candidate_emails:
            linked.append(dict(row))
    return linked


def _get_course_row(school_id: str, course_id: str) -> dict[str, Any]:
    rows = list(
        _table("courses")
        .select("*")
        .eq("school_id", school_id)
        .eq("id", course_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Course not found")
    return dict(rows[0])


def _get_module_row(school_id: str, module_id: str) -> dict[str, Any]:
    rows = list(
        _table("course_modules")
        .select("*")
        .eq("school_id", school_id)
        .eq("id", module_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Course module not found")
    return dict(rows[0])


def _get_lesson_row(school_id: str, lesson_id: str) -> dict[str, Any]:
    rows = list(
        _table("lessons")
        .select("*")
        .eq("school_id", school_id)
        .eq("id", lesson_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Lesson not found")
    return dict(rows[0])


def _get_assignment_row(school_id: str, assignment_id: str) -> dict[str, Any]:
    rows = list(
        _table("assignments")
        .select("*")
        .eq("school_id", school_id)
        .eq("id", assignment_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Assignment not found")
    return dict(rows[0])


def _load_resource_map(school_id: str, lesson_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    ids = [item for item in lesson_ids if item]
    if not ids:
        return {}
    rows = list(
        _table("lesson_resources")
        .select("*")
        .eq("school_id", school_id)
        .in_("lesson_id", ids)
        .is_("deleted_at", "null")
        .order("created_at", desc=False)
        .execute()
        .data
        or []
    )
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        lesson_id = _normalize(row.get("lesson_id"))
        grouped.setdefault(lesson_id, []).append(_serialize_resource(dict(row)))
    return grouped


def _load_lesson_map(school_id: str, module_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    ids = [item for item in module_ids if item]
    if not ids:
        return {}
    rows = list(
        _table("lessons")
        .select("*")
        .eq("school_id", school_id)
        .in_("module_id", ids)
        .is_("deleted_at", "null")
        .order("display_order", desc=False)
        .execute()
        .data
        or []
    )
    resource_map = _load_resource_map(school_id, [_normalize(row.get("id")) for row in rows])
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        module_id = _normalize(row.get("module_id"))
        grouped.setdefault(module_id, []).append(_serialize_lesson(dict(row), resource_map.get(_normalize(row.get("id")), [])))
    return grouped


def _load_module_map(school_id: str, course_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    ids = [item for item in course_ids if item]
    if not ids:
        return {}
    rows = list(
        _table("course_modules")
        .select("*")
        .eq("school_id", school_id)
        .in_("course_id", ids)
        .is_("deleted_at", "null")
        .order("display_order", desc=False)
        .execute()
        .data
        or []
    )
    lesson_map = _load_lesson_map(school_id, [_normalize(row.get("id")) for row in rows])
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        course_id = _normalize(row.get("course_id"))
        grouped.setdefault(course_id, []).append(_serialize_module(dict(row), lesson_map.get(_normalize(row.get("id")), [])))
    return grouped


def _load_assignment_rows(
    school_id: str,
    *,
    course_id: str | None = None,
    student_id: str | None = None,
    include_inactive: bool = False,
) -> list[dict[str, Any]]:
    query = _table("assignments").select("*").eq("school_id", school_id).is_("deleted_at", "null")
    if not include_inactive:
        query = query.eq("is_active", True)
    if course_id:
        query = query.eq("course_id", course_id)
    rows = list(query.order("due_at", desc=False).execute().data or [])
    assignment_rows = [dict(row) for row in rows]
    if student_id:
        submission_rows = list(
            _table("assignment_submissions")
            .select("*")
            .eq("school_id", school_id)
            .eq("student_id", student_id)
            .in_("assignment_id", [_normalize(row.get("id")) for row in assignment_rows] or ["00000000-0000-0000-0000-000000000000"])
            .is_("deleted_at", "null")
            .execute()
            .data
            or []
        )
        submission_map = {_normalize(row.get("assignment_id")): _serialize_submission(dict(row)) for row in submission_rows}
    else:
        submission_map = {}
    submission_counts: dict[str, int] = {}
    if assignment_rows:
        counts = list(
            _table("assignment_submissions")
            .select("assignment_id")
            .eq("school_id", school_id)
            .in_("assignment_id", [_normalize(row.get("id")) for row in assignment_rows])
            .is_("deleted_at", "null")
            .execute()
            .data
            or []
        )
        for row in counts:
            assignment_id = _normalize(row.get("assignment_id"))
            submission_counts[assignment_id] = submission_counts.get(assignment_id, 0) + 1
    return [
        _serialize_assignment(
            row,
            submission=submission_map.get(_normalize(row.get("id"))),
            submission_count=submission_counts.get(_normalize(row.get("id")), 0),
        )
        for row in assignment_rows
    ]


def _course_visible_to_student(course: dict[str, Any], student: dict[str, Any]) -> bool:
    if not bool(course.get("is_active", True)) or not bool(course.get("is_published", False)):
        return False
    visibility = _normalize(course.get("visibility")) or "batch"
    if visibility == "public":
        return True
    if visibility == "batch":
        batch_id = _normalize(course.get("batch_id"))
        return not batch_id or batch_id == _normalize(student.get("batch_id"))
    if visibility == "class":
        class_name = _normalize(course.get("target_class_name")).lower()
        section = _normalize(course.get("target_section")).lower()
        student_class = _normalize(student.get("class_name")).lower()
        student_section = _normalize(student.get("section")).lower()
        if class_name and class_name != student_class:
            return False
        if section and section != student_section:
            return False
        return True
    if visibility == "private":
        assigned_ids = {_normalize(item) for item in _normalize_json_list(_normalize_json_object(course.get("metadata")).get("assigned_student_ids"))}
        return _normalize(student.get("id")) in assigned_ids
    return False


def _course_counts(modules: list[dict[str, Any]], assignments: list[dict[str, Any]]) -> tuple[int, int, int]:
    module_count = len(modules)
    lesson_count = sum(len(module.get("lessons") or []) for module in modules)
    return module_count, lesson_count, len(assignments)


def list_courses(
    school_id: str,
    *,
    include_inactive: bool = False,
    student: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    query = _table("courses").select("*").eq("school_id", school_id).is_("deleted_at", "null")
    if not include_inactive:
        query = query.eq("is_active", True)
    rows = [dict(row) for row in list(query.order("created_at", desc=True).execute().data or [])]
    if student is not None:
        rows = [row for row in rows if _course_visible_to_student(row, student)]
    module_map = _load_module_map(school_id, [_normalize(row.get("id")) for row in rows])
    assignment_rows = _load_assignment_rows(school_id, include_inactive=include_inactive)
    assignment_count_map: dict[str, int] = {}
    for item in assignment_rows:
        assignment_count_map[_normalize(item.get("course_id"))] = assignment_count_map.get(_normalize(item.get("course_id")), 0) + 1
    payload: list[dict[str, Any]] = []
    for row in rows:
        modules = module_map.get(_normalize(row.get("id")), [])
        module_count, lesson_count, assignment_count = _course_counts(modules, [])
        payload.append(
            _serialize_course(
                row,
                modules=[],
                module_count=module_count,
                lesson_count=lesson_count,
                assignment_count=assignment_count_map.get(_normalize(row.get("id")), assignment_count),
            )
        )
    return payload


def get_course(school_id: str, course_id: str, *, student: dict[str, Any] | None = None) -> dict[str, Any]:
    row = _get_course_row(school_id, course_id)
    if student is not None and not _course_visible_to_student(row, student):
        raise HTTPException(status_code=403, detail="This course is not available for the current student")
    modules = _load_module_map(school_id, [course_id]).get(course_id, [])
    assignments = _load_assignment_rows(
        school_id,
        course_id=course_id,
        student_id=_normalize(student.get("id")) if student else None,
        include_inactive=student is None,
    )
    module_count, lesson_count, assignment_count = _course_counts(modules, assignments)
    return _serialize_course(row, modules=modules, module_count=module_count, lesson_count=lesson_count, assignment_count=assignment_count)


def create_course(school_id: str, profile_id: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    title = _normalize(payload.get("title"))
    if not title:
        raise HTTPException(status_code=400, detail="title is required")
    insert_payload = {
        "school_id": school_id,
        "subject_id": _normalize_optional_uuid(payload.get("subject_id")),
        "batch_id": _normalize_optional_uuid(payload.get("batch_id")),
        "created_by_profile_id": _normalize_optional_uuid(profile_id),
        "updated_by_profile_id": _normalize_optional_uuid(profile_id),
        "course_code": _normalize(payload.get("course_code")) or None,
        "title": title,
        "description": payload.get("description"),
        "thumbnail_url": payload.get("thumbnail_url"),
        "intro_video_url": payload.get("intro_video_url"),
        "target_class_name": _normalize(payload.get("target_class_name")) or None,
        "target_section": _normalize(payload.get("target_section")) or None,
        "visibility": _normalize(payload.get("visibility")) or "batch",
        "is_published": bool(payload.get("is_published", False)),
        "estimated_duration_minutes": int(payload.get("estimated_duration_minutes") or 0),
        "metadata": _normalize_json_object(payload.get("metadata")),
        "is_active": True,
    }
    response = _table("courses").insert(insert_payload).execute()
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Course create returned no row")
    created = dict(rows[0])
    _log_audit_entry(school_id=school_id, profile_id=profile_id, action="lms.course_created", entity_id=_normalize(created.get("id")), payload={"title": title})
    return _serialize_course(created)


def update_course(school_id: str, course_id: str, profile_id: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    current = _get_course_row(school_id, course_id)
    update_payload: dict[str, Any] = {"updated_by_profile_id": _normalize_optional_uuid(profile_id)}
    for key in ("title", "description", "course_code", "thumbnail_url", "intro_video_url", "target_class_name", "target_section", "visibility"):
        if key in payload:
            update_payload[key] = payload.get(key)
    for key in ("subject_id", "batch_id"):
        if key in payload:
            update_payload[key] = _normalize_optional_uuid(payload.get(key))
    for key in ("is_published", "is_active"):
        if key in payload and payload.get(key) is not None:
            update_payload[key] = bool(payload.get(key))
    if "estimated_duration_minutes" in payload and payload.get("estimated_duration_minutes") is not None:
        update_payload["estimated_duration_minutes"] = int(payload.get("estimated_duration_minutes"))
    if "metadata" in payload and payload.get("metadata") is not None:
        update_payload["metadata"] = _normalize_json_object(payload.get("metadata"))
    _table("courses").update(update_payload).eq("school_id", school_id).eq("id", course_id).execute()
    _log_audit_entry(school_id=school_id, profile_id=profile_id, action="lms.course_updated", entity_id=course_id, payload={"updated_fields": sorted(update_payload.keys())})
    return get_course(school_id, course_id)


def delete_course(school_id: str, course_id: str, profile_id: str | None) -> dict[str, Any]:
    _get_course_row(school_id, course_id)
    _table("courses").update(
        {"is_active": False, "deleted_at": _utc_now_iso(), "deleted_by_profile_id": _normalize_optional_uuid(profile_id)}
    ).eq("school_id", school_id).eq("id", course_id).execute()
    _log_audit_entry(school_id=school_id, profile_id=profile_id, action="lms.course_deleted", entity_id=course_id, payload={"soft_delete": True})
    return {"message": "Course deleted successfully"}


def list_modules(school_id: str, course_id: str) -> list[dict[str, Any]]:
    _get_course_row(school_id, course_id)
    return _load_module_map(school_id, [course_id]).get(course_id, [])


def create_module(school_id: str, profile_id: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    course_id = _normalize(payload.get("course_id"))
    if not course_id:
        raise HTTPException(status_code=400, detail="course_id is required")
    _get_course_row(school_id, course_id)
    title = _normalize(payload.get("title"))
    if not title:
        raise HTTPException(status_code=400, detail="title is required")
    response = _table("course_modules").insert(
        {
            "school_id": school_id,
            "course_id": course_id,
            "created_by_profile_id": _normalize_optional_uuid(profile_id),
            "updated_by_profile_id": _normalize_optional_uuid(profile_id),
            "title": title,
            "description": payload.get("description"),
            "display_order": int(payload.get("display_order") or 1),
            "metadata": _normalize_json_object(payload.get("metadata")),
            "is_active": True,
        }
    ).execute()
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Module create returned no row")
    created = dict(rows[0])
    _log_audit_entry(school_id=school_id, profile_id=profile_id, action="lms.module_created", entity_id=_normalize(created.get("id")), payload={"course_id": course_id})
    return _serialize_module(created, [])


def update_module(school_id: str, module_id: str, profile_id: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    _get_module_row(school_id, module_id)
    update_payload: dict[str, Any] = {"updated_by_profile_id": _normalize_optional_uuid(profile_id)}
    for key in ("title", "description"):
        if key in payload:
            update_payload[key] = payload.get(key)
    if "display_order" in payload and payload.get("display_order") is not None:
        update_payload["display_order"] = int(payload.get("display_order"))
    if "metadata" in payload and payload.get("metadata") is not None:
        update_payload["metadata"] = _normalize_json_object(payload.get("metadata"))
    if "is_active" in payload and payload.get("is_active") is not None:
        update_payload["is_active"] = bool(payload.get("is_active"))
    _table("course_modules").update(update_payload).eq("school_id", school_id).eq("id", module_id).execute()
    current = _get_module_row(school_id, module_id)
    _log_audit_entry(school_id=school_id, profile_id=profile_id, action="lms.module_updated", entity_id=module_id, payload={"updated_fields": sorted(update_payload.keys())})
    return _serialize_module(current, _load_lesson_map(school_id, [module_id]).get(module_id, []))


def delete_module(school_id: str, module_id: str, profile_id: str | None) -> dict[str, Any]:
    _get_module_row(school_id, module_id)
    _table("course_modules").update(
        {"is_active": False, "deleted_at": _utc_now_iso(), "deleted_by_profile_id": _normalize_optional_uuid(profile_id)}
    ).eq("school_id", school_id).eq("id", module_id).execute()
    _log_audit_entry(school_id=school_id, profile_id=profile_id, action="lms.module_deleted", entity_id=module_id, payload={"soft_delete": True})
    return {"message": "Course module deleted successfully"}


def _replace_lesson_resources(school_id: str, lesson_id: str, course_id: str, profile_id: str | None, resources: list[dict[str, Any]]) -> None:
    _table("lesson_resources").update(
        {"is_active": False, "deleted_at": _utc_now_iso(), "deleted_by_profile_id": _normalize_optional_uuid(profile_id)}
    ).eq("school_id", school_id).eq("lesson_id", lesson_id).is_("deleted_at", "null").execute()
    if not resources:
        return
    payload = []
    for resource in resources:
        payload.append(
            {
                "school_id": school_id,
                "course_id": course_id,
                "lesson_id": lesson_id,
                "created_by_profile_id": _normalize_optional_uuid(profile_id),
                "updated_by_profile_id": _normalize_optional_uuid(profile_id),
                "resource_type": _normalize(resource.get("resource_type")) or "pdf",
                "title": _normalize(resource.get("title")) or "Resource",
                "resource_url": resource.get("resource_url"),
                "text_content": resource.get("text_content"),
                "file_size_bytes": int(resource.get("file_size_bytes")) if resource.get("file_size_bytes") is not None else None,
                "metadata": _normalize_json_object(resource.get("metadata")),
                "is_downloadable": bool(resource.get("is_downloadable", True)),
                "is_active": True,
            }
        )
    _table("lesson_resources").insert(payload).execute()


def list_lessons(school_id: str, *, course_id: str | None = None, module_id: str | None = None) -> list[dict[str, Any]]:
    query = _table("lessons").select("*").eq("school_id", school_id).is_("deleted_at", "null").eq("is_active", True)
    if course_id:
        query = query.eq("course_id", course_id)
    if module_id:
        query = query.eq("module_id", module_id)
    rows = [dict(row) for row in list(query.order("display_order", desc=False).execute().data or [])]
    resource_map = _load_resource_map(school_id, [_normalize(row.get("id")) for row in rows])
    return [_serialize_lesson(row, resource_map.get(_normalize(row.get("id")), [])) for row in rows]


def get_lesson(school_id: str, lesson_id: str, *, student: dict[str, Any] | None = None) -> dict[str, Any]:
    lesson = _get_lesson_row(school_id, lesson_id)
    course = _get_course_row(school_id, _normalize(lesson.get("course_id")))
    if student is not None and not _course_visible_to_student(course, student) and not bool(lesson.get("is_preview", False)):
        raise HTTPException(status_code=403, detail="This lesson is not available for the current student")
    resource_map = _load_resource_map(school_id, [lesson_id])
    return _serialize_lesson(lesson, resource_map.get(lesson_id, []))


def create_lesson(school_id: str, profile_id: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    course_id = _normalize(payload.get("course_id"))
    module_id = _normalize(payload.get("module_id"))
    if not course_id or not module_id:
        raise HTTPException(status_code=400, detail="course_id and module_id are required")
    _get_course_row(school_id, course_id)
    _get_module_row(school_id, module_id)
    title = _normalize(payload.get("title"))
    if not title:
        raise HTTPException(status_code=400, detail="title is required")
    response = _table("lessons").insert(
        {
            "school_id": school_id,
            "course_id": course_id,
            "module_id": module_id,
            "created_by_profile_id": _normalize_optional_uuid(profile_id),
            "updated_by_profile_id": _normalize_optional_uuid(profile_id),
            "title": title,
            "description": payload.get("description"),
            "lesson_type": _normalize(payload.get("lesson_type")) or "video",
            "video_url": payload.get("video_url"),
            "content_text": payload.get("content_text"),
            "duration_seconds": int(payload.get("duration_seconds") or 0),
            "display_order": int(payload.get("display_order") or 1),
            "is_preview": bool(payload.get("is_preview", False)),
            "metadata": _normalize_json_object(payload.get("metadata")),
            "is_active": True,
        }
    ).execute()
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Lesson create returned no row")
    created = dict(rows[0])
    resources = [_normalize_json_object(item) for item in _normalize_json_list(payload.get("resources"))]
    _replace_lesson_resources(school_id, _normalize(created.get("id")), course_id, profile_id, resources)
    _log_audit_entry(school_id=school_id, profile_id=profile_id, action="lms.lesson_created", entity_id=_normalize(created.get("id")), payload={"course_id": course_id, "module_id": module_id})
    return get_lesson(school_id, _normalize(created.get("id")))


def update_lesson(school_id: str, lesson_id: str, profile_id: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    current = _get_lesson_row(school_id, lesson_id)
    update_payload: dict[str, Any] = {"updated_by_profile_id": _normalize_optional_uuid(profile_id)}
    for key in ("title", "description", "lesson_type", "video_url", "content_text"):
        if key in payload:
            update_payload[key] = payload.get(key)
    for key in ("duration_seconds", "display_order"):
        if key in payload and payload.get(key) is not None:
            update_payload[key] = int(payload.get(key))
    for key in ("is_preview", "is_active"):
        if key in payload and payload.get(key) is not None:
            update_payload[key] = bool(payload.get(key))
    if "metadata" in payload and payload.get("metadata") is not None:
        update_payload["metadata"] = _normalize_json_object(payload.get("metadata"))
    _table("lessons").update(update_payload).eq("school_id", school_id).eq("id", lesson_id).execute()
    if "resources" in payload and payload.get("resources") is not None:
        resources = [_normalize_json_object(item) for item in _normalize_json_list(payload.get("resources"))]
        _replace_lesson_resources(school_id, lesson_id, _normalize(current.get("course_id")), profile_id, resources)
    _log_audit_entry(school_id=school_id, profile_id=profile_id, action="lms.lesson_updated", entity_id=lesson_id, payload={"updated_fields": sorted(update_payload.keys())})
    return get_lesson(school_id, lesson_id)


def delete_lesson(school_id: str, lesson_id: str, profile_id: str | None) -> dict[str, Any]:
    _get_lesson_row(school_id, lesson_id)
    _table("lessons").update(
        {"is_active": False, "deleted_at": _utc_now_iso(), "deleted_by_profile_id": _normalize_optional_uuid(profile_id)}
    ).eq("school_id", school_id).eq("id", lesson_id).execute()
    _log_audit_entry(school_id=school_id, profile_id=profile_id, action="lms.lesson_deleted", entity_id=lesson_id, payload={"soft_delete": True})
    return {"message": "Lesson deleted successfully"}


def list_assignments(
    school_id: str,
    *,
    student: dict[str, Any] | None = None,
    course_id: str | None = None,
    include_inactive: bool = False,
) -> list[dict[str, Any]]:
    items = _load_assignment_rows(
        school_id,
        course_id=course_id,
        student_id=_normalize(student.get("id")) if student else None,
        include_inactive=include_inactive,
    )
    if student is not None:
        visible_course_ids = {item.get("id") for item in list_courses(school_id, student=student)}
        items = [item for item in items if item.get("course_id") in visible_course_ids and item.get("status") in {"published", "closed"}]
    return items


def get_assignment(school_id: str, assignment_id: str, *, student: dict[str, Any] | None = None) -> dict[str, Any]:
    row = _get_assignment_row(school_id, assignment_id)
    items = list_assignments(
        school_id,
        student=student,
        course_id=_normalize(row.get("course_id")),
        include_inactive=student is None,
    )
    for item in items:
        if _normalize(item.get("id")) == assignment_id:
            return item
    raise HTTPException(status_code=404, detail="Assignment not found")


def create_assignment(school_id: str, profile_id: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    course_id = _normalize(payload.get("course_id"))
    if not course_id:
        raise HTTPException(status_code=400, detail="course_id is required")
    _get_course_row(school_id, course_id)
    title = _normalize(payload.get("title"))
    if not title:
        raise HTTPException(status_code=400, detail="title is required")
    response = _table("assignments").insert(
        {
            "school_id": school_id,
            "course_id": course_id,
            "module_id": _normalize_optional_uuid(payload.get("module_id")),
            "lesson_id": _normalize_optional_uuid(payload.get("lesson_id")),
            "created_by_profile_id": _normalize_optional_uuid(profile_id),
            "updated_by_profile_id": _normalize_optional_uuid(profile_id),
            "title": title,
            "description": payload.get("description"),
            "attachment_url": payload.get("attachment_url"),
            "due_at": payload.get("due_at"),
            "max_score": float(payload.get("max_score") or 100),
            "status": _normalize(payload.get("status")) or "draft",
            "metadata": _normalize_json_object(payload.get("metadata")),
            "is_active": True,
        }
    ).execute()
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Assignment create returned no row")
    created = dict(rows[0])
    _log_audit_entry(school_id=school_id, profile_id=profile_id, action="lms.assignment_created", entity_id=_normalize(created.get("id")), payload={"course_id": course_id})
    return _serialize_assignment(created)


def update_assignment(school_id: str, assignment_id: str, profile_id: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    _get_assignment_row(school_id, assignment_id)
    update_payload: dict[str, Any] = {"updated_by_profile_id": _normalize_optional_uuid(profile_id)}
    for key in ("title", "description", "attachment_url", "due_at", "status"):
        if key in payload:
            update_payload[key] = payload.get(key)
    for key in ("module_id", "lesson_id"):
        if key in payload:
            update_payload[key] = _normalize_optional_uuid(payload.get(key))
    if "max_score" in payload and payload.get("max_score") is not None:
        update_payload["max_score"] = float(payload.get("max_score"))
    if "metadata" in payload and payload.get("metadata") is not None:
        update_payload["metadata"] = _normalize_json_object(payload.get("metadata"))
    if "is_active" in payload and payload.get("is_active") is not None:
        update_payload["is_active"] = bool(payload.get("is_active"))
    _table("assignments").update(update_payload).eq("school_id", school_id).eq("id", assignment_id).execute()
    _log_audit_entry(school_id=school_id, profile_id=profile_id, action="lms.assignment_updated", entity_id=assignment_id, payload={"updated_fields": sorted(update_payload.keys())})
    return get_assignment(school_id, assignment_id)


def delete_assignment(school_id: str, assignment_id: str, profile_id: str | None) -> dict[str, Any]:
    _get_assignment_row(school_id, assignment_id)
    _table("assignments").update(
        {"is_active": False, "deleted_at": _utc_now_iso(), "deleted_by_profile_id": _normalize_optional_uuid(profile_id)}
    ).eq("school_id", school_id).eq("id", assignment_id).execute()
    _log_audit_entry(school_id=school_id, profile_id=profile_id, action="lms.assignment_deleted", entity_id=assignment_id, payload={"soft_delete": True})
    return {"message": "Assignment deleted successfully"}


def submit_assignment(school_id: str, assignment_id: str, student: dict[str, Any], profile_id: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    assignment = _get_assignment_row(school_id, assignment_id)
    course = _get_course_row(school_id, _normalize(assignment.get("course_id")))
    if not _course_visible_to_student(course, student):
        raise HTTPException(status_code=403, detail="This assignment is not available for the current student")
    existing_rows = list(
        _table("assignment_submissions")
        .select("*")
        .eq("school_id", school_id)
        .eq("assignment_id", assignment_id)
        .eq("student_id", _normalize(student.get("id")))
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    submission_payload = {
        "school_id": school_id,
        "assignment_id": assignment_id,
        "student_id": _normalize(student.get("id")),
        "submitted_by_profile_id": _normalize_optional_uuid(profile_id),
        "submission_text": payload.get("submission_text"),
        "attachment_url": payload.get("attachment_url"),
        "status": "submitted",
        "submitted_at": _utc_now_iso(),
        "metadata": _normalize_json_object(payload.get("metadata")),
        "is_active": True,
    }
    if existing_rows:
        submission_id = _normalize(existing_rows[0].get("id"))
        _table("assignment_submissions").update(submission_payload).eq("school_id", school_id).eq("id", submission_id).execute()
        rows = list(
            _table("assignment_submissions")
            .select("*")
            .eq("school_id", school_id)
            .eq("id", submission_id)
            .limit(1)
            .execute()
            .data
            or []
        )
    else:
        response = _table("assignment_submissions").insert(submission_payload).execute()
        rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Assignment submission failed")
    _sync_assignment_completion(school_id, _normalize(student.get("id")), _normalize(assignment.get("course_id")))
    _log_audit_entry(school_id=school_id, profile_id=profile_id, action="lms.assignment_submitted", entity_id=assignment_id, payload={"student_id": _normalize(student.get("id"))})
    return _serialize_submission(dict(rows[0]))


def grade_submission(school_id: str, assignment_id: str, student_id: str, profile_id: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    rows = list(
        _table("assignment_submissions")
        .select("*")
        .eq("school_id", school_id)
        .eq("assignment_id", assignment_id)
        .eq("student_id", student_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Assignment submission not found")
    update_payload = {
        "graded_by_profile_id": _normalize_optional_uuid(profile_id),
        "status": _normalize(payload.get("status")) or "graded",
        "score_awarded": float(payload.get("score_awarded")) if payload.get("score_awarded") is not None else None,
        "feedback": payload.get("feedback"),
        "graded_at": _utc_now_iso(),
    }
    _table("assignment_submissions").update(update_payload).eq("school_id", school_id).eq("id", _normalize(rows[0].get("id"))).execute()
    refreshed = list(
        _table("assignment_submissions").select("*").eq("school_id", school_id).eq("id", _normalize(rows[0].get("id"))).limit(1).execute().data or []
    )
    _log_audit_entry(school_id=school_id, profile_id=profile_id, action="lms.assignment_graded", entity_id=assignment_id, payload={"student_id": student_id})
    return _serialize_submission(dict(refreshed[0]))


def _sync_assignment_completion(school_id: str, student_id: str, course_id: str) -> None:
    lesson_rows = list(
        _table("lessons")
        .select("id,module_id")
        .eq("school_id", school_id)
        .eq("course_id", course_id)
        .is_("deleted_at", "null")
        .eq("is_active", True)
        .execute()
        .data
        or []
    )
    lesson_ids = [_normalize(row.get("id")) for row in lesson_rows]
    progress_rows = list(
        _table("student_progress")
        .select("*")
        .eq("school_id", school_id)
        .eq("student_id", student_id)
        .eq("course_id", course_id)
        .in_("lesson_id", lesson_ids or ["00000000-0000-0000-0000-000000000000"])
        .is_("deleted_at", "null")
        .execute()
        .data
        or []
    )
    assignment_rows = list(
        _table("assignments")
        .select("id")
        .eq("school_id", school_id)
        .eq("course_id", course_id)
        .is_("deleted_at", "null")
        .eq("is_active", True)
        .in_("status", ["published", "closed"])
        .execute()
        .data
        or []
    )
    assignment_ids = [_normalize(row.get("id")) for row in assignment_rows]
    submission_rows = list(
        _table("assignment_submissions")
        .select("assignment_id,status")
        .eq("school_id", school_id)
        .eq("student_id", student_id)
        .in_("assignment_id", assignment_ids or ["00000000-0000-0000-0000-000000000000"])
        .is_("deleted_at", "null")
        .execute()
        .data
        or []
    )
    completed_lessons = {_normalize(row.get("lesson_id")) for row in progress_rows if bool(row.get("is_completed"))}
    course_completion_percentage = round((len(completed_lessons) / max(len(lesson_ids), 1)) * 100, 2) if lesson_ids else 0.0
    submitted_assignments = len([row for row in submission_rows if _normalize(row.get("status")) in {"submitted", "graded", "returned"}])
    assignment_completion_percentage = round((submitted_assignments / max(len(assignment_ids), 1)) * 100, 2) if assignment_ids else 0.0
    for row in progress_rows:
        _table("student_progress").update(
            {
                "course_completion_percentage": course_completion_percentage,
                "assignment_completion_percentage": assignment_completion_percentage,
                "lessons_completed": len(completed_lessons),
            }
        ).eq("school_id", school_id).eq("id", _normalize(row.get("id"))).execute()


def update_progress(school_id: str, student: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    course_id = _normalize(payload.get("course_id"))
    lesson_id = _normalize(payload.get("lesson_id"))
    if not course_id or not lesson_id:
        raise HTTPException(status_code=400, detail="course_id and lesson_id are required")
    course = _get_course_row(school_id, course_id)
    lesson = _get_lesson_row(school_id, lesson_id)
    if _normalize(lesson.get("course_id")) != course_id:
        raise HTTPException(status_code=400, detail="Lesson does not belong to the specified course")
    if not _course_visible_to_student(course, student) and not bool(lesson.get("is_preview", False)):
        raise HTTPException(status_code=403, detail="This lesson is not available for the current student")
    existing_rows = list(
        _table("student_progress")
        .select("*")
        .eq("school_id", school_id)
        .eq("student_id", _normalize(student.get("id")))
        .eq("lesson_id", lesson_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    progress_payload = {
        "school_id": school_id,
        "student_id": _normalize(student.get("id")),
        "course_id": course_id,
        "module_id": _normalize_optional_uuid(payload.get("module_id") or lesson.get("module_id")),
        "lesson_id": lesson_id,
        "last_watched_position_seconds": int(payload.get("last_watched_position_seconds") or 0),
        "watch_percentage": float(payload.get("watch_percentage") or 0),
        "assignment_completion_percentage": float(payload.get("assignment_completion_percentage") or 0),
        "is_completed": bool(payload.get("is_completed", False)),
        "last_accessed_at": _utc_now_iso(),
        "completed_at": _utc_now_iso() if bool(payload.get("is_completed", False)) else None,
        "metadata": _normalize_json_object(payload.get("metadata")),
        "is_active": True,
    }
    if existing_rows:
        progress_id = _normalize(existing_rows[0].get("id"))
        _table("student_progress").update(progress_payload).eq("school_id", school_id).eq("id", progress_id).execute()
    else:
        _table("student_progress").insert(progress_payload).execute()
    _sync_assignment_completion(school_id, _normalize(student.get("id")), course_id)
    refreshed_rows = list(
        _table("student_progress")
        .select("*")
        .eq("school_id", school_id)
        .eq("student_id", _normalize(student.get("id")))
        .eq("lesson_id", lesson_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not refreshed_rows:
        raise HTTPException(status_code=500, detail="Progress update failed")
    return _serialize_progress(dict(refreshed_rows[0]))


def _recommended_test_titles(school_id: str, student: dict[str, Any]) -> list[str]:
    try:
        from app.services.supabase_online_tests import list_tests

        tests = list_tests(school_id, include_inactive=False, student_batch_id=_normalize(student.get("batch_id")) or None, skip=0, limit=3)
        return [str(item.get("title") or "").strip() for item in tests if str(item.get("title") or "").strip()]
    except Exception:
        return []


def _build_ai_insights(school_id: str, student: dict[str, Any], enrolled_courses: list[dict[str, Any]], progress_items: list[dict[str, Any]]) -> dict[str, Any]:
    weak_chapters: list[str] = []
    revision_suggestions: list[str] = []
    try:
        from app.services.supabase_analytics import get_student_analytics

        analytics = get_student_analytics(school_id, _normalize(student.get("id")))
        weak_chapters = list(analytics.get("weak_topics") or [])[:3]
        revision_suggestions = list(analytics.get("suggestions") or [])[:3]
    except Exception:
        pass
    progress_map = {_normalize(item.get("lesson_id")): item for item in progress_items}
    recommended_lessons: list[str] = []
    for course in enrolled_courses:
        for module in course.get("modules") or []:
            for lesson in module.get("lessons") or []:
                lesson_progress = progress_map.get(_normalize(lesson.get("id")))
                if not lesson_progress or not bool(lesson_progress.get("is_completed")):
                    recommended_lessons.append(str(lesson.get("title") or "").strip())
                if len(recommended_lessons) >= 3:
                    break
            if len(recommended_lessons) >= 3:
                break
        if len(recommended_lessons) >= 3:
            break
    return {
        "weak_chapters": weak_chapters,
        "recommended_lessons": [item for item in recommended_lessons if item],
        "recommended_tests": _recommended_test_titles(school_id, student),
        "revision_suggestions": revision_suggestions or ["Revise the lowest-progress lessons before attempting the next test"],
    }


def get_progress_dashboard(
    school_id: str,
    *,
    student: dict[str, Any] | None = None,
    parent_students: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    target_students = [student] if student is not None else list(parent_students or [])
    if not target_students:
        return {"progress_items": [], "enrolled_courses": [], "ai_insights": {"weak_chapters": [], "recommended_lessons": [], "recommended_tests": [], "revision_suggestions": []}}
    student_ids = [_normalize(item.get("id")) for item in target_students]
    progress_rows = list(
        _table("student_progress")
        .select("*")
        .eq("school_id", school_id)
        .in_("student_id", student_ids)
        .is_("deleted_at", "null")
        .order("updated_at", desc=True)
        .execute()
        .data
        or []
    )
    progress_items = [_serialize_progress(dict(row)) for row in progress_rows]
    if student is not None:
        enrolled_courses = [get_course(school_id, item.get("id"), student=student) for item in list_courses(school_id, student=student)]
        ai_insights = _build_ai_insights(school_id, student, enrolled_courses, progress_items)
    else:
        enrolled_courses = []
        for linked_student in target_students:
            for item in list_courses(school_id, student=linked_student):
                if not any(existing.get("id") == item.get("id") for existing in enrolled_courses):
                    enrolled_courses.append(get_course(school_id, item.get("id"), student=linked_student))
        ai_insights = {
            "weak_chapters": [],
            "recommended_lessons": [str(course.get("title") or "").strip() for course in enrolled_courses[:3]],
            "recommended_tests": [],
            "revision_suggestions": ["Track your child’s incomplete lessons and upcoming assignments from My Learning"],
        }
    return {"progress_items": progress_items, "enrolled_courses": enrolled_courses, "ai_insights": ai_insights}
