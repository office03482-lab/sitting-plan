# FINAL ENTERPRISE EXAMINATION ARCHITECTURE

**Version:** 1.0 (FINAL — permanent design reference)
**Date:** 2026-08-03
**Status:** Architecture specification. No code, SQL, migrations, or files were created/modified to produce this document.
**Baseline:** `QUESTION_BANK_ARCHITECTURE_AUDIT.md` (read-only audit, 2026-08-03) + live schema/route verification.

> This document is the **single source of truth** for the entire Examination Module. All future development — schema, backend, frontend, mobile, AI — must conform to this specification. It extends the existing application **additively and backward-compatibly**; nothing existing is dropped or renamed.

---

## 0. Executive Summary & Guiding Principles

### 0.1 The existing foundation (verified baseline)

The product already ships a substantial, professional-grade examination stack that must be **extended, not replaced**:

| Layer | Artifact (verified) | State |
|---|---|---|
| Bank backend | `/api/question-bank/*` routes + `supabase_question_bank.py` (CRUD, taxonomy, versions, history) | Live, unused (0 rows) |
| Bank schema | `qb_questions`, `qb_taxonomy_nodes`, `qb_tags`, `qb_sources`, `qb_exam_types`, `qb_question_versions`, `qb_question_history`, `qb_bank_test_links` | Live, **0 rows** |
| Online tests | `/api/online-tests/*` + `supabase_online_tests.py` + `online_tests.*` schema (tests, sections, questions, attempts, responses, results) | Live, in use (11 tests, 19 questions) |
| Offline exams | `/api/offline-exams/*` + `supabase_offline_exams.py` + `exam.*` schema (exams, sections, questions, hall tickets, attendance, evaluations, results, seating) | Live (1 exam, 0 questions) |
| AI | Gemini provider (JSON mode), credit engine, entitlement gating, teacher paper generator | Live (2 papers) |
| Frontend | `QuestionBankList`, `QuestionBuilder`, `OnlineTests*`, `OfflineExams*`, `pages/questionBank/*` | Live routes; AI/OCR/PDF panels **simulated** |
| Analytics | `analytics.*`, `warehouse.*` (fact_tests) | Scaffolding present |
| Permissions | `online_tests` / `online_tests.view` / `online_tests.attempt`; `offline_exams.*`; `teacher_ai.*`; roles: `platform_admin`, `school_admin`, `teacher`, `student`, `parent`, `staff`, `viewer` + `managed_*` per-person roles | Live |

**Key structural decision:** `qb_questions` becomes the **single master bank**. `online_tests.question_bank` (simple text-based duplicate) and inline `online_tests.test_questions` / `exam.exam_questions` rows become **linked snapshots/references**, never the source of truth. All extensions are **additive** (new columns, new tables, new endpoints, new permission keys); existing tables/endpoints remain fully functional.

### 0.2 Design principles

1. **Bank-first.** Every question has exactly one canonical row (`qb_questions`). Tests/exams reference it and snapshot at delivery time.
2. **Additive & backward compatible.** No drops, no renames, no breaking column changes. Legacy endpoints keep working. Compat views preserve old clients.
3. **Tenant-correct multi-school.** Global master bank is read-mostly; schools derive their own banks; private/teacher questions never leak.
4. **Deterministic generation.** Blueprints + seeded RNG produce reproducible papers (same blueprint + same seed = same paper), enabling QA and per-set variants.
5. **Everything auditable.** Every create/edit/AI action/review decision writes an immutable audit record.
6. **AI is an assistant, not the author.** All AI output lands in draft/review and requires human approval before publication.
7. **Design for 10M questions and millions of attempts** now (schema, keys, sharding readiness), deliver incrementally.
8. **One identity model.** Permissions are hierarchical prefix keys (`question_bank` → `question_bank.view` → `question_bank.manage`) consistent with existing `permissionMatches` (`AuthProvider.tsx:255`).

### 0.3 Notation used in this document

- **Tables** are described as design concepts (names + responsibilities + key fields). Exact DDL is intentionally **not** produced here (this is an architecture document, not a migration).
- **API** endpoints are described by method + path + purpose. They will be implemented in the existing FastAPI → service → PostgREST pattern.
- **New** items are explicitly labeled `[NEW]`; existing items are labeled `[EXISTING]`.

---

## 1. Phase 1 — Complete Examination Workflow

### 1.1 End-to-end workflow (author → student → analytics)

