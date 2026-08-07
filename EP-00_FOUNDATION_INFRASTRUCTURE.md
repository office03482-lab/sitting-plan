# EP-00 — Foundation Infrastructure (Execution Package)

**Status:** Planning-only (no production code, no SQL, no migrations, no file modifications in this document)
**Applies to:** MIP **Phase 0 — Foundation (7 weeks)**
**Binding inputs:** `QUESTION_BANK_ARCHITECTURE_AUDIT.md`, `FINAL_EXAMINATION_ARCHITECTURE.md`, `FINAL_ARCHITECTURE_READINESS_REVIEW.md`, ADR-001…005, `MASTER_IMPLEMENTATION_PLAN.md`
**Owner:** Backend platform team (FastAPI) + Frontend platform team (React)

---

## 1. Scope and Purpose

EP-00 is the developer-executable work package for Phase 0 of the Master Implementation Plan. It ships **zero user-visible features**. It delivers the shared infrastructure that every later phase (question bank, online/offline exams, AI generation, seating, results) builds on.

EP-00 satisfies the Readiness Review's structural items that block Phase 1+:

| ADR | Structural item | Delivered by component |
|-----|-----------------|------------------------|
| ADR-001 | Enforce tenant context as a single resolved, validated `school_id` | Component 1 — Tenant Context |
| ADR-002 | Partitioning key strategy (`school_id` on every new table + RLS) | Component 2 — Partitioning Key |
| ADR-003 | Snapshot delivery model (capture at publish, deliver immutably) | Component 3 — Snapshot Framework |
| ADR-005 | AI provider interface + prompt versioning | Component 6 — AI Provider Interface |
| ADR-004 | Offline re-eval / grace / answer-key lifecycle | **Out of scope** — later phases |

**Non-goals (explicitly excluded):** No `/question-bank` navigation entry (scheduled MIP Phase 1), no scoring changes, no RLS retrofit of *existing* business tables except the explicit `exam.*` backfill in F-003c (service-role-compatible), no AI model replacement.

---

## 2. Foundation Components

The 15 components and their target modules:

| # | Component | Target module(s) | ADR |
|---|-----------|------------------|-----|
| 1 | Tenant Context | `app/middleware/tenant_context.py`, extend `app/services/supabase_context.py` | ADR-001 |
| 2 | Partitioning Key + New-Table Access | `app/core/partitioning.py`, new-table RLS templates, `exam.*` RLS backfill, `question_bank.*` permission seed | ADR-002 |
| 3 | Snapshot Framework | `app/services/supabase_snapshot.py` (`qb_snapshots`, `qb_snapshot_items`) | ADR-003 |
| 4 | Question Version Foundation | `app/services/version_service.py` (`qb_version_events`, `qb_version_retention_policy`) | ADR-005 (prompt side) |
| 5 | Audit Logging | `app/services/audit_logger.py`, `qb_audit_events` wrapper + `audit_logs` unified | — |
| 6 | AI Provider Interface | `app/services/llm/protocol.py`, `app/services/llm/gemini.py` | ADR-005 |
| 7 | Background Queue Engine | `app/services/queue_engine.py` (APScheduler + Redis, DB-backed) | — |
| 8 | Feature Flags | `app/services/feature_flags.py`, `system_feature_flags` table, `useFeatureFlag` hook | — |
| 9 | Observability | extend `SystemObservabilityEngine`, `request_profiler`, `/system/health` | — |
| 10 | Error Handling | `app/core/exceptions.py`, axios interceptor, request-id passthrough, error boundary | — |
| 11 | Repository Standards | `app/repositories/` (data-access layer convention) | — |
| 12 | API Standards | route/tag/response conventions | — |
| 13 | Coding Standards | lint/type/test gate | — |
| 14 | Testing Standards | pytest/Vitest/Playwright harnesses | — |
| 15 | Rollback Standards | migration + flag + deploy rollback runbook | — |

---

### Component 1 — Tenant Context (ADR-001)

**Purpose.** Guarantee every request resolves exactly one trusted `school_id`, and no code path can read or write outside it. This is the security spine of the entire exam system.

