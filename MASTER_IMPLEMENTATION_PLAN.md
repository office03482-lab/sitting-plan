# MASTER IMPLEMENTATION PLAN (MIP)

**Document:** `MASTER_IMPLEMENTATION_PLAN.md`
**Version:** 1.0 (FINAL — the ONLY engineering roadmap)
**Date:** 2026-08-03
**Status:** Engineering execution plan. No code, SQL, migrations, or implementation were created to produce this document.
**Governing inputs (treated as FINAL, not subject to re-design):**
- `QUESTION_BANK_ARCHITECTURE_AUDIT.md`
- `FINAL_EXAMINATION_ARCHITECTURE.md`
- `FINAL_ARCHITECTURE_READINESS_REVIEW.md`
- ADR-001 … ADR-005 (Architecture Decision Records, binding)

**Tooling baseline (verified):** FastAPI 0.104 + SQLAlchemy 2.0 + Alembic 1.12; Supabase/PostgREST via `supabase` SDK 2.15 (service role); Supabase SQL migrations under `supabase/migrations/` (timestamped, additive); React 18 + Vite 5 + TypeScript 5.2 + Vitest + Playwright; pytest 7.4 + pytest-cov; `reportlab` (PDF), `openpyxl` (Excel), `redis` + `APScheduler` (background/cache); Render deployment (`render.yaml`, gunicorn + uvicorn workers). Existing modules of record: `backend/app/routes/question_bank.py`, `supabase_question_bank.py`, `supabase_online_tests.py`, `supabase_offline_exams.py`, `ai_provider.py`, `ai_credit_engine.py`, `route_retrofit.py`, `entitlement_engine.py`; frontend `pages/QuestionBankList.tsx`, `QuestionBuilder.tsx`, `OnlineTests*`, `OfflineExams*`, `components/Layout.tsx`, `contexts/AuthProvider.tsx`.

---

# SECTION 1 — EXECUTIVE SUMMARY

## 1.1 Project Goals

1. **Unify the question bank** — make `qb_questions` the single master source of truth; stop orphan/inline question authoring; link every online-test and offline-exam question back to a bank row via `bank_question_id` (provenance) while preserving frozen delivery snapshots (ADR-003).
2. **Ship a deterministic Blueprint + Paper engine** — blueprint-defined composition (difficulty %, Bloom %, question-type %, marks, NCERT weightage, PYQ %, sets, randomization) producing reproducible papers with per-set variants.
3. **Deliver online + offline examinations on the frozen-snapshot model** — published tests/exams never mutate with bank edits; attempts, resume, autosave, shuffle, timer, negative marking work correctly (Phase 5); offline adds paper editions, answer keys, challenge window, grace marks, re-evaluation (Phase 6, ADR-004).
4. **Stand up an auditable AI authoring platform** behind a real provider interface with prompt versioning and cost control (Phase 7, ADR-005).
5. **Provide question/teacher/student/blueprint/exam analytics** from idempotent rollups (Phase 8).
6. **Support multi-school SaaS** with tenant-scoped access, RLS on new tables, global/school/private/shared scopes, and licensing (Phase 0 tenancy framework + Phase 1 scopes, ADR-001).
7. **Design for scale now** — partition keys decided up front (ADR-002), indexing, caching, background jobs, pagination discipline — targeting 1,000 schools, 100,000 teachers, 10M questions, millions of attempts.

## 1.2 Engineering Principles

| Principle | Meaning in practice |
|---|---|
| **Never break existing functionality** | Every phase keeps existing endpoints, tables, columns, and UI routes working. |
| **Backward compatible, additive only** | New columns/tables/keys/endpoints only. No drops, no renames, no re-types. `online_tests.question_bank` and legacy `/api/exams` remain functional. |
| **Independently deployable phases** | Each phase ships alone, with its own rollback and tests; no large-bang releases. |
| **Snapshot-first delivery** | Published tests/exams freeze their content; bank edits never touch live attempts. |
| **Deterministic generation** | Same blueprint + same seed + same bank state → same paper (QA-verifiable). |
| **Everything audited** | Every create/edit/AI/review/publish decision writes an immutable audit record. |
| **Human-in-the-loop AI** | AI output lands as draft only; publication requires the review chain. |
| **Tenant-scoped by default** | School context comes from the authenticated token, never from client payloads (ADR-001). |
| **Tests before merge** | Unit/integration/API/regression required per phase; load & security tests per schedule. |

## 1.3 Deployment Strategy

- **Environments:** Dev → QA → Staging → Production (Section 14).
- **Schema:** All DB changes shipped as additive Supabase migrations (`supabase/migrations/YYYYMMDD_XXX_*.sql`), applied per environment in order, never edited after merge. Backend data backfills run as idempotent service jobs with verification, not one-way scripts.
- **Backend:** New FastAPI service functions + routes are additive; no existing signature removed.
- **Frontend:** New routes/pages are lazy-loaded and additive; existing navigation untouched (the "Question Bank" sidebar entry is *added*, per audit).
- **No-downtime rule:** every migration is online-safe (no `ALTER ... SET NOT NULL` on populated columns without backfill-first, no table rewrites that lock production). Feature flags gate new UI until backend is live.

## 1.4 Backward Compatibility Strategy

1. Existing tables/columns/indexes are never dropped, renamed, or re-typed.
2. `online_tests.question_bank`, `online_tests.test_questions`, `exam.exam_questions`, legacy `/api/exams`, and online-test question endpoints keep working.
3. New FKs (`bank_question_id`) are nullable with `on delete set null`; old rows unaffected.
4. `public.online_test_question_bank` is preserved as a **compat UNION view** over `qb_questions` with the exact columns clients read; a contract test guards the shape.
5. New `question_bank.*` permission keys are seeded alongside existing `online_tests.*`/`offline_exams.*`; existing roles keep current access.
6. `supabase_api_spec.json` is regenerated when endpoints change.

## 1.5 Risk Management Strategy

- **Risk register maintained per phase** (Section 11 of readiness review is the seed). Each phase lists its top risks, mitigations, and rollback.
- **Rollback doctrine:** schema changes are forward-only (additive); rollback = revert application code to previous deploy + feature-flag off + optional data backfill reversal (never destructive). Data backfills are reversible via undo jobs or snapshot tables.
- **Gate criteria:** a phase ships only when all tests pass, acceptance criteria are met, and rollback is demonstrated in staging.
- **Tenancy risk is handled once at Phase 0** (ADR-001) and is a mandatory review gate for every later phase.

---

# SECTION 2 — IMPLEMENTATION PHASES (OVERVIEW)