```
┌────────────┐   ┌──────────────────────────────────────────────────────────────────────────────┐
│  Teacher    │   │                        EXAMINATION LIFE CYCLE                                 │
│  Login      │   │                                                                              │
└─────┬──────┘   │  ┌──────────┐ ┌────────────┐ ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐  │
      │          │  │ Question │ │ Blueprint  │ │ Paper   │ │ Delivery │ │ Student  │ │ Eval & │  │
      ▼          │  │  Bank    │ │  Builder   │ │ Generator│ │ (online/ │ │ Attempt  │ │Analytics│ │
  Question Bank  │  └────┬─────┘ └─────┬──────┘ └────┬────┘ │ offline) │ └────┬─────┘ └───┬────┘  │
      │          │       │             │             │     └──────────┘      │           │       │
      ▼          │       ▼             ▼             ▼                        ▼           ▼       │
  Create/Author  │  draft → review →  define rules  select+build +  randomize  submit     auto +   │
      │          │  approval →        (Ph2)         variants (Ph2/6)   sets     answer    manual   │
      ▼          │  publish (Ph1.2)                 (Ph1.5)          (Ph7)   (Ph7)     scoring    │
  Review/Approve │                                                                     (Ph1.6)    │
      │          │                                                                                │
      ▼          │                                                                                │
  Publish        │                                                                                │
      │          │                                                                                │
      ▼          ▼                                                                                │
  (back to bank) Blueprint ──► Paper ──► Online Test ─┐  ──► Attempts ──► Evaluation ──► Analytics  │
                        └──► Offline Exam ───────────┘                                             │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Stage-by-stage specification

#### Stage A — Teacher Login
- Existing auth (Supabase auth + portal intents) continues unchanged. `school_admin`, `teacher`, `platform_admin`, and new review roles are the authoring actors.
- Role resolution: existing `roles`/`role_permissions` tables; new `question_bank.*` permission keys gate the module.
- School context: the active school (from school membership / platform-admin school picker) scopes everything the teacher sees. Global master-bank visibility is governed by `question_bank.global` permission.

#### Stage B — Question Bank
- Entry surface: sidebar "Question Bank" (the module currently missing from the sidebar — see Audit; navigation is a UX gap this architecture fixes).
- Bank views: My Questions, School Bank, Global Master, Shared With Me, Drafts, Pending Review, Published, Archived, Rejected. Filters: exam type, subject, class, chapter, topic, sub-topic, difficulty, Bloom, question type, status, source, tags, language, NCERT/exam mapping, created-by, date range.
- Bulk actions: multi-select → publish, archive, delete (soft), move (change owner bank), tag, export, assign reviewer.

#### Stage C — Question Creation
- Single authoring via the existing `QuestionBuilder` pattern (rich text, LaTeX via `FormulaPanel`, options, images, answer key, explanation, solution, hints, teacher/student notes, tags, source, language, marks/negative/time).
- **Question types (canonical enum, extended `[NEW]`):** single_choice, multiple_choice, true_false, assertion_reason, match_following, integer (numeric), short_answer, long_answer, case_study (with passage), comprehension, diagram_label. Existing DB CHECK for `question_type` must be extended additively (new values; existing values untouched).
- **Structured metadata `[NEW]`:** `bloom_taxonomy` (Remember→Create), `ncert_chapter_id`, `exam_tags` (NEET/JEE-Mains/JEE-Adv/CBSE/State), `multiple_correct`, `expected_time_seconds`, `language`, `difficulty_predicted_by_ai` vs `difficulty_calibrated` (usage-based), tags.
- AI authoring is available at this stage (see Phase 4) and always lands as **draft** with `source=ai` + full audit.
- Creation persists to `qb_questions` (draft). Inline-into-test authoring continues to work but is transparently back-written/linked to the bank (Stage C rule: **no orphan questions**).

#### Stage D — Review
- A question moves `draft → review` when the author requests review.
- Reviewer assigns: self-review, peer reviewer, senior faculty, HOD, or route via bulk assignment.
- Reviewer actions: approve, request-changes (with comment), reject (with reason), approve-with-changes (approve current, note improvements).
- Quality checklist must be completed before approval (Phase 5). Each decision is audited.

#### Stage E — Approval
- Configurable chain (school default): Teacher → Reviewer → Senior Faculty → HOD → (optional) Academic Head. Chain depth is a school setting (`metadata.review_chain`).
- Final state `approved` (may be auto-`published` or held for publish, per school policy).

#### Stage F — Publishing
- `approved → published` by author/senior/HOD. Published = eligible for paper generation and reuse.
- **Unpublish/withdraw:** `emergency_withdraw` (Phase 5) instant-retires a question from live use without deleting history.

#### Stage G — Blueprint Creation (Phase 2)
- Teacher picks exam type → template loads (NEET/JEE defaults) → defines sections, difficulty %, Bloom %, question-type %, marks, negative, NCERT weightage, PYQ %, time, sets, language, randomization, exclusions, duplicates, locks, AI suggestions.
- Blueprints are saved, versioned, reusable, shareable within school.

#### Stage H — Paper Generation
- Deterministic engine selects from `qb_questions` per blueprint rules (Phase 2/6). Produces a paper with sections, questions, answer key, per-set variants.
- Output can be: saved paper (reusable), pushed to Online Test, pushed to Offline Exam, or exported.

#### Stage I — Online Test / Offline Exam
- **Online:** test object (`online_tests.tests`) is created from paper; delivery via existing `OnlineTestTake` (timer, sections, auto-save, review flags, auto-submit). Randomization now server-side.
- **Offline:** exam object (`exam.exams`) with sets A/B/C/D, answer keys, OMR design, hall tickets, attendance, seating, invigilation.

#### Stage J — Student Attempts
- Online: session starts (existing `test_attempts`), questions delivered from the **snapshot** made at publish time, responses recorded (`test_responses`).
- Offline: paper printed/distributed by set; OMR or booklet submitted; attendance verified.

#### Stage K — Evaluation
- Online: MCQ/numeric auto-scored (existing exact-match scoring extended for assertion/reason, match-following, multi-correct, integer ranges).
- Subjective: manual evaluation UI (existing grid + Excel import) enhanced with AI-assisted scoring proposals (never automatic final).
- Offline: OMR import + manual grid. Answer keys per set.

#### Stage L — Analytics
- Post-evaluation: results computed (existing `test_results`/`exam_results` + ranks). Feed `analytics.*` and new per-question stats (Phase 8): accuracy, discriminability, difficulty calibration, chapter/Bloom/NCERT coverage, teacher performance, weak topics.

### 1.3 State machine (question)

```
draft ──request──► review ──approve──► approved ──publish──► published ──archive──► archived
  ▲                   │                  │                       │
  └──edit(same ver)──┘                  │                       ├──withdraw──► withdrawn(review)
   (new version on content change)      └──reject──► rejected ──┘
                                         └──request-changes──► draft (revision)
