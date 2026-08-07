# EP-01 — Question Bank Foundation (Execution Package)

**Status:** Planning-only (no production code, no SQL, no migrations, no file modifications in this document)
**Applies to:** MIP **Phase 1 — Question Bank Foundation**
**Binding inputs:** `QUESTION_BANK_ARCHITECTURE_AUDIT.md`, `FINAL_EXAMINATION_ARCHITECTURE.md`, `FINAL_ARCHITECTURE_READINESS_REVIEW.md`, ADR-001…005, `MASTER_IMPLEMENTATION_PLAN.md` (Section 4), `EP-00_FOUNDATION_INFRASTRUCTURE.md`
**Owner:** Backend exam platform team + Frontend exam platform team

---

## 1. Scope

EP-01 brings the existing-but-empty `qb_questions` bank to life as the **master source of truth** for questions: taxonomy, media, review workflow, search/filters, multi-school scopes, exact-duplicate guard, the missing permission wiring, and unification with the legacy online-tests bank — while shipping **zero** changes to Online Tests, Offline Exams, or AI behavior.

**In scope (from MIP Section 4):**
- Extend `qb_questions` additively (Bloom, NCERT, exam tags, multiple-correct, difficulty predicted/calibrated, global/provenance fields, question-code generator).
- New tables: `qb_question_media`, `qb_question_shares`, `qb_question_families`, `qb_question_hashes`, review tables, `ncert_chapters`, taxonomy bridge.
- Indexes: partial (`WHERE deleted_at IS NULL`), GIN on tags/metadata, trigram on `prompt_text`.
- Backend: extended CRUD, scope resolution (global/school/private/shared), effective-owner rule, review service, media service, search service, dedupe + validation, seed service.
- API: full route set from MIP Section 4 (CRUD, media, duplicate/publish/archive/withdraw, share, dedupe-check, reviews, taxonomy, search).
- Frontend: re-permission the sidebar entry, expand list/builder, new Review Inbox page, wire VersionHistory, new types + API client functions.
- Compat UNION view `online_test_question_bank` with a contract test.

**Out of scope (later phases):** paper blueprint generator, export, question usage/performance analytics, versioning lifecycle (Phase 2), server-side shuffle, AI generation/OCR/PDF wiring (frontend simulated panels stay), RLS retrofit beyond the `qb_*` + new tables already covered in EP-00.

---

## 2. Objectives

1. Make the Question Bank **functional** (the current `/api/question-bank/*` routes crash — QB-001) so teachers can create, find, review, and publish questions.
2. Establish `qb_questions` as the **single source of truth** for question content, unified with the legacy online-tests bank via a compat view (no behavior change to existing consumers).
3. Deliver **professional-bank metadata**: Bloom, NCERT/exam mapping, exam tags, media assets, multiple-correct, difficulty prediction fields, provenance.
4. Enforce **multi-school scopes** (global / school / private / shared) with an effective-owner edit rule, backed by tenant context (ADR-001) and partition keys (ADR-002).
5. Ship a **review workflow** (draft → review → approved → published → archived / withdrawn / rejected) with checklists, comments, and bulk approve.
6. Ship **search + allowlisted filters** that cannot be used for PostgREST operator injection.
7. Lay **AI-readiness groundwork** (provenance fields, validation, dedupe-check, review-gate default) so Phase 4+ generation plugs in.
8. Keep the four non-negotiables green: Online Tests, Offline Exams, AI, and existing Question Bank surfaces.

---

## 3. Dependencies

**Must be complete (EP-00 / Phase 0):**
- Tenant context middleware + `get_tenant_context`/`resolve_school_id_from_actor` (F-001/F-002).
- Partitioning-key template + `question_bank.*` permission seed (F-003/F-003b) — keys: `view, create, edit, delete, import, export, review, approve, publish, withdraw, blueprints, generate, ai, analytics, global, global.copy, license, manage`.
- RLS template for new tables + `exam.*` backfill (F-003c).
- `audit_logger` + `qb_audit_events` wrapper (F-006).
- `llm/` provider protocol (F-007) — used by dedupe/validation groundwork.
- DB-backed queue engine (F-008) — used by media orphan sweep.
- Feature flags (F-009) — gate new UI/review inbox.
- Typed exceptions + frontend error normalization (F-011).

**Runtime prerequisites:** `supabase/migrations/` timestamped additive convention; Supabase storage bucket availability; existing `get_supabase_admin_client()`; existing uploads module.

---

## 4. Current State (verified)