| Phase | Name | Objective (short) | Key Dependencies | Complexity | Risk |
|---|---|---|---|---|---|
| **0** | Foundation | Tenancy, permissions, snapshot framework, question-version framework, audit, AI provider interface, background queue, feature flags, observability | None (start) | High | Critical |
| **1** | Question Bank Foundation | Master questions, taxonomy, media, review workflow, search/filters | P0 | High | High |
| **2** | Question Versioning | Immutable versions, draft/published/archive/restore, usage tracking | P1 | Medium | High |
| **3** | Blueprint Engine | Blueprint CRUD, validation, constraint engine, preview | P1 (bank), P2 (versions) | Medium | Medium |
| **4** | Paper Generator | Selection engine, distributions, randomization, variants, freeze | P3 | High | High |
| **5** | Online Test Integration | Replace copied questions with references; freeze published tests; attempt compat | P2, P4 | High | Critical |
| **6** | Offline Exam Integration | Paper editions, answer keys, freeze, challenge window, grace, re-evaluation (ADR-004) | P2, P4 | High | High |
| **7** | AI Platform | Generation, import, OCR, quality, dedupe, translation, improvement (ADR-005) | P0 (AI iface), P1 | High | High |
| **8** | Analytics | Question/teacher/student/blueprint/exam analytics | P5, P6 | Medium | Medium |
| **9** | Import/Export | Excel, Word, PDF, OCR, JSON, backup, restore | P1, P7 | Medium | Medium |

Each phase in Sections 3–12 follows this template: **Objective · Dependencies · Estimated Complexity · Estimated Risk · Database Changes · Backend Changes · Frontend Changes · API Changes · Migration Strategy · Rollback Strategy · Testing Strategy · Acceptance Criteria · Deliverables.**

---

# SECTION 3 — PHASE 0: FOUNDATION

**Objective:** Stand up the platform infrastructure that every other phase depends on. Nothing domain-specific ships here; this phase removes the structural risks identified in the readiness review (tenancy, snapshot, versioning, audit, AI provider, queue, flags, observability).

**Dependencies:** None (pure infrastructure).

**Estimated Complexity:** High · **Estimated Risk:** Critical (tenant isolation + snapshot model affect everything).

### Database Changes
- **[NEW] Tenant-scoped access (ADR-001):** add a PostgREST request-context helper (`app.current_school_id`) that resolves school_id from the authenticated token (portal intent + membership), never from payload. Add RLS policies keyed on an application claim (`auth.jwt() ->> 'school_id'` or a custom `app_claims` helper) to **all new** `qb_*` tables. Backfill RLS on `exam.*` (currently service-role gated only).
- **[NEW] Partition keys (ADR-002):** document and lock the partition strategy: `qb_questions` partitioned by `school_id` hash (global `school_id = NULL` rows isolated in a `global` partition); `online_tests.test_responses` partitioned by `created_at` (monthly) or `test_id` range. New FKs on these tables must include the partition key in the FK columns. No actual partitioning of existing tables in this phase unless a table is empty/new.
- **[NEW] Snapshot framework tables (ADR-003):** `qb_snapshots` + `qb_snapshot_items` (generic frozen content artifact: `source_type`, `source_id`, `snapshot JSONB`, `snapshot_version`, `hash`, `created_at`, `created_by`) — the delivery artifact layer that Phase 4/5/6 will use.
- **[NEW] Question-version framework:** `qb_question_versions` already exists; add `version_retention_policy` config table + `qb_version_events` (append-only log of version actions). Extend `qb_questions` (additive) with `partition_key_hint`, `is_global`, `created_via`, `version_root_id`, `source_question_id`, `origin_school_id`.
- **[NEW] Audit:** add a `qb` module tag to the existing `audit_logs` trigger pattern; create `qb_audit_events` (idempotent wrapper) mirroring the `online_tests.write_audit_log()` pattern.
- **[NEW] Permission keys:** seed `question_bank.*` keys (`view, create, edit, delete, import, export, review, approve, publish, withdraw, blueprints, generate, ai, analytics, global, global.copy, license, manage`).
- **[NEW] Feature flags:** `system_feature_flags` table (key, enabled, scope: school/platform, metadata).

### Backend Changes
- **Tenant context middleware:** `get_current_school()` dependency; a "tenant guard" assertion helper used by every new route; unit-tested.
- **Snapshot service:** `supabase_snapshot.py` — create/read/verify snapshots with content hash.
- **Question-version service:** extend `supabase_question_bank.py` with versioning primitives (create version on content change; retention enforcement).
- **AI provider interface (ADR-005):** define `LLMProvider` protocol + registry; wrap existing `ai_provider.py` Gemini implementation behind it; add model catalog + fallback policy. Keep current Gemini path default.
- **Background queue:** `queue_engine.py` using existing APScheduler + Redis; `enqueue(job_type, payload)`, `poll_jobs`, dead-letter table, idempotency key support.
- **Feature flag service:** `feature_flags.py` helper.
- **Observability:** structured logging middleware; request ID; `metrics.py` (counters/latency) feed to a log sink; `/readyz` extended with queue/DB/cache checks.

### Frontend Changes
- **Permission framework wiring:** extend `AuthProvider.tsx` `canAccess` usage to consume new `question_bank.*` keys (no change to matching logic — it is hierarchical already).
- **Feature-flag hook:** `useFeatureFlag(key)` gating new UI.
- **Error/observability shell:** API client request-id passthrough; error boundary standardization.
- *(No user-visible features.)*

### API Changes
- `GET /system/feature-flags` (app context)
- `GET /system/health` (extended `/readyz`)
- Internal-only endpoints for queue job status.

