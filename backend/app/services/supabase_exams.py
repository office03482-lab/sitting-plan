"""Supabase-native exam repository for production-safe routes."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from fastapi import HTTPException

from app.services.supabase_admin import fetch_all, get_supabase_admin_client


def serialize_exam_response(exam: dict[str, Any]) -> dict[str, Any]:
    metadata = exam.get("metadata") or {}
    exam_date_value = exam.get("exam_date")
    created_at_value = exam.get("created_at")
    updated_at_value = exam.get("updated_at")
    return {
        "id": exam.get("id"),
        "name": exam.get("name") or "",
        "school_id": exam.get("school_id"),
        "subject": metadata.get("subject_text") if isinstance(metadata, dict) else None,
        "exam_date": exam_date_value.isoformat() if isinstance(exam_date_value, (datetime, date)) else exam_date_value,
        "duration_minutes": exam.get("duration_minutes"),
        "total_students": int(exam.get("total_students") or 0),
        "total_batches": int(exam.get("total_batches") or 0),
        "is_active": bool(exam.get("is_active", True)),
        "created_at": created_at_value.isoformat() if isinstance(created_at_value, datetime) else created_at_value,
        "updated_at": updated_at_value.isoformat() if isinstance(updated_at_value, datetime) else updated_at_value,
    }


def normalize_exam_payload(exam_data: dict[str, Any]) -> dict[str, Any]:
    name = str(exam_data.get("name") or exam_data.get("exam_name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Exam name is required")

    exam_date = str(exam_data.get("exam_date") or "").strip()
    if not exam_date:
        raise HTTPException(status_code=400, detail="Exam date is required")

    duration_value = exam_data.get("duration_minutes")
    duration_minutes = None
    if duration_value not in (None, "", False):
        try:
            duration_minutes = int(duration_value)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Duration must be a valid number")

    return {
        "name": name,
        "exam_type": str(exam_data.get("exam_type") or "written").strip() or "written",
        "exam_date": exam_date,
        "duration_minutes": duration_minutes,
        "status": str(exam_data.get("status") or "draft").strip() or "draft",
        "metadata": {
            "subject_text": str(exam_data.get("subject") or "").strip() or None,
        },
        "is_active": bool(exam_data.get("is_active", True)),
    }


def build_exam_code(name: str) -> str:
    suffix = datetime.utcnow().strftime("%Y%m%d-%H%M%S%f")[-12:]
    return f"EXM-{suffix}"


def list_exams(school_id: str) -> list[dict[str, Any]]:
    supabase = get_supabase_admin_client()
    rows = (
        supabase
        .schema("exam")
        .table("exams")
        .select("*")
        .eq("school_id", school_id)
        .order("exam_date", desc=True)
        .execute()
    )
    return [serialize_exam_response(item) for item in list(rows.data or [])]


def get_exam(school_id: str, exam_id: str) -> dict[str, Any]:
    rows = fetch_all(
        get_supabase_admin_client(),
        "exams",
        schema="exam",
        filters={"id": exam_id, "school_id": school_id},
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Exam not found")
    return serialize_exam_response(rows[0])


def create_exam(school_id: str, exam_data: dict[str, Any]) -> dict[str, Any]:
    supabase = get_supabase_admin_client()
    payload = normalize_exam_payload(exam_data)
    payload["school_id"] = school_id
    payload["exam_code"] = str(exam_data.get("exam_code") or "").strip() or build_exam_code(payload["name"])
    insert_response = (
        supabase
        .schema("exam")
        .table("exams")
        .insert(payload)
        .execute()
    )
    inserted_rows = list(insert_response.data or [])
    if not inserted_rows:
        raise HTTPException(status_code=500, detail="Exam save returned no row")
    created_exam_id = inserted_rows[0].get("id")
    if not created_exam_id:
        raise HTTPException(status_code=500, detail="Exam save returned no id")

    created_exam = (
        supabase
        .schema("exam")
        .table("exams")
        .select("*")
        .eq("id", created_exam_id)
        .eq("school_id", school_id)
        .single()
        .execute()
    )
    if not created_exam.data:
        raise HTTPException(status_code=500, detail="Exam save could not be reloaded")
    return serialize_exam_response(dict(created_exam.data))


def update_exam(school_id: str, exam_id: str, exam_data: dict[str, Any]) -> dict[str, Any]:
    supabase = get_supabase_admin_client()
    payload = normalize_exam_payload(exam_data)
    updated = (
        supabase
        .schema("exam")
        .table("exams")
        .update(payload)
        .eq("id", exam_id)
        .eq("school_id", school_id)
        .select("*")
        .single()
        .execute()
    )
    if not updated.data:
        raise HTTPException(status_code=404, detail="Exam not found")
    return serialize_exam_response(dict(updated.data))


def delete_exam(school_id: str, exam_id: str) -> dict[str, Any]:
    supabase = get_supabase_admin_client()
    deleted = (
        supabase
        .schema("exam")
        .table("exams")
        .delete()
        .eq("id", exam_id)
        .eq("school_id", school_id)
        .select("id")
        .execute()
    )
    if not list(deleted.data or []):
        raise HTTPException(status_code=404, detail="Exam not found")
    return {"message": "Exam deleted successfully"}


def delete_all_exams(school_id: str) -> dict[str, Any]:
    supabase = get_supabase_admin_client()
    existing = (
        supabase
        .schema("exam")
        .table("exams")
        .select("id")
        .eq("school_id", school_id)
        .execute()
    )
    rows = list(existing.data or [])
    if rows:
        supabase.schema("exam").table("exams").delete().eq("school_id", school_id).execute()
    return {"message": f"All {len(rows)} exams deleted successfully", "deleted_count": len(rows)}