| Area | Verified fact |
|---|---|
| Backend routes | `/api/question-bank/*` exists (276 lines) but **crashes**: `_school_id(request)` reads `request.state.permission_scope` which nothing ever sets (`question_bank.py:19-21`) → 500 on every call. Router registered at `main.py:344-347` gated by `require_permissions("online_tests")` only. |
| Backend service | `supabase_question_bank.py` (193 lines): exam-types, taxonomy nodes, tags, sources CRUD; question CRUD; versions list/create/restore; history. All calls tenant-scoped via `school_id` param. `create_version`/`log_history` already exist. |
| DB schema | `qb_*` tables live (via `backend/migrations/003_question_bank_taxonomy.sql`, **not** in `supabase/migrations/`): `qb_exam_types`, `qb_taxonomy_nodes`, `qb_tags`, `qb_sources`, `qb_questions`, `qb_question_versions`, `qb_question_history`, `qb_bank_test_links` (dead — no FK target). **0 rows everywhere.** RLS enabled but only service-role policies. |
| `qb_questions` columns | `id, school_id, created_by, updated_by, question_code, exam_type_slug, subject_id/chapter_id/topic_id/sub_topic_id (FK→qb_taxonomy_nodes), subject/chapter/topic/sub_topic (text fallback), question_type, difficulty_level, prompt_text, prompt_html, option_items JSONB, answer_key JSONB, explanation(+_html), teacher_notes, student_notes, hints, solution(+_html), marks, negative_marks, estimated_time_seconds, source_id, source_name, language, visibility (private|school|public), question_owner, metadata JSONB, question_image_url, tags JSONB, status (draft|review|approved|published|archived|rejected), display_order, version, is_active, deleted_at, created_at, updated_at`. |
| Frontend pages | `QuestionBankList.tsx` (453 ln) — loads via `listQBQuestions` (crashes), uses **working** `importOnlineTestQuestionBank`; filters + status cards + quick actions; edit→`/question-bank/edit/:id`. `QuestionBuilder.tsx` (974 ln) — dual bank/test mode; bank save calls `create/updateQBQuestion` (crash); test mode uses online-test APIs (works). `QuestionBankEditor.tsx` (630 ln) — **orphan**, decorative, no API calls. `ActionBar.tsx` — static buttons. |
| Sidebar | "Question Bank" entry **already exists** at `Layout.tsx:320-324` (Examinations) gated by `['online_tests','online_tests.manage']` — needs re-permission to `question_bank.view`, not addition. |
| Types/API client | No `QBQuestion` interface — `qb_questions` typed as `Record<string, unknown>` in `api.ts` (915-983) where all QB client functions live. |
| Legacy bank | `online_tests.question_bank` table + `public.online_test_question_bank` view (in `20260618_056`), used by `supabase_online_tests.py:32-33` for read + import; works end-to-end. |
| Permissions | `question_bank.*` keys seeded in EP-00 (F-003b). Not yet consumed anywhere. |
| Audit | `online_tests.write_audit_log()` DB trigger pattern exists; `qb_*` has no audit wiring beyond `qb_question_history`. |
| AI | `AIGenerator.tsx`/`OCRPanel.tsx`/`PDFImportPanel.tsx` are simulated. Backend AI generators are real and untouched by this phase. |

---

## 5. Target State

- A teacher with `question_bank.create` opens `/question-bank` (sidebar shows for `question_bank.view`), creates a draft with taxonomy + Bloom + NCERT/exam tags + optional media, saves it, submits for review; a reviewer with `question_bank.review` completes the checklist and approves; a publisher with `question_bank.publish` publishes it.
- Questions are visible to school peers only when `visibility='school'`, to shared users via `qb_question_shares`, to everyone via global scope; cross-school reads are blocked by tenant context + RLS.
- An identical prompt to an existing same-school question is flagged by `dedupe-check` before insert (soft warn in this phase).
- Search returns filtered, paginated, allowlisted-query results.
- Legacy online-tests question-bank read/write flows keep working through the compat UNION view (contract-tested).
- All new surfaces are behind a feature flag (e.g., `question_bank.enhanced_bank`) default-on for the bank core, with Review Inbox behind its own flag.

---

## 6. Database Impact

All **additive**, timestamped migrations under `supabase/migrations/` (pattern: `005_exam_and_seating.sql`). Every new table carries `school_id UUID NOT NULL`, RLS with tenant policies, and follows the EP-00 partitioning-key template. Existing tables are only `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` / `CREATE UNIQUE INDEX`.

| Change | Detail |
|---|---|
| `qb_questions` additive columns | `bloom_taxonomy TEXT`, `ncert_chapter_id UUID` (FK→`ncert_chapters`), `exam_tags JSONB`, `multiple_correct BOOLEAN DEFAULT FALSE`, `difficulty_predicted TEXT`, `difficulty_calibrated TEXT`, `is_global BOOLEAN DEFAULT FALSE`, `created_via TEXT DEFAULT 'manual'`, `version_root_id UUID`, `source_question_id UUID`, `origin_school_id UUID`. |
| `question_code` generator | Sequence + partial unique index `ON qb_questions(school_id, question_code) WHERE question_code IS NOT NULL AND is_active`; service assigns `QB-<school-prefix>-<year>-<seq>` on create when absent. |
| `qb_question_media` | `id, school_id, question_id FK, asset_type (stem|option|solution|diagram), bucket, storage_path, public_url, alt_text, width, height, mime_type, size_bytes, provenance, is_active, deleted_at, created_by, created_at`. Index `(school_id, question_id)`. |
| `qb_question_shares` | `id, school_id, question_id FK, shared_with_role_id, shared_with_profile_id (one required), permissions JSONB, created_by, expires_at, created_at`. Index `(school_id, shared_with_profile_id, expires_at)`. |
| `qb_question_families` | `id, school_id, family_name, question_ids JSONB, metadata JSONB, created_by, created_at` — AI-variant grouping. |
| `qb_question_hashes` | `id, school_id, question_id FK, normalized_prompt_hash TEXT, algorithm TEXT, created_at`; unique `(school_id, normalized_prompt_hash)` for active rows. |
| Review tables | `qb_review_requests` (id, school_id, question_id, requested_by, reviewer_id, status, submitted_at, decided_at, decision, decision_note), `qb_review_comments` (request_id FK, author, body, created_at), `qb_review_checklist` (id, school_id, name, is_default, items JSONB), `qb_review_checklist_items` (request_id FK, checklist_item_id, completed_by, completed_at), `qb_question_reviews` (id, school_id, question_id, reviewer_id, decision, comments, created_at). |
| `ncert_chapters` catalog | `id, board TEXT, class TEXT, subject TEXT, chapter_number INT, chapter_name TEXT, created_at` — additive seed catalog (NEET/JEE/CBSE/State). |
| Taxonomy bridge | Index/lookup between `qb_taxonomy_nodes` and `public.subjects`/`batches` (reconciled reference table `qb_subject_bridge`: `school_id, taxonomy_node_id, erp_subject_id, erp_batch_id, mapping_type`). |
| Indexes | `qb_questions`: `(school_id, status, exam_type_slug)`, `(school_id, subject_id)`, `(school_id, difficulty_level)`, `(school_id, bloom_taxonomy)` partial `WHERE deleted_at IS NULL`; GIN on `tags`/`metadata`; trigram index on `prompt_text` (requires `pg_trgm` extension, `CREATE EXTENSION IF NOT EXISTS pg_trgm`). |
| Compat view | `public.online_test_question_bank` re-created as a **UNION** over `qb_questions` + `online_tests.question_bank` with an `INSTEAD OF INSERT` trigger routing new rows to `qb_questions` so the existing write path (`supabase_online_tests.py:32-33`) keeps working. |
| Seeds | On-demand, idempotent per school: NEET / JEE Mains / JEE Adv / CBSE / State-board exam types + starter taxonomy (Physics/Chemistry/Mathematics/Biology subjects → chapters → topics) + default review checklist. |