```

Content edits to a question always bump `version` (Phase 11 Versioning Strategy); status metadata edits do not.

---

## 2. Phase 2 — Blueprint System PRD

### 2.1 Purpose

The Blueprint Engine converts curriculum + exam requirements into a **deterministic, reproducible, exam-accurate paper composition rule-set**. It is the contract between syllabus planning and paper generation.

### 2.2 Blueprint data model (concepts)

**`qb_blueprints` `[NEW]`** — one row per reusable blueprint.
Responsibilities: identity, ownership, versioning, status, audit.
Key fields (concept): `id, school_id, created_by, name, slug, exam_type_slug, paper_format, total_marks, duration_minutes, total_questions, negative_marking_flag, pass_marks, language, status (draft|active|archived), version, is_template (platform-level), metadata JSONB, is_active, deleted_at, timestamps`.

**`qb_blueprint_sections` `[NEW]`** — one row per section inside a blueprint.
Key fields: `id, blueprint_id, section_name, display_order, subject_id (→ qb_taxonomy_nodes or ERP subjects), question_type, question_count, marks_per_question, negative_marks, min/max difficulty, fixed_questions JSONB (locked question IDs), source_bank_scope`.

**`qb_blueprint_rules` `[NEW]`** — distribution rules attached to a blueprint (or section).
Key fields: `id, blueprint_id, section_id (nullable), rule_type, distribution JSONB, is_active`.
`rule_type` values: `difficulty_distribution` (e.g. easy 20% / medium 70% / hard 10%), `bloom_distribution` (Remember 10, Understand 30, Apply 40, Analyze 15, Evaluate 5), `question_type_distribution`, `marks_distribution`, `ncert_weightage` (chapter weight map), `previous_year_percent`, `chapter_coverage` (min per chapter), `topic_coverage` (min per topic).

### 2.3 Blueprint fields — full PRD

| Parameter | Description | Example | Behavior in generator |
|---|---|---|---|
| **Subject** | Subject scope | Physics | Filter `qb_questions` by subject node |
| **Class** | Class scope | Class 12 | Maps to taxonomy/ERP class filter |
| **Course** | Course scope | NEET / JEE-Mains | Maps to `exam_type_slug` + `exam_tags` |
| **Batch** | Batch scope | Batch 2027-A | Optional; restricts candidate pool, not question source |
| **Exam Type** | NEET/JEE/CBSE/State | NEET | Loads template defaults |
| **Chapter / Topic / Sub-topic** | Taxonomy scope | Ch.3 Laws of Motion → Topic: FBD | Filter + coverage budget |
| **Difficulty %** | % per difficulty | 20/70/10 | Selector quota per bucket |
| **Bloom Distribution** | % per Bloom level | R10 U30 A40 An15 E5 | Selector quota |
| **Question Type Distribution** | % per type | SC 80 / Integer 20 | Per-section composition |
| **Marks Distribution** | marks per question, total | 4/180 | Section total = count × marks |
| **NCERT Weightage** | weight per NCERT chapter | Ch.1: 5%, Ch.2: 8% | Weighted sampling within NCERT-mapped pool |
| **Previous Year %** | % of paper from PYQ-sourced questions | 60% | Bias sampling toward `source_type=pyq` |
| **Negative Marking** | on/off + value | −1 | Applied at section/test level |
| **Paper Time** | duration | 180 min | Delivery + offline printing |
| **Number of Sets** | A/B/C/D… | 4 | Generator produces per-set variant selections |
| **Language** | paper language | Hindi/English | Filter `language`, bilingual flag |
| **Randomization Rules** | seed, per-set shuffling, option shuffle | seed=paper#, per-set question shuffle, options fixed per question in a set | Deterministic shuffle |
| **Question Exclusions** | never-use list | Question IDs / tags / chapters | Hard filter before selection |
| **Duplicate Rules** | across-sections / across-sets reuse policy | No dup across sets | Post-selection dedupe with constraint solve |
| **Manual Lock Questions** | fixed must-include | Q: 5 specific IDs | Pre-seeded mandatory picks |
| **AI Suggestions** | recommended composition | "Low coverage: Thermodynamics" | Blueprint editor AI panel (draft suggestions only) |

### 2.4 Blueprint UX & workflow

1. **Entry:** Bank → Blueprints → "New Blueprint" (or duplicate an existing).
2. **Wizard (5 steps):**
   - *Step 1 — Identity:* name, exam type, paper format, language, class/course/batch, total marks, duration, negative marking.
   - *Step 2 — Sections:* add sections (Physics / Chemistry / Bio), per-section question type, count, marks, negative, optional locked questions.
   - *Step 3 — Distributions:* difficulty %, Bloom %, question-type %, NCERT weightage, PYQ %; sliders + live total validation (sum=100%).
   - *Step 4 — Rules:* exclusions, duplicate policy, set count, randomization seed, language.
   - *Step 5 — AI review & save:* AI validates coverage balance, flags under-covered chapters, suggests tweaks; save as draft or active.
3. **Blueprint versioning:** every save bumps version (snapshot in `qb_blueprint_versions` `[NEW]`). Papers record which blueprint **version** generated them.
4. **Preview:** "Preview paper" runs the generator in dry-run (no persistence) showing composition vs blueprint targets (coverage bars).
5. **Templates:** platform ships `is_template=true` blueprints for NEET/JEE-Mains/JEE-Adv/CBSE/State boards; schools copy-then-edit.

### 2.5 Validation rules (PRD-level)

- Section question count × marks_per_question == section total.
- Sum of section totals == `total_marks`.
- Difficulty/Bloom distributions sum to 100% per section (or explicitly "auto").
- NCERT weightage sum to 100% per subject (or auto).
- Exclusions always win over inclusion.
- Locked questions must satisfy type/marks/negative constraints of their section; otherwise hard error at generate time.

---

## 3. Phase 3 — Multi-School SaaS Architecture

### 3.1 The five question scopes (ownership model)

| Scope | Owner | Visible to | Source | Persistence |
|---|---|---|---|---|
| **Global Master** | Platform (vendor) | All schools with license | `qb_questions.school_id = NULL`, `is_global=true` | Shared read-mostly pool |
| **School Bank** | School | That school's teachers | School-owned rows | `school_id` scoped |
| **Teacher Private** | Teacher | Only that teacher | `visibility='private'`, `created_by` | Same school |
| **Shared** | School/Teacher | Selected teachers/groups | `qb_question_shares` `[NEW]` | Explicit grant |
| **Imported/Copied** | School | That school | Copied from master or another school | New owned rows with provenance |

### 3.2 Relationship model

- **Copy from Master:** school "checks out" a global question → creates an owned copy row (`source_question_id` → global row, `copy_mode='snapshot'`). School edits its copy freely; global updates don't propagate.
- **Reference Master:** school references the global row **live** (no copy). Edits not allowed; updates from vendor propagate. Great for standardized content. `reference_mode='live'`.
- **Import from Other Schools:** only possible school→school via an explicit **share** (below); raw cross-tenant copying is denied. Import creates owned copies with provenance (`origin_school_id`).
- **Hybrid:** a reference that the school promotes to a copy when it needs to edit (break-link).

### 3.3 Licensing model `[NEW]`

- **`qb_licenses` `[NEW]`:** `id, school_id, license_scope (global|school), granted_question_ids JSONB or count, expiry, max_refs, allow_copy, allow_edit, status`.
- Global master content is gated: `question_bank.global.view` to read; `question_bank.global.copy` to check-out under an active license count.
- Usage metering: each copy/ref increments `qb_license_usage` `[NEW]` (question_id, school_id, action, at). Reports feed billing (existing `finance.*` integration point).
- Vendor withdrawal: license expiry revokes **new** copies but **never** breaks already-snapshotted papers (safety).

### 3.4 Ownership, versioning & provenance

- Every question row has `created_by`, `created_via (manual|ai|import|copied|referenced)`, `origin_question_id`, `origin_school_id`, `source_id`, `source_name`.
- **Version ownership:** when a school edits a *copied* question, it becomes the owner of subsequent versions; `version_root_id` tracks the lineage back to the global original. Global version changes never rewrite school copies (snapshot semantics).
- Deletes are soft (`deleted_at`) with history preserved (`qb_question_history`).
- **Permission inheritance:** a school question is visible to a teacher if (a) teacher created it, (b) visibility=school + teacher in school, (c) explicit share, (d) `question_bank.global` + is_global. `visibility` values extended: `private|school|shared|public_global`.

### 3.5 Multi-tenant enforcement

- RLS-style school scoping at the **service layer** (existing pattern) + new RLS policies for `qb_*` `[NEW]` mirroring `online_tests.*` (which already has RLS + audit trigger).
- Cross-school uniqueness: `question_code` unique per `(school_id, bank)`; global questions use `(NULL, …)` namespace.
- All new tables carry `school_id` (nullable for global rows) and are indexed by `(school_id, …)`.

---

## 4. Phase 4 — AI Authoring Workflow

### 4.1 Principles

- Every AI action is **audited** (`ai_question_jobs` `[NEW]` + `qb_question_history` action `ai_*`).
- Every AI output lands as **draft**, never auto-published.
- AI is credit-gated through the existing credit engine + entitlement retrofit.
- Model provider: existing Gemini provider (JSON mode) extended with structured output for bank schema.

### 4.2 AI capabilities matrix

| Capability | Input | Output | Lands as | Notes |
|---|---|---|---|---|
| **Question Generation** | prompt {subject, chapter, topic, type, difficulty, count} | N draft questions | draft | schema validated |
| **OCR Import** | image/PDF of printed paper | text → structured questions | draft | parse → map → draft |
| **PDF Import** | PDF | per-question extraction | draft | layout-aware parser |
| **Word Import** | .docx | paragraphs → questions | draft | pattern extraction |
| **Excel Import** | .xlsx (template) | validated rows → draft | draft | header validation |
| **Duplicate Detection** | candidate question | match list + similarity score | pre-insert | semantic (embeddings) + normalized-text |
| **Difficulty Prediction** | question content | easy/medium/hard | metadata | stored, later calibrated by stats |
| **Bloom Prediction** | question content | Bloom level | metadata | editor can override |
| **NCERT Mapping** | question content | NCERT chapter suggestion | metadata | editor confirms |
| **Topic Detection** | question content | chapter/topic/sub-topic suggestion | metadata | taxonomy match |
| **Question Improvement** | draft question | revised stem/options | new draft (revision) | audited as AI edit |
| **Distractor Improvement** | options | improved distractors | new draft | keeps correct answer |
| **Grammar Check** | question text | grammar fixes | suggestion diff | accepted per-edit |
| **Image Detection** | question content | diagram/image needed → generate/upload placeholder | media asset | storage bucket |
| **Formula Detection** | question content | LaTeX detection/insertion | prompt_html | FormulaPanel integration |
| **Question Translation** | question + target language | translated draft | new draft row | language field |
| **Question Simplification** | question | simpler variant (readability) | new draft row | keeps semantic answer |
| **Question Expansion** | base question | variant stems (parallel questions) | N draft rows | family group `qb_question_families` `[NEW]` |
| **Human Review** | draft(s) | approve/edit/reject | workflow | Phase 5 |
| **Publishing** | approved | published | publish action | permission-gated |

### 4.3 AI job & audit pipeline `[NEW]`

```
User request → POST /question-bank/ai/jobs → job row (ai_question_jobs: status queued|running|done|failed)
   → credit debit (existing engine, idempotent)
   → worker executes (sync for small, background queue for bulk)
   → result questions written as qb_questions (status=draft, created_via=ai)
   → ai_question_jobs row: input_payload, output_ids, model, tokens, cost, duration, audit
