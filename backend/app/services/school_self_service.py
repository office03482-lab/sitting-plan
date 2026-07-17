from __future__ import annotations

import threading
import time
from copy import deepcopy
from pathlib import Path
from typing import Any

from fastapi import HTTPException, UploadFile

from app.services.supabase_admin import get_supabase_admin_client
from app.services.supabase_storage import upload_file_to_supabase_storage

MODULE_KEY = "school_self_service"

_BRANDING_CACHE_TTL_SECONDS = 60
_branding_cache_lock = threading.Lock()
_branding_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def _get_branding_cache(key: str) -> dict[str, Any] | None:
    with _branding_cache_lock:
        entry = _branding_cache.get(key)
        if entry is None:
            return None
        ts, data = entry
        if time.monotonic() - ts > _BRANDING_CACHE_TTL_SECONDS:
            _branding_cache.pop(key, None)
            return None
        return data


def _set_branding_cache(key: str, data: dict[str, Any]) -> None:
    with _branding_cache_lock:
        _branding_cache[key] = (time.monotonic(), data)


def invalidate_branding_cache() -> None:
    with _branding_cache_lock:
        _branding_cache.clear()

DEFAULT_BRANDING = {
    "school_name": "",
    "tagline": "",
    "logo_url": "",
    "banner_url": "",
    "favicon_url": "",
    "background_image_url": "",
    "website": "",
    "email": "",
    "phone": "",
    "address": "",
    "principal_name": "",
    "primary_color": "#0f766e",
    "secondary_color": "#1d4ed8",
    "accent_color": "#f59e0b",
    "theme": "auto",
    "welcome_message": "Welcome back",
    "footer_text": "Powered by the shared SaaS platform",
    "portal_name": "School ERP",
}

DEFAULT_PORTAL_SETTINGS = {
    "academic_year": "",
    "attendance_rules": {"minimum_attendance_threshold": 75},
    "working_days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    "periods_per_day": 8,
    "exam_pattern": "percentage",
    "grade_system": "standard",
    "notification_preferences": {"email": True, "sms": False, "whatsapp": False},
    "ai_preferences": {"enabled": True, "guardian_mode": "assisted"},
    "language": "English",
    "timezone": "Asia/Kolkata",
}

DEFAULT_PREFERENCES = {
    "default_currency": "INR",
    "date_format": "DD/MM/YYYY",
    "time_format": "24h",
    "language": "English",
    "timezone": "Asia/Kolkata",
    "session_start": "",
    "session_end": "",
}

DEFAULT_DOMAIN_SETTINGS = {
    "custom_domain": "",
    "subdomain": "",
    "ssl_status": "pending",
    "verification_status": "pending",
}

DEFAULT_EMAIL_TEMPLATES = {
    "admission_email": "Welcome to {{school_name}}. Your admission is being processed.",
    "fee_reminder": "Dear Parent, fees are due for {{student_name}}.",
    "attendance_alert": "{{student_name}} attendance needs attention.",
    "exam_result": "Exam results for {{student_name}} are now available.",
    "password_reset": "Your password reset request is ready for {{school_name}}.",
    "welcome_email": "Welcome to {{portal_name}}.",
}

DEFAULT_MESSAGING_TEMPLATES = {
    "parent_alerts": "{{school_name}} alert: {{message}}",
    "fee_due": "Fee due reminder for {{student_name}}.",
    "attendance": "{{student_name}} attendance alert from {{school_name}}.",
    "emergency_notice": "Emergency notice from {{school_name}}: {{message}}",
}


def _client():
    return get_supabase_admin_client()


def _public_table(name: str):
    return _client().table(name)


def _schema_table(schema: str, name: str):
    return _client().schema(schema).table(name)


def _normalize(value: Any) -> str:
    return str(value or "").strip()


def _normalize_hostname(value: Any) -> str:
    raw = _normalize(value).lower()
    if not raw:
        return ""
    first = raw.split(",")[0].strip()
    if first.startswith("[") and "]" in first:
        return first.split("]")[0].lstrip("[")
    if ":" in first:
        return first.split(":", 1)[0].strip()
    return first