**Current State.** A foundation already exists and must be preserved:
- `backend/app/services/supabase_context.py` is role-aware and authorization-gated. Platform Admin may pass an explicit validated `school_id` query param; all other roles get `school_id` from the JWT only, validated against `school_memberships` (blocks cross-tenant IDOR). No legacy SQLite mode. 5-minute in-memory school cache.
- `backend/app/middleware/auth.py` resolves `current_school_id` from token payload / memberships.
- `backend/app/utils/auth.py:181` places `current_school_id` into JWT `app_metadata`.

**Target State.** A single `TenantContext` object (FastAPI dependency) carrying `{ school_id, role, profile_id, resolved_at, source }`, produced by a dedicated `tenant_context` middleware that runs before routers, rejects requests with no resolvable school (except explicitly anonymous endpoints), and is injected into every service call for new exam modules.

**Dependencies.** Existing auth middleware + JWT claims; `school_memberships`.

**Backend changes.** New `app/middleware/tenant_context.py`; add dependency `get_tenant_context`; keep `supabase_context.py` as the resolver kernel (do not duplicate resolution logic).

**Frontend changes.** None (school is server-derived).

**API changes.** None to existing endpoints. New middleware only; anonymous allow-list (`/readyz`, auth login) explicit.

**Database impact.** None (no schema change).

**Security impact.** Positive — closes any future path that could skip resolution. Must not weaken existing IDOR guards.

**Performance impact.** One extra membership lookup per request, cached (existing 5-min cache). Negligible.

**Backward compatibility.** Fully additive; existing endpoints keep their current school-resolution behavior.

**Risks.** Double-resolution drift (middleware vs `supabase_context.py`) → mitigate by making middleware call the same resolver. Blocked anonymous flows → explicit allow-list + regression tests.

**Acceptance criteria.**
- Every new exam route can `Depends(get_tenant_context)` and gets a validated `school_id`.
- No change to existing Online Tests, Offline Exams, AI, or Question Bank routes.
- Cross-tenant IDOR test suite passes unchanged.

---

### Component 2 — Partitioning Key + New-Table Access (ADR-002)

**Purpose.** Establish `school_id` as the mandatory partitioning/ownership key on every new table, with RLS templates, so multi-tenant data cannot leak. Also seed the `question_bank.*` permission keys that later phases enforce.

**Current State.** Existing tables are unpartitioned and RLS is retrofit work scheduled for Phase 1+. No new-table template exists. `question_bank.*` permission keys do not exist in `permissions`. `exam.*` tables are service-role gated only (no RLS).

**Target State.**
- A checked-in template + generation check: every new migration creating a business table MUST include `school_id uuid not null` (or be explicitly exempted with a reason) plus a default RLS policy block. New tables get `supabase.migrations/` files following the timestamped additive convention (pattern: `005_exam_and_seating.sql`, `003_rbac_extensions`).
- Backfill RLS policies on `exam.*` keyed on an application claim (PostgREST request-context helper `app.current_school_id`); service role keeps bypassing, so no behavior change for the backend.
- Seed `question_bank.*` permission keys (`view, create, edit, delete, import, export, review, approve, publish, withdraw, blueprints, generate, ai, analytics, global, global.copy, license, manage`) into `permissions`, granted to school admin / platform admin.

**Dependencies.** None (standard only).

**Backend/Frontend/API changes.** None at runtime. Development-only.

**Database impact.** New tables only; additive. RLS enabled by default on new tables; RLS backfilled on `exam.*` (service-role-compatible); permission keys seeded; service role remains authoritative.

**Security impact.** Positive — new tables start tenant-safe rather than retrofitted.

**Backward compatibility.** `exam.*` RLS is the only behavioral change and is safe: the service role still bypasses RLS, so existing service-role reads are unaffected. If a regression appears, the policy-adding migration is reverted (reverse migration removes the policies).

**Risks.** Template drift → enforce via a migration review checklist item and a CI lint (grep new migrations for `school_id`).

**Acceptance criteria.**
- New-table migration template documented in `supabase/migrations/` README.
- CI lint flags any new business table missing `school_id` or RLS.
- `question_bank.*` keys present in `permissions` and seeded to school admin / platform admin.
- `exam.*` RLS blocks `authenticated` cross-school reads; service role still reads everything (tests).

---

### Component 3 — Snapshot Framework (ADR-003)