```

- Job record captures: `requested_by, school_id, model_id, prompt_payload, output_question_ids, job_type, status, error, credits_spent, created_at, completed_at`.
- Undo: deleting AI drafts is a normal soft-delete; audit trail remains.

### 4.4 Validation & dedupe gates

- **Schema validation** (always): prompt non-empty, options ≥ 2 (MCQ), exactly-one-correct (single/multiple per type), marks ≥ 0, answer-key consistent with options.
- **Semantic duplicate detection** (always before insert): vector embedding on `prompt_text` (+ optional options), cosine threshold; returns top matches with scores. Teacher chooses "skip / add anyway / replace".
- **Human gate:** AI question batches require a review step before any single question can reach `published`.

---

## 5. Phase 5 — Review Workflow

### 5.1 Roles in review chain

| Role | Capability summary |
|---|---|
| Teacher (author) | Create, submit for review, edit drafts, respond to revisions |
| Reviewer | Review assigned questions, approve/request-changes/reject |
| Senior Faculty | Review + approve; assign reviewers; bulk approve |
| HOD | Final approve; emergency withdraw; override |
| Admin (school_admin) | All above + policy config, chain configuration |
| Academic Head | Cross-subject quality, blueprint governance, publish policies |

### 5.2 Review entities `[NEW]`

- **`qb_review_requests` `[NEW]`:** `id, question_id (or batch), requested_by, requested_at, assigned_to, status (open|assigned|approved|changes_requested|rejected|withdrawn), chain_position, urgency`.
- **`qb_review_comments` `[NEW]`:** `id, review_request_id, author, body, is_internal (teacher-private note vs visible), created_at` (replaces/extends inline comment storage).
- **`qb_review_checklist` `[NEW]`** + **`qb_review_checklist_items` `[NEW]`:** per-question or per-batch checklist: correctness of answer, clarity, options quality, Bloom/difficulty accuracy, NCERT mapping, no duplicate, language, images/LaTeX render, no ambiguity. Completion required to approve.
- **`qb_question_reviews` `[NEW]`:** immutable record of each review decision (who, when, action, comment ref, version reviewed, checklist snapshot).
- **Bulk approval** `[NEW]`: `POST /question-bank/reviews/bulk-approve` — batch review requests, checklist can be "batch-complete", each question still gets an individual `qb_question_reviews` row.
- **Emergency withdraw** `[NEW]`: `POST /question-bank/questions/{id}/withdraw` — sets `status='withdrawn'`, instantly excludes from all future generation, flags currently-live tests that reference it for admin review. Logged to history + audit.

### 5.3 Approval chain & workflow

```
Author submits (draft → review) ──► Chain configured per school (e.g. teacher→reviewer→senior→HOD)
   Step 1 Reviewer: approve / changes / reject
        ├─ approve ──► Step 2 (next in chain) or terminal approve
        ├─ changes ──► author revises (version bump) → resubmit
        └─ reject ──► status=rejected (recoverable via re-draft)
   Terminal: approved (may auto-publish per policy)
