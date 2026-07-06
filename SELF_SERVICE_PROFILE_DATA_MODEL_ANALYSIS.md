# SELF-SERVICE PROFILE DATA MODEL ANALYSIS

## Intended Purpose

`school_self_service_profiles` stores per-school configuration for the school self-service portal. It replaces the previous approach of storing branding/settings in `schools.metadata` JSONB with dedicated columns and schemas.

### Expected Columns (confirmed from migration SQL)

| Column | Type | Purpose |
|--------|------|---------|
| `school_id` | UUID PK → schools(id) | School identity (1:1 with schools) |
| `branding` | JSONB | Colors, logo URLs, portal name, footer text |
| `portal_settings` | JSONB | Academic year, attendance rules, working days, exam pattern |
| `domain_settings` | JSONB | Custom domain, subdomain, SSL/verification status |
| `email_templates` | JSONB | Admission, fee, attendance, exam, password reset templates |
| `messaging_templates` | JSONB | SMS/WhatsApp templates for alerts, fees, attendance |
| `preferences` | JSONB | Currency, date/time format, language, timezone |
| `metadata` | JSONB | Source tracking, extensible metadata |
| `created_by` | UUID → profiles(id) | Audit trail |
| `updated_by` | UUID → profiles(id) | Audit trail |
| `created_at` | Timestamptz | Row creation |
| `updated_at` | Timestamptz | Row update (auto via trigger) |

### Comparison with Existing Tables

| Table | Overlap | Relationship |
|-------|---------|-------------|
| `schools` | `schools.metadata.branding` (legacy) | Migration path: `school_self_service_profiles` is the NEW canonical store. `_sync_school_row()` (line 266) backport branding to `schools.metadata` |
| `school_memberships` | **NONE** | Memberships track profile→school assignments. Self-service profiles track school CONFIGURATION. Different purpose entirely. |
| `school_settings` or `school_profiles` | **DOES NOT EXIST** | No such tables in the codebase |
| `platform_schools` | **DOES NOT EXIST** | No such table |
| `public.school_brand_assets` | Companion table | Created by same migration 068 for uploaded brand assets (logos, banners) |
| `public.school_backup_requests` | Companion table | Created by same migration 068 for school backup/restore requests |

### Classification

| Question | Answer | Evidence |
|----------|--------|----------|
| Genuinely required table? | **YES** | Backend code in `school_self_service.py` queries it for branding/profile/backup operations |
| Stale old table name? | **NO** | This is a NEW table, not a renamed old one |
| Renamed table? | **NO** | No ALTER TABLE RENAME in any migration |
| Duplicated model? | **NO** | No other table has the same columns/schema |
| Wrong schema reference? | **NO** | It's correctly in `public` schema |
| Obsolete fallback? | **NO** | Active runtime code in school_self_service.py |

## Candidate Replacement Analysis

The PostgREST hint suggests `school_memberships`, but this is semantically incompatible:

| Requirement | `school_self_service_profiles` | `school_memberships` | Compatible? |
|-------------|-------------------------------|----------------------|-------------|
| School branding (colors, logo) | ✅ 7 JSONB branding fields | ❌ Only profile→school links | ❌ NO |
| Portal settings (academic year, rules) | ✅ `portal_settings` JSONB | ❌ No settings storage | ❌ NO |
| Domain settings (custom domain) | ✅ `domain_settings` JSONB | ❌ | ❌ NO |
| Email/messaging templates | ✅ Dedicated columns | ❌ | ❌ NO |
| Preferences (currency, timezone) | ✅ `preferences` JSONB | ❌ | ❌ NO |
| School ID | ✅ 1:1 with schools | ✅ Many:many profile→school | ❌ Wrong cardinality |

**No existing table can replace `school_self_service_profiles`.** The table is genuinely required.
