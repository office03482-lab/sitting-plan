"""
Settings management routes backed by the canonical Supabase school record.
"""
import logging
from copy import deepcopy
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.middleware.auth import get_authenticated_actor_context
from app.services.supabase_admin import get_supabase_admin_client
from app.services.supabase_context import resolve_school_id_from_actor

logger = logging.getLogger(__name__)

router = APIRouter()

_SETTINGS_METADATA_KEY = "app_settings"
_DEFAULT_BATCH_COLORS = {
    "11th": "#3B82F6",
    "12th": "#10B981",
    "Dropper 1": "#F59E0B",
    "Dropper 2": "#EF4444",
    "Dropper 3": "#8B5CF6",
    "Dropper 4": "#06B6D4",
    "Dropper 5": "#84CC16",
    "Dropper 6": "#F97316",
    "Dropper 7": "#EC4899",
    "Dropper 8": "#6B7280",
    "Dropper 9": "#374151",
    "Dropper 10": "#1F2937",
}
_DEFAULT_SETTINGS = {
    "name": "",
    "address": "",
    "phone": "",
    "email": "",
    "website": "",
    "principal_name": "",
    "established_year": 2024,
    "timezone": "Asia/Kolkata",
    "date_format": "DD/MM/YYYY",
    "default_batch_colors": deepcopy(_DEFAULT_BATCH_COLORS),
    "export_format": "both",
    "auto_save": True,
    "conflict_detection": True,
    "email_notifications": False,
}


class SchoolSettings(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    principal_name: Optional[str] = None
    established_year: Optional[int] = None
    timezone: Optional[str] = None
    date_format: Optional[str] = None
    default_batch_colors: Optional[Dict[str, str]] = None
    export_format: Optional[str] = None
    auto_save: Optional[bool] = None
    conflict_detection: Optional[bool] = None
    email_notifications: Optional[bool] = None


def _normalize_text(value: object | None) -> str:
    return str(value or "").strip()


def _load_school_row(school_id: str) -> dict:
    response = (
        get_supabase_admin_client()
        .table("schools")
        .select("*")
        .eq("id", school_id)
        .limit(1)
        .execute()
    )
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=404, detail="School not found")
    return dict(rows[0])


def _normalize_batch_colors(value: object) -> Dict[str, str]:
    if not isinstance(value, dict):
        return deepcopy(_DEFAULT_BATCH_COLORS)

    normalized = {
        str(key).strip(): str(color).strip()
        for key, color in value.items()
        if str(key).strip() and str(color).strip()
    }
    return normalized or deepcopy(_DEFAULT_BATCH_COLORS)


def _serialize_school_settings(row: dict) -> dict:
    metadata = row.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}
    app_settings = metadata.get(_SETTINGS_METADATA_KEY)
    if not isinstance(app_settings, dict):
        app_settings = {}

    settings = deepcopy(_DEFAULT_SETTINGS)
    settings.update(
        {
            "name": _normalize_text(row.get("name")) or settings["name"],
            "phone": _normalize_text(row.get("contact_phone")) or settings["phone"],
            "email": _normalize_text(row.get("contact_email")) or settings["email"],
            "timezone": _normalize_text(row.get("timezone")) or settings["timezone"],
            "address": _normalize_text(app_settings.get("address")) or settings["address"],
            "website": _normalize_text(app_settings.get("website")) or settings["website"],
            "principal_name": _normalize_text(app_settings.get("principal_name")) or settings["principal_name"],
            "established_year": int(app_settings.get("established_year") or settings["established_year"]),
            "date_format": _normalize_text(app_settings.get("date_format")) or settings["date_format"],
            "default_batch_colors": _normalize_batch_colors(app_settings.get("default_batch_colors")),
            "export_format": _normalize_text(app_settings.get("export_format")) or settings["export_format"],
            "auto_save": bool(app_settings.get("auto_save", settings["auto_save"])),
            "conflict_detection": bool(app_settings.get("conflict_detection", settings["conflict_detection"])),
            "email_notifications": bool(app_settings.get("email_notifications", settings["email_notifications"])),
        }
    )
    return settings


