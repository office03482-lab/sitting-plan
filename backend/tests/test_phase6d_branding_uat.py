from __future__ import annotations

from copy import deepcopy

from app.services import school_self_service


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, rows):
        self._rows = [deepcopy(row) for row in rows]
        self._filters: list[tuple[str, object]] = []
        self._order: tuple[str, bool] | None = None
        self._limit: int | None = None

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, key, value):
        self._filters.append((key, value))
        return self

    def order(self, key, desc=False):
        self._order = (key, desc)
        return self

    def limit(self, value):
        self._limit = value
        return self

    def execute(self):
        rows = list(self._rows)
        for key, value in self._filters:
            rows = [row for row in rows if row.get(key) == value]
        if self._order:
            key, desc = self._order
            rows.sort(key=lambda row: row.get(key) or "", reverse=desc)
        if self._limit is not None:
            rows = rows[: self._limit]
        return _Result(rows)


class _Table:
    def __init__(self, dataset, name):
        self._dataset = dataset
        self._name = name

    def select(self, *_args, **_kwargs):
        return _Query(self._dataset[self._name])


def _dataset():
    return {
        "schools": [
            {
                "id": "school-aspire",
                "name": "Aspire IIT & Medical",
                "slug": "aspire-iit-medical",
                "school_code": "ASP1",
                "metadata": {"school_domain": "portal.aspire-school.com"},
                "timezone": "Asia/Kolkata",
                "contact_email": "admin@aspire.example.com",
                "contact_phone": "1111111111",
            },
            {
                "id": "school-dps",
                "name": "Delhi Public School",
                "slug": "delhi-public-school",
                "school_code": "DPS2",
                "metadata": {"school_domain": "portal.dps-school.com"},
                "timezone": "Asia/Kolkata",
                "contact_email": "admin@dps.example.com",
                "contact_phone": "2222222222",
            },
            {
                "id": "school-xavier",
                "name": "St. Xavier School",
                "slug": "st-xavier-school",
                "school_code": "XAV3",
                "metadata": {},
                "timezone": "Asia/Kolkata",
                "contact_email": "admin@xavier.example.com",
                "contact_phone": "3333333333",
            },
        ],
        "school_self_service_profiles": [
            {
                "school_id": "school-aspire",
                "branding": {
                    "school_name": "Aspire IIT & Medical",
                    "portal_name": "Aspire ERP",
                    "logo_url": "https://cdn.example.com/aspire-logo.png",
                    "banner_url": "https://cdn.example.com/aspire-banner.png",
                    "favicon_url": "https://cdn.example.com/aspire-favicon.png",
                    "primary_color": "#1d4ed8",
                    "secondary_color": "#0f766e",
                    "accent_color": "#38bdf8",
                    "tagline": "Blue identity",
                },
                "domain_settings": {
                    "subdomain": "school1.yourdomain.com",
                    "custom_domain": "portal.aspire-school.com",
                },
                "portal_settings": {},
                "preferences": {},
                "email_templates": {"welcome_email": "Welcome to Aspire"},
                "messaging_templates": {"parent_alerts": "Aspire alert"},
            },
            {
                "school_id": "school-dps",
                "branding": {
                    "school_name": "Delhi Public School",
                    "portal_name": "DPS ERP",
                    "logo_url": "https://cdn.example.com/dps-logo.png",
                    "banner_url": "https://cdn.example.com/dps-banner.png",
                    "favicon_url": "https://cdn.example.com/dps-favicon.png",
                    "primary_color": "#166534",
                    "secondary_color": "#22c55e",
                    "accent_color": "#86efac",
                    "tagline": "Green identity",
                },
                "domain_settings": {
                    "subdomain": "school2.yourdomain.com",
                    "custom_domain": "portal.dps-school.com",
                },
                "portal_settings": {},
                "preferences": {},
                "email_templates": {"welcome_email": "Welcome to DPS"},
                "messaging_templates": {"parent_alerts": "DPS alert"},
            },
            {
                "school_id": "school-xavier",
                "branding": {
                    "school_name": "St. Xavier School",
                    "portal_name": "Xavier ERP",
                    "primary_color": "#b91c1c",
                    "secondary_color": "#ef4444",
                    "accent_color": "#fca5a5",
                    "tagline": "Red identity",
                },
                "domain_settings": {
                    "subdomain": "school3.yourdomain.com",
                    "custom_domain": "portal.xavier-school.com",
                },
                "portal_settings": {},
                "preferences": {},
                "email_templates": {"welcome_email": "Welcome to Xavier"},
                "messaging_templates": {"parent_alerts": "Xavier alert"},
            },
        ],
        "school_brand_assets": [
            {
                "id": "asset-1",
                "school_id": "school-aspire",
                "asset_type": "logo",
                "file_name": "aspire-logo.png",
                "public_url": "https://cdn.example.com/aspire-logo.png",
                "content_type": "image/png",
                "size_bytes": 1024,
                "bucket": "online-test-images",
                "storage_path": "school-aspire/logo/aspire-logo.png",
                "created_at": "2026-07-03T10:00:00Z",
                "metadata": {},
            },
            {
                "id": "asset-2",
                "school_id": "school-dps",
                "asset_type": "logo",
                "file_name": "dps-logo.png",
                "public_url": "https://cdn.example.com/dps-logo.png",
                "content_type": "image/png",
                "size_bytes": 2048,
                "bucket": "online-test-images",
                "storage_path": "school-dps/logo/dps-logo.png",
                "created_at": "2026-07-03T11:00:00Z",
                "metadata": {},
            },
        ],
        "school_backup_requests": [
            {
                "id": "backup-1",
                "school_id": "school-aspire",
                "request_type": "backup",
                "status": "requested",
                "download_url": None,
                "notes": "Aspire backup",
                "created_at": "2026-07-03T12:00:00Z",
                "metadata": {},
            },
            {
                "id": "backup-2",
                "school_id": "school-dps",
                "request_type": "restore",
                "status": "requested",
                "download_url": None,
                "notes": "DPS restore",
                "created_at": "2026-07-03T13:00:00Z",
                "metadata": {},
            },
        ],
    }