**Purpose.** Provide the capture-at-publish, deliver-immutably model: published exams/questions are snapshotted so later edits can never change what a student already took.

**Current State.** No snapshot mechanism. `online_tests.*` reads live rows; `_score_response` (`supabase_online_tests.py:525`) matches normalized option IDs against live questions.

**Target State.** `app/services/supabase_snapshot.py` exposing `capture(entity_type, entity_id) -> snapshot_id` and `read(snapshot_id) -> dict` backed by `qb_snapshots` (content JSONB + `content_hash`, `snapshot_version`) + `qb_snapshot_items` (item-level frozen artifacts). Consumers in later phases render from `read()`, never from live tables. Immutability enforced by convention + deterministic hash verification; storage is additive.

**Dependencies.** Partitioning Key (C2), Tenant Context (C1).

**Backend changes.** New service + `qb_snapshots`/`qb_snapshot_items` migration (additive, `school_id` partition key, RLS).

**Frontend changes.** None (later phases consume).

**API changes.** Internal service only; no public endpoint in EP-00.

**Database impact.** New additive tables. Index on `(school_id, source_type, source_id, created_at)`.

**Security impact.** Snapshot read must be tenant-scoped (partition key + RLS).

**Performance impact.** Storage growth linear with publish volume; mitigated by content hash (dedupe identical snapshots).

**Backward compatibility.** None needed (no live behavior changes).

**Risks.** Hash mismatch on re-read → deterministic serialization (canonical JSON, sorted keys). Verify in tests.

**Acceptance criteria.**
- `capture()`/`read()` round-trips byte-identical content; `content_hash` is deterministic across runs.
- Same entity + same content → same `content_hash` (dedupe works).
- Mutating the source after capture does not change `read()`.

---

### Component 4 — Question Version Foundation

**Purpose.** Lay immutable version primitives for question/question-bank evolution (edit history, publish→version, revert) so later phases can version questions without rewriting the design.

**Current State.** Question entities exist but unversioned (`qb_*` tables exist with 0 rows; `online_tests.*` live-editable).

**Target State.** `app/services/version_service.py` primitive: `next_version(scope_id, minor=False) -> int` and `record_change(scope_id, version, change)`, backed by `qb_version_events` (append-only log of version actions) + `qb_version_retention_policy` (config: how many versions to keep). `qb_question_versions` already exists and stays untouched in EP-00. No question-model rewrite in EP-00.

**Dependencies.** C1, C2.

**Backend changes.** New service + additive `qb_version_events`/`qb_version_retention_policy` tables.

**Frontend/API changes.** None.

**Database impact.** New additive tables (`school_id` partitioned).

**Security/Performance.** Partitioned read; low volume.

**Backward compatibility.** None required.

**Risks.** Designing ahead of the actual question model → keep primitives generic (scope_id + version int) and defer model-specific rules to Phase 2.

**Acceptance criteria.** `next_version` is monotonic per scope; `record_change` is append-only; retention policy is read by tests; generic enough to serve both question and prompt versioning.

---

### Component 5 — Audit Logging

**Purpose.** Replace ad-hoc per-service `audit_logs` inserts with one governed `AuditLogger` that captures actor, tenant, action, and payload consistently.

**Current State.** `audit_logs` table + write-trigger already exist and are used by `online_tests.*`, `offline_exams.*`, `supabase_ai_agents.py` (`_log_audit_entry`), `ai_credit_engine.py`, and many others via direct `.table("audit_logs").insert(...)`. Platform review UI exists (`routes/platform.py` `list_platform_audit_logs`).

**Target State.** `app/services/audit_logger.py` with `log(*, tenant, actor, action, entity_type, entity_id, payload)` that standardizes columns and always writes `school_id`, plus a `qb_audit_events` idempotent wrapper mirroring the `online_tests.write_audit_log()` pattern and a `qb` module tag on the existing `audit_logs` trigger. Existing call sites migrate gradually (Phase 1+) — **EP-00 ships the logger + tests only**, not a full migration.

**Dependencies.** C1 (tenant/actor from context).

**Backend changes.** New `audit_logger.py`; no changes to existing services in EP-00.

**Frontend/API changes.** None.