---

## 7. Backend Changes

**QB-001 (blocker fix).** Replace `_school_id(request)` in `routes/question_bank.py` so it resolves the tenant from the authenticated principal via the EP-00 pattern (`resolve_school_id_from_actor`, `supabase_context.py:232`) instead of the never-set `request.state.permission_scope`. Remove the unused `get_authenticated_user` import. All routes then work; no endpoint signature changes.

**Extended `supabase_question_bank.py`.**
- CRUD accepts new fields (Bloom, NCERT, exam tags, multiple_correct, is_global, created_via, difficulty_predicted, source/version provenance). Assigns `question_code` on create when absent. Runs dedupe check on create/update (soft warn). Writes `qb_question_history` on every mutation.
- **Scope resolution** `visible_question_ids(actor, school_id, scope)`:
  - `global` → `is_global = true`
  - `school` → `visibility='school'` AND `school_id = tenant`
  - `private` → `visibility='private'` AND `created_by = actor` AND `school_id = tenant`
  - `shared` → `visibility` any AND row in `qb_question_shares` where `shared_with_profile_id = actor` OR `shared_with_role_id` in actor's roles, and not expired.
- **Effective-owner rule** for `edit`/`delete`: actor is `created_by`, OR explicit share with `edit`/`manage` permission, OR role `school_admin`/`platform_admin`. Everything else → typed `TenantForbiddenError` (EP-00 F-011).
- Multi-school copy helper `copy_to_school(question_id, target_school_id)` for global reuse (records `source_question_id`/`origin_school_id`).

**Review service** (`supabase_question_reviews.py`). Submit (draft→review), assign reviewer, checklist completion, approve (review→approved→published via separate `publish` action), request-changes (→review or draft), reject (→rejected), bulk approve (checklist-gated), emergency withdraw (published→withdrawn). Every transition writes `qb_question_reviews` + `qb_question_history` + `audit_logger` (`qb` module tag, EP-00 F-006).

**Media service** (`supabase_question_media.py`). Upload → bucket `qb-question-media`, insert row, return signed URL (short TTL) + `public_url` for published questions. List/delete (soft). Orphan sweep: queue job (EP-00 F-008) that marks/deletes unreferenced assets older than N days. Reuses the existing uploads module.

**Search service** (`supabase_question_search.py`). Builds PostgREST queries from an **allowlist** of filter→operator mappings (never pass raw keys/operators). Filters: exam type, subject, chapter, topic, difficulty, Bloom, type, status, source, tags, language, NCERT, visibility, created-by, date. Text: trigram ILIKE + FTS over `prompt_text`/`explanation`. Pagination via `range` + `count=exact`.

**Validation + dedupe** (`question_validation.py`). Schema/answer validation (options non-empty for choice types, exactly-one-correct unless `multiple_correct`, marks ≥ 0, prompt non-empty). `normalized_prompt_hash` (canonical, whitespace/case/normalized) → `qb_question_hashes`. Phase-1 mode: **warn, not block** (MIP rollback guarantee).

**Seed service** (`supabase_question_seed.py`). Idempotent per-school seed of exam types + starter taxonomy + NCERT catalog + default review checklist. Invoked on demand (endpoint or startup when flag enabled).

---

## 8. Frontend Changes

