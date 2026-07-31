from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class SchoolBrandingPayload(BaseModel):
    school_name: str | None = None
    short_name: str | None = None
    school_code: str | None = None
    tagline: str | None = None
    logo_url: str | None = None
    banner_url: str | None = None
    favicon_url: str | None = None
    background_image_url: str | None = None
    principal_signature_url: str | None = None
    official_seal_url: str | None = None
    report_card_header_url: str | None = None
    certificate_header_url: str | None = None
    website: str | None = None
    email: str | None = None
    phone: str | None = None
    address: str | None = None
    principal_name: str | None = None
    primary_color: str | None = None
    secondary_color: str | None = None
    accent_color: str | None = None
    theme: Literal["light", "dark", "auto"] | None = None
    welcome_message: str | None = None
    footer_text: str | None = None
    portal_name: str | None = None


class SchoolPortalSettingsPayload(BaseModel):
    academic_year: str | None = None
    attendance_rules: dict[str, Any] = Field(default_factory=dict)
    working_days: list[str] = Field(default_factory=list)
    periods_per_day: int | None = None
    exam_pattern: str | None = None
    grade_system: str | None = None
    notification_preferences: dict[str, Any] = Field(default_factory=dict)
    ai_preferences: dict[str, Any] = Field(default_factory=dict)
    language: str | None = None
    timezone: str | None = None


class SchoolPreferencesPayload(BaseModel):
    default_currency: str | None = None
    date_format: str | None = None
    time_format: str | None = None
    language: str | None = None
    timezone: str | None = None
    session_start: str | None = None
    session_end: str | None = None


class SchoolDomainSettingsPayload(BaseModel):
    custom_domain: str | None = None
    subdomain: str | None = None
    ssl_status: str | None = None
    verification_status: str | None = None


class SchoolTemplatePayload(BaseModel):
    templates: dict[str, str] = Field(default_factory=dict)


class SchoolBrandAssetResponse(BaseModel):
    id: str
    asset_type: str
    file_name: str
    public_url: str
    content_type: str | None = None
    size_bytes: int = 0
    bucket: str
    storage_path: str
    created_at: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ManageableSchoolSummaryResponse(BaseModel):
    id: str
    name: str
    short_name: str | None = None
    slug: str
    school_code: str
    timezone: str
    contact_email: str | None = None
    contact_phone: str | None = None
    logo_url: str | None = None
    status: str | None = None
    is_active: bool = True


class ManageableSchoolListResponse(BaseModel):
    items: list[ManageableSchoolSummaryResponse] = Field(default_factory=list)
    total_count: int = 0


class SchoolStorageOverviewResponse(BaseModel):
    total_files: int = 0
    total_size_bytes: int = 0
    total_size_mb: float = 0
    assets: list[SchoolBrandAssetResponse] = Field(default_factory=list)


class SchoolBackupRequestPayload(BaseModel):
    notes: str | None = None


class SchoolBackupHistoryItem(BaseModel):
    id: str
    request_type: str
    status: str
    download_url: str | None = None
    notes: str | None = None
    created_at: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class SchoolBackupHistoryResponse(BaseModel):
    items: list[SchoolBackupHistoryItem] = Field(default_factory=list)
    total_count: int = 0


class SchoolSelfServiceProfileResponse(BaseModel):
    school_id: str
    branding: dict[str, Any] = Field(default_factory=dict)
    portal_settings: dict[str, Any] = Field(default_factory=dict)
    domain_settings: dict[str, Any] = Field(default_factory=dict)
    email_templates: dict[str, str] = Field(default_factory=dict)
    messaging_templates: dict[str, str] = Field(default_factory=dict)
    preferences: dict[str, Any] = Field(default_factory=dict)
    assets: list[SchoolBrandAssetResponse] = Field(default_factory=list)
    storage: SchoolStorageOverviewResponse
    backups: SchoolBackupHistoryResponse
    school_summary: dict[str, Any] = Field(default_factory=dict)


class PublicSchoolBrandingResponse(BaseModel):
    school_name: str
    portal_name: str
    logo_url: str | None = None
    banner_url: str | None = None
    favicon_url: str | None = None
    background_image_url: str | None = None
    tagline: str | None = None
    welcome_message: str | None = None
    footer_text: str | None = None
    primary_color: str
    secondary_color: str
    accent_color: str
    theme: str
    subdomain: str | None = None
    custom_domain: str | None = None
