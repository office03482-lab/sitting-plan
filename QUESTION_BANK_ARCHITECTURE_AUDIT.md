# Question Bank & Examination System — Complete Architectural Audit

**Date:** 2026-08-03
**Scope:** Read-only audit. No code, tables, or migrations were modified.
**Repo:** C:\Users\GIRISH\Desktop\SITTING PLAN
**Stack (verified):** FastAPI (Python) → service layer → Supabase/PostgREST (PostgreSQL 15+); React 18 + TypeScript + Vite frontend; Flutter mobile app; Supabase SQL migrations.

> **Headline finding:** A **professional-grade enterprise Question Bank ALREADY EXISTS** (schema, backend routes, and full frontend builder). However it is **completely unused — all `qb_*` tables have 0 rows**. Live exams/tests store questions inline (19 questions in 11 tests, 1 offline exam with 0 questions) with no link back to the bank. The AI paper generator is real and working on the backend, but the frontend AI/OCR/PDF tools are **simulated**. The correct move is to **extend and unify what exists**, not build from scratch.

---

## PHASE 1 — Existing System Audit

### 1.1 What exists today (inventory)

| Layer | Question Bank / Exam artifact | Status |
|---|---|---|
| **Backend routes** | `/api/question-bank/*` (276 lines) — exam-types, taxonomy, tags, sources, questions CRUD, versions, history | Live, wired in `main.py` |
| **Backend service** | `supabase_question_bank.py` (193 lines) — full CRUD + versioning + history | Live |
| **DB tables** | `qb_*` (8 tables) — schema exists in live DB | **0 rows of data** |
| **Backend routes** | `/api/online-tests/*` (1175 lines) — full test lifecycle incl. question bank import + AI generate | Live |
| **Backend service** | `supabase_online_tests.py` (1833 lines) — tests, attempts, scoring, results, analytics | Live |
| **DB tables** | `online_tests.*` (7 tables) + public views | **In use** (11 tests, 19 questions, 4 attempts/results) |
| **Backend routes** | `/api/offline-exams/*` (540 lines) — exams, hall tickets, attendance, evaluations, results, seating | Live |
| **Backend service** | `supabase_offline_exams.py` (1079 lines) | Live |
| **DB tables** | `exam.*` (10 tables) + public views | **1 exam, 0 questions** |
| **Backend routes** | `/api/teacher-ai/question-paper` (+ alias `/api/ai`) — grounded paper generator | Live, credit-gated (5 credits) |
| **Backend service** | `supabase_teacher_ai.py` (858 lines) | Live (5 jobs, 2 papers generated) |
| **Backend routes** | `/api/exams/*` (legacy) — bare CRUD on old exam stub | Live (legacy) |
| **Frontend pages** | `QuestionBankList`, `QuestionBuilder` (shared bank + test mode), `QuestionBankEditor`, `OnlineTests*` (list/create/edit/take/results), `OfflineExams*` (create 6-step wizard, details 9 tabs, evaluate, question builder) | Live routes |
| **Frontend components** | `pages/questionBank/` — `ActionBar`, `RichTextEditor`, `OptionRow`, `FormulaPanel` (LaTeX), `LivePreview`, `TaxonomySelect`, `VersionHistory`, `taxonomyData.ts` (8 exam types, 13 question types, difficulty/bloom/tags/languages) | Live |
| **Frontend API client** | `services/api.ts` — full question-bank, online-test, offline-exam, teacher-ai clients | Live |
| **Permissions** | `online_tests.*` (6 keys), `offline_exams.*` (4 keys), `teacher_ai.*` (3 keys), seeded to school_admin/platform_admin/teacher/student/parent/viewer | Live |
| **Mobile (Flutter)** | Online-test **read-only listing** for students/teachers; no question building, no offline exams, no test-taking | Read-only |
| **AI backend** | Gemini provider (`gemini-2.5-flash`, JSON mode), credit engine (709 lines), entitlement/route-retrofit gating | Live |

### 1.2 Term coverage (grep across whole repo)

