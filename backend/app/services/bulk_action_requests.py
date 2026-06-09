from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable
from uuid import UUID

from fastapi import HTTPException, status

from app.middleware.auth import user_has_permission
from app.models import User
from app.services.supabase_admin import get_supabase_admin_client
from app.services.supabase_attendance import (
    delete_all_holidays,
    delete_all_leave_requests,
    delete_all_notifications,
    delete_all_staff_records,
    delete_all_student_records,
)
from app.services.supabase_students import delete_all_students


DEFAULT_BULK_ACTION_REASON = "Approval required for bulk destructive action."


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_platform_admin_user(user: User | None) -> bool:
    return str(getattr(user, "role_key", "") or "").strip().lower() == "platform_admin"


def can_request_bulk_action(user: User | None, module_name: str) -> bool:
    if not user:
        return False
    if is_platform_admin_user(user):
        return True

    normalized_module = str(module_name or "").strip().lower()
    if normalized_module in {"attendance", "leaves"}:
        return user_has_permission(user, "attendance")
    if normalized_module == "students":
        return user_has_permission(user, "admin_office.students")
    if normalized_module == "staff":
        return user_has_permission(user, "admin_office.teachers") or user_has_permission(user, "admin_office.invigilators")
    return False


def _normalize_uuid(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return str(UUID(text))
    except (TypeError, ValueError, AttributeError):
        return None


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()


def _normalize_json_object(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _log_workflow_event(
    *,
    request_id: str,
    school_id: str,
    event_type: str,
    actor_profile_id: str | None,
    actor_role: str | None,
    notes: str | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    (
        get_supabase_admin_client()
        .schema("workflow")
        .table("bulk_action_events")
        .insert(
            {
                "request_id": request_id,
                "school_id": school_id,
                "event_type": event_type,
                "actor_profile_id": _normalize_uuid(actor_profile_id),
                "actor_role": _normalize_text(actor_role) or None,
                "notes": _normalize_text(notes) or None,
                "payload": payload or {},
            }
        )
        .execute()
    )


def _log_audit_entry(
    *,
    school_id: str,
    profile_id: str | None,
    action: str,
    module_key: str,
    entity_id: str | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    row: dict[str, Any] = {
        "school_id": _normalize_uuid(school_id),
        "profile_id": _normalize_uuid(profile_id),
        "action": action,
        "module_key": module_key,
        "payload": payload or {},
    }
    entity_uuid = _normalize_uuid(entity_id)
    if entity_uuid:
        row["entity_id"] = entity_uuid
    get_supabase_admin_client().table("audit_logs").insert(row).execute()


def _fetch_bulk_action_request(request_id: str) -> dict[str, Any]:
    response = (
        get_supabase_admin_client()
        .schema("workflow")
        .table("bulk_action_requests")
        .select("*")
        .eq("id", request_id)
        .limit(1)
        .execute()
    )
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=404, detail="Bulk action request not found")
    return dict(rows[0])


def _update_bulk_action_request(request_id: str, updates: dict[str, Any]) -> dict[str, Any]:
    response = (
        get_supabase_admin_client()
        .schema("workflow")
        .table("bulk_action_requests")
        .update(updates)
        .eq("id", request_id)
        .execute()
    )
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=404, detail="Bulk action request not found")
    return dict(rows[0])


def _serialize_bulk_action_request(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "school_id": row.get("school_id"),
        "module_name": row.get("module_name") or "",
        "action_type": row.get("action_type") or "",
        "requested_by_profile_id": row.get("requested_by_profile_id"),
        "requested_role": row.get("requested_role") or "",
        "reason": row.get("reason"),
        "payload_json": _normalize_json_object(row.get("payload_json")),
        "status": row.get("status") or "pending",
        "approved_by_profile_id": row.get("approved_by_profile_id"),
        "approved_at": row.get("approved_at"),
        "rejected_by_profile_id": row.get("rejected_by_profile_id"),
        "rejected_at": row.get("rejected_at"),
        "cancelled_by_profile_id": row.get("cancelled_by_profile_id"),
        "cancelled_at": row.get("cancelled_at"),
        "executed_by_profile_id": row.get("executed_by_profile_id"),
        "executed_at": row.get("executed_at"),
        "execution_result": _normalize_json_object(row.get("execution_result")),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _normalize_execution_result(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, int):
        return {"deleted_count": value}
    if isinstance(value, list):
        return {"items": value, "count": len(value)}
    return {"result": value}


def _filter_staff_directory_rows(rows: list[dict[str, Any]], *, search: str | None, staff_type: str | None, category: str | None) -> list[dict[str, Any]]:
    normalized_search = _normalize_text(search).casefold()
    normalized_staff_type = _normalize_text(staff_type).casefold()
    normalized_category = _normalize_text(category).casefold()

    def matches(row: dict[str, Any]) -> bool:
        row_staff_type = _normalize_text(row.get("staff_type")).casefold()
        if normalized_staff_type == "teaching" and row_staff_type != "teaching":
            return False
        if normalized_staff_type == "non_teaching" and row_staff_type == "teaching":
            return False

        metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        category_value = _normalize_text(
            metadata.get("category")
            or row.get("department")
            or row.get("designation")
            or ("Teaching" if row_staff_type == "teaching" else "Non-Teaching")
        ).casefold()
        if normalized_category and normalized_category != "all" and category_value != normalized_category:
            return False

        if normalized_search:
            haystack = " ".join(
                _normalize_text(row.get(key))
                for key in ("full_name", "employee_code", "email", "phone", "department", "designation")
            ).casefold()
            if normalized_search not in haystack:
                return False
        return True

    return [row for row in rows if matches(row)]


def _chunk_values(values: list[str], chunk_size: int = 200) -> list[list[str]]:
    return [values[index:index + chunk_size] for index in range(0, len(values), chunk_size)]


def execute_staff_directory_bulk_delete(
    school_id: str,
    *,
    search: str | None = None,
    staff_type: str | None = None,
    category: str | None = None,
) -> dict[str, Any]:
    response = (
        get_supabase_admin_client()
        .table("staff_members")
        .select("id, full_name, employee_code, email, phone, department, designation, staff_type, metadata")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .execute()
    )
    filtered_rows = _filter_staff_directory_rows(
        list(response.data or []),
        search=search,
        staff_type=staff_type,
        category=category,
    )
    staff_ids = [str(row.get("id")) for row in filtered_rows if row.get("id")]
    if not staff_ids:
        return {"message": "0 staff record(s) deleted successfully", "deleted_count": 0}

    deleted_count = 0
    for chunk in _chunk_values(staff_ids):
        update_response = (
            get_supabase_admin_client()
            .table("staff_members")
            .update({"is_active": False})
            .eq("school_id", school_id)
            .in_("id", chunk)
            .execute()
        )
        deleted_count += len(list(update_response.data or []))

    return {
        "message": f"{deleted_count} staff record(s) deleted successfully",
        "deleted_count": deleted_count,
    }


def _execute_delete_all_leaves(school_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    return delete_all_leave_requests(school_id, status_filter=_normalize_text(payload.get("status")) or None)


def _execute_delete_all_student_records(school_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    return delete_all_student_records(
        school_id,
        class_name=_normalize_text(payload.get("class_name")) or None,
        section=_normalize_text(payload.get("section")) or None,
        student_name=_normalize_text(payload.get("student_name")) or None,
        date_from=_normalize_text(payload.get("date_from")) or None,
        date_to=_normalize_text(payload.get("date_to")) or None,
        batch_filters=list(payload.get("batch_filters") or []) if isinstance(payload.get("batch_filters"), list) else None,
    )


def _execute_delete_all_staff_records(school_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    return delete_all_staff_records(
        school_id,
        department=_normalize_text(payload.get("department")) or None,
        staff_name=_normalize_text(payload.get("staff_name")) or None,
        date_from=_normalize_text(payload.get("date_from")) or None,
        date_to=_normalize_text(payload.get("date_to")) or None,
    )


def _execute_delete_all_notifications(school_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    del payload
    return delete_all_notifications(school_id)


def _execute_delete_all_holidays(school_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    del payload
    return delete_all_holidays(school_id)


def _execute_delete_all_students(school_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    del payload
    deleted_count = delete_all_students(school_id)
    return {"message": f"All {deleted_count} students deleted successfully", "deleted_count": deleted_count}


def _execute_delete_all_staff_directory(school_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    return execute_staff_directory_bulk_delete(
        school_id,
        search=_normalize_text(payload.get("search")) or None,
        staff_type=_normalize_text(payload.get("staff_type")) or None,
        category=_normalize_text(payload.get("category")) or None,
    )


BULK_ACTION_EXECUTORS: dict[str, Callable[[str, dict[str, Any]], dict[str, Any]]] = {
    "attendance.delete_all_leaves": _execute_delete_all_leaves,
    "attendance.delete_all_student_records": _execute_delete_all_student_records,
    "attendance.delete_all_staff_records": _execute_delete_all_staff_records,
    "attendance.delete_all_notifications": _execute_delete_all_notifications,
    "attendance.delete_all_holidays": _execute_delete_all_holidays,
    "students.delete_all_students": _execute_delete_all_students,
    "staff.delete_all_staff": _execute_delete_all_staff_directory,
}


def create_bulk_action_request(
    *,
    school_id: str,
    module_name: str,
    action_type: str,
    requested_by_profile_id: str,
    requested_role: str,
    reason: str | None = None,
    payload_json: dict[str, Any] | None = None,
) -> dict[str, Any]:
    row = {
        "school_id": school_id,
        "module_name": _normalize_text(module_name),
        "action_type": _normalize_text(action_type),
        "requested_by_profile_id": _normalize_uuid(requested_by_profile_id),
        "requested_role": _normalize_text(requested_role) or "viewer",
        "reason": _normalize_text(reason) or DEFAULT_BULK_ACTION_REASON,
        "payload_json": payload_json or {},
        "status": "pending",
    }
    response = (
        get_supabase_admin_client()
        .schema("workflow")
        .table("bulk_action_requests")
        .insert(row)
        .execute()
    )
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create bulk action request")
    created = dict(rows[0])
    request_id = str(created.get("id"))
    _log_workflow_event(
        request_id=request_id,
        school_id=school_id,
        event_type="created",
        actor_profile_id=requested_by_profile_id,
        actor_role=requested_role,
        notes="Request Created",
        payload={"notification_type": "bulk_request_created", "module_name": module_name, "action_type": action_type},
    )
    _log_audit_entry(
        school_id=school_id,
        profile_id=requested_by_profile_id,
        action="bulk_action.requested",
        module_key=module_name,
        entity_id=request_id,
        payload={"action_type": action_type, "payload_json": payload_json or {}, "reason": row["reason"]},
    )
    return _serialize_bulk_action_request(created)


def list_bulk_action_requests(
    school_id: str,
    *,
    status_filter: str | None = None,
    module_name: str | None = None,
) -> list[dict[str, Any]]:
    query = (
        get_supabase_admin_client()
        .schema("workflow")
        .table("bulk_action_requests")
        .select("*")
        .eq("school_id", school_id)
        .order("created_at", desc=True)
    )
    if _normalize_text(status_filter):
        query = query.eq("status", _normalize_text(status_filter))
    if _normalize_text(module_name):
        query = query.eq("module_name", _normalize_text(module_name))
    response = query.execute()
    return [_serialize_bulk_action_request(dict(row)) for row in list(response.data or [])]


def approve_bulk_action_request(
    request_id: str,
    *,
    approved_by_profile_id: str,
    approved_role: str,
) -> dict[str, Any]:
    existing = _fetch_bulk_action_request(request_id)
    if _normalize_text(existing.get("status")) != "pending":
        raise HTTPException(status_code=400, detail="Only pending bulk action requests can be approved")

    updated = _update_bulk_action_request(
        request_id,
        {
            "status": "approved",
            "approved_by_profile_id": _normalize_uuid(approved_by_profile_id),
            "approved_at": _utc_now_iso(),
        },
    )
    _log_workflow_event(
        request_id=request_id,
        school_id=str(updated.get("school_id") or ""),
        event_type="approved",
        actor_profile_id=approved_by_profile_id,
        actor_role=approved_role,
        notes="Request Approved",
        payload={"notification_type": "bulk_request_approved"},
    )
    _log_audit_entry(
        school_id=str(updated.get("school_id") or ""),
        profile_id=approved_by_profile_id,
        action="bulk_action.approved",
        module_key=str(updated.get("module_name") or ""),
        entity_id=request_id,
        payload={"action_type": updated.get("action_type")},
    )
    return _serialize_bulk_action_request(updated)


def reject_bulk_action_request(
    request_id: str,
    *,
    rejected_by_profile_id: str,
    rejected_role: str,
    reason: str | None = None,
) -> dict[str, Any]:
    existing = _fetch_bulk_action_request(request_id)
    if _normalize_text(existing.get("status")) != "pending":
        raise HTTPException(status_code=400, detail="Only pending bulk action requests can be rejected")

    updated = _update_bulk_action_request(
        request_id,
        {
            "status": "rejected",
            "rejected_by_profile_id": _normalize_uuid(rejected_by_profile_id),
            "rejected_at": _utc_now_iso(),
            "execution_result": {"reason": _normalize_text(reason) or "Rejected by Super Admin"},
        },
    )
    _log_workflow_event(
        request_id=request_id,
        school_id=str(updated.get("school_id") or ""),
        event_type="rejected",
        actor_profile_id=rejected_by_profile_id,
        actor_role=rejected_role,
        notes=_normalize_text(reason) or "Request Rejected",
        payload={"notification_type": "bulk_request_rejected"},
    )
    _log_audit_entry(
        school_id=str(updated.get("school_id") or ""),
        profile_id=rejected_by_profile_id,
        action="bulk_action.rejected",
        module_key=str(updated.get("module_name") or ""),
        entity_id=request_id,
        payload={"reason": _normalize_text(reason) or "Rejected by Super Admin"},
    )
    return _serialize_bulk_action_request(updated)


def execute_bulk_action_request(
    request_id: str,
    *,
    executed_by_profile_id: str,
    executed_role: str,
) -> dict[str, Any]:
    existing = _fetch_bulk_action_request(request_id)
    if _normalize_text(existing.get("status")) != "approved":
        raise HTTPException(status_code=400, detail="Only approved bulk action requests can be executed")

    payload = _normalize_json_object(existing.get("payload_json"))
    operation = _normalize_text(payload.get("operation"))
    executor = BULK_ACTION_EXECUTORS.get(operation)
    if not executor:
        raise HTTPException(status_code=400, detail=f"Unsupported bulk action operation: {operation or 'unknown'}")

    school_id = str(existing.get("school_id") or "")
    _log_workflow_event(
        request_id=request_id,
        school_id=school_id,
        event_type="execution_started",
        actor_profile_id=executed_by_profile_id,
        actor_role=executed_role,
        notes="Request execution started",
        payload={"notification_type": "bulk_request_execution_started", "operation": operation},
    )
    try:
        result = executor(school_id, payload)
    except Exception as exc:
        error_result = {"error": str(exc)}
        _update_bulk_action_request(request_id, {"execution_result": error_result})
        _log_workflow_event(
            request_id=request_id,
            school_id=school_id,
            event_type="execution_failed",
            actor_profile_id=executed_by_profile_id,
            actor_role=executed_role,
            notes="Request execution failed",
            payload={"notification_type": "bulk_request_execution_failed", **error_result},
        )
        _log_audit_entry(
            school_id=school_id,
            profile_id=executed_by_profile_id,
            action="bulk_action.execution_failed",
            module_key=str(existing.get("module_name") or ""),
            entity_id=request_id,
            payload=error_result,
        )
        raise

    execution_result = _normalize_execution_result(result)
    updated = _update_bulk_action_request(
        request_id,
        {
            "status": "executed",
            "executed_by_profile_id": _normalize_uuid(executed_by_profile_id),
            "executed_at": _utc_now_iso(),
            "execution_result": execution_result,
        },
    )
    _log_workflow_event(
        request_id=request_id,
        school_id=school_id,
        event_type="executed",
        actor_profile_id=executed_by_profile_id,
        actor_role=executed_role,
        notes="Request Executed",
        payload={"notification_type": "bulk_request_executed", **execution_result},
    )
    _log_audit_entry(
        school_id=school_id,
        profile_id=executed_by_profile_id,
        action="bulk_action.executed",
        module_key=str(updated.get("module_name") or ""),
        entity_id=request_id,
        payload={"operation": operation, **execution_result},
    )
    return _serialize_bulk_action_request(updated)