**Database impact.** None in EP-00 (table exists). Optionally an additive index if missing.

**Security impact.** Positive — consistent actor/tenant provenance.

**Backward compatibility.** New logger writes identical `audit_logs` schema; existing inserters untouched.

**Risks.** Duplicate convention → audit logger must write the exact columns the trigger expects; verify against a live row sample before rollout (Phase 1 migration).

**Acceptance criteria.** Logger writes a row that satisfies the existing trigger; `list_platform_audit_logs` returns it; payload serializes JSON safely.

---

### Component 6 — AI Provider Interface + Prompt Versioning (ADR-005)

**Purpose.** Make AI calls provider-agnostic and prompt-stable so the system can add providers and reproduce prompt outputs across versions.

**Current State.** `backend/app/services/ai_provider.py` is **Gemini-only**: no interface, `_build_gemini_model` raises "Unsupported AI provider configured", `DEFAULT_MODEL="gemini-2.5-flash"`, hard 45s timeout, quota-aware no-retry. Credit engine + entitlement (`ai_credit_engine.py`) already gate usage. Prompt strings are inline in call sites.

**Target State.**
- `app/services/llm/protocol.py`: `LLMProvider` protocol (`generate_text`, `generate_json`, `chat`, `is_available`) + registry keyed by provider name.
- `app/services/llm/gemini.py`: wraps existing `ai_provider.py` logic behind the protocol (no behavior change).
- `app/services/llm/prompts.py`: central prompt catalog; every prompt keyed + versioned (`PROMPTS["question_generation"]["v2"]`), stored with `prompt_version` metadata.
- `ai_provider.py` becomes a thin facade delegating to the registry, preserving its public function signatures (backward compatible).

**Dependencies.** C5 (audit of AI actions), C1.

**Backend changes.** New `llm/` package; refactor `ai_provider.py` facade; credit engine untouched.

**Frontend changes.** None.

**API changes.** None (function signatures preserved; no endpoint changes).

**Database impact.** None in EP-00 (prompt version metadata can ride on existing `prompt_versions`/audit; add table only if Phase 1 needs it).

**Security impact.** No new secrets; provider config stays env-driven.

**Performance impact.** Identical path to Gemini; protocol adds negligible overhead.

**Backward compatibility.** All existing callers keep working; error messages/quota behavior unchanged.

**Risks.** Refactor regression in AI routes → the facade must be a thin pass-through with the full existing test suite green; `route_retrofit.py` permission gating must still pass.

**Acceptance criteria.**
- `generate_text`/`generate_json`/`chat` behave identically pre/post refactor (contract tests).
- Unsupported provider raises the same error.
- Every prompt in the catalog carries a `prompt_version`; generating with the same version + inputs yields identical output for deterministic prompts.

---

### Component 7 — Background Queue Engine

**Purpose.** Provide a small, durable background-job primitive (scheduled + async) for later phases (offline scoring, bulk generation, exports).

**Current State.** No generic queue. `APScheduler` + `redis` are already in `requirements.txt`; `redis_url` exists in `backend/app/config.py:59-60`. Precedent job tables `ai_agent_jobs` / `ai_teacher_assistant_jobs` exist.

**Target State.** `app/services/queue_engine.py` with `enqueue(job_type, payload, tenant, idempotency_key=None)` + worker loop (APScheduler-backed) storing jobs in a `queue_jobs` table (statuses: `queued|running|succeeded|failed|dead_letter`, `school_id` partition key, retry count, idempotency key with dedupe). No task is wired to it yet — the engine is proven by synthetic tests only.

**Dependencies.** C1, C2.

**Backend changes.** New `queue_engine.py` + additive `queue_jobs` table (dead-letter via status field, no separate table).

**Frontend/API changes.** Internal job-status endpoint only (no public surface).

**Database impact.** New additive table; worker marks jobs via row update (no external broker needed on free plan).

**Security impact.** Jobs must carry `school_id`; execution validates tenant.

**Performance impact.** Polling worker on APScheduler (5s tick); negligible at Phase 0 volume.

**Backward compatibility.** Nothing existing uses it; `APScheduler` import is additive.

**Risks.** Redis absence on Render free plan → design the engine to work **without Redis** (DB-backed queue) and treat Redis as optional accelerator; verify scheduler starts with `redis_url` unset.