def _patch_tables(monkeypatch, dataset):
    monkeypatch.setattr(school_self_service, "_public_table", lambda name: _Table(dataset, name))


def test_multi_school_branding_resolves_correct_school_by_domain_and_hint(monkeypatch):
    dataset = _dataset()
    _patch_tables(monkeypatch, dataset)

    aspire = school_self_service.get_public_school_branding(hostname="school1.yourdomain.com:443")
    dps = school_self_service.get_public_school_branding(hostname="portal.dps-school.com")
    xavier = school_self_service.get_public_school_branding(school_hint="XAV3")

    assert aspire["school_name"] == "Aspire IIT & Medical"
    assert aspire["portal_name"] == "Aspire ERP"
    assert aspire["primary_color"] == "#1d4ed8"

    assert dps["school_name"] == "Delhi Public School"
    assert dps["logo_url"] == "https://cdn.example.com/dps-logo.png"
    assert dps["primary_color"] == "#166534"

    assert xavier["school_name"] == "St. Xavier School"
    assert xavier["primary_color"] == "#b91c1c"


def test_unknown_domain_or_hint_never_leaks_another_school_branding(monkeypatch):
    dataset = _dataset()
    _patch_tables(monkeypatch, dataset)

    unknown_host = school_self_service.get_public_school_branding(hostname="unknown.yourdomain.com")
    unknown_hint = school_self_service.get_public_school_branding(school_hint="missing-school")

    assert unknown_host["school_name"] == "School ERP"
    assert unknown_host["portal_name"] == "School ERP"
    assert unknown_host.get("logo_url") is None

    assert unknown_hint["school_name"] == "School ERP"
    assert unknown_hint["portal_name"] == "School ERP"
    assert unknown_hint.get("logo_url") is None


def test_school_self_service_profile_is_fully_school_scoped(monkeypatch):
    dataset = _dataset()
    _patch_tables(monkeypatch, dataset)

    aspire_profile = school_self_service.get_school_self_service_profile("school-aspire")
    dps_profile = school_self_service.get_school_self_service_profile("school-dps")

    assert aspire_profile["school_summary"]["name"] == "Aspire IIT & Medical"
    assert aspire_profile["email_templates"]["welcome_email"] == "Welcome to Aspire"
    assert aspire_profile["messaging_templates"]["parent_alerts"] == "Aspire alert"
    assert len(aspire_profile["assets"]) == 1
    assert aspire_profile["assets"][0]["file_name"] == "aspire-logo.png"
    assert aspire_profile["backups"]["total_count"] == 1
    assert aspire_profile["backups"]["items"][0]["notes"] == "Aspire backup"

    assert dps_profile["school_summary"]["name"] == "Delhi Public School"
    assert dps_profile["email_templates"]["welcome_email"] == "Welcome to DPS"
    assert dps_profile["messaging_templates"]["parent_alerts"] == "DPS alert"
    assert len(dps_profile["assets"]) == 1
    assert dps_profile["assets"][0]["file_name"] == "dps-logo.png"
    assert dps_profile["backups"]["total_count"] == 1
    assert dps_profile["backups"]["items"][0]["notes"] == "DPS restore"


def test_missing_logo_banner_and_favicon_fall_back_without_failure(monkeypatch):
    dataset = _dataset()
    _patch_tables(monkeypatch, dataset)

    branding = school_self_service.get_public_school_branding(hostname="school3.yourdomain.com")

    assert branding["school_name"] == "St. Xavier School"
    assert branding["portal_name"] == "Xavier ERP"
    assert branding["logo_url"] is None
    assert branding["banner_url"] == ""
    assert branding["favicon_url"] == ""
    assert branding["primary_color"] == "#b91c1c"
