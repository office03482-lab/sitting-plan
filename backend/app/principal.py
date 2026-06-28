"""Runtime auth principal model.

This is the lightweight request-time representation of an authenticated
Supabase user. It is intentionally not backed by SQLAlchemy.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any, Mapping

from app.models import UserRole


@dataclass(frozen=True, slots=True)
class SupabasePrincipal:
    profile_id: str
    email: str
    school_id: str
    role_id: str
    role_key: str
    role_name: str
    permissions: tuple[str, ...] = field(default_factory=tuple)
    scopes: Mapping[str, str] = field(default_factory=dict)
    metadata: Mapping[str, Any] = field(default_factory=dict)
    membership_id: str = ""
    default_school_id: str = ""
    full_name: str = ""
    username: str = ""
    role: UserRole = UserRole.VIEWER
    user_type: str = "non_teaching"
    is_active: bool = True
    auth_source: str = "supabase"

    def __post_init__(self) -> None:
        normalized_permissions = tuple(
            str(item).strip().lower()
            for item in self.permissions
            if str(item).strip()
        )
        normalized_scopes = {
            str(key).strip(): str(value).strip()
            for key, value in dict(self.scopes or {}).items()
            if str(key).strip()
        }
        normalized_metadata = dict(self.metadata or {})
        object.__setattr__(self, "permissions", normalized_permissions)
        object.__setattr__(self, "scopes", MappingProxyType(normalized_scopes))
        object.__setattr__(self, "metadata", MappingProxyType(normalized_metadata))

    @property
    def id(self) -> str:
        return self.profile_id

    @property
    def role_metadata(self) -> Mapping[str, Any]:
        return self.metadata

    @property
    def scope_assignments(self) -> Mapping[str, str]:
        return self.scopes