**Acceptance criteria.** `enqueue`→`run`→`succeeded` round-trip in tests with no Redis; `failed` + dead-letter path works; idempotency keys dedupe; job row is tenant-scoped.

---

### Component 8 — Feature Flags

**Purpose.** Ship infrastructure behind flags so every later phase can merge dark and toggle safely.

**Current State.** **None.** No feature-flag system exists anywhere.

**Target State.** `app/services/feature_flags.py` with `is_enabled(flag, tenant=None) -> bool` reading from the `system_feature_flags` table (key, enabled, scope: school/platform, metadata), plus env-var fallback for flags not yet in the table. A `useFeatureFlag(key)` hook gates new UI. All Phase 1+ work mounts behind flags.

**Dependencies.** C1.

**Backend changes.** New service + additive `system_feature_flags` table + dev seeding.

**Frontend changes.** `useFeatureFlag(key)` hook reading `GET /system/feature-flags` (app context) with env default fallback.

**API changes.** `GET /system/feature-flags` (app context; per-tenant resolved values). Admin write endpoint deferred to Phase 1 to minimize surface.

**Database impact.** New additive table.

**Security impact.** Flag values are not security boundaries — permission checks remain authoritative (document this).

**Performance impact.** Cached flag reads (short TTL); negligible.

**Backward compatibility.** Defaults to `False`/off for unknown flags; existing behavior untouched.

**Risks.** Flags used as security gates → explicitly prohibited in docs; CI lint reviews flag usage.

**Acceptance criteria.** `is_enabled` returns env default when table empty; per-tenant override wins over global; unknown flag → off; permission checks unaffected; `useFeatureFlag` renders gated UI only when on.

---

### Component 9 — Observability

**Purpose.** Ensure every new module is traceable end-to-end (request, tenant, latency, errors).

**Current State.** `SystemObservabilityEngine` middleware, `RequestProfilerMiddleware` (`slow_threshold_ms=800`), `/readyz` health endpoint, and exception handlers already exist in `backend/app/main.py`. Frontend axios has retry/timeout diagnostics.

**Target State.** Extend request logging to include `school_id` when tenant context resolves; add structured error counts by module; keep `/readyz` as the deploy gate and add `/system/health` extending it with DB/cache/queue checks.

**Dependencies.** C1.

**Backend changes.** Middleware reads tenant context and enriches log lines; `GET /system/health` reports DB, cache, queue health.

**Frontend changes.** None.

**API changes.** `GET /system/health` (additive; `/readyz` unchanged).

**Database impact.** None (structured logs; optionally an additive `observability_events` table only if Phase 1 requires it — not in EP-00).

**Security impact.** Never log token/JWT/sensitive payloads; redaction list enforced in middleware.

**Backward compatibility.** Log format additive.

**Risks.** Log noise → sample slow-path debug logs; keep `/readyz` cheap.

**Acceptance criteria.** A request with resolved tenant logs `school_id`; slow request logs duration; no sensitive fields in logs (regex scan in tests).

---

### Component 10 — Error Handling

**Purpose.** Consistent error taxonomy (4xx validation/forbidden/not-found vs 5xx) so the frontend can react predictably.

**Current State.** Backend exception handlers exist (`http_exception_handler`, `unhandled_exception_handler`, upstream-connection handlers in `main.py`). Frontend axios has retry/timeout helpers (`isRequestCanceled`, `isRequestTimeoutError`, safe retry for 502/503/504).

**Target State.** `app/core/exceptions.py` with typed exceptions (`TenantForbiddenError`, `EntityNotFoundError`, `ValidationError`, `ConflictError`) mapped to stable JSON shapes; frontend `ApiError` normalization in the axios interceptor plus request-id passthrough and error-boundary standardization.

**Dependencies.** C1.

**Backend changes.** New `core/exceptions.py` + handler registration; existing handlers retained.

**Frontend changes.** `api.ts` interceptor normalizes errors into `{ status, code, message, detail }` and passes request-id headers; shared error boundary component.

**API changes.** Error JSON shape becomes stable for new endpoints; existing endpoints unchanged.

**Database impact.** None.

**Backward compatibility.** Existing error shapes untouched.

