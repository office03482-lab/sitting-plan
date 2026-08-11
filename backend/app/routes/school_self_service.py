from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, Request, UploadFile, status

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user, user_has_permission
from app.middleware.tenant_context import TenantContext, get_tenant_context
from app.models import User, UserRole
from app.schemas.school_self_service import (
    ManageableSchoolListResponse,
    PublicSchoolBrandingResponse,
    SchoolBackupHistoryResponse,
    SchoolBackupRequestPayload,
    SchoolBrandAssetResponse,
    SchoolBrandingPayload,
    SchoolDomainSettingsPayload,
    SchoolPortalSettingsPayload,
    SchoolPreferencesPayload,
    SchoolSelfServiceProfileResponse,
    SchoolStorageOverviewResponse,
    SchoolTemplatePayload,
)
from app.services.school_self_service import (
    get_public_school_branding,
    get_school_self_service_profile,
    list_manageable_schools,
    get_storage_overview,
    list_backup_history,
    request_backup,
    request_restore,
    update_school_branding,
    update_school_domain_settings,
    update_school_email_templates,
    update_school_messaging_templates,
    update_school_portal_settings,
    update_school_preferences,
    upload_school_brand_asset,
)
from app.services.bulk_action_requests import is_platform_admin_user
router = APIRouter(prefix="/api/school-self-service", tags=["School Self Service"])


def _role_key(user: User) -> str:
    return str(getattr(user, "role_key", "") or "").strip().lower()


def require_school_admin_user(user: User = Depends(get_authenticated_user)) -> User:
    from app.services.bulk_action_requests import is_platform_admin_user
    role_key = _role_key(user)
    if (
        is_platform_admin_user(user)
        or role_key == "school_admin"
        or (getattr(user, "role", None) == UserRole.ADMIN and role_key != "platform_admin")
        or user_has_permission(user, "school_self_service")
    ):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only School Admin can manage school self-service settings")


@router.get("/public-branding", response_model=PublicSchoolBrandingResponse)
def get_school_login_branding(
    request: Request,
    school: str | None = Query(default=None),
    x_forwarded_host: str | None = Header(default=None, alias="X-Forwarded-Host"),
):
    return get_public_school_branding(
        school_hint=school,
        hostname=x_forwarded_host or request.headers.get("host"),
    )


@router.get("/manageable-schools", response_model=ManageableSchoolListResponse)
def get_manageable_schools(
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    user: User = Depends(require_school_admin_user),
):
    return list_manageable_schools(actor=actor, is_platform_admin=is_platform_admin_user(user))


@router.get("/profile", response_model=SchoolSelfServiceProfileResponse)
def get_self_service_profile(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_school_admin_user),
):
    school_id = tenant.school_id
    return get_school_self_service_profile(school_id, actor_profile_id=str(actor.get("profile_id") or "").strip() or None)


@router.put("/branding", response_model=SchoolSelfServiceProfileResponse)
def update_self_service_branding(
    payload: SchoolBrandingPayload,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_school_admin_user),
):
    school_id = tenant.school_id
    return update_school_branding(school_id, payload.model_dump(exclude_unset=True), actor_profile_id=str(actor.get("profile_id") or "").strip() or None)


@router.put("/preferences", response_model=SchoolSelfServiceProfileResponse)
def update_self_service_preferences(
    payload: SchoolPreferencesPayload,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_school_admin_user),
):
    school_id = tenant.school_id
    return update_school_preferences(school_id, payload.model_dump(exclude_unset=True), actor_profile_id=str(actor.get("profile_id") or "").strip() or None)


@router.put("/portal-settings", response_model=SchoolSelfServiceProfileResponse)
def update_self_service_portal_settings(
    payload: SchoolPortalSettingsPayload,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_school_admin_user),
):
    school_id = tenant.school_id
    return update_school_portal_settings(school_id, payload.model_dump(exclude_unset=True), actor_profile_id=str(actor.get("profile_id") or "").strip() or None)


@router.put("/domain", response_model=SchoolSelfServiceProfileResponse)
def update_self_service_domain_settings(
    payload: SchoolDomainSettingsPayload,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_school_admin_user),
):
    school_id = tenant.school_id
    return update_school_domain_settings(school_id, payload.model_dump(exclude_unset=True), actor_profile_id=str(actor.get("profile_id") or "").strip() or None)


@router.put("/email-templates", response_model=SchoolSelfServiceProfileResponse)
def update_self_service_email_templates(
    payload: SchoolTemplatePayload,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_school_admin_user),
):
    school_id = tenant.school_id
    return update_school_email_templates(school_id, payload.templates, actor_profile_id=str(actor.get("profile_id") or "").strip() or None)


@router.put("/messaging-templates", response_model=SchoolSelfServiceProfileResponse)
def update_self_service_messaging_templates(
    payload: SchoolTemplatePayload,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_school_admin_user),
):
    school_id = tenant.school_id
    return update_school_messaging_templates(school_id, payload.templates, actor_profile_id=str(actor.get("profile_id") or "").strip() or None)


@router.get("/storage", response_model=SchoolStorageOverviewResponse)
def get_self_service_storage(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_school_admin_user),
):
    school_id = tenant.school_id
    return get_storage_overview(school_id, actor_profile_id=str(actor.get("profile_id") or "").strip() or None)


@router.post("/assets/{asset_type}", response_model=SchoolBrandAssetResponse)
async def upload_self_service_asset(
    asset_type: str,
    file: UploadFile = File(...),
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_school_admin_user),
):
    school_id = tenant.school_id
    return await upload_school_brand_asset(
        school_id,
        asset_type,
        file,
        actor_profile_id=str(actor.get("profile_id") or "").strip() or None,
    )


@router.get("/backups", response_model=SchoolBackupHistoryResponse)
def get_self_service_backups(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_school_admin_user),
):
    school_id = tenant.school_id
    return list_backup_history(school_id, actor_profile_id=str(actor.get("profile_id") or "").strip() or None)


@router.post("/backups/request", response_model=SchoolBackupHistoryResponse)
def request_school_backup(
    payload: SchoolBackupRequestPayload,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_school_admin_user),
):
    school_id = tenant.school_id
    return request_backup(school_id, payload.notes, actor_profile_id=str(actor.get("profile_id") or "").strip() or None)


@router.post("/backups/restore-request", response_model=SchoolBackupHistoryResponse)
def request_school_restore(
    payload: SchoolBackupRequestPayload,
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict[str, Any] = Depends(get_authenticated_actor_context),
    _: User = Depends(require_school_admin_user),
):
    school_id = tenant.school_id
    return request_restore(school_id, payload.notes, actor_profile_id=str(actor.get("profile_id") or "").strip() or None)