Every requested term (Question Bank, Question Repository/Library/Pool, Paper Generator, Question Paper, MCQ, Subjective, Test/Exam Questions, Question Import/Export, Question Categories, Chapter/Topic Mapping, Tags, Difficulty, Bloom Taxonomy, Question Images/Solutions/Options/Metadata) **has a matching implementation artifact** — mostly in the `qb_*` question bank system, the online-tests system, and the offline-exams system. Details per term appear throughout this report.

### 1.3 The two-bank problem (critical)

There are **two disconnected question-bank implementations**:

1. **`qb_questions`** (from `backend/migrations/003_question_bank_taxonomy.sql`) — *rich*: taxonomy FKs to `qb_taxonomy_nodes` (subject→chapter→topic→sub_topic), status workflow, versioning, history, tags, sources, hints/solutions, `estimated_time_seconds`, language, visibility, HTML fields. **Backed by the full `QuestionBuilder` UI. 0 rows.**
2. **`online_tests.question_bank`** (from `20260618_056`) — *simple*: **plain text** `subject/chapter/topic` columns, no taxonomy, no status, no versioning. Exposed as `public.online_test_question_bank`. **0 rows.**

`qb_bank_test_links` (M2M question↔test) exists but has **no FK to any tests table** and **no code path** uses it — dead table.

No sync/migration exists between the two banks. Questions are currently authored **directly inside tests** (`online_tests.test_questions` 19 rows; `exam.exam_questions` 0 rows) — so there is no reuse, no bank-driven paper construction, and no shared question identity.

---

## PHASE 2 — Database Audit

### 2.1 Live database (verified against Supabase — 159 exposed PostgREST paths)

#### A. Question Bank (`qb_*`, schema currently empty)

**`qb_exam_types`** — Exam-type catalog (NEET/JEE/etc).
Columns: `id, school_id, name, slug, display_order, is_active, created_at, updated_at`. Unique `(school_id, slug)`. RLS enabled, service-role policies.

**`qb_taxonomy_nodes`** — Self-referential taxonomy tree.
Columns: `id, school_id, parent_id→self, exam_type_slug, node_type ('subject'|'chapter'|'topic'|'sub_topic'), name, display_order, is_system, is_active, created_at, updated_at`. Indexes: `(school_id,parent_id)`, `(school_id,exam_type_slug,node_type)`.
**Gap:** not FK-linked to `public.subjects` / `public.batches` (parallel taxonomy, duplicated subject lists).

**`qb_tags`** / **`qb_sources`** — tag & source catalogs. Unique `(school_id, slug)` / `(school_id, name)`.

**`qb_questions`** — The main bank table (rich).
Columns: `id, school_id, created_by, updated_by, question_code`, taxonomy (`exam_type_slug, subject_id, chapter_id, topic_id, sub_topic_id → qb_taxonomy_nodes`, plus free-text fallbacks `subject, chapter, topic, sub_topic`), content (`question_type, difficulty_level, prompt_text, prompt_html, option_items JSONB, answer_key JSONB, explanation, explanation_html, teacher_notes, student_notes, hints, solution, solution_html`), scoring (`marks, negative_marks, estimated_time_seconds`), source (`source_id, source_name`), `language, visibility ('private'|'school'|'public'), question_owner`, metadata (`metadata JSONB, question_image_url, tags JSONB, status draft|review|approved|published|archived|rejected, display_order, version, is_active, deleted_at, created_at, updated_at`). Indexes on school/exam_type/status/difficulty/subject.
**Missing:** Bloom taxonomy column, image table, usage-count, NCERT/exam-mapping, per-question LaTeX field (only free HTML).

**`qb_question_versions`** — full snapshot versioning. `snapshot JSONB`, indexed `(question_id, version DESC)`.
**`qb_question_history`** — audit log of field changes. Indexed `(question_id, created_at DESC)`.
**`qb_bank_test_links`** — M2M bank→test. **No FK target for `test_id`; unused.**

#### B. Online tests (`online_tests.*` — in use)