**Risks.** Double-handling → new exceptions map through the existing handler chain; test that `HTTPException` behavior is unchanged.

**Acceptance criteria.** Each typed exception yields stable status+code; frontend interceptor surfaces `code`; existing error tests pass unchanged.

---

### Component 11 — Repository (Data Access) Standards

**Purpose.** Standardize how services read/write Supabase so new modules don't scatter `.table()` calls.

**Current State.** Services call `_public_table(...)`/`_client().table(...)` directly; patterns vary per file.

**Target State.** Documented repository convention: `app/repositories/` wraps a domain entity behind functions (`get_by_id`, `list_by_tenant`, `insert`, `update`, `delete`), always tenant-scoped, always returning normalized dicts. Phase 1+ modules use repositories; existing services are **not** refactored in EP-00.

**Dependencies.** C1, C2.

**Backend/Frontend/API changes.** Docs + a template repository (e.g., `repositories/_template.py`); no runtime behavior change.

**Database impact.** None.

**Backward compatibility.** None needed.

**Risks.** Standard ignored → Phase 1 review gate enforces it.

**Acceptance criteria.** Template repository + conventions doc exist; CI lint (optional) flags non-repository data access in new modules only.

---

### Component 12 — API Standards

**Purpose.** Stable naming, tagging, and response conventions for all new exam APIs.

**Current State.** Routers registered centrally in `main.py` with `api_prefix`; tags present.

**Target State.** Documented convention: REST nouns, `{api_prefix}/{domain}/...`, consistent pagination envelope, camelCase keys, `application/json`, tags per module. Applied to Phase 1+ routes; no existing route renamed.

**Dependencies.** None.

**Backend/Frontend/API changes.** Convention doc only.

**Backward compatibility.** Existing routes untouched.

**Acceptance criteria.** Convention doc merged; Phase 1 route review checklist references it.

---

### Component 13 — Coding Standards

**Purpose.** A green gate for every PR in later phases.

**Current State.** pytest 7.4 + pytest-cov, Vitest, Playwright, TS 5.2, ruff (if configured). `conftest.py` inserts root into sys.path; `pytest.ini` filterwarnings only.

**Target State.** Enforced per-PR: `ruff` + `mypy` (or agreed checker) + `pytest` + `vitest` + `tsc --noEmit` + `vite build`. Tooling is pinned and documented in an `AGENTS.md`/CONTRIBUTING note.

**Dependencies.** None.

**Backend/Frontend/API changes.** Config only (add ruff/mypy config if absent).

**Backward compatibility.** None needed.

**Risks.** Tooling absent for some languages → pin what exists; do not add new toolchains in EP-00.

**Acceptance criteria.** CI runs the gate on a representative PR; README documents commands.

---

### Component 14 — Testing Standards

**Purpose.** Reusable harnesses so every phase lands with tests, not after them.

**Current State.** pytest + pytest-cov backend; Vitest + Playwright frontend; no tenant-isolation test fixture.

**Target State.** New shared fixtures: `tenant_context` fixture (two tenants with known IDs), `audit_clean` fixture, `feature_flags` reset fixture. A documented matrix: unit (per module), integration (service vs Supabase test project), regression (existing suites must stay green), security (IDOR/cross-tenant), performance (slow-path thresholds).

**Dependencies.** C1, C8.

**Backend changes.** New fixtures in `backend/tests/conftest.py` (additive).

**Frontend changes.** None (frontend harness ready).

**Database impact.** None (test fixtures only).

**Backward compatibility.** None needed.

**Acceptance criteria.** Two-tenant fixture usable by a new test; full suite runs with `pytest` and reports coverage.

---

### Component 15 — Rollback Standards

**Purpose.** Every Phase 1+ change is reversible without data loss.

**Current State.** Additive migration convention + feature flags (once built) + Render deploy pipeline exist.

**Target State.** Documented rollback runbook: (1) feature flag off → (2) additive migration revert (down migration or new forward-fix) → (3) `render.yaml` redeploy previous image. Data is never deleted by migrations; destructive ops are separate reviewed migrations.

**Dependencies.** C8.

**Backend/Frontend/API changes.** Runbook doc + checklist.

**Backward compatibility.** None needed.

