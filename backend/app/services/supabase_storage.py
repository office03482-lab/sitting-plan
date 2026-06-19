"""Shared Supabase Storage helpers for production file uploads."""

from __future__ import annotations

import mimetypes
from pathlib import Path
from uuid import uuid4
from typing import Any

from fastapi import HTTPException, UploadFile

from app.config import settings
from app.services.supabase_admin import get_supabase_admin_client


UPLOAD_BUCKETS: dict[str, dict[str, Any]] = {
    "video": {
        "bucket": "lms-videos",
        "max_bytes": 1024 * 1024 * 1024,
        "extensions": {".mp4", ".mov", ".m4v", ".webm"},
        "content_types": {"video/mp4", "video/quicktime", "video/webm", "application/octet-stream"},
    },
    "document": {
        "bucket": "lms-documents",
        "max_bytes": 100 * 1024 * 1024,
        "extensions": {".pdf", ".docx", ".zip"},
        "content_types": {
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/zip",
            "application/x-zip-compressed",
            "multipart/x-zip",
            "application/octet-stream",
        },
    },
    "assignment": {
        "bucket": "lms-assignments",
        "max_bytes": 100 * 1024 * 1024,
        "extensions": {".pdf", ".docx", ".zip", ".png", ".jpg", ".jpeg", ".webp"},
        "content_types": {
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/zip",
            "application/x-zip-compressed",
            "image/png",
            "image/jpeg",
            "image/webp",
            "application/octet-stream",
        },
    },
    "assignment_submission": {
        "bucket": "assignment-submissions",
        "max_bytes": 100 * 1024 * 1024,
        "extensions": {".pdf", ".docx", ".zip", ".png", ".jpg", ".jpeg", ".webp"},
        "content_types": {
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/zip",
            "application/x-zip-compressed",
            "image/png",
            "image/jpeg",
            "image/webp",
            "application/octet-stream",
        },
    },
    "image": {
        "bucket": "online-test-images",
        "max_bytes": 20 * 1024 * 1024,
        "extensions": {".png", ".jpg", ".jpeg", ".webp", ".gif"},
        "content_types": {"image/png", "image/jpeg", "image/webp", "image/gif", "application/octet-stream"},
    },
    "live_class_recording": {
        "bucket": "live-class-recordings",
        "max_bytes": 1024 * 1024 * 1024,
        "extensions": {".mp4", ".mov", ".m4v", ".webm"},
        "content_types": {"video/mp4", "video/quicktime", "video/webm", "application/octet-stream"},
    },
    "notes": {
        "bucket": "lms-notes",
        "max_bytes": 50 * 1024 * 1024,
        "extensions": {".pdf", ".docx", ".txt"},
        "content_types": {
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "text/plain",
            "application/octet-stream",
        },
    },
}


def _storage():
    return get_supabase_admin_client().storage


def _sanitize_file_name(file_name: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in {"-", "_", "."} else "_" for ch in file_name.strip())
    return cleaned or f"upload-{uuid4().hex}"


def _resolve_content_type(file: UploadFile, file_name: str) -> str:
    hinted = str(file.content_type or "").strip().lower()
    if hinted:
        return hinted
    guessed, _ = mimetypes.guess_type(file_name)
    return str(guessed or "application/octet-stream")


async def upload_file_to_supabase_storage(
    *,
    school_id: str,
    category: str,
    file: UploadFile,
    folder: str | None = None,
) -> dict[str, Any]:
    config = UPLOAD_BUCKETS.get(category)
    if not config:
        raise HTTPException(status_code=400, detail="Unsupported upload category")
    if not file.filename:
        raise HTTPException(status_code=400, detail="File name is required")

    original_name = _sanitize_file_name(file.filename)
    extension = Path(original_name).suffix.lower()
    if extension not in set(config["extensions"]):
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {extension or 'unknown'}")

    content_type = _resolve_content_type(file, original_name)
    if content_type not in set(config["content_types"]):
        raise HTTPException(status_code=400, detail=f"Unsupported content type: {content_type}")

    file_bytes = await file.read()
    size = len(file_bytes)
    max_bytes = int(config["max_bytes"] or settings.max_upload_size_mb * 1024 * 1024)
    if size <= 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if size > max_bytes:
        raise HTTPException(status_code=400, detail=f"File exceeds max size of {max_bytes // (1024 * 1024)} MB")

    bucket = str(config["bucket"])
    path_prefix = folder.strip("/").replace("\\", "/") if folder else category
    storage_path = f"{school_id}/{path_prefix}/{uuid4().hex}-{original_name}"

    try:
        _storage().from_(bucket).upload(
            path=storage_path,
            file=file_bytes,
            file_options={"content-type": content_type, "upsert": "false"},
        )
        public_url = _storage().from_(bucket).get_public_url(storage_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to upload file to storage") from exc

    return {
        "url": public_url,
        "file_name": original_name,
        "size": size,
        "bucket": bucket,
        "storage_path": storage_path,
        "content_type": content_type,
    }