**`tests`** (11 rows) — `id, school_id→schools, subject_id→subjects (single), batch_id→batches, created_by/published_by/deleted_by→profiles, test_code (unique per school), title, description, instructions, test_type (objective|subjective|mixed|practice), delivery_mode (scheduled|practice|assignment), status (draft|published|in_progress|completed|archived|cancelled), duration_minutes, total_marks, pass_marks, max_attempts, shuffle_questions, shuffle_options, show_result_immediately, allow_review, starts_at, ends_at, published_at, metadata JSONB, is_active, deleted_at, created_at, updated_at`. 4 indexes + unique partial index on `(school_id, lower(test_code))`.
**Gaps:** single `subject_id` FK (frontend multi-selects via `metadata`), `shuffle_questions/shuffle_options` inert (no server-side shuffle), no blueprint/difficulty-distribution config, no negative-marking flag at test level, no per-question `estimated_time`.

**`test_sections`** — sections per test (question_type per section incl. `mixed`, marks/negative per question, question_count).

**`test_questions`** (19 rows) — **inline question copy**: `question_type (single_choice|multiple_choice|true_false|short_answer|long_answer|numeric)`, `difficulty_level (easy|medium|hard)`, `prompt_text, option_items JSONB, answer_key JSONB, explanation, marks, negative_marks, metadata`. Unique `(section_id, display_order)`.
**Gap:** **no `bank_question_id` FK** → no reuse/versioning/tracking back to a bank.

**`test_attempts`** (4) — `attempt_number` (unique per test/student), status, timestamps, snapshots, `time_spent_seconds`.
**`test_responses`** — per-question response payload JSONB, `is_marked_for_review`, `is_correct`, `marks_awarded`. Unique `(attempt_id, question_id)`.
**`test_results`** (4) — scores, correct/incorrect/unanswered counts, `rank_in_batch/rank_in_school`, percentage, published_at. Unique `(attempt_id)`.
**`question_bank`** (0 rows) — the *simple* text-based bank (see 1.3).
All tables: RLS + `online_tests.write_audit_log()` DB trigger → `public.audit_logs`.

#### C. Offline exams (`exam.*` — 1 exam, 0 questions)

**`exams`** — `exam_code, subject_id (single FK), batch_id, exam_type, paper_format (mcq|...), status, duration_minutes, total_marks, pass_marks, total_sets, shuffle_questions, allow_negative_marking, exam_date/start_time/end_time, question_source (default 'question_bank'), seating_required, invigilators_required, hall_tickets_required, metadata, ...`. Index `(school_id,is_active)`.
**Gaps:** `question_source='question_bank'` is a **stored flag only — no code auto-pulls questions**; `total_sets` + `set_labels` exist; subject multi-select lives in `metadata.subjects[]` (no FK integrity).

**`exam_sections`** — sections with per-section question_type/marks/negative/question_count.
**`exam_questions`** (0) — like test_questions + `set_labels JSONB` (per-set variants). No bank FK.
**`hall_tickets`, `attendance`, `evaluations`, `exam_results`** — hall-ticket/attendance/evaluation pipeline; results unique `(exam_id, student_id)`; ranks. Evaluations manual (marks grid + Excel import).
**`seating`, `room_desks`, `room_seats`** — seating engine tables.
Views: `public.exam_*` with `security_invoker=true`. **Gap:** `exam.*` tables themselves have **no RLS policies** (gated only in Python service layer).

#### D. AI / Analytics / Warehouse (supports bank analytics)

- `ai.teacher_assistant_jobs` (5), `ai.generated_papers` (2, `question_payload JSONB`), `ai.generated_assignments`, `ai.generated_reports`, `ai.doubt_*`.
- `analytics.test_analytics` (0), `analytics.topic_performance` (0), `analytics.student_performance`, `analytics.risk_scores`.
- `warehouse.fact_tests` (4), `warehouse.fact_lms`, `warehouse.dim_course`.
- ERP master: `subjects` (17), `batches` (27), `students` (1248), `rooms`, `staff_members`.

### 2.2 Can the current schema support a professional Question Bank?

**Yes, partially — the `qb_*` schema is already close to professional.** It supports taxonomy, types, difficulty, status workflow, versioning, history, tags, sources, hints/solutions, estimated time, language, visibility, and JSONB extensibility. What it lacks (details in Phase 3/5) is **Bloom taxonomy, media assets, usage analytics, NCERT/exam mapping, and — critically — any data and any wiring into test/exam construction.**

