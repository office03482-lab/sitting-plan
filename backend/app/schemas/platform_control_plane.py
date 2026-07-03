from __future__ import annotations

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field


class PlatformSchoolSummaryResponse(BaseModel):
    id: str
    school_code: str
    slug: str
    name: str
    legal_name: str | None = None
    timezone: str
    contact_email: str | None = None
    contact_phone: str | None = None
    school_domain: str | None = None
    academic_session: str | None = None
    logo_url: str | None = None
    status: str
    is_active: bool
    student_count: int = 0
    teacher_count: int = 0
    staff_count: int = 0
    created_at: str | None = None
    updated_at: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class PlatformSchoolListResponse(BaseModel):
    items: list[PlatformSchoolSummaryResponse] = Field(default_factory=list)
    total_count: int


class PlatformSchoolCreateRequest(BaseModel):
    school_code: str
    slug: str
    name: str
    legal_name: str | None = None
    timezone: str = "Asia/Kolkata"
    contact_email: str | None = None
    contact_phone: str | None = None
    school_domain: str | None = None
    academic_session: str | None = None
    logo_url: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class PlatformSchoolUpdateRequest(BaseModel):
    school_code: str | None = None
    slug: str | None = None
    name: str | None = None
    legal_name: str | None = None
    timezone: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    school_domain: str | None = None
    academic_session: str | None = None
    logo_url: str | None = None
    metadata: dict[str, Any] | None = None


class PlatformSchoolLifecycleRequest(BaseModel):
    status: Literal["active", "suspended", "archived", "deleted"]
    reason: str | None = None


class PlatformCloneSchoolRequest(BaseModel):
    source_school_id: str
    target_school_id: str


class PlatformUsageSummaryResponse(BaseModel):
    school_id: str
    school_name: str
    students: int = 0
    teachers: int = 0
    parents: int = 0
    staff: int = 0
    rooms: int = 0
    attendance_records: int = 0
    ai_credits_used: int = 0
    ai_requests: int = 0
    online_tests: int = 0
    storage_used_gb: float = 0
    database_size_mb: float = 0
    monthly_active_users: int = 0
    generated_at: str | None = None


class PlatformUsageDashboardResponse(BaseModel):
    items: list[PlatformUsageSummaryResponse] = Field(default_factory=list)
    total_students: int = 0
    total_teachers: int = 0
    total_ai_requests: int = 0
    total_storage_used_gb: float = 0
    generated_at: str | None = None


class PlatformHealthSummaryResponse(BaseModel):
    school_id: str
    school_name: str
    api_status: str
    background_jobs: str
    queue_status: str
    storage_health: str
    last_backup: str | None = None
    last_login: str | None = None
    last_activity: str | None = None
    last_billing_event: str | None = None


class PlatformHealthDashboardResponse(BaseModel):
    items: list[PlatformHealthSummaryResponse] = Field(default_factory=list)
    generated_at: str | None = None


class PlatformSubscriptionSummaryResponse(BaseModel):
    school_id: str
    current_plan: str
    status: str
    expiry: str | None = None
    renewal: str | None = None
    usage: dict[str, Any] = Field(default_factory=dict)
    grace_period_days: int = 0
    payment_status: str
    subscription_id: str | None = None
    billing_cycle: str | None = None
    amount: float | None = None
    currency: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class PlatformGlobalSearchItem(BaseModel):
    entity_type: str
    school_id: str | None = None
    school_name: str | None = None
    entity_id: str | None = None
    title: str
    subtitle: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class PlatformGlobalSearchResponse(BaseModel):
    items: list[PlatformGlobalSearchItem] = Field(default_factory=list)
    total_count: int


class PlatformAnalyticsOverviewResponse(BaseModel):
    total_schools: int
    active_schools: int
    trial_schools: int
    revenue: float
    monthly_growth: int
    student_count: int
    teacher_count: int
    subscriptions: int
    ai_usage: int
    credit_sales: float
    generated_at: str | None = None