- **Types:** new `QBQuestion`, `QBMedia`, `QBShare`, `QBReviewRequest`, `QBReviewChecklist`, `QBTaxonomyNode`, `QBQuestionSearchParams` interfaces in `src/types/index.ts` (replaces `Record<string, unknown>` usage).
- **API client (`api.ts`):** add/extend functions for all EP-01 endpoints (filters, media, share, review, dedupe-check, search, taxonomy bridge). Keep existing function names for compatibility.
- **Sidebar:** change `Layout.tsx:320-324` permission from `['online_tests','online_tests.manage']` to `['question_bank.view', 'question_bank.manage']` (fallback to `online_tests` keys during rollout via a feature-flag-controlled permission list). Verify `/question-bank` direct URL passes `ProtectedRoute`.
- **`QuestionBankList.tsx`:** filter bar (exam type, subject, chapter, topic, difficulty, **Bloom**, **NCERT**, exam tags, **visibility**, status, source, language); status chips; usage column; duplicate badge (from dedupe-check); favorites/recent/recently-used smart lists; Review Inbox quick-action (gated by `question_bank.review`).
- **`QuestionBuilder.tsx`:** Bloom selector, NCERT/exam-mapping chips, media upload per question/option, share dialog, submit-for-review action, multiple-correct toggle, created-via/provenance read-only badge.
- **`VersionHistory.tsx`:** wire to real `listQBQuestionVersions` + `restoreQBQuestionVersion` (list + restore buttons active).
- **Review Inbox page** (`ReviewInbox.tsx`): assignments, checklist completion, comments, approve/request-changes/reject, bulk approve. New route `/question-bank/reviews` gated by `question_bank.review`, behind a feature flag.
- **`QuestionBankEditor.tsx` + `ActionBar.tsx`:** either wire to real save (reuse `QuestionBuilder` patterns) or **remove** the orphan page if routes point at `QuestionBuilder`; decision recorded in QB-023.

---

## 9. API Changes

All under `/api/question-bank`, tagged "Question Bank", gated by the EP-00 typed-permission dependency. Errors follow the EP-00 stable shape `{status, code, message, detail}`.

| Method | Path | Purpose | Permission |
|---|---|---|---|
| GET/POST | `/question-bank/questions` | Extended CRUD list/create (new fields, filters, scope param `scope=all\|school\|shared\|private\|global`) | `view` / `create` |
| GET/PUT/DELETE | `/question-bank/questions/{id}` | Detail/update/soft-delete (effective-owner enforced) | `view` / `edit` / `edit` |
| POST | `/question-bank/questions/{id}/duplicate` | Copy within school (records provenance) | `create` |
| POST | `/question-bank/questions/{id}/publish` | approved → published | `publish` |
| POST | `/question-bank/questions/{id}/archive` | soft archive | `edit` |
| POST | `/question-bank/questions/{id}/withdraw` | emergency withdraw (published→withdrawn) | `publish` |
| POST | `/question-bank/questions/{id}/copy-to-school` | global reuse across schools | `global.copy` |
| GET/POST/DELETE | `/question-bank/questions/{id}/media` `/media/{media_id}` | Media list/upload/delete | `edit` |
| POST/DELETE | `/question-bank/questions/{id}/share` `/share/{share_id}` | Grant/revoke share | `edit` |
| POST | `/question-bank/questions/dedupe-check` | Exact-duplicate flag (soft) | `create` |
| POST | `/question-bank/questions/validate` | Schema/answer validation | `create` |
| POST | `/question-bank/reviews/assign` | Assign reviewer | `review` |
| GET | `/question-bank/reviews/inbox` | My review assignments | `review` |
| POST | `/question-bank/reviews/{id}/approve\|request-changes\|reject` | Decide | `review`/`approve` |
| POST | `/question-bank/reviews/bulk-approve` | Checklist-gated bulk approve | `approve` |
| GET | `/question-bank/taxonomy` | Taxonomy tree (exam type/node type/parent) | `view` |
| POST | `/question-bank/taxonomy/nodes` | Add node | `edit` |
| GET | `/question-bank/taxonomy/bridge` | Taxonomy↔ERP subject/batch lookup | `view` |
| GET | `/question-bank/search` | Combined allowlisted filters + pagination | `view` |
| POST | `/question-bank/seed` | On-demand per-school seed (idempotent) | `manage` |

**Backward compatibility:** no existing endpoint changed; only the crash fix + registration permission change (QB-001/QB-002). The `online-tests` question-bank endpoints stay untouched.

---

## 10. UI Changes

- Sidebar label/path unchanged; gating updated (9 above).
- QuestionBankList: new filter bar + status chips + usage/duplicate columns + smart lists (favorites/recent/recently-used).
- QuestionBuilder: taxonomy + Bloom + NCERT/exam chips + media upload + share dialog + submit-for-review + multiple-correct.
- Review Inbox: new page (assignments, checklist, comments, approve/reject/changes, bulk approve).
- VersionHistory: active restore.
- All new UI gated by `useFeatureFlag` (EP-00 F-009); nothing user-visible until flags on.

---

## 11. Media Support

- Storage bucket `qb-question-media` (public-read for `public_url`; private for drafts via signed URLs).
- `qb_question_media` row per asset; asset types: stem / option / solution / diagram.
- Per-option images stored in `option_items[*].image_url` metadata, pointing at bucket objects, with `qb_question_media` provenance rows.
- Orphan sweep queue job (EP-00 F-008) for unreferenced/deleted assets.
- MIME/size validation + redaction-safe logging (no signed URLs in logs).

---

## 12. Taxonomy

- `qb_taxonomy_nodes` remains the canonical tree (subject→chapter→topic→sub_topic) per exam type.
- **Bridge:** `qb_subject_bridge` reconciles `qb_taxonomy_nodes` with ERP `public.subjects`/`batches` so bank subjects align with school masters (no duplicated subject lists going forward).
- **NCERT catalog:** `ncert_chapters` (board/class/subject/chapter) + `qb_questions.ncert_chapter_id` + exam tags (`NEET`, `JEE-Mains`, `JEE-Adv`, `CBSE`, state boards).
- **Seed:** on-demand per-school starter taxonomy (Physics/Chemistry/Mathematics/Biology) for the 5 exam types; idempotent.

