"""Environment-driven initial admin bootstrap helpers (Supabase-native)."""
from __future__ import annotations

from typing import Any

from app.config import settings
from app.models import UserRole
from app.services.supabase_admin import create_supabase_admin_client, get_supabase_admin_client
from app.utils.auth import hash_password


def count_admin_users() -> int:
    """Return the number of active admin profiles in Supabase.

    Counts profiles that have at least one active school_membership
    linked to a role whose role_key is 'platform_admin' or 'school_admin'.
    """
    try:
        supabase = get_supabase_admin_client()
    except Exception:
        return 0

    admin_role_keys = {"platform_admin", "school_admin"}
    try:
        roles_response = (
            supabase.table("roles")
            .select("id")
            .in_("role_key", list(admin_role_keys))
            .eq("is_system", True)
            .execute()
        )
        admin_role_ids = [r["id"] for r in (roles_response.data or [])]
        if not admin_role_ids:
            return 0
        memberships_response = (
            supabase.table("school_memberships")
            .select("profile_id")
            .in_("role_id", admin_role_ids)
            .eq("status", "active")
            .execute()
        )
        profile_ids = set()
        for m in (memberships_response.data or []):
            pid = str(m.get("profile_id") or "").strip()
            if pid:
                profile_ids.add(pid)
        return len(profile_ids)
    except Exception:
        return 0


def bootstrap_initial_admin() -> dict[str, Any]:
    """Create the first admin user in Supabase from environment variables.

    Steps:
      1. Create the user in Supabase Auth (auth.users)
      2. Upsert a profile row in public.profiles
      3. Resolve or create an admin role in public.roles
      4. Create an active school_membership
    """
    if not settings.initial_admin_enabled:
        raise RuntimeError(
            "Initial admin bootstrap is disabled. Set INITIAL_ADMIN_ENABLED=true only for the one-time bootstrap command."
        )

    username = (settings.initial_admin_username or "").strip().lower()
    email = (settings.initial_admin_email or "").strip().lower()
    password = settings.initial_admin_password or ""
    full_name = (settings.initial_admin_full_name or "System Administrator").strip()

    if not username or not email or not password:
        raise RuntimeError(
            "INITIAL_ADMIN_USERNAME, INITIAL_ADMIN_EMAIL, and INITIAL_ADMIN_PASSWORD are required for bootstrap."
        )
    if len(password) < 12:
        raise RuntimeError("INITIAL_ADMIN_PASSWORD must be at least 12 characters long.")

    supabase = create_supabase_admin_client()

    admin_role_key = settings.initial_admin_role_key or "platform_admin"
    permissions_csv = settings.initial_admin_permissions or "admin_office,timetable,attendance,inventory,edupay,settings"

    user_response = supabase.auth.admin.create_user(
        {
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {
                "full_name": full_name,
                "display_name": username,
                "username": username,
            },
        }
    )
    created_user = getattr(user_response, "user", None)
    if not created_user:
        raise RuntimeError("Failed to create admin user in Supabase Auth.")
    profile_id = str(getattr(created_user, "id", "") or "").strip()
    if not profile_id:
        raise RuntimeError("Failed to resolve admin profile_id from Supabase Auth response.")

    supabase.table("profiles").upsert(
        {
            "id": profile_id,
            "email": email,
            "full_name": full_name,
            "display_name": username,
            "is_active": True,
            "metadata": {"username": username, "user_type": "non_teaching"},
        },
        on_conflict="id",
    ).execute()

    existing_roles = (
        supabase.table("roles")
        .select("id")
        .eq("role_key", admin_role_key)
        .limit(1)
        .execute()
    )
    role_rows = list(existing_roles.data or [])
    if role_rows:
        role_id = role_rows[0]["id"]
    else:
        role_insert = (
            supabase.table("roles")
            .insert(
                {
                    "role_key": admin_role_key,
                    "role_name": admin_role_key.replace("_", " ").title(),
                    "is_system": True,
                    "metadata": {"legacy_role": "admin", "permissions": permissions_csv.split(",")},
                }
            )
            .execute()
        )
        role_id = role_insert.data[0]["id"] if role_insert.data else ""

    if not role_id:
        raise RuntimeError("Failed to resolve or create admin role.")

    supabase.table("school_memberships").upsert(
        {
            "school_id": settings.initial_admin_school_id or "00000000-0000-0000-0000-000000000000",
            "profile_id": profile_id,
            "role_id": role_id,
            "status": "active",
            "is_primary": True,
            "is_active": True,
            "metadata": {"source": "initial_admin_bootstrap"},
        },
        on_conflict="profile_id, school_id",
    ).execute()

    return {
        "profile_id": profile_id,
        "email": email,
        "username": username,
        "full_name": full_name,
        "role_key": admin_role_key,
    }