**Acceptance criteria.** Runbook covers flag-revert, migration-revert, and deploy-revert; destructive-migration review rule documented.

---

## 3. Task Breakdown

| ID | Description | Priority | Dependencies | Effort | Est. Files | Risk | Rollback | Acceptance Tests | Definition of Done |
|----|-------------|----------|--------------|--------|-----------|------|----------|------------------|--------------------|
| F-001 | Tenant context middleware + `get_tenant_context` dependency; delegate resolution to `supabase_context.py` | Critical | C1 | 3 d | 2 | High | Disable middleware via env flag | Cross-tenant IDOR tests; existing auth suite green | Every new-route dep resolves; no existing route changed |
| F-002 | Anonymous allow-list + regression tests for auth/login/readyz | Critical | F-001 | 1 d | 2 | Med | Remove list entries | Anonymous flows pass | Allow-list minimal; documented |
| F-003 | Partitioning-key template + migration README + CI lint for new tables | High | C2 | 1 d | 3 | Low | Revert lint rule | CI flags missing `school_id` | Template committed; lint runs in CI |
| F-003b | Seed `question_bank.*` permission keys into `permissions` (school admin / platform admin) | High | F-003 | 1 d | 2 | Med | Reverse the seed migration | Keys exist; grant matrix verified | Keys present; RBAC suites green |
| F-003c | Backfill RLS on `exam.*` keyed on `app.current_school_id`; verify service-role bypass | High | F-001 | 2 d | 3 | High | Reverse policy migration | `authenticated` cross-school read blocked; service role unaffected | RLS enforced; existing exam flows green |
| F-004 | `qb_snapshots`/`qb_snapshot_items` migration (additive, RLS) + `supabase_snapshot` capture/read + deterministic hash | Critical | F-001 | 3 d | 3 | Med | Keep migration unapplied; service unreferenced | Round-trip + dedupe + immutability tests | Service contract tested; no caller yet |
| F-005 | `qb_version_events` + `qb_version_retention_policy` migrations + `version_service` primitives | High | F-001 | 2 d | 3 | Low | Unapply migration; service unreferenced | Monotonic version + append-only + retention tests | Primitives proven; no model rewrite |
| F-006 | `audit_logger.py` writing existing `audit_logs` schema + `qb_audit_events` wrapper; validate vs trigger | High | F-001 | 1 d | 2 | Low | Logger unreferenced | Logger row passes existing trigger; platform UI lists it | Column-identical insert proven |
| F-007 | `llm/protocol.py` + `llm/gemini.py`; facade `ai_provider.py`; prompt catalog with versions | Critical | C6 | 3 d | 5 | High | Revert to pre-facade `ai_provider.py` | Contract tests pass; AI route suites green; unsupported-provider error preserved | Identical behavior; prompts versioned |
| F-008 | `queue_jobs` migration + DB-backed queue engine (no Redis) + worker tick + dead-letter + idempotency | High | F-001 | 3 d | 4 | Med | Disable scheduler via config | enqueue→succeeded/failed/dead-letter round-trip without Redis; idempotent dedupe | Engine proven by tests only |
| F-009 | `system_feature_flags` migration + service with env fallback + per-tenant override + `GET /system/feature-flags` + `useFeatureFlag` hook | High | F-001 | 3 d | 4 | Med | Default-off; table empty-safe | Default-off; override wins; unknown flag off; hook gates UI | Flags off by default; permission checks authoritative |
| F-010 | Observability enrichment (school_id in logs, redaction) + `GET /system/health` (DB/cache/queue) | Med | F-001 | 1 d | 2 | Low | Revert middleware enrichment | Logs contain school_id; redaction scan passes; health reports components | No sensitive fields in logs |
| F-011 | `core/exceptions.py` + handlers + axios normalization + request-id passthrough + error boundary | Med | F-001 | 2 d | 4 | Low | Keep old handler chain | Typed exceptions → stable code; old error tests green | Stable JSON error shape |
| F-012 | Repository template + conventions doc | Med | C2 | 1 d | 2 | Low | Doc-only | Template reviewed | Template + review gate note |
| F-013 | API standards doc | Med | — | 1 d | 1 | Low | Doc-only | Doc merged | Phase 1 checklist references it |
| F-014 | Coding-standards gate (ruff/mypy/test/tsc/build) in CI | Med | — | 2 d | 4 | Low | Revert workflow | CI green on representative PR | Gate runs and passes |
| F-015 | Testing fixtures (two-tenant, audit-clean, flag-reset) + matrix doc | High | F-001 | 2 d | 2 | Low | Fixture-only | New fixture-using tests pass | Two-tenant fixture proven |
| F-016 | Rollback runbook + destructive-migration rule | Med | F-008 | 1 d | 1 | Low | Doc-only | Runbook reviewed | Covers flag/migration/deploy revert |