---

## 13. Search

- `GET /question-bank/search` with allowlisted filter keys mapped to safe PostgREST operators; any unknown key rejected (400).
- Trigram ILIKE over `prompt_text` (pg_trgm index) + FTS on `prompt_text`/`explanation`.
- Allowlisted sort columns (`created_at`, `updated_at`, `difficulty_level`, `marks`, `question_code`) + direction; default `created_at DESC`.
- Pagination: `skip`/`limit` bounded (max 100), `count=exact` envelope `{items, total, skip, limit}`.

---

## 14. Filters

| Filter | Source | Operator |
|---|---|---|
| exam_type_slug | column | eq |
| subject_id / chapter_id / topic_id | FK columns | eq |
| difficulty_level | column | eq |
| bloom_taxonomy | new column | eq |
| question_type | column | eq |
| status | column | eq |
| source_id | column | eq |
| tags | JSONB | contains (any) |
| language | column | eq |
| ncert_chapter_id | new FK | eq |
| visibility / scope | column + scope resolver | eq / resolver |
| created_by | column | eq |
| created_from / created_to | column | gte / lte |
| search | text | trigram ILIKE / FTS |

No raw operator strings accepted from clients.

---

## 15. Review Workflow

State machine (service-enforced; existing `status` CHECK extended implicitly by the same 6 values):
`draft → review → approved → published`, with `request-changes` (→ review or draft), `reject` (→ rejected), `archive` (from approved/published), `withdraw` (published → withdrawn), `restore` (archived/withdrawn → previous).

- Submit → `qb_review_requests` (status `pending`), optional reviewer assignment.
- Reviewer completes `qb_review_checklist_items` then approves/rejects/requests-changes with `qb_review_comments`.
- `approve` requires checklist items for the assigned checklist complete (or `bulk-approve` with explicit override flag, audited).
- Every transition: `qb_question_reviews` row + `qb_question_history` + `audit_logger` (`qb` tag).
- AI-created questions (Phase 4+) land in `review` by default; this phase enforces the same for `created_via='ai'` rows.

---

## 16. Permissions

New `question_bank.*` keys (seeded in EP-00 F-003b) enforced **per route**:

| Key | Grants |
|---|---|
| `question_bank.view` | list/get/search/taxonomy/media read, sidebar entry |
| `question_bank.create` | create, duplicate, copy-to-school |
| `question_bank.edit` | update/delete/archive (effective-owner rule applies) |
| `question_bank.import` / `export` | workbook import/export (reserved; export later phase) |
| `question_bank.review` | submit, assign, checklist, comments, approve/request-changes/reject |
| `question_bank.publish` | publish, withdraw, bulk-approve |
| `question_bank.share` | grant/revoke shares |
| `question_bank.manage` | all of the above + seed endpoint |
| `question_bank.global` / `global.copy` | create/view global bank questions, cross-school copy |
| `question_bank.ai` | AI read/write groundwork (reserved) |

Effective-owner rule overrides role grants for `edit`/`delete` (private or shared-scope only); `school_admin`/`platform_admin` retain full control. Router registration moves from `require_permissions("online_tests")` to the `question_bank.*` dependency (with rollout fallback list).

---

## 17. AI Readiness

EP-01 ships **groundwork only** — no new AI generation, no wiring of the simulated panels:
- Provenance: `created_via` (`manual|import|ai`), `difficulty_predicted`, `source_question_id`, `version_root_id`, `origin_school_id`.
- `qb_question_families` groups AI variants for later comparison.
- `validate` + `dedupe-check` endpoints give AI generation a safety gate in Phase 4+.
- Review-gate default: any `created_via='ai'` row is forced to `review` status (never auto-published).
- Credit-gating hook documented via EP-00 `llm/` protocol + `ai_credit_engine` (no endpoint added in this phase).

---

## 18. Migration Plan

Timeline-ordered, all additive, all under `supabase/migrations/` (timestamped, `IF NOT EXISTS`):
1. **M-1 Schema core:** `qb_questions` additive columns + `question_code` sequence/unique index + new indexes (partial/GIN/trigram) + `pg_trgm`.
2. **M-2 Media/share/families:** `qb_question_media`, `qb_question_shares`, `qb_question_families` (+ RLS + indexes).
3. **M-3 Dedupe:** `qb_question_hashes` + unique index.
4. **M-4 Review:** review tables + checklist seed.
5. **M-5 Taxonomy:** `ncert_chapters` catalog + `qb_subject_bridge` + bridge indexes.
6. **M-6 Compat view:** re-create `public.online_test_question_bank` as UNION with `INSTEAD OF INSERT` trigger.
7. **M-7 Seeds:** idempotent per-school exam-type/taxonomy/checklist seed data.

Each migration ships with a dry-run on a scratch Supabase project before production apply (matches the EP-00 additive-migration rule). No destructive ops, no renames, no drops.

---

## 19. Rollback Plan