---

## PHASE 3 — Feature Audit

| Feature | Present? | Where / Notes |
|---|---|---|
| Question Storage | ✅ | `qb_questions` (rich), `online_tests.question_bank` (simple), inline in `test_questions`/`exam_questions` |
| Question Categories | ✅ | `qb_exam_types`, `qb_tags`, `qb_sources` |
| Subjects | ✅ (parallel) | `public.subjects` (ERP) AND `qb_taxonomy_nodes` — **not linked** |
| Chapters | ✅ | `qb_taxonomy_nodes` node_type chapter |
| Topics | ✅ | `qb_taxonomy_nodes` node_type topic |
| Subtopics | ✅ | `qb_taxonomy_nodes` node_type sub_topic |
| Difficulty | ✅ | `difficulty_level easy/medium/hard` |
| Question Type | ✅ | 13 types in frontend constants; DB CHECKs allow single_choice, multiple_choice, true_false, short_answer, long_answer, numeric |
| MCQ | ✅ | single_choice + multiple_choice (multiple correct supported) |
| Integer | ✅ | `numeric` type (JEE integer-type) |
| Assertion Reason | ⚠️ | Not a DB type; only via free-form type/HTML — no structured support |
| Match the Following | ⚠️ | Not structured; could be JSONB in option_items |
| Subjective | ✅ | short_answer/long_answer (manual scoring) |
| Diagram Based | ⚠️ | Single `question_image_url` text; no structured diagram/media handling |
| Image Upload | ⚠️ | Upload API exists (uploads module) + per-option `image_url` (online tests); bank has single `question_image_url`; no media-asset table |
| LaTeX Equations | ✅ (partial) | `FormulaPanel` injects LaTeX into `prompt_html`/rich text; no dedicated latex column |
| Solutions / Hints / Explanation | ✅ | `solution, solution_html, hints, explanation, explanation_html` on `qb_questions` |
| Multiple Correct Answers | ✅ | `option_items` JSONB + multiple_choice |
| Negative Marking | ✅ | `negative_marks` on questions/sections; test-level flag on offline exams |
| Question Versioning | ✅ | `qb_question_versions` + restore API (**UI exists but not wired** — API unused) |
| Approval Workflow | ✅ | `status draft/review/approved/published/archived/rejected` |
| Language Support | ✅ | `language` column (bank only) |
| Question Search | ✅ | list API with filters + search |
| Question Filters | ✅ | exam_type/subject/chapter/topic/difficulty/type/status/pagination |
| Question Randomization | ❌ | `shuffle_questions`/`shuffle_options` flags inert; no server-side shuffle |
| Question Reuse | ❌ | No bank↔test FK; `qb_bank_test_links` dead |
| Question Import | ✅ | Online bank Excel import (`POST /online-tests/question-bank/import`); offline score import |
| Question Export | ❌ | **No export anywhere** |
| Question Statistics/Analytics | ⚠️ | Test/result analytics + `analytics.*`; no **per-question** usage stats |
| Question Usage Count | ❌ | Not tracked |
| Question History | ✅ | `qb_question_history` + audit_logs |
| Question Review | ✅ | status workflow |
| Question Editing | ✅ | full builder UI |
| Bloom Taxonomy | ⚠️ | Frontend `taxonomyData.ts` has Bloom constants, but **no DB column** |
| Expected Time / Question | ✅ | `estimated_time_seconds` (bank only) |
| NCERT / Exam mapping | ❌ | Not present |

**Frontend realism caveat:** `AIGenerator.tsx`, `OCRPanel.tsx`, `PDFImportPanel.tsx` are **simulated** (`setTimeout` + hardcoded data). The real backend `POST /online-tests/ai-generate` is **never called** by any page. `VersionHistory.tsx` is display-only; version APIs exist but no page calls them.

---

## PHASE 4 — Test Integration (how questions are obtained today)