def _build_school_update_payload(existing_row: dict, settings_data: dict) -> tuple[dict, dict]:
    metadata = existing_row.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}
    metadata = dict(metadata)
    app_settings = metadata.get(_SETTINGS_METADATA_KEY)
    if not isinstance(app_settings, dict):
        app_settings = {}
    app_settings = dict(app_settings)

    update_payload: dict = {}

    if "name" in settings_data:
        update_payload["name"] = _normalize_text(settings_data["name"])
    if "phone" in settings_data:
        update_payload["contact_phone"] = _normalize_text(settings_data["phone"]) or None
    if "email" in settings_data:
        update_payload["contact_email"] = _normalize_text(settings_data["email"]) or None
    if "timezone" in settings_data:
        update_payload["timezone"] = _normalize_text(settings_data["timezone"]) or _DEFAULT_SETTINGS["timezone"]

    metadata_fields = (
        "address",
        "website",
        "principal_name",
        "established_year",
        "date_format",
        "default_batch_colors",
        "export_format",
        "auto_save",
        "conflict_detection",
        "email_notifications",
    )
    for field in metadata_fields:
        if field not in settings_data:
            continue
        value = settings_data[field]
        if field == "default_batch_colors":
            app_settings[field] = _normalize_batch_colors(value)
        elif field == "established_year":
            app_settings[field] = int(value or _DEFAULT_SETTINGS["established_year"])
        elif field in {"auto_save", "conflict_detection", "email_notifications"}:
            app_settings[field] = bool(value)
        else:
            app_settings[field] = _normalize_text(value)

    metadata[_SETTINGS_METADATA_KEY] = app_settings
    update_payload["metadata"] = metadata
    return update_payload, metadata


@router.get("")
async def get_settings(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
):
    row = _load_school_row(school_id)
    payload = _serialize_school_settings(row)
    logger.info(
        "settings.loaded",
        extra={"user_id": actor.get("user_id"), "school_id": school_id},
    )
    return payload


@router.put("")
async def update_settings(
    settings_data: SchoolSettings,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
):
    existing_row = _load_school_row(school_id)
    update_payload, _ = _build_school_update_payload(
        existing_row,
        settings_data.model_dump(exclude_unset=True),
    )

    response = (
        get_supabase_admin_client()
        .table("schools")
        .update(update_payload)
        .eq("id", school_id)
        .execute()
    )
    rows = list(response.data or [])
    updated_row = dict(rows[0]) if rows else _load_school_row(school_id)

    logger.info(
        "settings.updated",
        extra={"user_id": actor.get("user_id"), "school_id": school_id},
    )
    return {
        "message": "Settings updated successfully",
        "settings": _serialize_school_settings(updated_row),
    }


@router.post("/reset")
async def reset_settings(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
):
    existing_row = _load_school_row(school_id)
    update_payload, _ = _build_school_update_payload(existing_row, deepcopy(_DEFAULT_SETTINGS))
    update_payload["name"] = _normalize_text(existing_row.get("name"))
    update_payload["contact_phone"] = None
    update_payload["contact_email"] = None
    update_payload["timezone"] = _DEFAULT_SETTINGS["timezone"]

    response = (
        get_supabase_admin_client()
        .table("schools")
        .update(update_payload)
        .eq("id", school_id)
        .execute()
    )
    rows = list(response.data or [])
    updated_row = dict(rows[0]) if rows else _load_school_row(school_id)

    logger.info(
        "settings.reset",
        extra={"user_id": actor.get("user_id"), "school_id": school_id},
    )
    return {
        "message": "Settings reset to defaults",
        "settings": _serialize_school_settings(updated_row),
    }