- **Feature flags:** Review Inbox and enhanced list/builder UI behind flags; disabling returns prior UX. Router permission fallback list keeps `online_tests` keys active until all roles have `question_bank.view`.
- **Application:** revert backend/frontend to previous Render image; old code ignores new columns/tables.
- **Schema:** all migrations additive → old code runs against them untouched. The only behavioral change is the compat-UNION view: if it regresses the online-tests import path, restore the original view definition (reverse migration documented) — this is why the `INSTEAD OF INSERT` trigger and contract test are mandatory.
- **Dedupe enforcement:** soft (warn) in this phase — cannot block inserts → no regression by construction (MIP Section 4 guarantee).
- **Router gating:** if permission gating breaks a school, flip the fallback flag to restore `online_tests` gating.

---

## 20. Testing Plan

**Unit (pytest):**
- Scope resolution matrix (global/school/private/shared × role × ownership), effective-owner (granted/denied cases).
- Dedupe hash determinism; normalize variants (whitespace/case/unicode).
- Search allowlist: unknown key/operator rejected (400); operator injection strings return 400, never crash.
- Review state machine: every valid transition; illegal transitions rejected; checklist-gated approve.
- `question_code` generator uniqueness per school.
- Media signing + soft-delete; validation service (option/answer/marks rules).

**Integration:**
- RLS: `authenticated` cross-school read on all new tables blocked; service role reads all.
- Compat view contract test: existing online-tests question-bank read AND write (import) flows still pass with the UNION view + trigger.
- Share grant/revoke → visibility change end-to-end.
- Review chain draft→review→approved→published→archived/withdrawn/rejected with audit rows present (`audit_logs` + `qb_question_history`).

**API:**
- Full CRUD + all filters + search + pagination envelope; bulk approve; withdraw; duplicate; copy-to-school; seed idempotency (run twice → same state).

**Regression:**
- Full existing backend `pytest` suite green.
- Frontend `tsc --noEmit`, `vitest`, `vite build` green.
- **Online Tests** create/edit/take/score; **Offline Exams** flows; **AI** (tutor/agents/generation/credits) — all unchanged.
- `QuestionBuilder` legacy test-mode path (`testId` context) still works.

**Security:**
- Cross-tenant IDOR suite re-run; new endpoints reject foreign `school_id`.
- Redaction scan on observability output (no signed URLs/tokens in logs).

**Performance:**
- Search on 1,000 seeded questions < 500 ms p95; pagination bounded; `/readyz` unaffected.

**Frontend (Vitest/Playwright):**
- Filter-bar reducer tests; Review Inbox smoke (assign→checklist→approve); sidebar visibility per role.

---

## 21. Validation Checklist (gate to Phase 2)

- [ ] `/api/question-bank/*` no longer 500s (QB-001 fixed); all QB routes return typed errors.
- [ ] Teacher creates draft with taxonomy + Bloom + NCERT/exam tags + media; row lands in `qb_questions`.
- [ ] `visibility=school` questions visible to school peers; cross-school read blocked at DB level (RLS test).
- [ ] Share grant makes a private question visible to the target; revoke hides it.
- [ ] `dedupe-check` flags an identical prompt (same school) — soft warn only.
- [ ] Review chain completes: submit → assign → checklist → approve → published; reject/request-changes round-trip; bulk approve works; every transition audited.
- [ ] Media upload → record → signed URL → delete works; orphan sweep job runs without error.
- [ ] Sidebar shows for `question_bank.view`; `/question-bank` direct URL works; fallback flag restores old gating.
- [ ] Search returns correct filtered/paginated results; allowlist rejects injected operators.
- [ ] Compat UNION view: online-tests question-bank read/write contract test passes.
- [ ] Seeds idempotent; NEET/JEE/State exam types + starter taxonomy present.
- [ ] No API contract changed outside `/api/question-bank`; no TS errors; no build failures.
- [ ] Online Tests, Offline Exams, AI, legacy Question Bank behavior unchanged (full regression green).
- [ ] All new UI behind flags; no regression in permission/tenant isolation.

---

## 22. Task Breakdown

Legend — Priority: **C** Critical / **H** High / **M** Medium. Files Expected = primary files (new/edited).

### A. Fix + Wiring (must land first)

| ID | Purpose | Deps | Pri | Hours | Files Expected | Risk | Rollback | Acceptance Tests | Definition of Done |
|----|---------|------|-----|-------|----------------|------|----------|------------------|--------------------|
| QB-001 | Fix `_school_id` crash: resolve tenant from authenticated principal via `resolve_school_id_from_actor` (EP-00 tenant context); remove unused import; all existing QB endpoints functional | EP-00 F-001/F-002 | C | 4 | `routes/question_bank.py` | High | Single-commit revert; old behavior already broken | Every existing QB route returns 200 (not 500) under an authenticated school actor; forged school rejected | `_school_id` uses tenant context; no `request.state.permission_scope` reads remain; suite green |
| QB-002 | Re-gate router registration from `require_permissions("online_tests")` to `question_bank.view` + per-route `question_bank.*` checks, with rollout fallback list behind a flag | QB-001, EP-00 F-003b | C | 4 | `main.py`, `routes/question_bank.py` | High | Flag falls back to `online_tests` gating | Teacher w/o `question_bank.view` blocked; school admin/teacher with key allowed; fallback restores prior | Registration gated by `question_bank.*`; fallback flag tested |

### B. Schema (additive migrations)