1. **Manual entry (primary path):** teacher opens `QuestionBuilder` (bank mode `/question-bank/add`) or test/offline-exam question builder (`/online-tests/:id/build`, `/offline-exams/build/:examId`), types question + options + answer, saves → question is written **directly into `test_questions`/`exam_questions`** (or `qb_questions` if in bank mode). `OfflineExamQuestionBuilder.tsx:214-248` shows the save loop.
2. **Excel import:** `POST /online-tests/question-bank/import` (xlsx; headers `Question, Correct Answer, Difficulty, Topic, Chapter`) → `online_tests.question_bank`.
3. **Bank picker (flag only):** offline exam wizard offers `question_source = question_bank | create_new | import | pdf` but **no code auto-pulls from a bank**.
4. **AI generation:** real backend endpoint `POST /online-tests/ai-generate` (Gemini, 5 credits) creates a test + questions; **not wired into UI** (frontend AI is fake). The **teacher paper generator** (`POST /teacher-ai/question-paper`) is real, grounded on the bank/LMS/tests, persists to `ai.generated_papers`, and has been used (2 papers).
5. **No seed data:** no INSERT/seed scripts for questions anywhere. All 0-row tables confirm it.

**Scoring flow:** MCQ auto-scored by exact normalized option-id match (`supabase_online_tests.py:_score_response:525`); `short_answer`/`long_answer` return `(None, 0)` — never auto-scored (manual offline evaluations + Excel import). No server-side randomization. Results store ranks.

**Bottom line: questions are obtained manually/static per test; the bank is bypassed; randomization, reuse, and UI-driven AI are all absent in practice.**

---

## PHASE 5 — Gap Analysis (NEET / JEE Mains / JEE Adv / CBSE / State Boards)

Must-have for a professional coaching bank, **currently missing or weak**:

1. **Bank unify + wiring:** single source of truth (`qb_questions`), FK `bank_question_id` on `test_questions`/`exam_questions`, functional `qb_bank_test_links`, auto-pull from bank for offline `question_source='question_bank'`. *(Highest priority — nothing else matters without this.)*
2. **Paper generator with blueprint:** configurable sections (Physics/Chemistry/Bio/Maths), difficulty distribution (e.g. NEET: easy 20 / med 70 / hard 10), per-exam-type templates (JEE integer, assertion-reason, match-the-following, multi-correct), question reuse budget.
3. **Bloom taxonomy column** on `qb_questions` (Remember→Understand→Apply→Analyze→Evaluate→Create).
4. **Structured question-type support:** assertion-reason, match-the-following, integer, multi-correct as first-class DB types (currently only free-form/HTML or JSONB convention).
5. **Media asset table** (question stem images, diagrams, options images) with storage bucket tracking; current single-text `question_image_url` is inadequate for diagram-heavy physics/chemistry/bio.
6. **NCERT chapter mapping + exam mapping** (NEET/JEE Mains/JEE Adv/CBSE/State board tags) — needed for coaching-curriculum alignment.
7. **Question usage/performance analytics:** usage count, attempts, %correct, discriminator stats per question (feeds the "question intelligence" a coaching institute expects).
8. **Randomization:** honor `shuffle_questions`/`shuffle_options` server-side; per-set variant selection for offline exams.
9. **Export:** Excel/PDF/JSON export of bank subsets and papers.
10. **Duplicate detection & validation** for AI-generated questions (dedupe against bank, schema/answer validation).
11. **RLS on `exam.*` tables** (security hardening), and reconcile the two taxonomy worlds (`qb_taxonomy_nodes` ↔ `public.subjects`/`batches`).

---

## PHASE 6 — Recommended Architecture

**Verdict: the existing architecture is good and should be EXTENDED, not replaced.** The `qb_*` schema + `QuestionBuilder` UI + online/offline exam modules + grounded AI generator are a solid foundation. Recommended extensions (in order):