**Sequencing:** F-001 → F-002 → (F-003, F-003b, F-003c) → (F-004, F-005, F-006, F-007 in parallel after F-001) → (F-008, F-009) → (F-010…F-016). Rough total ≈ **40 engineer-days** within the 7-week Phase 0 window (allows buffer for review/CI).

---

## 4. Testing Plan

**Unit.** Per-service: `supabase_snapshot` (round-trip/hash/dedupe), `version_service` (monotonic/append-only/retention), `feature_flags` (default-off/override), `llm/gemini` contract (identical output vs pre-refactor), `queue_engine` state machine with and without Redis + idempotency dedupe.

**Integration.** New-table migrations apply additively on a scratch Supabase project; `audit_logger` insert passes the existing write-trigger and `qb_audit_events` mirrors the `online_tests.write_audit_log()` pattern; tenant middleware resolves against real `school_memberships`; `exam.*` RLS blocks `authenticated` cross-school reads while the service role bypasses; `GET /system/feature-flags` and `GET /system/health` smoke-tested.

**Regression.** Entire existing backend suite (`pytest`) and frontend (`vitest` + `tsc --noEmit` + `vite build`) must stay green — specifically the Online Tests, Offline Exams, AI, and Question Bank suites (the four non-negotiables in the validation checklist).

**Security.** Cross-tenant IDOR tests re-run and pass; new endpoints/services reject foreign `school_id`; redaction scan on observability output; RLS tests under `authenticated` role.

**Performance.** RequestProfiler thresholds unchanged; `/readyz` stays < 100 ms; snapshot capture timing measured on a 100-question fixture.

---

## 5. Validation Checklist (gate to Phase 1)

- [ ] No existing API contract changed (all current suites green).
- [ ] No TypeScript errors (`tsc --noEmit`), no build failures (`vite build`).
- [ ] No permission regression — `permissionMatches`/`canAccess` and `route_retrofit.py` gating behavior identical.
- [ ] No tenant-isolation regression — existing IDOR tests + new two-tenant tests pass.
- [ ] Online Tests still work (create/edit/take/score) unchanged.
- [ ] Offline Exams still work unchanged.
- [ ] AI (tutor, agents, generation, credits) still work; provider facade behavior identical.
- [ ] Question Bank routes still work unchanged.
- [ ] `/readyz` green; Render deploy succeeds.
- [ ] All EP-00 flags default off; no user-visible feature shipped.

---

## 6. Outputs of EP-00

- Tenant context dependency + middleware (extending existing resolver).
- Partitioning-key template + CI lint + `question_bank.*` permission seed + `exam.*` RLS backfill.
- `supabase_snapshot` + `qb_snapshots`/`qb_snapshot_items` tables (ADR-003).
- `version_service` + `qb_version_events`/`qb_version_retention_policy` tables.
- `audit_logger` (column-compatible with existing trigger) + `qb_audit_events` wrapper.
- `llm/` provider protocol + Gemini adapter + versioned prompt catalog (ADR-005).
- DB-backed `queue_engine` (no Redis required) with dead-letter + idempotency.
- `system_feature_flags` service (default-off) + `GET /system/feature-flags` + `useFeatureFlag`.
- Observability enrichment + redaction + `GET /system/health`.
- Typed error exceptions + frontend error normalization + request-id passthrough + error boundary.
- Repository/API/coding/testing/rollback standards docs.
- 18 tasks (F-001…F-016 + F-003b/F-003c), each with rollback and acceptance tests.

EP-00 ships infrastructure only, fully behind flags and additive migrations, with existing Online Tests, Offline Exams, AI, and Question Bank behavior untouched.