| ID | Purpose | Deps | Pri | Hours | Files Expected | Risk | Rollback | Acceptance Tests | Definition of Done |
|----|---------|------|-----|-------|----------------|------|----------|------------------|--------------------|
| QB-003 | Extend `qb_questions` (Bloom, NCERT FK, exam_tags, multiple_correct, difficulty_predicted/calibrated, is_global, created_via, version_root_id, source_question_id, origin_school_id) + `question_code` sequence/unique index + partial/GIN/trigram indexes | EP-00 F-003 (partition template) | H | 8 | 1 migration + `supabase/migrations/README` | Med | Migration unapplied (additive); no code depends yet | Columns exist; index scan used on 1k rows; unique code per school | Additive DDL merged; scratch-DB apply clean |
| QB-004 | `qb_question_media` table + RLS + indexes; bucket `qb-question-media` setup | QB-003 | H | 4 | 1 migration | Med | Unapply migration | Table + bucket exist; RLS blocks cross-school | Media table additive + tenant-safe |
| QB-005 | `qb_question_shares` + `qb_question_families` tables + RLS + indexes | QB-003 | H | 4 | 1 migration | Med | Unapply migration | Rows enforce one-of (role|profile); expired shares filterable | Share + family tables live |
| QB-006 | `qb_question_hashes` table + unique `(school_id, normalized_prompt_hash)` + `pg_trgm` extension if absent | QB-003 | H | 3 | 1 migration | Low | Unapply migration (soft feature anyway) | Unique constraint present; extension installed | Dedupe storage ready; soft behavior |
| QB-007 | Review tables (`qb_review_requests`, `qb_review_comments`, `qb_review_checklist`, `qb_review_checklist_items`, `qb_question_reviews`) + RLS + indexes + default checklist seed | QB-003 | H | 6 | 1 migration | Med | Unapply migration | Tables created; default checklist seeded idempotently | Review storage additive + tenant-safe |
| QB-008 | `ncert_chapters` catalog + `qb_subject_bridge` (taxonomy↔ERP subjects/batches) + indexes + catalog seed | QB-003 | M | 6 | 1 migration | Med | Unapply migration | Bridge lookups return reconciled ERP refs; catalog seeded | Taxonomy bridge live; no ERP table modified |

### C. Backend services

| ID | Purpose | Deps | Pri | Hours | Files Expected | Risk | Rollback | Acceptance Tests | Definition of Done |
|----|---------|------|-----|-------|----------------|------|----------|------------------|--------------------|
| QB-009 | Extend `supabase_question_bank.py`: new fields, scope resolver (`visible_question_ids`), effective-owner rule, `question_code` gen, provenance fields, duplicate/copy-to-school helpers; `qb_question_history` on all mutations | QB-001, QB-003 | C | 20 | `supabase_question_bank.py` | High | Feature-flag the new resolution; revert service commit | Scope matrix + owner matrix unit tests pass; existing CRUD behavior preserved | Scope + owner rules unit-proven; legacy call paths untouched |
| QB-010 | Review service: submit/assign/checklist/approve/request-changes/reject/bulk-approve/withdraw; state machine + audit (`audit_logger` `qb` tag + `qb_question_reviews` + history) | QB-007, EP-00 F-006 | H | 18 | `supabase_question_reviews.py` | Med | Flag off; endpoint unavailable | State-transition unit matrix; audit rows written per transition | Full transition set tested + audited |
| QB-011 | Media service: upload→record→signed URL→delete (soft); orphan-sweep queue job via EP-00 F-008; reuse uploads module | QB-004, EP-00 F-008 | H | 12 | `supabase_question_media.py`, `queue` job module | Med | Disable sweep job; media endpoints flagged off | Upload/list/delete round-trip; sweep job marks orphaned assets | Media CRUD + sweep proven; bucket policy set |
| QB-012 | Search service: allowlist filter→operator map, trigram+FTS query builder, bounded pagination, envelope | QB-003 | H | 14 | `supabase_question_search.py` | Med | Search endpoint off; list API still works | Injection strings → 400; 1k-row search < 500 ms p95 | Allowlist + pagination proven; no raw operators |
| QB-013 | Validation + dedupe services: schema/answer validation; `normalized_prompt_hash` → `qb_question_hashes` (soft warn); `dedupe-check`/`validate` logic | QB-006 | H | 10 | `question_validation.py` | Low | Soft mode = cannot block inserts | Hash determinism tests; validation rules tests | Validation + dedupe services unit-proven |
| QB-014 | Seed service: idempotent per-school exam types + starter taxonomy + NCERT catalog + default checklist | QB-008 | M | 8 | `supabase_question_seed.py` | Low | Seed endpoint off; data additive | Run twice → identical state | Seed idempotency proven |
| QB-015 | Compat UNION view `online_test_question_bank` + `INSTEAD OF INSERT` trigger + contract test for existing online-tests read/write | EP-00 F-003 | H | 10 | 1 migration, `test_online_tests_compat.py` | High | Restore original view (reverse migration documented) | Import + list + create through legacy path pass | Contract test green; legacy flows unchanged |

### D. API routes