1. **Unify the bank.** Treat `qb_questions` as the single source of truth. Stop using `online_tests.question_bank` (or migrate it into `qb_questions`). Add `bank_question_id UUID` FK on `online_tests.test_questions` and `exam.exam_questions` (nullable, `on delete set null`).
2. **Fix `qb_bank_test_links`** (add FK to a tests table — best a polymorphic `source_table`/`source_id`, or two link tables) or replace with a proper `qb_question_usage` table that also counts usage.
3. **Add a paper blueprint table** (`qb_paper_blueprints` + `qb_blueprint_sections`: exam_type, section, subject, question_type, difficulty distribution, marks, negative marks, question_count, shuffle) and a **deterministic paper generator service** (select-by-difficulty-distribution from the bank, honor reuse, produce per-set variants) with a `POST /question-bank/papers/generate` API.
4. **Extend `qb_questions`** with: `bloom_taxonomy`, `expected_time_seconds` (already present), `ncert_chapter_id` (or NCERT mapping table), `exam_ids/exam_mapping` tags, `multiple_correct` flag, richer `question_type` enum (add `assertion_reason`, `match_following`), and a `qb_question_media` table (asset rows → storage bucket).
5. **Wire the frontend:** connect `AIGenerator.tsx`/`OCRPanel.tsx`/`PDFImportPanel.tsx` to the real endpoints, activate `VersionHistory` restore, add paper-blueprint builder UI, add question usage stats.
6. **Harden:** RLS on `exam.*`, indexes for the new FKs, `audit_logs` coverage for `qb_*` and `exam.*`, and a compatibility view (`public.online_test_question_bank` kept as a UNION over `qb_questions` to avoid breaking existing clients).
7. **Backward compatibility:** never drop `online_tests.question_bank`; keep legacy `/api/exams` and online-test question endpoints working; new FKs are additive.

This supports: unlimited subjects/classes/chapters/topics/questions/images/tests (all FK-scoped by `school_id`), versioning, approval workflow, analytics (via `analytics.*` + new question stats), reuse, random paper generation, online+offline tests, PDF export (new), Excel import (exists) + export (new), AI generation + validation + duplicate detection (backend ready, needs wiring/endpoints), difficulty distribution, Bloom, expected time, tags, NCERT/exam mapping (new columns/tables).

---

## PHASE 7 — AI Question Generation Readiness

**Readiness: BACKEND 85% ready; FRONTEND 0% wired.**

Already in place:
- **Gemini provider** (`ai_provider.py`): JSON-mode generation, retry, quota → `AIQuotaError`.
- **Credit engine** (`ai_credit_engine.py`, 709 lines): wallet/ledger, idempotent debits, expiry, concurrency-safe (tested).
- **Entitlement gating** (`route_retrofit.py`): credit + feature flags on AI routes.
- **Real generator #1:** `POST /online-tests/ai-generate` → Gemini creates a whole test with questions (metadata tag `source: ai_generator`).
- **Real generator #2:** `POST /teacher-ai/question-paper` → **bank-grounded** fallback + Gemini refinement → persists to `ai.generated_papers`; 2 papers already produced.
- **Analytics scaffolding** for per-question intelligence.

Required to be fully AI-question-ready:
1. **Wire the frontend** `AIGenerator.tsx` to `generateOnlineAiTest` (currently fakes output with `setTimeout`).
2. **AI question validation endpoint:** after generation, validate schema (options non-empty, exactly-one-correct, marks ≥ 0), content (prompt non-empty), and optionally LLM sanity check.
3. **AI duplicate detection endpoint:** semantic dedupe against existing `qb_questions` (vector/similarity or embeddings; at minimum a normalized-text match).
4. **Single-question generation** into the bank (bank mode) — current generators target whole tests; coaching workflows need "add 10 questions to chapter X at difficulty Y".
5. **Blueprint-aware generation:** pass difficulty distribution + exam type (NEET/JEE) into the prompt for syllabus-appropriate papers.
6. **AI credit budget + cost guardrails** for bulk generation, and an approval workflow gate before AI questions are published.

---

## PHASE 8 — Deliverables

### 8.1 Complete architecture report
This document (Phases 1–7).

### 8.2 Existing database map
Live Supabase (159 PostgREST paths): `qb_*` (8 tables, empty), `online_tests.*` (7 tables + views, in use), `exam.*` (10 tables + views, 1 exam), `ai.*` (papers/jobs), `analytics.*`, `warehouse.*` (`fact_tests`), ERP master (`subjects` 17, `batches` 27, `students` 1248, `rooms`). Full column detail in Phase 2.