### Migration Strategy
- Additive migrations only: new tables (`qb_snapshots`, `qb_snapshot_items`, `qb_version_events`, `system_feature_flags`, `qb_audit_events`), new columns on `qb_questions`, seed `question_bank.*` permissions, RLS on `exam.*` + new `qb_*` tables, index additions. All `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.

### Rollback Strategy
- Application rollback: revert backend/frontend to previous deploy; feature flags disable any new behavior.
- Schema: new tables/columns are additive and can be ignored by old code; RLS on `exam.*` is the only behavioral change — it is service-role-compatible (service role still bypasses), so it is safe. If it causes regression, the migration that adds it can be reverted by removing policies (reverse migration documented).

### Testing Strategy
- Unit: tenant-context resolution; tenant guard (positive/negative); snapshot hash/verify; version retention; feature-flag service; LLM provider registry.
- Integration: RLS actually blocks cross-school reads on new tables when using an `authenticated` role; snapshot create→verify round trip.
- API: `/system/*` smoke; permission key seed present.
- Regression: full existing `backend/tests` suite + `frontend` `tsc`/`vitest` suite green.

### Acceptance Criteria
1. `get_current_school()` derives school from token only; a forged payload school_id is rejected (test exists).
2. New `qb_*`/snapshot tables have RLS policies that enforce tenant isolation under an `authenticated` role.
3. Snapshot create→read→hash-verify round trip passes; snapshot content hash is deterministic.
4. LLMProvider registry returns Gemini by default; a stub provider can be registered in tests.
5. Queue can enqueue → run → record → dead-letter; idempotency keys dedupe.
6. `question_bank.*` permission keys exist in `permissions` and are seeded to school admin/platform admin.
7. `/readyz` reports DB, cache, queue health.
8. Full regression suite green.

**Deliverables:** tenant-context middleware + guard, snapshot service, version primitives, AI provider interface, queue engine, feature-flag service, observability middleware, permission seed, RLS on new tables, README for infra usage.

---

# SECTION 4 — PHASE 1: QUESTION BANK FOUNDATION

**Objective:** Bring the existing (empty) `qb_questions` bank to life as the master source of truth: taxonomy, media, review workflow, search/filters, multi-school scopes, and the missing sidebar navigation.

**Dependencies:** P0 (tenancy, permissions, audit, queue).

**Estimated Complexity:** High · **Estimated Risk:** High.

### Database Changes
- **[NEW] Extend `qb_questions` (additive):** `bloom_taxonomy`, `ncert_chapter_id`, `exam_tags JSONB`, `multiple_correct`, `difficulty_predicted`, `difficulty_calibrated`, `is_global`, `created_via`, `version_root_id`, `source_question_id`, `origin_school_id`, `question_code` generator sequence.
- **[NEW] `qb_question_media`:** `id, school_id, question_id FK, asset_type, bucket, storage_path, public_url, alt_text, width, height, mime_type, size_bytes, provenance, is_active, deleted_at, created_by, created_at`.
- **[NEW] `qb_question_shares`:** explicit teacher/group grants (`shared_with_role_id`/`shared_with_profile_id`, `permissions`, `created_by`, `expires_at`).
- **[NEW] `qb_question_families`:** AI-variant grouping.
- **[NEW] Taxonomy bridge:** index/lookup between `qb_taxonomy_nodes` and ERP `public.subjects`/`batches` (reconciled reference), plus `ncert_chapters` catalog table (additive).
- **[NEW] Exact-duplicate guard:** `qb_question_hashes` (`normalized_prompt_hash` unique per `school_id`) — cheap deterministic dedupe baseline.
- **[NEW] Indexes:** `qb_questions` on `(school_id, status, exam_type_slug)`, `(school_id, subject_id)`, `(school_id, difficulty_level)`, `(school_id, bloom_taxonomy)` partial `WHERE deleted_at IS NULL`; GIN on `tags`/`metadata`; trigram on `prompt_text`.
- **[NEW] Review tables:** `qb_review_requests`, `qb_review_comments`, `qb_review_checklist`, `qb_review_checklist_items`, `qb_question_reviews`.

### Backend Changes
- Extend `supabase_question_bank.py` CRUD with: Bloom/NCERT/exam-tag fields, media attach/list/delete, exact-duplicate check, multi-school scope resolution (global vs school vs private vs shared), effective-owner rule (`question_bank.edit` = own → created_by/school/visibility resolution).
- **Review service:** submit for review, assign, approve/request-changes/reject, checklist completion, bulk approve, emergency withdraw.
- **Media service:** upload → bucket `qb-question-media`, record row, signed URL; orphan sweep job.
- **Search service:** FTS + trigram query builder (allowlisted columns), pagination, filters (exam type, subject, chapter, topic, difficulty, Bloom, type, status, source, tags, language, NCERT, visibility, created-by, date).
- **Seed NEET/JEE/State-board exam types + starter taxonomy** per school (additive, on-demand).

### Frontend Changes
- **Add "Question Bank" sidebar entry** in `components/Layout.tsx` `rawSections` (fixes the audit-identified navigation gap) with permission `question_bank.view`.
- Expand `QuestionBankList.tsx`: new filter bar (Bloom/NCERT/exam-tag/visibility), status chips, usage column, duplicate badge, favorites/recent/recently-used smart lists.
- Expand `QuestionBuilder.tsx`: Bloom selector, NCERT/exam-mapping chips, media upload per question, share dialog, submit-for-review action.
- New **Review Inbox** page (assignments, checklist, comments, approve/reject/changes, bulk approve).
- Wire `VersionHistory.tsx` to real version APIs (display + restore).

### API Changes
- `GET/POST/PUT/DELETE /question-bank/questions` (extended fields/filters)
- `GET /question-bank/questions/{id}/media`, `POST .../media`, `DELETE .../media/{id}`
- `POST /question-bank/questions/{id}/duplicate`, `/publish`, `/archive`, `/withdraw`
- `POST /question-bank/questions/{id}/share`, `DELETE .../share/{id}`
- `POST /question-bank/questions/dedupe-check`
- `POST /question-bank/reviews/assign`, `GET /question-bank/reviews/inbox`, `POST /question-bank/reviews/{id}/approve|request-changes|reject`, `POST /question-bank/reviews/bulk-approve`
- `GET /question-bank/taxonomy`, `POST /question-bank/taxonomy/nodes`
- `GET /question-bank/search` (combined filters)

### Migration Strategy
- Additive migrations for new columns/tables/indexes/seed data; `qb_question_hashes` backfilled from any existing rows (none today) then enforced going forward. Compat UNION view `online_test_question_bank` created (Phase 1 or P5) with contract test.

### Rollback Strategy
- Feature-flag the new sidebar entry and Review Inbox; disabling returns to previous UX.
- New endpoints/columns additive; old code ignores them.
- `qb_question_hashes` enforcement is soft in this phase (warn, not block) to guarantee no regression.

### Testing Strategy
- Unit: scope resolution (global/school/private/shared), effective-owner, dedupe hash, media signing.
- Integration: RLS cross-school read blocked; share grant/revoke visibility; review chain transitions (draft→review→approved→published→archived→withdrawn→rejected).
- API: full question CRUD + filters + search; bulk approve; withdraw.
- Regression: existing online/offline test flows unchanged; `QuestionBuilder` legacy test-mode path still works.
- Frontend: vitest for filters/reducers; playwright smoke for bank list + review inbox.

### Acceptance Criteria
1. Teacher can create a draft question with taxonomy, Bloom, NCERT, media, tags; it lands in `qb_questions`.
2. Question becomes visible to school peers only after visibility=school or explicit share; cross-school read is blocked at DB level.
3. Exact-duplicate check flags an identical prompt (same school) before insert.
4. Review chain completes: submit → assign → checklist → approve → published; reject/request-changes round-trip works; bulk approve works.
5. Media upload → record → signed URL → delete works; orphan sweep removes unreferenced assets.
6. Sidebar "Question Bank" entry visible for users with `question_bank.view`; direct URL `/question-bank` still works.
7. Search returns correct filtered/paginated results; allowlisted filters cannot inject PostgREST operators.
8. Full regression suite green.

**Deliverables:** live master bank CRUD + media + taxonomy bridge, review inbox UI, search/filters, share/scope model, duplicate guard, sidebar navigation, seed content.

---

# SECTION 5 — PHASE 2: QUESTION VERSIONING

**Objective:** Immutable, auditable question versions with draft/published/archive/restore and usage tracking — the foundation for safe paper generation and snapshot delivery.

**Dependencies:** P1.

**Estimated Complexity:** Medium · **Estimated Risk:** High (version integrity is correctness-critical).

### Database Changes
- **[NEW]** Extend `qb_question_versions` (exists) with `version_root_id`, `immutable_hash`, `status_at_version`; add index `(question_id, version DESC)` (exists) + `(version_root_id, version)`.
- **[NEW] `qb_question_usage`:** `question_id, source_type (test|exam|paper), source_id, school_id, used_at, snapshot_hash` — replaces/absorbs the dead `qb_bank_test_links` role; add FK target handling.
- **[NEW] Retention:** version retention policy config (keep N versions + annual archive) + `qb_version_events` (append-only).

### Backend Changes
- Versioning rules in `supabase_question_bank.py`: content change → new version (immutable snapshot + hash); metadata/status change → same version. 
- **Restore service:** restore a version → creates a new version with `change_summary='restored from vN'` (never mutates history).
- **Usage service:** record every paper/test/exam link as `qb_question_usage`; count usage; expose usage stats.
- **Retention job:** archive old versions per policy; never delete.

### Frontend Changes
- Activate `VersionHistory.tsx` restore (real API call + confirmation + diff view).
- Question detail: version list, immutable badge, "used in N papers/tests".

### API Changes
- `GET /question-bank/questions/{id}/versions`
- `POST /question-bank/questions/{id}/versions/{version}/restore`
- `GET /question-bank/questions/{id}/usage`
- `GET /question-bank/questions/{id}/versions/{version}/diff` (optional)

### Migration Strategy
- Additive columns + new tables; backfill `qb_question_versions` rows (none today) — nothing to migrate; `qb_question_usage` starts empty and accrues going forward. `qb_bank_test_links` left untouched (dead) or repurposed by data team per ADR — document decision in code comment.

### Rollback Strategy
- Version APIs additive; restore is a new-version operation (old code unaffected).
- Retention job is disabled via feature flag if it misbehaves.

### Testing Strategy
- Unit: content-edit bumps version, metadata-edit does not; restore creates new version; hash immutability (tamper detection).
- Integration: version lineage across copy/edit; usage recorded on link; retention archives without deleting.
- API + regression.

### Acceptance Criteria
1. Editing question text/options/answer produces a new immutable version with hash; editing status does not.
2. Restore produces a new version labelled "restored from vN" and leaves history intact.
3. Every paper/test/exam link records `qb_question_usage`; `GET .../usage` returns correct counts.
4. Retention job archives per policy without data loss; archival is reversible.
5. Regression suite green.

**Deliverables:** immutable versioning with hash, restore (UI + API), usage tracking, retention job.

---

# SECTION 6 — PHASE 3: BLUEPRINT ENGINE

**Objective:** Blueprint CRUD, validation, constraint engine, and preview — the contract between syllabus planning and paper generation.

**Dependencies:** P1 (bank), P2 (versions).

**Estimated Complexity:** Medium · **Estimated Risk:** Medium.

### Database Changes
- **[NEW] `qb_blueprints`** (`school_id, created_by, name, slug, exam_type_slug, paper_format, total_marks, duration_minutes, total_questions, negative_marking_flag, pass_marks, language, status, version, is_template, metadata, is_active, deleted_at, timestamps`).
- **[NEW] `qb_blueprint_sections`** (section_name, display_order, subject_id, question_type, question_count, marks_per_question, negative_marks, fixed_questions JSONB, source_bank_scope).
- **[NEW] `qb_blueprint_rules`** (rule_type, distribution JSONB: difficulty %, Bloom %, question-type %, marks, NCERT weightage, PYQ %).
- **[NEW] `qb_blueprint_versions`** (snapshot per save).

### Backend Changes
- Blueprint CRUD service + validation service (sums to 100%, section totals == total_marks, exclusions/locks consistent).
- **Constraint engine:** evaluate a blueprint against the bank (coverage per chapter/topic, availability of types/difficulty) → report.
- **Preview:** dry-run composition (no persistence) returning projected distribution vs blueprint targets.
- Template seeding: NEET / JEE-Mains / JEE-Adv / CBSE / State boards (`is_template=true`).

### Frontend Changes
- New **Blueprint Builder** 5-step wizard (identity → sections → distributions → rules → AI review/save), as per `FINAL_EXAMINATION_ARCHITECTURE.md` §2.4.
- Blueprint list/detail/duplicate/version history UI; coverage preview bars.

### API Changes
- `GET/POST/PUT /question-bank/blueprints`
- `GET /question-bank/blueprints/{id}`, `/duplicate`, `/versions`, `/validate`, `/preview`
- `GET /question-bank/blueprints/templates` (platform templates)

### Migration Strategy
- Additive new tables + template seed rows.

### Rollback Strategy
- Blueprints are new features; feature-flag off → invisible. No impact on existing flows.

### Testing Strategy
- Unit: validation rules (percent sums, totals, exclusions win, locks type-compatible).
- Integration: constraint-engine report correctness on seeded bank.
- API + frontend wizard flow (vitest/playwright).

### Acceptance Criteria
1. Blueprint create/edit/duplicate/version works; save bumps version.
2. Validation rejects invalid compositions (e.g., difficulty sum ≠ 100%, section totals mismatch) with clear messages.
3. Preview shows difficulty/Bloom/NCERT coverage vs targets from a seeded bank.
4. Template blueprints load for NEET/JEE; school copy-then-edit works.
5. Regression green.

**Deliverables:** blueprint CRUD + validation + constraint engine + preview + wizard UI + templates.

---

# SECTION 7 — PHASE 4: PAPER GENERATOR

**Objective:** Deterministic paper generation from blueprints with difficulty/Bloom/NCERT distribution, randomization, per-set variants, and freeze.

**Dependencies:** P3.

**Estimated Complexity:** High · **Estimated Risk:** High (correctness of selection + reproducibility).

### Database Changes
- **[NEW] `qb_papers`** (`school_id, blueprint_id, blueprint_version, name, exam_type_slug, seed, total_marks, duration_minutes, status (generated|frozen|archived), language, created_by, created_at, frozen_at`).
- **[NEW] `qb_paper_questions`** (paper_id, set_label, section_id, question_id, display_order, marks, negative_marks, shuffle_order, snapshot JSONB of question, immutable hash).
- **[NEW] `qb_paper_snapshots`** (ADR-003 full freeze: question content snapshot per paper, so the bank can never mutate a generated paper).

### Backend Changes
- **Selection engine:** deterministic, constraint-satisfaction selection from bank respecting blueprint rules (difficulty buckets, Bloom buckets, NCERT weights, PYQ bias, exclusions, locks, duplicate-across-sections/sets policy). Seeded RNG (paper seed + set index).
- **Reservation:** atomic claim of selected questions during generation to prevent double-use in concurrent generations.
- **Variant generation:** per-set selections (A/B/C/D) from same blueprint; options shuffle consistent with keys.
- **Freeze:** on freeze, snapshot all questions into `qb_paper_snapshots`; paper immutable afterwards.
- **Push endpoints:** push frozen paper → online test object / offline exam object (Phase 5/6 consume).

### Frontend Changes
- New **Paper Generator** screen: pick blueprint → configure seed/sets/exclusions/locks → Generate Preview (dry-run) → Generate → Preview per set → Freeze → Export PDF → Push to Online Test/Offline Exam.
- Composition dashboard (bars vs targets).

### API Changes
- `POST /question-bank/papers/generate` (blueprint_id, seed, sets, exclusions) → paper
- `GET /question-bank/papers`, `GET /question-bank/papers/{id}` (per-set preview)
- `POST /question-bank/papers/{id}/freeze`
- `POST /question-bank/papers/{id}/push-online-test`, `/push-offline-exam`
- `POST /question-bank/papers/{id}/export`

### Migration Strategy
- Additive new tables; no existing data touched.

### Rollback Strategy
- Papers are new artifacts; disabling the feature (flag) does not affect existing online/offline flows. Freeze is irreversible by design (new paper instead) — documented.

### Testing Strategy
- Unit: determinism (same seed+blueprint+bank → identical paper), difficulty/Bloom/NCERT distribution accuracy vs targets, exclusion/lock respect, no duplicate across sets, atomic reservation under concurrency.
- Integration: freeze → snapshot immutability (bank edit does not change paper).
- API + frontend generator flow.

### Acceptance Criteria
1. Generating twice with the same seed yields identical papers; different seeds differ.
2. Selected questions meet difficulty/Bloom/NCERT distribution within tolerance (configurable, default ±5%).
3. Exclusions and locks always respected; duplicate-across-sets policy enforced.
4. Concurrent generations from the same pool never double-select a question.
5. Freeze snapshots content; subsequent bank edits do not alter the frozen paper.
6. Set variants A/B/C/D produced; options shuffle consistent with keys.
7. Push-to-test/exam and PDF export produce valid artifacts.
8. Regression green.

**Deliverables:** deterministic paper generator, variant generation, freeze/snapshot, push + export integration.

---

# SECTION 8 — PHASE 5: ONLINE TEST INTEGRATION

**Objective:** Replace copied/inline questions with bank references + frozen delivery snapshots; freeze published tests; keep existing attempts fully compatible.

**Dependencies:** P2, P4.

**Estimated Complexity:** High · **Estimated Risk:** Critical (must not break live tests).

### Database Changes
- **[NEW]** `bank_question_id UUID` (nullable, `on delete set null`) on `online_tests.test_questions` (additive).
- **[NEW] `online_tests.test_snapshots`** or reuse `qb_paper_snapshots`: frozen question content per published test (`test_id, section_id, question_id, snapshot JSONB, hash`).
- **[NEW]** `test_version` column on `online_tests.tests` (increments on publish/re-publish).
- **[NEW] Indexes** on new FKs + partial indexes.

### Backend Changes
- **Publish flow:** on publish → snapshot all test questions into the snapshot table; `test_version++`; bank edits afterward never mutate delivered content.
- **Authoring path:** teacher may author directly into test (existing behavior preserved) — the question is also back-written/linked to the bank (`qb_questions` row + `bank_question_id`) so no orphan questions exist; or select from bank/paper (new path).
- **Shuffle (server-side):** seeded per-attempt shuffle honoring `shuffle_questions`/`shuffle_options`; options shuffle consistent with keys (ADR from readiness review §2.3).
- **Scoring:** extend `_score_response` for assertion_reason, match_following, integer ranges, multi-correct partial credit policy.
- **Attempt compatibility:** existing attempts/responses/results untouched; new attempts read from snapshot.
- **Timer:** server-authoritative with drift tolerance + grace (configurable).
- **Concurrency:** submit idempotency (key on attempt+request), `max_attempts` enforced at DB (unique partial index).

### Frontend Changes
- Test builder: "Generate from Blueprint/Paper" source path; bank-question picker with version display.
- Test take: display snapshot content; resume restores responses/time; section-lock UI; negative-marking display.
- Results: unaffected views; add "from bank vN" provenance chip.

### API Changes
- Extend existing online-test endpoints to accept `bank_question_id` and paper-source.
- `POST /online-tests/{id}/generate-from-paper`
- `GET /online-tests/{id}/snapshot` (internal/delivery)
- Keep all existing endpoints unchanged.

### Migration Strategy
- Additive: new column + snapshot tables; **backfill** existing 19 `test_questions` into `qb_questions` (idempotent, hash-verified) and set `bank_question_id`; published tests get a snapshot generated at migration time so they remain frozen.

### Rollback Strategy
- Feature-flag the new authoring paths; legacy authoring and existing publish flow remain the default until flag on.
- `bank_question_id` nullable; old rows null; snapshot creation is additive.
- If snapshot-on-publish breaks anything, revert to legacy publish (snapshot table unused).

### Testing Strategy
- Regression: all 11 existing tests, 4 attempts, 4 results render identically before/after.
- Integration: publish freezes content; bank edit post-publish does not change student view; resume/autosave/shuffle/timer/negative-marking behaviors; submit idempotency; max_attempts race.
- Scoring: new question types scored correctly incl. partial credit.
- Load: concurrent attempts on one test.

### Acceptance Criteria
1. Published tests are frozen: bank edits do not alter delivered questions.
2. All existing attempts/results/reports remain byte-identical in behavior.
3. Every inline question created going forward is linked to a bank row (no orphans).
4. Server-side shuffle + option-key consistency verified.
5. New question-type scoring correct (assertion/reason, match, integer, multi-correct).
6. Submit double-click idempotent; max_attempts race blocked.
7. Resume/autosave/timer/grace pass integration tests.
8. Regression green.

**Deliverables:** bank-linked tests, frozen publish snapshots, server shuffle, extended scoring, concurrency hardening, attempt compatibility verified.

---

# SECTION 9 — PHASE 6: OFFLINE EXAM INTEGRATION

**Objective:** Paper editions, per-set answer keys, freeze, challenge window, grace marks, and re-evaluation (ADR-004).

**Dependencies:** P2, P4.

**Estimated Complexity:** High · **Estimated Risk:** High.

### Database Changes
- **[NEW] `bank_question_id`** on `exam.exam_questions` (additive, nullable, `on delete set null`).
- **[NEW] `exam.exam_snapshots`** (frozen question content per exam).
- **[NEW] `exam.answer_keys`** (exam_id, set_label, key JSONB, key_version, hash, published_at, changed_by).
- **[NEW] `exam.grace_marks`** (exam_id, section_id/question_id, policy, amount, reason, granted_to scope).
- **[NEW] `exam.re_evaluation_requests`** (exam_id, student_id, question refs, status, decision, result_delta, reviewer).
- **[NEW] `exam.challenges`** (challenge window open/close, per-question challenge, admin decision, result correction).
- **[NEW] Indexes** on new FKs.

### Backend Changes
- **Paper editions:** offline exam consumes a frozen paper; `set_labels` hold per-set question refs (existing schema supports).
- **Answer keys:** generate per-set key sheets; key versioning + hash; answer-key change → re-score policy (recompute affected attempts with full audit; grace if beneficial).
- **Re-evaluation:** request → review → decision (marks change) → result correction with audit; delta logged.
- **Grace marks:** apply policy per section/question; recompute results + ranks.
- **Challenge window:** open/close; student submissions; admin decisions; corrections.
- **OMR:** template export (Phase 9) + import path.

### Frontend Changes
- Offline exam details tabs: add Answer Keys, Re-evaluation, Challenges, Grace.
- Evaluation grid gains re-evaluation actions and key-version banner.

### API Changes
- `POST /offline-exams/{id}/generate-from-paper`
- `GET /offline-exams/{id}/answer-keys`, `POST /offline-exams/{id}/answer-keys/{keyId}/publish`
- `POST /offline-exams/{id}/re-evaluation-requests`, `GET .../re-evaluation-requests`, `POST .../decide`
- `POST /offline-exams/{id}/grace`, `POST /offline-exams/{id}/challenges/{id}/decide`

### Migration Strategy
- Additive; backfill existing exam (1 exam, 0 questions) — trivial; snapshot generation for any published exam.

### Rollback Strategy
- Feature-flag new offline features; legacy offline flow untouched.
- Re-scoring operations are journaled (new results rows, prior results preserved).

### Testing Strategy
- Unit: key change → re-score correctness + grace beneficial policy; re-evaluation delta; challenge window enforcement.
- Integration: freeze → key change → student results recomputed with audit trail; ranks recalculated.
- API + regression.

### Acceptance Criteria
1. Offline exam from frozen paper with sets A/B/C/D and per-set answer keys.
2. Answer-key change triggers versioned re-score with audit; results/ranks correct.
3. Re-evaluation requests flow to decision → result correction with delta log.
4. Grace marks apply per policy and recompute results.
5. Challenge window enforces open/close.
6. Regression green.

**Deliverables:** offline paper editions, answer-key lifecycle, re-evaluation, grace, challenge window.

---

# SECTION 10 — PHASE 7: AI PLATFORM

**Objective:** Auditable AI authoring behind the real provider interface (ADR-005): generation, import, OCR, quality check, duplicate detection, translation, improvement — all landing as drafts.

**Dependencies:** P0 (AI interface), P1.

**Estimated Complexity:** High · **Estimated Risk:** High.

### Database Changes
- **[NEW] `ai_question_jobs`:** `school_id, requested_by, job_type, provider, model_id, prompt_template_id, prompt_template_version, input_payload, output_question_ids, status, error, credits_spent, tokens, cost, idempotency_key, created_at, completed_at`.
- **[NEW] `ai_prompt_templates`:** `template_key, version, provider, template_text, params_schema, created_by, is_active`.
- **[NEW] `ai_question_audit`:** per-question AI actions (type, model, prompt version, accepted/rejected).
- **[NEW] Cost/budget:** `ai_budgets` (per school/per user daily cap) + usage ledger (extend credit engine).

### Backend Changes
- **AI service:** `ai_question_service.py` — single/batch generation into bank (draft), schema validation, semantic dedupe (embeddings), quality check, translation, improvement, expansion.
- **Provider interface enforcement:** all AI calls through `LLMProvider`; model catalog; fallback.
- **Prompt versioning:** every job records template + version; templates immutable once used.
- **OCR/PDF/Word/Excel → questions:** parse pipelines (Phase 9 shares import infra).
- **Dedupe:** semantic (vector similarity) + exact hash; threshold config; scoped to school/global.
- **Budget enforcement:** per-school/per-user daily caps enforced before enqueue (beyond credit engine).
- **Partial-batch handling:** per-item job results; retry only failed items; credit refund for failed items.

### Frontend Changes
- Wire `AIGenerator.tsx`, `OCRPanel.tsx`, `PDFImportPanel.tsx` to real endpoints (replacing simulated paths).
- **AI Studio:** generate batch into chapter/topic at difficulty; preview drafts; accept/reject; view audit.
- AI budget display per user/school.

### API Changes
- `POST /question-bank/ai/jobs` (generate/import/ocr/translate/improve), `GET /question-bank/ai/jobs/{id}`
- `POST /question-bank/questions/validate`, `/dedupe-check`
- `GET /question-bank/ai/budget`

### Migration Strategy
- Additive tables; prompt templates seeded; existing `ai.generated_papers` unchanged.

### Rollback Strategy
- AI endpoints additive; feature-flag AI Studio; simulated panels remain as fallback until wiring verified.

### Testing Strategy
- Unit: prompt version immutability; job audit fields complete; budget cap enforced; partial failure retry + refund.
- Integration: batch generation lands as drafts with correct taxonomy/difficulty; dedupe flags duplicates; translation preserves answer semantics.
- Security: prompt-injection payloads contained (untrusted content delimited; no autonomous action from model output).
- Cost: mock provider tokens recorded; budgets respected.

### Acceptance Criteria
1. All AI output lands as draft; nothing auto-publishes.
2. Every AI action records provider, model, prompt template + version, tokens, cost, and idempotency key.
3. Semantic + exact dedupe flags duplicates within scope before insert.
4. Batch partial failure: failed items retried independently; refunds correct.
5. Per-school/per-user daily AI budget enforced.
6. Real OCR/PDF/Word/Excel import produces structured draft questions.
7. Regression green (simulated panels replaced without breaking bank flow).

**Deliverables:** AI authoring platform (generation/import/OCR/quality/dedupe/translation/improvement), prompt versioning, budgets, audit.

---

# SECTION 11 — PHASE 8: ANALYTICS

**Objective:** Question, teacher, student, blueprint, and exam analytics from idempotent rollups.

**Dependencies:** P5, P6.

**Estimated Complexity:** Medium · **Estimated Risk:** Medium.

### Database Changes
- **[NEW] `qb_question_stats`:** `question_id, school_id, usage_count, attempts, correct_count, accuracy, avg_time_seconds, discrimination_index, difficulty_calibrated, updated_at`.
- **[NEW] `qb_topic_coverage`:** per (school, subject, chapter/topic, exam) counts + coverage %.
- **[NEW] `analytics.question_bank_analytics`:** precomputed dashboard aggregates (daily bucket).
- **[NEW] `analytics.teacher_analytics`** and extend `warehouse.fact_tests` as BI base.

### Backend Changes
- **Rollup jobs** (idempotent, daily + post-eval): update `qb_question_stats` from `test_responses`/`evaluations`; discrimination & calibration computation.
- **Analytics APIs:** question quality, teacher performance, student weak topics (reuse `analytics.topic_performance`), blueprint coverage, exam statistics, AI-vs-human breakdown.
- **Aggregation strategy (ADR):** aggregate tables + idempotent jobs + daily buckets; materialized views only for small dimensions; dashboards never query live response tables.

### Frontend Changes
- New **Question Analytics** page with dashboards (Phase 8 of architecture doc): quality, usage, weak/strong, difficulty accuracy, Bloom/NCERT coverage, teacher performance, AI-vs-human, exam stats, student weak topics.

### API Changes
- `GET /question-bank/analytics/question-quality`, `/usage`, `/coverage`, `/teacher`, `/ai-vs-human`
- `GET /question-bank/analytics/exam-stats`, `/student-weak-topics`

### Migration Strategy
- Additive tables; initial rollup from existing 4 results (tiny); going forward incremental.

### Rollback Strategy
- Analytics new feature; flag off → hidden. No impact on core flows.

### Testing Strategy
- Unit: discrimination index math; difficulty calibration buckets; idempotent rollup (re-run same data → same results).
- Integration: analytics reflect a test result within the job cycle.
- API + dashboard smoke.

### Acceptance Criteria
1. Question stats accurate after a scored test; recalibration reflects observed accuracy.
2. Dashboards load from rollups (no ad-hoc GROUP BY over live response tables).
3. Teacher/student/blueprint/exam dashboards populated correctly for seeded data.
4. Rollup job idempotent; re-running does not double-count.
5. Regression green.

**Deliverables:** question intelligence rollups, 7 dashboards, calibration.

---

# SECTION 12 — PHASE 9: IMPORT/EXPORT

**Objective:** Excel, Word, PDF, OCR, JSON import/export plus backup/restore and question packages.

**Dependencies:** P1, P7.

**Estimated Complexity:** Medium · **Estimated Risk:** Medium.

### Database Changes
- **[NEW] `qb_import_jobs`**, **[NEW] `qb_export_jobs`**: async job tracking (`school_id, format, status, file_key, row_stats, error, created_by, created_at`).
- **[NEW] `qb_packages`:** question-package registry (manifest, media zip, version, provenance).

### Backend Changes
- **Import pipeline (uniform):** upload → validate headers/schema → normalize → dedupe (exact + semantic) → taxonomy auto-suggest → preview (accept/reject/repair rows) → commit as drafts → notify. Never auto-publishes.
- **Export pipeline (uniform):** select scope (bank subset/paper/blueprint) → background job → signed download URL → notify.
- Formats: Excel (`openpyxl`), PDF (`reportlab`), Word (.docx), OCR (Phase 7 infra), JSON (canonical package), `.qbpackage` (zip: JSON + media).
- **Backup/Restore:** per-bank/per-blueprint/per-paper package backup and restore; school-scoped; idempotent restore.

### Frontend Changes
- New **Import/Export Center** page: upload with preview table (per-row status), download manager, package list.

### API Changes
- `POST /question-bank/import` (+ `GET /question-bank/import/jobs/{id}`)
- `POST /question-bank/export` (+ `GET /question-bank/export/jobs/{id}/{download}`)
- `POST /question-bank/packages`, `GET /question-bank/packages/{id}/download`, `POST /question-bank/packages/restore`

### Migration Strategy
- Additive tables only.

### Rollback Strategy
- Import/export new features; flag off → hidden. Import is preview-first (no auto-commit); safe.

### Testing Strategy
- Unit: Excel/JSON round-trip fidelity; PDF layout smoke; Word/OCR parse sample files.
- Integration: import → preview → commit as drafts; export job → signed URL.
- Security: malicious workbook (formula/macro) rejected; oversized files rejected; path traversal blocked.
- Regression.

### Acceptance Criteria
1. Excel/JSON/Word/PDF/OCR imports land as drafts with per-row status; nothing auto-publishes.
2. Export produces valid files for each format; job async with signed download.
3. `.qbpackage` round-trip preserves questions + media + provenance.
4. Backup/restore of a bank is school-scoped and idempotent.
5. Malicious/oversized files rejected with clear errors.
6. Regression green.

**Deliverables:** import/export center, 5 format pipelines, packages, backup/restore.

---

# SECTION 13 — TESTING PLAN

| Test type | Scope | Tooling | Run at |
|---|---|---|---|
| **Unit** | Services (tenant, snapshot, versions, blueprint validation, selection engine, scoring, rollups, AI budget/prompt) | pytest | per phase, CI |
| **Integration** | RLS tenancy, review chain, publish-freeze, re-score, share revoke, dedupe, queue jobs | pytest (service-role + authenticated-role clients) | per phase, CI |
| **API** | All new endpoints + backward-compat contract tests (incl. `online_test_question_bank` view shape) | pytest + httpx against running app | per phase, CI |
| **Regression** | Full existing suite: `backend/tests/*`, `frontend` `tsc`, vitest, eslint | pytest, tsc, vitest, eslint | every phase gate |
| **Load** | Concurrent attempts on one test; paper generation concurrency; 10k-question bank search; response-table growth | locust/scripted (Playwright load) | before Phase 5 & Phase 4 GA; Phase 9 hardening |
| **Security** | PostgREST filter injection (allowlist bypass), tenant leak, file upload (macro/oversize/path), prompt injection, rate limits, RLS | pytest security cases + manual | Phase 0 (foundation), re-run per phase |
| **Performance** | Query plans on new indexes; pagination; rollup latency | EXPLAIN, pytest markers | per phase |
| **E2E (browser)** | Bank → blueprint → paper → online/offline flow; review inbox; import/export center | Playwright | per phase (staging) |

**Test gates:** every phase must have (a) new tests covering its acceptance criteria, (b) the full regression suite green, (c) no performance regression marker failures.

---

# SECTION 14 — DEPLOYMENT PLAN

| Environment | Purpose | Cadence | Gate |
|---|---|---|---|
| **Dev** | Feature development, unit/integration | continuous per PR | PR CI green |
| **QA** | Feature acceptance, E2E, security tests | per phase | QA sign-off |
| **Staging** | Full regression + load + rollback drill (Render-like) | per phase before GA | Staging gate |
| **Production** | Live rollout | phased, feature-flagged | Go-live checklist |

- **Deploy order per phase:** (1) Supabase migrations (additive) → (2) backend (additive services/routes) → (3) frontend (additive pages, feature-flagged) → (4) enable feature flag after smoke.
- **Rollback:** revert backend/frontend to previous image; disable flags; data backfills reversible/verifiable. Demonstrated in staging per phase.
- **Monitoring:** `/readyz` (DB, cache, queue), structured logs with request IDs, metrics (AI cost, queue depth, snapshot counts), alerting on tenancy-guard violations and AI-budget breaches.

---

# SECTION 15 — SUCCESS CRITERIA

Implementation is **complete** when all of the following are true in production:

1. **Bank unify:** 100% of new test/exam questions carry `bank_question_id`; 0 orphan questions created in the last 30 days.
2. **Navigation:** Question Bank reachable via sidebar for authorized roles (audit gap closed).
3. **Blueprints & papers:** teachers can build a blueprint → generate a frozen, per-set paper → push to an online test or offline exam.
4. **Frozen delivery:** published tests/exams are provably frozen (hash checks in tests); bank edits never alter delivered content.
5. **Offline lifecycle:** answer-key change, grace, and re-evaluation operate with full audit and correct result recomputation.
6. **AI:** all AI output lands as draft; every AI job records provider/model/prompt-version/tokens/cost; per-school daily budget enforced.
7. **Analytics:** question/teacher/student/blueprint/exam dashboards populated from idempotent rollups.
8. **Import/export:** Excel/JSON/Word/PDF/OCR import and export + backup/restore work, preview-first, school-scoped.
9. **Security:** tenant-isolation tests pass (authenticated-role RLS), filter-injection suite passes, file-upload security passes.
10. **Scale targets demonstrated:** 10k-question bank search < 200ms p95; 500 concurrent attempts on one test within SLA; rollup job for a day's results < 10 min.

**KPIs (measurable):**
- Regression suite 100% green at every phase gate.
- Zero cross-tenant incidents in production (monitored via guard alerts).
- Question reuse rate (bank-linked questions used in >1 test/exam) rising; duplicate-creation rate declining.
- AI draft → published conversion tracked; human-approval SLA (e.g., < 3 days p90).
- Paper generation determinism verified nightly (same seed → same paper).

---

# SECTION 16 — ENGINEERING CHECKLIST (EVERY PHASE)

| Item | Requirement |
|---|---|
| ✔ Database | Additive migrations only; no drops/renames/re-types; migrations reversible or ignore-by-old-code; indexes on new hot paths; partition-key-aware FKs. |
| ✔ Backend | New services additive; tenant guard on every new route; audit on every mutating action; queue/job idempotency; no existing signature removed. |
| ✔ Frontend | New routes lazy-loaded; sidebar entry additive; feature-flag-gated; existing flows untouched; `tsc` + lint + vitest green. |
| ✔ APIs | New endpoints documented in `supabase_api_spec.json` (regenerated); backward-compat contract tests; pagination + allowlisted filters. |
| ✔ Tests | Unit + integration + API + regression + load/security as applicable; acceptance criteria covered by automated tests. |
| ✔ Documentation | Phase readme; endpoint list; migration notes; rollback runbook updated. |
| ✔ Rollback | Feature-flag off restores previous behavior; rollback drill passed in staging; data backfill reversible/verifiable. |
| ✔ Validation | Acceptance criteria demonstrated in staging; performance markers pass; security suite passes; sign-off recorded. |

---

# SECTION 17 — IMPLEMENTATION ORDER (DEPENDENCY GRAPH)

```
                 Phase 0 (Foundation)
                       │
                       ▼
                 Phase 1 (Question Bank Foundation)
                       │
        ┌──────────────┴───────────────┐
        ▼                              ▼
  Phase 2 (Versioning)          (Phase 1 also feeds)
        │                              │
        ▼                              ▼
  Phase 3 (Blueprint)          Phase 7 (AI Platform)
        │                              │
        ▼                              │
  Phase 4 (Paper Generator)            │
        │                              │
        ├──────────┬───────────────────┘
        ▼          ▼
  Phase 5 (Online)   Phase 6 (Offline)
        │          │
        └────┬─────┘
             ▼
       Phase 8 (Analytics)
             │
             ▼
       Phase 9 (Import/Export)
```

- **Strictly serial:** P0 → P1 → P2 → P3 → P4 → P5/P6 (parallelizable) → P8 → P9.
- **P7 (AI)** can start after P1 and run in parallel with P3–P6 (depends on P0 interface + P1 bank); it must be complete before P9 (import/export reuses its parse/OCR infra).
- **P5 and P6** are independent of each other but both depend on P4 and P2.
- No phase may start before its dependencies' acceptance criteria are met.

---

# SECTION 18 — ESTIMATED TIMELINE

Estimates assume a small senior team (2–3 backend, 1–2 frontend, 1 QA) and include engineering, testing, and review effort. Time = engineering weeks (not elapsed).

| Phase | Engineering (wk) | Testing (wk) | Review (wk) | Total (wk) | Notes |
|---|---|---|---|---|---|
| **0 — Foundation** | 4 | 2 | 1 | **7** | Tenancy + snapshot + AI interface + queue are load-bearing; keep tight. |
| **1 — Question Bank Foundation** | 5 | 2.5 | 1.5 | **9** | Largest surface (media, review, search, scopes). |
| **2 — Question Versioning** | 2.5 | 1.5 | 1 | **5** | Correctness-critical but bounded. |
| **3 — Blueprint Engine** | 3 | 1.5 | 1 | **5.5** | Validation + constraint engine. |
| **4 — Paper Generator** | 4.5 | 2.5 | 1.5 | **8.5** | Determinism + concurrency + freeze. |
| **5 — Online Integration** | 4 | 2.5 | 1.5 | **8** | Attempt compat + snapshot + scoring. |
| **6 — Offline Integration** | 4 | 2.5 | 1.5 | **8** | Re-eval/grace/key lifecycle. |
| **7 — AI Platform** | 4.5 | 2.5 | 1.5 | **8.5** | Provider, prompts, budgets, dedupe. |
| **8 — Analytics** | 2.5 | 1.5 | 1 | **5** | Rollups + dashboards. |
| **9 — Import/Export** | 3 | 2 | 1 | **6** | 5 formats + packages + backup/restore. |
| **Cross-cutting** | — | — | 3 | **3** | Integration hardening, load, security, docs. |
| **TOTAL** | **37.5** | **21.5** | **15** | **~74 engineer-weeks** | ≈ 4.5–5 elapsed months with a 4-person team; ≈ 6 months with buffers/leave. |

**Buffering recommendation:** add 15–20% contingency (≈ 11–15 weeks) for unknowns → planning envelope of **5.5–7 elapsed months**. Phase 0–2 are the critical path and the highest-value early investment; P7 can be resourced in parallel after P1.

---

# SECTION 19 — FINAL OUTPUT

This document is the **only implementation roadmap** for the Examination System. Future developers should be able to build the complete system using only:

1. `QUESTION_BANK_ARCHITECTURE_AUDIT.md` — current-state facts.
2. `FINAL_EXAMINATION_ARCHITECTURE.md` — target architecture (design reference).
3. `FINAL_ARCHITECTURE_READINESS_REVIEW.md` — risks/decisions that shaped the plan.
4. **ADR-001 … ADR-005** — binding structural decisions (tenancy, partitioning, snapshot model, offline lifecycle, AI layer).
5. **This Master Implementation Plan** — the phase-by-phase engineering roadmap.

**Rules of engagement for all future work:**
- No phase ships without its rollback, tests, and acceptance criteria (Section 16).
- No destructive migration, no large-bang deployment, no downtime migrations.
- All changes additive and backward compatible.
- Any deviation from this plan requires an ADR; the ADR becomes binding before implementation.

---

*End of Master Implementation Plan v1.0. This is the FINAL engineering roadmap for the Examination System.*