| ID | Purpose | Deps | Pri | Hours | Files Expected | Risk | Rollback | Acceptance Tests | Definition of Done |
|----|---------|------|-----|-------|----------------|------|----------|------------------|--------------------|
| QB-016 | Extended question CRUD routes (new fields, scope param, status actions duplicate/publish/archive/withdraw/copy-to-school) with per-route permissions | QB-002, QB-009 | C | 12 | `routes/question_bank.py` | High | Flag off; endpoints 404-able | Full CRUD + status-action API tests | All Phase-1 question endpoints live + permission-checked |
| QB-017 | Media routes (GET/POST/DELETE) wiring QB-011; signed-URL response | QB-011 | H | 6 | `routes/question_bank.py` | Med | Flag off | Upload/list/delete API tests | Media endpoints live |
| QB-018 | Share routes (grant/revoke) + scope-filter param on list/search | QB-005, QB-009 | H | 6 | `routes/question_bank.py` | Med | Flag off | Grant→visible / revoke→hidden API tests | Share + scope param live |
| QB-019 | Review routes (assign/inbox/approve/request-changes/reject/bulk-approve) wiring QB-010 | QB-010 | H | 10 | `routes/question_bank_reviews.py` | Med | Flag off | Review-chain API tests incl. bulk + withdraw | Review API surface live |
| QB-020 | Taxonomy routes (tree, create node, bridge lookup) + search route wiring QB-012/QB-014 + seed endpoint | QB-012, QB-014 | H | 10 | `routes/question_bank.py` | Med | Flag off | Taxonomy + search + seed API tests | Taxonomy/search/seed endpoints live |

### E. Frontend

| ID | Purpose | Deps | Pri | Hours | Files Expected | Risk | Rollback | Acceptance Tests | Definition of Done |
|----|---------|------|-----|-------|----------------|------|----------|------------------|--------------------|
| QB-021 | Re-permission sidebar entry to `question_bank.view` (fallback flag); verify `/question-bank` direct URL through `ProtectedRoute` | QB-002, EP-00 F-009 | C | 4 | `Layout.tsx` | Med | Fallback flag restores old gating | Sidebar shows only w/ key; direct URL works; fallback tested | Gating updated + verified |
| QB-022 | `QuestionBankList.tsx`: filter bar (Bloom/NCERT/exam-tags/visibility/source/language), status chips, usage column, duplicate badge, favorites/recent/recently-used | QB-016, QB-017 | H | 16 | `QuestionBankList.tsx` | Med | Flag off → previous list | Vitest filter reducer; list renders with new filters | List expanded behind flag |
| QB-023 | `QuestionBuilder.tsx`: Bloom selector, NCERT/exam chips, media upload, share dialog, submit-for-review, multiple-correct; resolve `QuestionBankEditor`/`ActionBar` (wire or remove orphan) | QB-016, QB-017, QB-018 | H | 18 | `QuestionBuilder.tsx`, `QuestionBankEditor.tsx`, `ActionBar.tsx` | Med | Flag off → previous builder | Builder saves with new fields; test-mode path unchanged | Builder expanded; orphan resolved |
| QB-024 | Review Inbox page + route `/question-bank/reviews` (assignments, checklist, comments, approve/reject/changes, bulk approve) | QB-019 | H | 14 | `ReviewInbox.tsx`, `App.tsx` | Med | Flag off | Playwright smoke: assign→checklist→approve | Review inbox live behind flag |
| QB-025 | Wire `VersionHistory.tsx` to real list/restore APIs | QB-016 | M | 6 | `VersionHistory.tsx` | Low | Revert wiring | Restore round-trip in UI | Version list + restore active |
| QB-026 | Frontend types (`QBQuestion`, media/share/review/taxonomy/search params) + `api.ts` client functions for all new endpoints | all D tasks | H | 8 | `types/index.ts`, `api.ts` | Low | Additive only | `tsc --noEmit` green; client calls return typed data | Types + client complete |

### F. Cross-cutting

| ID | Purpose | Deps | Pri | Hours | Files Expected | Risk | Rollback | Acceptance Tests | Definition of Done |
|----|---------|------|-----|-------|----------------|------|----------|------------------|--------------------|
| QB-027 | Audit wiring: `qb` module tag on `audit_logs` + `qb_audit_events` wrapper used by review/media/CRUD actions | EP-00 F-006 | H | 6 | `audit_logger.py`, migrations | Low | Logger unreferenced | Audit rows appear for create/update/review/media actions; platform UI lists them | `qb` audit coverage proven |
| QB-028 | End-to-end regression + validation checklist pass; flags verified default-appropriate; docs updated | all | H | 8 | CI, README, runbook | Med | — | Full checklist (Section 21) green; four non-negotiables verified | Phase 1 gate passed |

**Sequencing:** QB-001 → QB-002 → (QB-003…QB-008 schema, after QB-001) → (QB-009…QB-015 services) → (QB-016…QB-020 routes) → (QB-021…QB-026 frontend) → QB-027 → QB-028.
**Estimated total:** ≈ **240 engineer-hours** (~6 weeks, 1–2 engineers) within the MIP Phase 1 window.

---

## 23. Outputs of EP-01

- Functional `/api/question-bank/*` with tenant-context resolution and `question_bank.*` permission gating.
- Extended `qb_questions` + 7 additive table groups + indexes + `pg_trgm`.
- Scope resolution (global/school/private/shared) + effective-owner rule.
- Review service + workflow + Review Inbox UI.
- Media service + bucket + orphan-sweep queue job.
- Search service with allowlisted filters.
- Validation + exact-duplicate guard (soft).
- Seed service (NEET/JEE/State boards + starter taxonomy + NCERT catalog).
- Compat UNION view + contract test preserving online-tests flows.
- Expanded list/builder, VersionHistory wiring, frontend types + client.
- 28 tasks (QB-001…QB-028) each with rollback and acceptance tests.

EP-01 ships the Question Bank as the master source of truth with zero behavior change to Online Tests, Offline Exams, AI, or the legacy question-bank path.