### 8.3 Existing APIs
- `/api/question-bank/*`: exam-types, taxonomy CRUD, tags, sources, questions CRUD, versions list/restore, history.
- `/api/online-tests/*`: tests CRUD + publish/close/duplicate, test questions CRUD, question-bank list/create/import, `ai-generate`, attempts (start/save/submit), results, analytics.
- `/api/offline-exams/*`: exams CRUD + publish/duplicate, subjects, questions CRUD, hall-tickets, attendance, evaluations + Excel import, results/publish, seating, analytics.
- `/api/teacher-ai/*`: question-paper, assignment, lesson-plan, report-comments (credit-gated).
- Legacy `/api/exams/*` (bare CRUD).

### 8.4 Existing frontend flow
Login (portal tabs incl. `online_tests`/`offline_exams` permission-gated) → Module pages → QuestionBankList (`/question-bank`, filters + delete + xlsx import) → QuestionBuilder (bank & test modes; RichText, Options, Formula/LaTeX, LivePreview, TaxonomySelect, fake AI/OCR/PDF, VersionHistory) → OnlineTestCreate/Edit wizard → OnlineTestTake (timer/flag/auto-submit) → OnlineTestResults (analytics drilldown); OfflineExamCreate 6-step wizard → OfflineExamDetails 9 tabs → Evaluate (marks grid + xlsx) → Results publish → Seating/Hall tickets.

### 8.5 Existing admin workflow
Platform admin / school admin / teacher (seeded permissions `online_tests.*`, `offline_exams.*`, `teacher_ai.*`): create test/exam → add questions manually (or import xlsx / simulated AI) → publish → students attempt (online) or hall-ticket/attendance/paper (offline) → auto-score MCQs / manual evaluations → publish results with ranks → analytics. **No bank-based construction, no randomization, no blueprint, no export today.**

### 8.6 Missing features
See Phase 5 (13 gaps). Headline: bank unify+wiring, blueprint paper generator, Bloom column, structured assertion/match types, media table, NCERT/exam mapping, question usage analytics, server-side shuffle, export, duplicate detection, frontend AI wiring, `exam.*` RLS.

### 8.7 Recommended database schema
- **Extend `qb_questions`:** add `bloom_taxonomy TEXT`, `question_type` enum + `assertion_reason`, `match_following`, `multiple_correct BOOLEAN`, `expected_time_seconds INT` (exists), `ncert_chapter_id UUID`, `exam_tags JSONB`.
- **New tables:** `qb_question_media` (id, question_id, asset_type, bucket, storage_path, public_url, created_by, created_at); `qb_paper_blueprints` (school_id, name, exam_type_slug, paper_format, total_marks, duration_minutes, status, metadata); `qb_blueprint_sections` (blueprint_id, section_name, subject, question_type, question_count, marks_per_question, negative_marks, difficulty_distribution JSONB, display_order); `qb_question_stats` (question_id, usage_count, attempts, correct_count, accuracy, updated_at) or fold into analytics.
- **Modify:** add `bank_question_id UUID` on `online_tests.test_questions` + `exam.exam_questions`; fix/repurpose `qb_bank_test_links` (FK target) or add `qb_question_usage`; add indexes on new FKs.
- **Keep everything additive** — no destructive changes.

### 8.8 Recommended APIs
- `POST /question-bank/papers/generate` (blueprint → structured paper; deterministic, difficulty-distributed, set variants).
- `GET /question-bank/papers` / `GET /question-bank/papers/:id` (list/detail of generated papers).
- `POST /question-bank/export` (Excel/PDF/JSON by filters).
- `POST /question-bank/questions/generate` (single/batch AI questions into the bank, credit-gated).
- `POST /question-bank/questions/validate` (AI/schema validation).
- `POST /question-bank/questions/dedupe-check` (duplicate detection).
- `GET /question-bank/questions/:id/stats` + `GET /question-bank/analytics` (usage/performance).
- `POST /question-bank/blueprints` + `GET /question-bank/blueprints` (paper template CRUD).
- Extend existing `PUT /question-bank/questions/{id}` to accept `bloom_taxonomy`, `ncert_chapter_id`, media uploads.

