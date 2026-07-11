"""Focused regression tests for _is_parent_user permission gate.

Covers all code paths in the fixed _is_parent_user:
  1. Direct role_key == "parent"
  2. Managed role + role_metadata.role_key == "parent"
  3. Permissions string contains "edupay.parent_portal"
  4. Whitespace / casing edge cases
  5. Negative cases (teacher, student, school_admin, empty, None)
  6. Substring and near-match attacks
"""
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.routes.parent_portal import _is_parent_user


def _user(**overrides):
    defaults = {
        "role_key": "",
        "role_metadata": {},
        "permissions": "",
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


class TestDirectRoleKey:
    def test_role_key_parent(self):
        assert _is_parent_user(_user(role_key="parent")) is True

    def test_role_key_parent_uppercase(self):
        assert _is_parent_user(_user(role_key="Parent")) is True

    def test_role_key_parent_whitespace(self):
        assert _is_parent_user(_user(role_key="  parent  ")) is True

    def test_role_key_not_parent(self):
        assert _is_parent_user(_user(role_key="student")) is False

    def test_role_key_empty(self):
        assert _is_parent_user(_user(role_key="")) is False

    def test_role_key_none(self):
        assert _is_parent_user(_user(role_key=None)) is False


class TestRoleMetadata:
    def test_metadata_role_key_parent(self):
        assert _is_parent_user(
            _user(role_key="managed_parent_abc", role_metadata={"role_key": "parent"})
        ) is True

    def test_metadata_role_key_uppercase(self):
        assert _is_parent_user(
            _user(role_key="managed_parent_abc", role_metadata={"role_key": "Parent"})
        ) is True

    def test_metadata_role_key_whitespace(self):
        assert _is_parent_user(
            _user(role_key="managed_parent_abc", role_metadata={"role_key": "  parent  "})
        ) is True

    def test_metadata_role_key_not_parent(self):
        assert _is_parent_user(
            _user(role_key="managed_student_abc", role_metadata={"role_key": "student"})
        ) is False

    def test_metadata_missing_role_key(self):
        assert _is_parent_user(
            _user(role_key="managed_parent_abc", role_metadata={})
        ) is False

    def test_metadata_none(self):
        assert _is_parent_user(
            _user(role_key="managed_parent_abc", role_metadata=None)
        ) is False

    def test_metadata_not_dict(self):
        assert _is_parent_user(
            _user(role_key="managed_parent_abc", role_metadata="invalid")
        ) is False


class TestPermissions:
    def test_exact_match(self):
        assert _is_parent_user(
            _user(permissions="edupay.parent_portal")
        ) is True

    def test_multiple_permissions(self):
        assert _is_parent_user(
            _user(permissions="parent_intelligence.view,edupay.parent_portal,parent_intelligence.reports")
        ) is True

    def test_permissions_uppercase(self):
        assert _is_parent_user(
            _user(permissions="EDUPAY.PARENT_PORTAL")
        ) is True

    def test_permissions_whitespace_around(self):
        assert _is_parent_user(
            _user(permissions=" edupay.parent_portal ")
        ) is True

    def test_permissions_none(self):
        assert _is_parent_user(_user(permissions=None)) is False

    def test_permissions_empty_string(self):
        assert _is_parent_user(_user(permissions="")) is False

    def test_permissions_star(self):
        assert _is_parent_user(_user(permissions="*")) is False

    def test_permissions_no_parent(self):
        assert _is_parent_user(
            _user(permissions="teacher.view,student.manage")
        ) is False


class TestAttacks:
    def test_substring_attack(self):
        assert _is_parent_user(
            _user(permissions="edupay.parent_portal_extra")
        ) is False

    def test_near_match(self):
        assert _is_parent_user(
            _user(permissions="edupay.parent_porta")
        ) is False

    def test_prefix_attack(self):
        assert _is_parent_user(
            _user(permissions="not_edupay.parent_portal")
        ) is False

    def test_role_key_substring(self):
        assert _is_parent_user(
            _user(role_key="not_parent")
        ) is False

    def test_metadata_substring(self):
        assert _is_parent_user(
            _user(role_metadata={"role_key": "parent_admin"})
        ) is False


class TestEdgeCases:
    def test_all_none(self):
        assert _is_parent_user(_user(role_key=None, role_metadata=None, permissions=None)) is False

    def test_role_key_takes_precedence(self):
        assert _is_parent_user(
            _user(role_key="parent", permissions="", role_metadata={})
        ) is True

    def test_metadata_takes_precedence_over_permissions(self):
        assert _is_parent_user(
            _user(role_key="managed_x", role_metadata={"role_key": "parent"}, permissions="")
        ) is True

    def test_teacher_user(self):
        assert _is_parent_user(
            _user(role_key="teacher", permissions="teacher.view")
        ) is False

    def test_student_user(self):
        assert _is_parent_user(
            _user(role_key="student", permissions="student.view")
        ) is False

    def test_school_admin_user(self):
        assert _is_parent_user(
            _user(role_key="school_admin", permissions="admin.view")
        ) is False


class TestRequireParentViewUserNoPermissionsGate:
    """Verify require_parent_view_user no longer uses require_permissions as a dependency."""

    def test_no_require_permissions_in_source(self):
        import inspect
        from app.routes.parent_portal import require_parent_view_user
        source = inspect.getsource(require_parent_view_user)
        assert "require_permissions" not in source, (
            "require_parent_view_user must NOT use require_permissions — "
            "parents have empty permissions and would be blocked 403 before the body check"
        )

    def test_get_authenticated_user_is_dep(self):
        import inspect
        from app.routes.parent_portal import require_parent_view_user
        source = inspect.getsource(require_parent_view_user)
        assert "get_authenticated_user" in source, (
            "require_parent_view_user must depend on get_authenticated_user for auth"
        )