```

- Chain depth and auto-publish are **school policies** in `metadata` (e.g. `review_chain: [reviewer, senior_faculty, hod]`, `auto_publish_on_approve: false`).
- Escalation: unanswered review > SLA → auto-remind → escalate to next level.

### 5.4 Audit trail

- `qb_question_history` already records field changes; review decisions add action entries (`review_approve`, `review_request_changes`, `review_reject`, `bulk_approve`, `emergency_withdraw`) with old/new JSONB.
- Global `audit_logs` (existing) gains `question_bank` module entries via the same DB-trigger pattern used by `online_tests.*`.

---

## 6. Phase 6 — Examination Builder UX

### 6.1 Information architecture (sidebar)

```
Exam & Assessment
 ├─ Question Bank            ← NEW top-level entry (was missing)
 │    ├─ All Questions
 │    ├─ Blueprints
 │    ├─ Papers
 │    ├─ AI Studio
 │    ├─ Import / Export
 │    └─ Question Analytics
 ├─ Online Tests  (existing)
 ├─ Offline Exams (existing)
```

### 6.2 Screen-by-screen UX spec

**Question Bank (enhance `QuestionBankList`):**
- Header stats: total, published, pending review, AI drafts, duplicates flagged.
- Filter bar: search, exam type, subject, chapter, topic, difficulty, Bloom, question type, status, source, tags, language, visibility, NCERT mapping, created-by.
- Table/row: code, prompt (collapsed), type chip, difficulty chip, Bloom chip, status chip, usage count, accuracy, actions (edit, preview, duplicate, share, approve, publish, archive, withdraw, delete).
- Bulk bar: select-all → publish, archive, delete, move, tag, export, assign reviewer, bulk approve.
- Recently Used / Favorites / Recent Questions: three smart lists on the dashboard (personalized per user).

**Blueprint Builder (Phase 2 wizard):** as specified in §2.4.

**Paper Generator (new screen):**
- Pick blueprint → pick seed/sets → configure exclusions/locks → "Generate Preview" (dry-run composition) → "Generate Paper" → save → preview paper (per set) → export PDF → push to Online Test / Offline Exam.
- Composition dashboard: bars vs blueprint targets (difficulty/Bloom/NCERT/chapter coverage).

**Online Test Builder (enhance existing):** reuse existing wizard; add "Generate from Blueprint/Paper" as question-source path; server-side shuffle options; section-level timer options; negative-marking display.

**Offline Exam Builder (enhance existing):** 6-step wizard gains "Generate from Blueprint/Paper" path, set count A/B/C/D auto-variants, answer-key sheets per set, OMR sheet export.

**Question Analytics (Phase 8):** per-question stats page + aggregate dashboards.

**Question Preview (new modal):** rendered question exactly as students see it (stem, options, LaTeX, images), plus answer-key reveal, flags, version, provenance.

**Bulk Editing / Move / Delete / Tagging:** bulk bar operations; "move" reassigns to a target bank/visibility with permission check; "delete" is soft with confirm + audit.

---

## 7. Phase 7 — Student Delivery

### 7.1 Online delivery (enhance existing `OnlineTestTake`)

- **Server-side randomization:** questions and options randomized at attempt start (seeded per student attempt); persisted snapshot per attempt so review shows exactly what the student saw.
- **Adaptive Tests** `[NEW]` (optional per test): item-bank adaptation — difficulty adjusts based on running performance; implemented as a delivery mode flag `metadata.adaptive=true` with rules (ceiling/floor difficulty, question type pool). Adaptive mode requires the bank snapshot + pre-filtered eligible pool.
- **Resume:** existing `test_attempts.status` + auto-save; resume restores responses, remaining time, current section.
- **Auto Save:** per-response save (existing) + heartbeat; on network loss, client queues and flushes.
- **Section Lock:** per-section timer and locked navigation (forward-only / no-back) via `test_sections` metadata + server-enforced boundaries.
- **Timer:** server-authoritative countdown (drift-corrected from `starts_at`/`ends_at`), auto-submit at zero (existing).
- **Negative Marking:** configured per test/section; displayed; applied at scoring.
- **Submission & scoring:** existing exact-match scoring extended for assertion_reason, match_following (JSONB answer compare), integer ranges, multi-correct partial credit (policy option).

### 7.2 Offline delivery (enhance existing `exam.*`)

- **Paper Editions / Sets A/B/C/D:** generated by the paper engine with per-set variant question selections (same blueprint, different sampled questions); stored as `exam_questions.set_labels` per existing schema + `set_labels` extended to hold set-specific question refs.
- **Answer Keys:** per-set answer-key sheets generated and exported (teacher/HOD only).
- **OMR:** OMR layout export (template) + OMR import path in evaluations (existing Excel import extended with OMR column mapping).
- **Subjective Evaluation:** manual grid (existing) + AI-assisted scoring proposal (suggested marks per rubric; teacher confirms) `[NEW]`.

---

## 8. Phase 8 — Analytics

### 8.1 Analytics architecture

- **Source of truth:** `online_tests.test_results` / `test_responses`, `exam.exam_results` / `evaluations`.
- **Rollup tables `[NEW]`:**
  - `qb_question_stats` — per question: `usage_count, attempts, correct_count, accuracy, avg_time_seconds, discrimination_index, difficulty_calibrated (easy|medium|hard), updated_at`.
  - `qb_topic_coverage` — per (school, subject, chapter/topic, exam): counts + coverage %.
  - `analytics.question_bank_analytics` — precomputed dashboard aggregates (daily).
- **Computation:** post-evaluation jobs update `qb_question_stats`; nightly batch recomputes calibrations & coverage. Warehouse `warehouse.fact_tests` continues as the BI base.

### 8.2 Dashboards

| Dashboard | Metrics | Audience |
|---|---|---|
| Question Quality | accuracy distribution, discrimination index, p-value, distractors stats, ambiguity flags | HOD, Academic Head |
| Teacher Performance | authored count, approval rate, avg question quality score, usage of their questions | School Admin, HOD |
| Question Usage | per-question usage in tests/exams, reuse rate, favorites | Teachers, Admin |
| Weak/Strong Questions | low accuracy + high discrimination (weak), high accuracy + low usage (strong/unused) | HOD |
| Difficulty Accuracy | predicted vs calibrated difficulty drift | Reviewers |
| Chapter Coverage | syllabus coverage heatmap per subject/exam | Academic Head |
| Bloom Coverage | Bloom distribution vs blueprint target | Academic Head |
| NCERT Coverage | NCERT chapter weight fulfillment | Academic Head |
| Student Weak Topics | per-student/batch topic accuracy (feeds existing `analytics.topic_performance`) | Teachers |
| Exam Statistics | score distribution, rank, percentile, per-section analysis | Admin, Teachers |
| AI vs Human | AI-authored question count, quality vs human, approval rates, usage | School Admin |

### 8.3 Question intelligence (discrimination & calibration)

- **Discrimination index:** upper-lower group split on `qb_question_stats`.
- **Difficulty calibration:** recalibrate `difficulty_level` from observed accuracy (buckets), flag drift from author-predicted value.
- These feed generation (blueprint difficulty matching) and teacher insights.

---

## 9. Phase 9 — Import & Export

### 9.1 Formats & pipelines

| Format | Import | Export | Notes |
|---|---|---|---|
| **Excel** | ✅ (existing online bank import; extended template with taxonomy/Bloom/NCERT columns) | ✅ `.xlsx` bank subset / paper / key | Template download endpoint |
| **Word** | ✅ `.docx` → AI parse → draft | ✅ `.docx` paper (answer-key variant optional) | AI-assisted import |
| **PDF** | ✅ OCR + layout parse → draft | ✅ paper PDF (per set), OMR sheet, key PDF | PDF export for printing |
| **OCR** | ✅ images → text → questions | — | via Phase 4 pipeline |
| **JSON** | ✅ package import (validated) | ✅ question package, blueprint package | canonical interchange |
| **Question Packages** | ✅ `.qbpackage` (zip: JSON + media) | ✅ same | full fidelity incl. images/LaTeX |
| **Backup / Restore** | ✅ restore from package | ✅ per-bank / per-blueprint / per-paper backup | respects school scope |
| **Sharing** | ✅ accept share link | ✅ share link/payload | school↔school via license |
| **Marketplace (future)** | ⚠️ roadmap | ⚠️ roadmap | global listing + license purchase |

### 9.2 Import pipeline (uniform)

```
upload → validate headers/schema → normalize → duplicate-check (semantic) → 
map taxonomy (auto-suggest) → preview table (accept/reject/repair rows) → 
commit as drafts → notify author
```

- Import **never auto-publishes**; always lands as draft (or `review` if a reviewer import path is configured).
- Per-row status preserved (valid, needs-review, duplicate, error) in the preview.

### 9.3 Export pipeline (uniform)

```
select scope (bank subset / paper / blueprint) → choose format → 
background job (queue) → signed download URL (existing uploads/storage) → notify
```

---

## 10. Phase 10 — Scalability

### 10.1 Scale targets

| Target | Capacity design |
|---|---|
| 1,000 schools | Tenant-scoped tables; `school_id` composite indexing; no cross-tenant scans |
| 100,000 teachers | Auth on existing profiles/roles; permission cache; batch APIs |
| 10M questions | Partitioning readiness on `qb_questions` (by `school_id` hash or by `created_at` range); `qb_question_versions` as append-only partition by year; heavy read path via search index |
| Millions of attempts | `online_tests.test_responses` partitioned by `test_id`/created_at; write-path buffering; read replicas for analytics |
| Concurrent online exams | Connection pooling (existing service-layer batching), read-replica for question delivery, in-memory session state |
| High availability | Stateless API; existing Supabase managed infra; retry/backoff in clients |
| Caching | Redis/edge cache for taxonomy, blueprints, published bank reads, dashboard aggregates |
| Search | Full-text (tsvector) on prompt_text + options; trigram index on short fields; semantic index (pgvector) for dedupe |
| Background jobs | Queue worker (existing pattern + `ai_teacher_assistant_jobs` precedent) for imports, exports, AI bulk, analytics rollups, notifications |

### 10.2 Key design choices

- **Read/write separation:** authoring writes hit primary; paper delivery + analytics read from replicas/aggregates.
- **Snapshot-first delivery:** tests/exams snapshot questions at publish → attempts never touch the mutable bank (no locking during exams).
- **Idempotency:** all generation/import/AI jobs carry idempotency keys (pattern exists in finance payment infra).
- **Partitioning readiness** rather than premature partitioning: growth triggers (row counts / size) dictate when to enable partitions; schema keeps a partitionable key on every hot table.
- **Connection discipline:** pagination everywhere (existing pattern), `limit` caps, server-side filters, no N+1 in list screens.

---

## 11. Phase 11 — Final Deliverables

### 11.1 Complete PRD
- **Stakeholders:** platform vendor, schools, HODs, senior faculty, reviewers, teachers, students, parents.
- **Problem:** disconnected banks, no reuse, no blueprints, no deterministic papers, no export, no per-question intelligence, no multi-school/licensing, simulated AI.
- **Solution:** unified master bank, blueprint engine, deterministic paper generator, snapshot-linked online/offline delivery, enterprise review chain, audit-everywhere AI authoring, analytics, import/export, multi-school SaaS with licensing.
- **Scope (in/out):** in — bank, blueprints, papers, online+offline, AI, analytics, import/export, multi-school, permissions, review. out of v1 — public marketplace, adaptive-by-default, full OMR recognition hardware integration (OMR import by template in v1).
- **Success metrics:** % of questions created via bank, paper generation adoption, approval SLA, AI draft→published conversion, duplicate rate, question reuse rate, exam accuracy vs blueprint.

### 11.2 Complete UX Specification
- Sidebar entry "Question Bank" (fixes the discovered navigation gap), Blueprint Builder wizard, Paper Generator, AI Studio, Import/Export center, Question Analytics; enhanced QuestionBuilder with real AI/OCR/PDF panels and Bloom/NCERT controls; preview modal; bulk actions; version restore (existing UI activated). (Full screens in Phase 6.)

### 11.3 Workflow Diagrams
- Question state machine (§1.3), review chain (§5.3), AI pipeline (§4.3), paper generation pipeline (§2.5/§6), import/export pipelines (§9.2/9.3), end-to-end exam lifecycle (§1.1).

### 11.4 Database Concept (additive summary)

**Extend `qb_questions` `[NEW]` columns:** `bloom_taxonomy`, `ncert_chapter_id`, `exam_tags JSONB`, `multiple_correct`, `is_global`, `source_question_id`, `origin_school_id`, `created_via`, `version_root_id`, `visibility` extended enum, `question_type` extended enum, `difficulty_predicted`, `difficulty_calibrated`.

**New tables:**
- `qb_question_media` — media assets (type, bucket, storage_path, public_url, alt, created_by).
- `qb_question_shares` — explicit teacher/group shares.
- `qb_question_families` — AI-generated parallel/variant groups.
- `qb_blueprints`, `qb_blueprint_sections`, `qb_blueprint_rules`, `qb_blueprint_versions`.
- `qb_papers`, `qb_paper_questions` (paper + per-set variant question refs + composition audit).
- `qb_question_stats`, `qb_topic_coverage`, `analytics.question_bank_analytics`.
- `qb_review_requests`, `qb_review_comments`, `qb_review_checklist`, `qb_review_checklist_items`, `qb_question_reviews`.
- `qb_licenses`, `qb_license_usage`.
- `ai_question_jobs`.
- `qb_import_jobs`, `qb_export_jobs` (async job tracking).

**Modify (additive):** add `bank_question_id UUID` (nullable, `on delete set null`) to `online_tests.test_questions` and `exam.exam_questions`; repurpose `qb_bank_test_links` into a proper usage/link table or replace with `qb_question_usage`; add RLS policies to `exam.*`; add `question_bank` module entries to `audit_logs`.

**Compatibility:** `public.online_test_question_bank` becomes a UNION view over `qb_questions` (kept to avoid breaking clients); legacy endpoints untouched.

### 11.5 API Concept

**Bank (extend `/api/question-bank/*`):**
- `GET /question-bank/questions` (filters+pagination, enhanced)
- `POST/PUT/DELETE /question-bank/questions/{id}`
- `POST /question-bank/questions/{id}/version-restore`
- `POST /question-bank/questions/{id}/publish` | `/archive` | `/withdraw` | `/duplicate`
- `POST /question-bank/questions/{id}/share` | `DELETE .../share/{shareId}`
- `GET /question-bank/questions/{id}/stats`
- `POST /question-bank/ai/jobs` | `GET /question-bank/ai/jobs/{id}` (Phase 4)
- `POST /question-bank/questions/validate` | `/dedupe-check`
- `POST /question-bank/import` | `GET /question-bank/import/jobs/{id}`
- `POST /question-bank/export` | `GET /question-bank/export/jobs/{id}/{download}`
- `POST /question-bank/reviews/bulk-approve`
- `GET /question-bank/analytics`

**Blueprints & papers `[NEW]`:**
- `GET/POST/PUT /question-bank/blueprints`, `GET/POST /question-bank/blueprints/{id}/duplicate`, `GET /question-bank/blueprints/{id}/preview`
- `POST /question-bank/papers/generate` (blueprint_id, seed, sets, exclusions) → paper
- `GET /question-bank/papers`, `GET /question-bank/papers/{id}`, `POST /question-bank/papers/{id}/push-online-test`, `/push-offline-exam`, `/export`

**Online/offline (extend existing):**
- `POST /online-tests/{id}/generate-from-paper` etc. reuse existing lifecycle endpoints; existing question CRUD stays.

**Multi-school:** `GET /question-bank/master` (global view), `POST /question-bank/master/copy`, `POST /question-bank/master/reference`, license endpoints.

### 11.6 Permission Matrix

New keys seeded **additively** beside existing `online_tests.*` / `offline_exams.*` / `teacher_ai.*`:

| Permission key | teacher | reviewer | senior_faculty | hod | school_admin | academic_head | platform_admin |
|---|---|---|---|---|---|---|---|
| `question_bank.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `question_bank.create` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `question_bank.edit` | own | all | all | all | all | all | all |
| `question_bank.delete` | own | — | own | ✅ | ✅ | ✅ | ✅ |
| `question_bank.import` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `question_bank.export` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `question_bank.review` | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `question_bank.approve` | — | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| `question_bank.publish` | — | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| `question_bank.withdraw` | — | — | — | ✅ | ✅ | ✅ | ✅ |
| `question_bank.blueprints` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `question_bank.generate` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `question_bank.ai` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `question_bank.analytics` | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `question_bank.global` (master read) | via school | via school | ✅ | ✅ | ✅ | ✅ | ✅ |
| `question_bank.global.copy` | — | — | — | ✅ | ✅ | ✅ | ✅ |
| `question_bank.license` (manage) | — | — | — | — | ✅ | — | ✅ |
| `question_bank.manage` (config) | — | — | — | — | ✅ | ✅ | ✅ |

*(platform_admin inherits all via existing bypass; students/parents get no bank keys.)* Hierarchical matching: `question_bank` base implies sub-keys (existing `permissionMatches` semantics).

### 11.7 AI Workflow
See Phase 4. Summarized: credit-gated job → structured generation/transform → schema validate → semantic dedupe → draft insert → review chain → publish. Full audit at every step; model/tokens/cost recorded; output never auto-published.

### 11.8 Blueprint Specification
See Phase 2. Full field PRD, data model, wizard, validation rules, deterministic generation contract (seed + blueprint + bank state → reproducible paper), per-set variants.

### 11.9 Multi-School Architecture
See Phase 3. Global/school/private/shared scopes, copy vs reference, licensing & metering, provenance & version lineage, tenant isolation.

### 11.10 Analytics Architecture
See Phase 8. Rollups (`qb_question_stats`, `qb_topic_coverage`), discrimination & calibration, dashboards, warehouse integration.

### 11.11 Media Architecture
- **Storage:** existing Supabase Storage buckets — `qb-question-media`, `qb-paper-exports`, `qb-imports`. 
- **Assets:** `qb_question_media` rows (question stem images, option images, diagrams, passage images, generated figures) with bucket/path/public_url, alt text, width/height, provenance (uploaded/ai-generated).
- **Rendering:** CDN-signed URLs; lazy-load in lists; referential integrity via FK to question; soft-delete pattern for storage cleanup (orphan sweep job).

### 11.12 Versioning Strategy
- **Questions:** versioned snapshots in `qb_question_versions` (existing). Content change → new version; metadata/status change → same version. Restore via existing API; UI activated. 
- **Blueprints:** `qb_blueprint_versions` snapshots; papers record blueprint version used.
- **Papers:** immutable once generated; edits create new paper.
- **Copies:** version lineage via `version_root_id`; school copies diverge after first edit.
- **Tests/exams:** snapshot bank questions at publish → student-facing content frozen; bank edits never mutate delivered tests.

### 11.13 Migration Strategy
1. **A — Additive DDL:** new columns on `qb_questions`, new tables, `bank_question_id` FKs, `exam.*` RLS, audit coverage. No drops/renames.
2. **B — Unify & backfill:** one-time service to (a) migrate `online_tests.question_bank` → `qb_questions`, (b) back-create `qb_questions` rows from inline `test_questions`/`exam_questions` and set `bank_question_id`, (c) seed global master content (optional starter set + NEET/JEE blueprints).
3. **C — Compat layer:** `online_test_question_bank` UNION view; legacy endpoints preserved; `supabase_api_spec.json` refreshed when endpoints change.
4. **D — Feature rollout:** blueprints → paper generator → export/import → analytics → AI wiring → review workflow → licenses.
5. **E — Hardening & scale:** indexes, partitions, caching, background workers, load tests at target scale, permission seed `question_bank.*`.

### 11.14 Implementation Roadmap
1. **Week 1 — Foundation:** additive schema (bank columns, blueprints, papers, media, stats, review, AI-job tables, FKs); permission seed; refresh API spec.
2. **Week 2 — Unify:** backfill service, compat view, `qb_question_usage`, sidebar "Question Bank" navigation fix.
3. **Week 3 — Blueprint & Paper engine:** blueprint CRUD + deterministic generator + per-set variants + preview.
4. **Week 4 — Online/Offline wiring:** generate-from-paper paths, server-side shuffle, snapshot-on-publish, answer-key/OMR exports.
5. **Week 5 — Import/Export:** Excel/JSON packages, PDF/docx export, background jobs.
6. **Week 6 — AI:** real frontend wiring (AI Studio, OCR, PDF), single/batch generation, validate + dedupe, audit jobs, credit budget + approval gate.
7. **Week 7 — Review & analytics:** review chain UI/API, bulk approve, withdraw, dashboards, question stats rollups.
8. **Week 8 — Multi-school & licensing:** master/copy/reference, licenses, metering, sharing.
9. **Week 9 — Hardening & UAT:** RLS audit, index audit, load test (10k questions, concurrent attempts), regression (existing online/offline tests), pilot with one coaching batch + NEET/JEE blueprints.
10. **Week 10 — Rollout:** GA, docs, monitoring, iterate on usage data.

### 11.15 Risk Analysis

| Risk | Impact | Mitigation |
|---|---|---|
| Breaking existing online/offline tests | High | Additive-only; compat view; snapshot-on-publish; regression suite |
| Duplicate/divergent banks | High | Unify week 2; disable writes to `online_tests.question_bank` after migration |
| AI quality/untrusted questions | Medium | Draft-only, validation, dedupe, mandatory review gate |
| Licensing/compliance misuse | Medium | Explicit license counts, metering, never-break-snapshot safety |
| Cross-tenant leakage | High | RLS + service-layer scoping, index review, isolation tests |
| Scale bottlenecks (10M questions) | Medium | Partitioning readiness, read replicas, caching, pagination discipline |
| Paper-generation determinism regressions | Medium | Seeded RNG + recorded blueprint version + dry-run preview |
| OMR/offline complexity | Medium | Template-based import in v1; dedicated hardware integration later |
| Feature drift vs this spec | High | This doc is the permanent reference; PR reviews check conformance |

### 11.16 Future Expansion Plan
- **Public Question Marketplace:** global listing, purchase/license, cross-school exchange, revenue (integration with existing `finance.*`).
- **Adaptive Testing at scale:** item response theory (IRT) model + bank calibration service.
- **Full OMR/Scan integration:** hardware/scanning partners, auto-recognition.
- **Proctoring & anti-cheat:** browser lock, tab-switch detection, biometric checks (design hooks: attempt metadata).
- **Multilingual & localization:** full translation pipelines per school, bilingual papers.
- **Competitive benchmarking:** school-to-school anonymized analytics, question-level national norms.
- **AI grading of subjective answers** with human-in-the-loop rubric verification.
- **Wearable/offline-first mobile** test-taking for low-bandwidth regions.
- **Wholesale content partnerships** (publishers onboarding via import + licensing).

---

## 12. Backward-Compatibility Guarantees (binding)

1. No existing table, column, index, or endpoint is dropped, renamed, or re-typed.
2. `online_tests.question_bank`, `online_tests.test_questions`, `exam.exam_questions`, and legacy `/api/exams` remain functional.
3. New columns/FKs are nullable and additive; old rows unaffected.
4. Compat views (`online_test_question_bank`) preserved; new `question_bank.*` permission keys seeded beside existing ones; existing roles keep current access.
5. Frontend navigation additions are additive; no existing route removed.
6. AI changes are additive (new endpoints), existing credit engine reused.

---

*End of Final Enterprise Examination Architecture v1.0. This document is the permanent reference for all future examination-module development.*