### 8.9 Recommended UI
- **Question Bank home:** expand `QuestionBankList` with Bloom/NCERT/exam-mapping filters, bulk actions (export, publish/archive), usage/accuracy columns, duplicates badge.
- **QuestionBuilder:** enable real AI/OCR/PDF panels; add Bloom selector, NCERT/exam mapping chips, media upload per question/option, restore from version history.
- **New Paper Builder wizard:** pick exam type → auto-load blueprint → configure sections/difficulty distribution → generate from bank → preview/save/publish → export PDF.
- **Analytics view:** per-question usage + accuracy + difficulty calibration; per-chapter coverage heatmap for NEET/JEE syllabus.
- All gated behind existing `online_tests.manage` / new `question_bank.*` permissions.

### 8.10 Migration strategy
1. **Phase A (additive DDL):** `bank_question_id` FKs, Bloom/NCERT/type columns, `qb_question_media`, `qb_paper_blueprints`, `qb_blueprint_sections`, `qb_question_stats`; keep all existing columns/tables.
2. **Phase B (data backfill):** migrate `online_tests.question_bank` (if any) → `qb_questions`; create `qb_questions` rows from existing inline `test_questions`/`exam_questions` so future papers can reuse them.
3. **Phase C (compat views):** keep `public.online_test_question_bank` as a UNION/compat view; keep online/offline question endpoints untouched.
4. **Phase D (feature rollout):** paper generator, export, question stats, AI validation/dedupe, frontend wiring.
5. **Phase E (hardening):** RLS on `exam.*`, `audit_logs` for `qb_*`/`exam.*`, index audit, permission catalog (`question_bank.*` keys).

### 8.11 Backward compatibility plan
- All changes **additive** (new columns/tables/endpoints only; no drops, no renames of existing columns).
- Existing `online_tests.question_bank`, `test_questions`, `exam_questions`, legacy `/api/exams` remain fully functional.
- New `bank_question_id` nullable with `on delete set null` — old rows unaffected.
- Compat views preserved; `supabase_api_spec.json` refreshed only when endpoints change.
- Permissions: new `question_bank.*` keys seeded alongside existing `online_tests.*`/`offline_exams.*`; existing roles keep current access.

### 8.12 Step-by-step implementation roadmap
1. **Week 1 — Foundation (Phase A):** additive schema (bank FKs, Bloom/NCERT/type columns, media table, blueprint tables, stats table); refresh `supabase_api_spec.json`.
2. **Week 2 — Unify:** bank-backfill service (inline → `qb_questions`), compat views, `qb_bank_test_links` fix/`qb_question_usage`.
3. **Week 3 — Paper engine:** blueprint CRUD APIs + deterministic paper generator + per-set variant logic.
4. **Week 4 — Export & stats:** Excel/PDF/JSON export; question usage/accuracy APIs + analytics UI.
5. **Week 5 — AI wiring:** connect frontend AI/OCR/PDF to real endpoints; add single/batch question generation; validation + dedupe endpoints; credit budget + approval gate.
6. **Week 6 — Frontend:** Blueprint Paper Builder wizard; Bloom/NCERT/exam-mapping in builder + filters; version restore activation.
7. **Week 7 — Hardening & UAT:** RLS on `exam.*`, audit triggers, permission seed (`question_bank.*`), end-to-end regression (online + offline exams), load test with the bank seeded.
8. **Week 8 — Rollout:** pilot with one coaching batch, NEET/JEE blueprints seeded, gather usage data, iterate.

---

### Verification notes
- Live DB row counts confirmed via Supabase service role: `qb_*` = 0/0/0/0/0/0/0/0; `online_test_tests`=11, `online_test_test_questions`=19, attempts=4, results=4; `exam_exams`=1, `exam_exam_questions`=0; `ai_teacher_assistant_jobs`=5, `ai_generated_papers`=2; `subjects`=17, `batches`=27, `students`=1248.
- No files were modified during this audit.