class PlatformSupportActionRequest(BaseModel):
    action: Literal[
        "impersonate_school_admin",
        "reset_school_cache",
        "resync_school",
        "rebuild_permissions",
        "recalculate_usage",
        "repair_subscription",
        "repair_entitlements",
        "repair_ai_wallet",
    ]
    notes: str | None = None


class PlatformSupportActionResponse(BaseModel):
    school_id: str
    action: str
    status: str
    audited: bool = True
    details: dict[str, Any] = Field(default_factory=dict)


class PlatformNotificationCreateRequest(BaseModel):
    title: str
    message: str
    notification_type: Literal["maintenance", "subscription", "system_alert", "security_notice"]
    severity: Literal["info", "warning", "critical"] = "info"
    audience_scope: Literal["school", "multiple", "all"] = "school"
    school_ids: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class PlatformNotificationResponse(BaseModel):
    id: str
    title: str
    message: str
    notification_type: str
    severity: str
    audience_scope: str
    school_ids: list[str] = Field(default_factory=list)
    created_by_profile_id: str | None = None
    created_at: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class PlatformNotificationListResponse(BaseModel):
    items: list[PlatformNotificationResponse] = Field(default_factory=list)
    total_count: int


class PlatformOnboardingRequest(BaseModel):
    school_code: str | None = None
    slug: str | None = None
    name: str
    legal_name: str | None = None
    timezone: str = "Asia/Kolkata"
    contact_email: str | None = None
    contact_phone: str | None = None
    board: str | None = None
    academic_session: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None
    website: str | None = None
    language: str | None = None
    logo_url: str | None = None
    school_domain: str | None = None
    admin_profile_id: str | None = None
    admin_email: str
    admin_full_name: str
    admin_mobile: str | None = None
    admin_employee_code: str | None = None
    plan_tier: str = "starter"
    billing_cycle: str = "monthly"
    max_students: int | None = None
    max_teachers: int | None = None
    max_staff: int | None = None
    max_parents: int | None = None
    max_storage_gb: float | None = None
    create_default_batches: bool = True
    initialize_ai_wallet: bool = True


class PlatformOnboardingCredentialResponse(BaseModel):
    username: str
    temporary_password: str
    login_email: str
    login_url: str
    expires_at: str | None = None
    visible_once: bool = True


class PlatformOnboardingAdminResponse(BaseModel):
    profile_id: str | None = None
    full_name: str
    email: str
    mobile: str | None = None
    employee_code: str | None = None
    role_key: str = "school_admin"
    first_login_completed: bool = False
    must_change_password: bool = True


class PlatformProvisioningStatusResponse(BaseModel):
    school_settings: bool = False
    academic_session: bool = False
    role_templates: bool = False
    permission_templates: bool = False
    departments: bool = False
    attendance_settings: bool = False
    timetable_settings: bool = False
    examination_settings: bool = False
    ai_settings: bool = False
    notification_settings: bool = False
    usage_counters: bool = False
    subscription: bool = False
    ai_wallet: bool = False
    platform_notification: bool = False
    audit_entry: bool = False


class PlatformOnboardingResponse(BaseModel):
    school: PlatformSchoolSummaryResponse
    admin: PlatformOnboardingAdminResponse
    credentials: PlatformOnboardingCredentialResponse
    provisioning: PlatformProvisioningStatusResponse
    roles_created: int = 0
    permissions_seeded: bool = False
    batches_created: int = 0
    subscription_initialized: bool = False
    usage_initialized: bool = False
    ai_wallet_initialized: bool = False
    admin_membership_created: bool = False
    admin_account_created: bool = False
    notification_created: bool = False
    activation_status: str = "provisioned"
    audit_events: list[str] = Field(default_factory=list)


class PlatformAuditCenterResponse(BaseModel):
    items: list[dict[str, Any]] = Field(default_factory=list)
    total_count: int