def _json_dict(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _merge_dict(base: dict[str, Any], updates: dict[str, Any] | None = None) -> dict[str, Any]:
    merged = dict(base)
    for key, value in dict(updates or {}).items():
        if value is not None:
            merged[key] = value
    return merged


def _load_school_row(school_id: str) -> dict[str, Any]:
    rows = list(
        _public_table("schools")
        .select("*")
        .eq("id", school_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="School not found")
    return dict(rows[0])


def _upsert_profile_row(school_id: str, *, actor_profile_id: str | None = None) -> dict[str, Any]:
    existing_rows = list(
        _public_table("school_self_service_profiles")
        .select("*")
        .eq("school_id", school_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if existing_rows:
        return dict(existing_rows[0])
    created = (
        _public_table("school_self_service_profiles")
        .insert(
            {
                "school_id": school_id,
                "branding": deepcopy(DEFAULT_BRANDING),
                "portal_settings": deepcopy(DEFAULT_PORTAL_SETTINGS),
                "domain_settings": deepcopy(DEFAULT_DOMAIN_SETTINGS),
                "email_templates": deepcopy(DEFAULT_EMAIL_TEMPLATES),
                "messaging_templates": deepcopy(DEFAULT_MESSAGING_TEMPLATES),
                "preferences": deepcopy(DEFAULT_PREFERENCES),
                "metadata": {"source": "school_self_service"},
                "created_by": actor_profile_id,
                "updated_by": actor_profile_id,
            }
        )
        .execute()
    )
    rows = list(created.data or [])
    return dict(rows[0]) if rows else {}


def _record_audit(school_id: str, actor_profile_id: str | None, action: str, payload: dict[str, Any] | None = None) -> None:
    try:
        _public_table("audit_logs").insert(
            {
                "school_id": school_id,
                "profile_id": actor_profile_id,
                "action": action,
                "module_key": MODULE_KEY,
                "entity_table": "school_self_service_profiles",
                "payload": payload or {},
            }
        ).execute()
    except Exception:
        pass


def _school_summary(row: dict[str, Any]) -> dict[str, Any]:
    metadata = _json_dict(row.get("metadata"))
    branding = _json_dict(metadata.get("branding"))
    return {
        "id": _normalize(row.get("id")),
        "name": _normalize(row.get("name")),
        "slug": _normalize(row.get("slug")),
        "school_code": _normalize(row.get("school_code")),
        "timezone": _normalize(row.get("timezone")) or "Asia/Kolkata",
        "contact_email": _normalize(row.get("contact_email")) or None,
        "contact_phone": _normalize(row.get("contact_phone")) or None,
        "logo_url": _normalize(branding.get("logo_url")) or None,
    }


def _serialize_asset(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _normalize(row.get("id")),
        "asset_type": _normalize(row.get("asset_type")),
        "file_name": _normalize(row.get("file_name")),
        "public_url": _normalize(row.get("public_url")),
        "content_type": _normalize(row.get("content_type")) or None,
        "size_bytes": int(row.get("size_bytes") or 0),
        "bucket": _normalize(row.get("bucket")),
        "storage_path": _normalize(row.get("storage_path")),
        "created_at": row.get("created_at"),
        "metadata": _json_dict(row.get("metadata")),
    }


def _list_assets(school_id: str) -> list[dict[str, Any]]:
    rows = list(
        _public_table("school_brand_assets")
        .select("*")
        .eq("school_id", school_id)
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    return [_serialize_asset(dict(row)) for row in rows]


def _storage_overview(school_id: str) -> dict[str, Any]:
    assets = _list_assets(school_id)
    total_size_bytes = sum(int(item.get("size_bytes") or 0) for item in assets)
    return {
        "total_files": len(assets),
        "total_size_bytes": total_size_bytes,
        "total_size_mb": round(total_size_bytes / (1024 * 1024), 2),
        "assets": assets,
    }


def _backup_history(school_id: str) -> dict[str, Any]:
    rows = list(
        _public_table("school_backup_requests")
        .select("*")
        .eq("school_id", school_id)
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    items = [
        {
            "id": _normalize(row.get("id")),
            "request_type": _normalize(row.get("request_type")),
            "status": _normalize(row.get("status")) or "requested",
            "download_url": _normalize(row.get("download_url")) or None,
            "notes": _normalize(row.get("notes")) or None,
            "created_at": row.get("created_at"),
            "metadata": _json_dict(row.get("metadata")),
        }
        for row in rows
    ]
    return {"items": items, "total_count": len(items)}


def _sync_school_row(school_id: str, *, branding: dict[str, Any], preferences: dict[str, Any]) -> None:
    school = _load_school_row(school_id)
    metadata = _json_dict(school.get("metadata"))
    app_settings = _json_dict(metadata.get("app_settings"))
    app_settings = _merge_dict(
        app_settings,
        {
            "address": branding.get("address"),
            "website": branding.get("website"),
            "principal_name": branding.get("principal_name"),
            "timezone": preferences.get("timezone") or school.get("timezone"),
            "date_format": preferences.get("date_format"),
        },
    )
    metadata["app_settings"] = app_settings
    metadata["branding"] = {
        "logo_url": branding.get("logo_url"),
        "banner_url": branding.get("banner_url"),
        "favicon_url": branding.get("favicon_url"),
    }
    _public_table("schools").update(
        {
            "name": branding.get("school_name") or school.get("name"),
            "contact_email": branding.get("email") or school.get("contact_email"),
            "contact_phone": branding.get("phone") or school.get("contact_phone"),
            "timezone": preferences.get("timezone") or school.get("timezone"),
            "metadata": metadata,
        }
    ).eq("id", school_id).execute()


def get_school_self_service_profile(school_id: str, *, actor_profile_id: str | None = None) -> dict[str, Any]:
    row = _upsert_profile_row(school_id, actor_profile_id=actor_profile_id)
    school = _load_school_row(school_id)
    branding = _merge_dict(deepcopy(DEFAULT_BRANDING), _json_dict(row.get("branding")))
    portal_settings = _merge_dict(deepcopy(DEFAULT_PORTAL_SETTINGS), _json_dict(row.get("portal_settings")))
    domain_settings = _merge_dict(deepcopy(DEFAULT_DOMAIN_SETTINGS), _json_dict(row.get("domain_settings")))
    preferences = _merge_dict(deepcopy(DEFAULT_PREFERENCES), _json_dict(row.get("preferences")))
    email_templates = _merge_dict(deepcopy(DEFAULT_EMAIL_TEMPLATES), _json_dict(row.get("email_templates")))
    messaging_templates = _merge_dict(deepcopy(DEFAULT_MESSAGING_TEMPLATES), _json_dict(row.get("messaging_templates")))
    assets = _list_assets(school_id)
    storage = _storage_overview(school_id)
    backups = _backup_history(school_id)
    return {
        "school_id": school_id,
        "branding": branding,
        "portal_settings": portal_settings,
        "domain_settings": domain_settings,
        "email_templates": email_templates,
        "messaging_templates": messaging_templates,
        "preferences": preferences,
        "assets": assets,
        "storage": storage,
        "backups": backups,
        "school_summary": _school_summary(school),
    }


def _update_profile_section(
    school_id: str,
    column: str,
    payload: dict[str, Any],
    *,
    actor_profile_id: str | None,
    action: str,
) -> dict[str, Any]:
    row = _upsert_profile_row(school_id, actor_profile_id=actor_profile_id)
    existing_section = _json_dict(row.get(column))
    defaults = {
        "branding": deepcopy(DEFAULT_BRANDING),
        "portal_settings": deepcopy(DEFAULT_PORTAL_SETTINGS),
        "domain_settings": deepcopy(DEFAULT_DOMAIN_SETTINGS),
        "email_templates": deepcopy(DEFAULT_EMAIL_TEMPLATES),
        "messaging_templates": deepcopy(DEFAULT_MESSAGING_TEMPLATES),
        "preferences": deepcopy(DEFAULT_PREFERENCES),
    }.get(column, {})
    merged_section = _merge_dict(_merge_dict(defaults, existing_section), payload)
    _public_table("school_self_service_profiles").update(
        {
            column: merged_section,
            "updated_by": actor_profile_id,
        }
    ).eq("school_id", school_id).execute()
    if column in {"branding", "preferences"}:
        current = get_school_self_service_profile(school_id, actor_profile_id=actor_profile_id)
        _sync_school_row(school_id, branding=current["branding"], preferences=current["preferences"])
    elif column == "portal_settings":
        working_hours = _json_dict(payload.get("attendance_rules"))
        try:
            _schema_table("attendance", "settings").upsert(
                {
                    "school_id": school_id,
                    "minimum_attendance_threshold": working_hours.get("minimum_attendance_threshold") or 75,
                    "working_hours_start": working_hours.get("working_hours_start") or "09:00",
                    "working_hours_end": working_hours.get("working_hours_end") or "17:00",
                    "metadata": {"source": MODULE_KEY},
                    "is_active": True,
                },
                on_conflict="school_id",
            ).execute()
        except Exception:
            pass
    _record_audit(school_id, actor_profile_id, action, {"column": column})
    return get_school_self_service_profile(school_id, actor_profile_id=actor_profile_id)


def update_school_branding(school_id: str, payload: dict[str, Any], *, actor_profile_id: str | None) -> dict[str, Any]:
    result = _update_profile_section(school_id, "branding", payload, actor_profile_id=actor_profile_id, action="school.branding.updated")
    invalidate_branding_cache()
    return result


def update_school_preferences(school_id: str, payload: dict[str, Any], *, actor_profile_id: str | None) -> dict[str, Any]:
    return _update_profile_section(school_id, "preferences", payload, actor_profile_id=actor_profile_id, action="school.preferences.updated")


def update_school_portal_settings(school_id: str, payload: dict[str, Any], *, actor_profile_id: str | None) -> dict[str, Any]:
    return _update_profile_section(school_id, "portal_settings", payload, actor_profile_id=actor_profile_id, action="school.portal_settings.updated")


def update_school_domain_settings(school_id: str, payload: dict[str, Any], *, actor_profile_id: str | None) -> dict[str, Any]:
    profile = _update_profile_section(
        school_id,
        "domain_settings",
        payload,
        actor_profile_id=actor_profile_id,
        action="school.domain.updated",
    )
    school = _load_school_row(school_id)
    metadata = _json_dict(school.get("metadata"))
    metadata["school_domain"] = payload.get("custom_domain") or payload.get("subdomain") or metadata.get("school_domain")
    _public_table("schools").update({"metadata": metadata}).eq("id", school_id).execute()
    invalidate_branding_cache()
    return get_school_self_service_profile(school_id, actor_profile_id=actor_profile_id)


def update_school_email_templates(school_id: str, payload: dict[str, str], *, actor_profile_id: str | None) -> dict[str, Any]:
    return _update_profile_section(school_id, "email_templates", payload, actor_profile_id=actor_profile_id, action="school.email_templates.updated")


def update_school_messaging_templates(school_id: str, payload: dict[str, str], *, actor_profile_id: str | None) -> dict[str, Any]:
    return _update_profile_section(school_id, "messaging_templates", payload, actor_profile_id=actor_profile_id, action="school.messaging_templates.updated")


async def upload_school_brand_asset(
    school_id: str,
    asset_type: str,
    file: UploadFile,
    *,
    actor_profile_id: str | None,
) -> dict[str, Any]:
    normalized_type = _normalize(asset_type).lower()
    image_asset_types = {"logo", "banner", "favicon", "principal_signature", "official_seal", "report_card_header", "certificate_header", "background_image"}
    extension = Path(str(file.filename or "")).suffix.lower()
    category = "image" if normalized_type in image_asset_types or extension in {".png", ".jpg", ".jpeg", ".webp", ".gif"} else "document"
    uploaded = await upload_file_to_supabase_storage(
        school_id=school_id,
        category=category,
        file=file,
        folder=f"school-self-service/{normalized_type}",
    )
    rows = (
        _public_table("school_brand_assets")
        .insert(
            {
                "school_id": school_id,
                "asset_type": normalized_type,
                "file_name": uploaded["file_name"],
                "bucket": uploaded["bucket"],
                "storage_path": uploaded["storage_path"],
                "public_url": uploaded["url"],
                "content_type": uploaded["content_type"],
                "size_bytes": uploaded["size"],
                "uploaded_by": actor_profile_id,
                "metadata": {"source": MODULE_KEY},
            }
        )
        .execute()
        .data
        or []
    )
    branding_field_map = {
        "logo": "logo_url",
        "banner": "banner_url",
        "favicon": "favicon_url",
        "background_image": "background_image_url",
    }
    branding_field = branding_field_map.get(normalized_type)
    if branding_field:
        update_school_branding(school_id, {branding_field: uploaded["url"]}, actor_profile_id=actor_profile_id)
    _record_audit(school_id, actor_profile_id, "school.asset.uploaded", {"asset_type": normalized_type, "file_name": uploaded["file_name"]})
    return _serialize_asset(dict(rows[0])) if rows else {
        "id": "",
        "asset_type": normalized_type,
        "file_name": uploaded["file_name"],
        "public_url": uploaded["url"],
        "content_type": uploaded["content_type"],
        "size_bytes": uploaded["size"],
        "bucket": uploaded["bucket"],
        "storage_path": uploaded["storage_path"],
        "created_at": None,
        "metadata": {"source": MODULE_KEY},
    }


def get_storage_overview(school_id: str, *, actor_profile_id: str | None = None) -> dict[str, Any]:
    _upsert_profile_row(school_id, actor_profile_id=actor_profile_id)
    return _storage_overview(school_id)


def list_backup_history(school_id: str, *, actor_profile_id: str | None = None) -> dict[str, Any]:
    _upsert_profile_row(school_id, actor_profile_id=actor_profile_id)
    return _backup_history(school_id)


def request_backup(school_id: str, notes: str | None, *, actor_profile_id: str | None) -> dict[str, Any]:
    rows = (
        _public_table("school_backup_requests")
        .insert(
            {
                "school_id": school_id,
                "request_type": "backup",
                "status": "requested",
                "requested_by": actor_profile_id,
                "notes": _normalize(notes) or None,
                "metadata": {"scope": "school", "source": MODULE_KEY},
            }
        )
        .execute()
        .data
        or []
    )
    _record_audit(school_id, actor_profile_id, "school.backup.requested", {"notes": notes})
    return _backup_history(school_id)


def request_restore(school_id: str, notes: str | None, *, actor_profile_id: str | None) -> dict[str, Any]:
    rows = (
        _public_table("school_backup_requests")
        .insert(
            {
                "school_id": school_id,
                "request_type": "restore",
                "status": "requested",
                "requested_by": actor_profile_id,
                "notes": _normalize(notes) or None,
                "metadata": {"scope": "school", "source": MODULE_KEY},
            }
        )
        .execute()
        .data
        or []
    )
    _record_audit(school_id, actor_profile_id, "school.restore.requested", {"notes": notes})
    return _backup_history(school_id)


def get_public_school_branding(*, school_hint: str | None = None, hostname: str | None = None) -> dict[str, Any]:
    cache_key = f"{_normalize(school_hint).lower()}|{_normalize_hostname(hostname).lower()}"
    cached = _get_branding_cache(cache_key)
    if cached is not None:
        return cached
    result = _get_public_school_branding_uncached(school_hint=school_hint, hostname=hostname)
    _set_branding_cache(cache_key, result)
    return result


def _get_public_school_branding_uncached(*, school_hint: str | None = None, hostname: str | None = None) -> dict[str, Any]:
    normalized_hint = _normalize(school_hint).lower()
    normalized_host = _normalize_hostname(hostname)
    query = _public_table("schools").select("id,name,slug,school_code,metadata,timezone,contact_email,contact_phone")
    rows = [dict(row) for row in list(query.execute().data or [])]
    profiles = {
        _normalize(row.get("school_id")): dict(row)
        for row in list(
            _public_table("school_self_service_profiles")
            .select("school_id,branding,domain_settings")
            .execute()
            .data
            or []
        )
    }
    resolved_school: dict[str, Any] | None = None
    for row in rows:
        school = dict(row)
        profile = profiles.get(_normalize(school.get("id")), {})
        domain_settings = _merge_dict(deepcopy(DEFAULT_DOMAIN_SETTINGS), _json_dict(profile.get("domain_settings")))
        if normalized_hint and normalized_hint in {
            _normalize(school.get("id")).lower(),
            _normalize(school.get("slug")).lower(),
            _normalize(school.get("school_code")).lower(),
            _normalize(domain_settings.get("subdomain")).lower(),
            _normalize(domain_settings.get("custom_domain")).lower(),
        }:
            resolved_school = school
            break
        if normalized_host:
            metadata = _json_dict(school.get("metadata"))
            school_domain = _normalize(metadata.get("school_domain")).lower()
            custom_domain = _normalize(domain_settings.get("custom_domain")).lower()
            subdomain = _normalize(domain_settings.get("subdomain")).lower()
            if school_domain and school_domain == normalized_host:
                resolved_school = school
                break
            if custom_domain and custom_domain == normalized_host:
                resolved_school = school
                break
            if subdomain and subdomain == normalized_host:
                resolved_school = school
                break
    if resolved_school is None and not normalized_hint and not normalized_host and len(rows) == 1:
        resolved_school = dict(rows[0])
    if not resolved_school:
        return {
            "school_name": "School ERP",
            "portal_name": "School ERP",
            "primary_color": DEFAULT_BRANDING["primary_color"],
            "secondary_color": DEFAULT_BRANDING["secondary_color"],
            "accent_color": DEFAULT_BRANDING["accent_color"],
            "theme": DEFAULT_BRANDING["theme"],
        }
    school_id = _normalize(resolved_school.get("id"))
    profile = profiles.get(school_id, {})
    branding = _merge_dict(deepcopy(DEFAULT_BRANDING), _json_dict(profile.get("branding")))
    domain_settings = _merge_dict(deepcopy(DEFAULT_DOMAIN_SETTINGS), _json_dict(profile.get("domain_settings")))
    school_name = branding.get("school_name") or _normalize(resolved_school.get("name")) or "School ERP"
    return {
        "school_name": school_name,
        "portal_name": branding.get("portal_name") or school_name,
        "logo_url": branding.get("logo_url") or (_json_dict(resolved_school.get("metadata")).get("branding") or {}).get("logo_url"),
        "banner_url": branding.get("banner_url"),
        "favicon_url": branding.get("favicon_url"),
        "background_image_url": branding.get("background_image_url"),
        "tagline": branding.get("tagline"),
        "welcome_message": branding.get("welcome_message"),
        "footer_text": branding.get("footer_text"),
        "primary_color": branding.get("primary_color") or DEFAULT_BRANDING["primary_color"],
        "secondary_color": branding.get("secondary_color") or DEFAULT_BRANDING["secondary_color"],
        "accent_color": branding.get("accent_color") or DEFAULT_BRANDING["accent_color"],
        "theme": branding.get("theme") or DEFAULT_BRANDING["theme"],
        "subdomain": domain_settings.get("subdomain"),
        "custom_domain": domain_settings.get("custom_domain"),
    }
