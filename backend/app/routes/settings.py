"""
Settings management routes
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Dict, Optional
import json
from app.database import get_db
from app.models import Settings

router = APIRouter()


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


@router.get("")
async def get_settings(db: Session = Depends(get_db)):
    """
    Get school settings
    """
    # For now, use school_id = 1 (default school)
    school_id = 1

    settings = db.query(Settings).filter(Settings.school_id == school_id).first()

    if not settings:
        # Return default settings if none exist
        return {
            "name": "",
            "address": "",
            "phone": "",
            "email": "",
            "website": "",
            "principal_name": "",
            "established_year": 2024,
            "timezone": "Asia/Kolkata",
            "date_format": "DD/MM/YYYY",
            "default_batch_colors": {
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
                "Dropper 10": "#1F2937"
            },
            "export_format": "both",
            "auto_save": True,
            "conflict_detection": True,
            "email_notifications": False
        }

    # Parse batch colors from JSON
    batch_colors = {}
    if settings.default_batch_colors:
        try:
            batch_colors = json.loads(settings.default_batch_colors)
        except:
            batch_colors = {}

    return {
        "name": settings.name or "",
        "address": settings.address or "",
        "phone": settings.phone or "",
        "email": settings.email or "",
        "website": settings.website or "",
        "principal_name": settings.principal_name or "",
        "established_year": settings.established_year or 2024,
        "timezone": settings.timezone,
        "date_format": settings.date_format,
        "default_batch_colors": batch_colors,
        "export_format": settings.export_format,
        "auto_save": settings.auto_save,
        "conflict_detection": settings.conflict_detection,
        "email_notifications": settings.email_notifications
    }


@router.put("")
async def update_settings(
    settings_data: SchoolSettings,
    db: Session = Depends(get_db)
):
    """
    Update school settings
    """
    # For now, use school_id = 1 (default school)
    school_id = 1

    settings = db.query(Settings).filter(Settings.school_id == school_id).first()

    if not settings:
        # Create new settings record
        settings = Settings(school_id=school_id)
        db.add(settings)

    # Update fields
    for field, value in settings_data.dict(exclude_unset=True).items():
        if field == "default_batch_colors" and value:
            setattr(settings, field, json.dumps(value))
        else:
            setattr(settings, field, value)

    db.commit()
    db.refresh(settings)

    batch_colors = {}
    if settings.default_batch_colors:
        try:
            batch_colors = json.loads(settings.default_batch_colors)
        except:
            batch_colors = {}

    return {
        "message": "Settings updated successfully",
        "settings": {
            "name": settings.name or "",
            "address": settings.address or "",
            "phone": settings.phone or "",
            "email": settings.email or "",
            "website": settings.website or "",
            "principal_name": settings.principal_name or "",
            "established_year": settings.established_year or 2024,
            "timezone": settings.timezone or "Asia/Kolkata",
            "date_format": settings.date_format or "DD/MM/YYYY",
            "default_batch_colors": batch_colors,
            "export_format": settings.export_format or "both",
            "auto_save": settings.auto_save,
            "conflict_detection": settings.conflict_detection,
            "email_notifications": settings.email_notifications,
        },
    }


@router.post("/reset")
async def reset_settings(db: Session = Depends(get_db)):
    """
    Reset settings to defaults
    """
    # For now, use school_id = 1 (default school)
    school_id = 1

    settings = db.query(Settings).filter(Settings.school_id == school_id).first()

    if settings:
        # Reset existing settings
        settings.name = ""
        settings.address = ""
        settings.phone = ""
        settings.email = ""
        settings.website = ""
        settings.principal_name = ""
        settings.established_year = 2024
        settings.timezone = "Asia/Kolkata"
        settings.date_format = "DD/MM/YYYY"
        settings.default_batch_colors = json.dumps({
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
            "Dropper 10": "#1F2937"
        })
        settings.export_format = "both"
        settings.auto_save = True
        settings.conflict_detection = True
        settings.email_notifications = False
    else:
        # Create new settings with defaults
        settings = Settings(
            school_id=school_id,
            name="",
            address="",
            phone="",
            email="",
            website="",
            principal_name="",
            established_year=2024,
            timezone="Asia/Kolkata",
            date_format="DD/MM/YYYY",
            default_batch_colors=json.dumps({
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
                "Dropper 10": "#1F2937"
            }),
            export_format="both",
            auto_save=True,
            conflict_detection=True,
            email_notifications=False
        )
        db.add(settings)

    db.commit()
    db.refresh(settings)

    return {
        "message": "Settings reset to defaults",
        "settings": {
            "name": "",
            "address": "",
            "phone": "",
            "email": "",
            "website": "",
            "principal_name": "",
            "established_year": 2024,
            "timezone": "Asia/Kolkata",
            "date_format": "DD/MM/YYYY",
            "default_batch_colors": {
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
                "Dropper 10": "#1F2937"
            },
            "export_format": "both",
            "auto_save": True,
            "conflict_detection": True,
            "email_notifications": False
        }
    }