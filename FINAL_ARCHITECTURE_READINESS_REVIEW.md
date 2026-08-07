# FINAL ARCHITECTURE READINESS REVIEW

**Document:** `FINAL_EXAMINATION_ARCHITECTURE.md` v1.0
**Reviewer role:** Enterprise Software Architect — pre-implementation design gate
**Date:** 2026-08-03
**Scope:** Design validation only. No code, SQL, migrations, or edits to the architecture document were made.
**Method:** Cross-checked every claim in the architecture doc against the live codebase and live Supabase schema (`qb_*`, `online_tests.*`, `exam.*`, `ai_provider.py`, `supabase_admin.py`, `supabase_online_tests.py`, `AuthProvider.tsx`).

> **Verdict: the architecture is directionally correct, well-scoped, and backward-compatible — but it is NOT production-ready. Five structural decisions that are expensive to change later are still unresolved, and three of them interact with each other. Implementation should not begin until those are settled.**

---

## 1. SCORES

| # | Score | Value | Rationale |
|---|---|---|---|
| 1 | **Architecture Score** | **74 / 100** | Strong breadth, additive discipline, sensible module boundaries. Deducted for 5 unresolved structural decisions (partitioning↔FK, snapshot model, tenancy enforcement, offline re-evaluation, AI provider/prompt versioning). |
| 2 | **Scalability Score** | **66 / 100** | Right instincts (partitioning readiness, replicas, caching) but the partition key is undecided, FK/partition interplay unaddressed, and response-table growth plan is missing. |
| 3 | **Maintainability Score** | **78 / 100** | Excellent additive discipline, single-bank decision, reuse of existing patterns. Deducted for new-role-key complexity and a compat-view layer that adds a second source of truth for clients. |
| 4 | **Security Score** | **55 / 100** | **Lowest.** Service-role client bypasses all RLS; tenant isolation rests entirely on Python correctness. PostgREST filter injection surface, no API-level rate limits, prompt-injection surface, upload validation unspecified. |
| 5 | **SaaS Readiness Score** | **67 / 100** | Sound scope model (global/school/private/shared), licensing concept, provenance. Deducted: license metering is race-prone, `school_id = NULL` global rows break RLS, no share-revocation test, managed-role inheritance unverified. |
| 6 | **AI Readiness Score** | **54 / 100** | **Lowest.** Credit engine is real, but provider abstraction is Gemini-only in code, prompt templates are not versioned, no per-request cost caps, no partial-batch failure handling, frontend AI is simulated. |
| 7 | **Examination Readiness Score** | **70 / 100** | Blueprint engine is the strongest section. Deducted: no re-evaluation/answer-key-change/grace workflow, shuffle is inert in code, scoring for 6+ question types undefined, timer drift policy missing. |

**Overall Architecture Score: 66 / 100** — below the bar for a months-long implementation.

---

## 2. VALIDATION AREA FINDINGS

Classification legend: **CRITICAL** (must fix before implementation), **HIGH** (fix in this phase), **MEDIUM** (fix before GA), **LOW** (track).

### 2.1 Database Design

- **[HIGH] Partitioning decision is deferred but FKs make it expensive to retrofit.** `qb_questions` is referenced by `qb_question_versions.question_id` and `qb_bank_test_links.bank_question_id` (migration `003_question_bank_taxonomy.sql`). If `qb_questions` is later partitioned, every FK referencing it **must include the partition key in the FK columns**, and the PK/unique on the partitioned table must include the partition key. Retrofitting a partition on 10M rows with live FKs is a multi-day, high-risk migration. **Decide the partition key now (recommend `school_id` hash for the bank, `created_at`/`test_id` range for responses).**
- **[HIGH] Soft-delete everywhere is not index-complete.** `is_active`/`deleted_at` exist on all tables but queries filter them ad hoc. Plan **partial indexes** (`WHERE deleted_at IS NULL`) on hot paths; otherwise 10M-question scans degrade.
- **[MEDIUM] Versioning storage growth is unbounded.** Full JSONB snapshot per content edit × 10M questions × frequent edits is enormous. No retention policy, no delta+snapshot hybrid, no archive/cleanup job defined.
- **[MEDIUM] JSONB-as-schema on hot paths.** `option_items`, `answer_key`, `metadata`, `tags` are JSONB. Acceptable for flexibility, but per-option statistics and option-key scoring over JSONB are slow and index-hostile. Consider normalized `qb_question_options`/`qb_question_answers` for analytics-scoring hot paths while keeping JSONB for authoring fidelity.
- **[LOW] `audit_logs` volume** at 10M-question write rate needs retention + partitioning defined.

### 2.2 Question Bank

- **[HIGH] Snapshot-vs-reference model is ambiguous.** The doc promises both "snapshot at publish" and a `bank_question_id` FK with `on delete set null`. These conflict: if content is copied at publish, the FK is provenance only (correct); if the FK is a live reference, answer-key changes propagate into live tests (wrong). **Pin the delivery artifact now:** a frozen paper/test snapshot table; the FK is provenance; bank edits never mutate delivered content.
- **[HIGH] No structural duplicate-prevention baseline.** Semantic dedupe (embeddings) is planned but exact/normalized-text dedupe (cheap, deterministic) is not. Add an exact-match unique key (normalized prompt hash) per school before relying on fuzzy matching.
- **[MEDIUM] "Manual Lock Questions" has no concurrency story.** Two teachers generating papers from the same pool can double-select a question. Generator must reserve selections atomically (`SELECT ... FOR UPDATE` or an atomic claim) — especially important during live-test creation.
- **[MEDIUM] Reference-mode propagation is undefined.** When a vendor edits a *referenced* global question, what happens to (a) draft papers, (b) published tests? Published content must be frozen; draft papers must get a version-bump + warning. Document this.
- **[LOW] `qb_bank_test_links` is a dead table with no FK target for `test_id`.** Repurposing/replacing it must be a decision, not deferred (it becomes the source of truth for question-usage analytics).

### 2.3 Online Tests

- **[HIGH] Shuffle is inert in code.** `shuffle_questions`/`shuffle_options` are stored booleans only (`supabase_online_tests.py:123-124, 907-908`); no server-side shuffle exists. The architecture must define seeded per-attempt shuffle where options shuffle **consistently with their answer keys**.
- **[HIGH] Scoring for new question types is undefined.** Today scoring is exact normalized option-ID match (`_score_response`, `supabase_online_tests.py:525`). Assertion-reason, match-following, integer ranges, multi-correct partial credit, and case-study scoring have no algorithm. This is exam-correctness-critical and must be specified before build.
- **[MEDIUM] Timer is claimed "server-authoritative" but no drift policy.** Client/server clock skew, timezone handling, and a grace tolerance for auto-submit must be defined to avoid wrong submissions.
- **[MEDIUM] Concurrency for attempts.** Double-submit protection (idempotency), `max_attempts` race (two tabs → two attempts), and DB-level uniqueness must be specified. (Existing `attempt_number` unique index is a good foundation.)
- **[MEDIUM] Publish freeze is undefined for in-flight attempts.** If a question is emergency-withdrawn mid-attempt, running attempts must finish on their delivered snapshot; future attempts must be blocked; live tests must be flagged for admin review.

### 2.4 Offline Exams

- **[CRITICAL] No re-evaluation, grace, or answer-key-change workflow.** The spec covers sets, printing, OMR, answer keys, subjective evaluation — but not: re-evaluation (recheck) requests, challenge windows, grace marks, or **answer-key correction after exam** (which requires a re-score-all policy). For a coaching exam system these are table stakes. Must be added before implementation.
- **[MEDIUM] Per-set answer-key integrity.** Sets A/B/C/D need per-set key sheets with a binding key-version + hash to prevent mix-ups in printing.
- **[MEDIUM] OMR is a template-only story.** OMR scanning/import accuracy, bubble detection, and correction workflow are underspecified. Acceptable for v1 if scoped explicitly, but must be called out as a v1 limit (not silent).

### 2.5 AI

- **[CRITICAL] Provider abstraction does not exist in code.** `ai_provider.py` is Gemini-only (`_build_gemini_model` raises "Unsupported AI provider configured"; `DEFAULT_MODEL="gemini-2.5-flash"`). The architecture doc *claims* provider abstraction; the codebase has none. A provider interface + model registry must be designed now to avoid lock-in.
- **[CRITICAL] Prompt templates are not versioned.** The audit model/tokens/cost is good, but the AI audit does **not** record which prompt template + version produced a result. Without prompt versioning, results are not reproducible and prompt changes cannot be compared. Must be added to `ai_question_jobs`.
- **[HIGH] No per-request or daily cost caps.** The credit engine gates credits, but there is no API-level budget (per school, per user, per endpoint). Bulk generation can burn unbounded provider spend before credits stop it.
- **[MEDIUM] Bulk generation partial failure is undefined.** An N-question batch can partially fail. Define per-question job items (retry only failed), overall job status, and credit refund for failed items.
- **[LOW] Provider retry/quota handling is solid** (capped retry, no-retry-on-quota in `ai_provider.py:57-80`) — reuse it; just expose it through an interface.

### 2.6 Multi-School SaaS

- **[CRITICAL] Tenant isolation rests entirely on Python; RLS is decorative.** The backend connects via the **service-role key** (`supabase_admin.py:124-125, 157-165`). All `qb_*` RLS policies are `auth.role() = 'service_role'` (migration `003`, lines 188-195) — i.e., the app bypasses RLS by design. Any missed `.eq("school_id", ...)` in the service layer is a cross-tenant leak. For a 1,000-school SaaS this is the #1 data-leakage risk. **Mitigation (defense-in-depth):** a scoped client that always injects `school_id` from the **authenticated token** (never from client payload), plus a "tenant guard" helper and RLS policies keyed on app claims for every new table.
- **[HIGH] `school_id = NULL` global rows break RLS.** A policy like `school_id = current_setting(...)` evaluates `NULL = 'x'` → false, so global master questions become invisible. Global rows need explicit `is_global` handling (visible to licensed schools, read-only).
- **[HIGH] License metering is race-prone.** "Granted question count" counting with concurrent check-outs can oversubscribe. Use atomic reservation (single-row increment / `FOR UPDATE`) or derive entitlements from the license row itself.
- **[MEDIUM] Share revocation must be testable.** The sharing model needs explicit revoke semantics and a test that a revoked share immediately removes visibility (including in caches/search).
- **[MEDIUM] Managed-role inheritance unverified.** Live DB has `managed_*` per-person roles layered over system roles. The new role keys (`reviewer`, `senior_faculty`, `hod`, `academic_head`) must be seeded as system roles and their interplay with `managed_*` roles verified against `AuthProvider` `permissionMatches` (`AuthProvider.tsx:255-260`).

### 2.7 Permissions

- **[HIGH] Permission keys must be enforced server-side, not only in the UI.** The frontend filters by `canAccess`; the backend must independently gate every new `question_bank.*` endpoint (the AI routes already do this via `route_retrofit`; the pattern must be applied to all new bank/review/blueprint endpoints).
- **[MEDIUM] `question_bank.edit` = "own" needs an effective-owner rule.** With copies/references, `created_by` alone is wrong. Define effective ownership (created_by vs school vs visibility) explicitly.
- **[LOW] Admin overrides** already route through `audit_logs`; keep them audited (existing pattern is sufficient).

### 2.8 Analytics

- **[HIGH] Aggregation strategy is unpinned.** Whether rollups are materialized views (`REFRESH CONCURRENTLY`) vs. tables maintained by idempotent background jobs matters at scale. Recommend: **aggregate tables + idempotent jobs + daily time bucketing**; use matviews only for small dimensions; keep `warehouse.fact_tests` as the BI base.
- **[MEDIUM] Discrimination/calibration compute path is undefined.** Per-question discrimination over millions of responses needs a dedicated rollup + update strategy; computing on live `test_responses` per request will not scale.
- **[LOW] Historical reporting/retention** for analytics tables needs a retention window.

### 2.9 Media

- **[HIGH] Media pipeline is under-specified.** Buckets are named, but not: upload validation (MIME, size, malware/AV scan), image optimization (thumbnails, responsive sizes), CDN/signed-URL strategy, media↔question-version linkage (a version restore must not reference deleted media), and an orphan-sweep job.
- **[MEDIUM] Option images inside JSONB** are not trackable/queryable; for diagram-heavy subjects, a normalized media reference is preferable for option assets too.

### 2.10 Search

- **[HIGH] FTS does not serve the primary market language.** The product targets NEET with Hindi/bilingual papers, but PostgreSQL FTS has no Indic-language stemmer. PG-FTS on Devanagari is ineffective. Decide now: dedicated search engine (OpenSearch/Meilisearch/Typesense) or ICU-tokenized fallback. Retrofitting search is expensive.
- **[HIGH] Semantic search (pgvector) scale is unspecified.** 10M questions × embeddings storage, HNSW index parameters, incremental embedding jobs, dedupe threshold calibration, and **school-scoped vector search** (must not cross tenants) all need definition.
- **[MEDIUM] Ranking strategy** (boost by usage/quality/recency) is not defined; neither is cache-invalidation for bank edits.

### 2.11 Performance

- **[HIGH] Partition key must be chosen now** (see 2.1) — the largest single retro-cost item.
- **[MEDIUM] Response-table growth.** Millions of attempts × ~100 questions = hundreds of millions of `test_responses` rows. Partition by `test_id`/`created_at`; keep authoring reads on the bank, attempt reads on replicas.
- **[MEDIUM] Per-attempt randomization CPU.** Constraint-satisfaction selection over a 10M pool per attempt is expensive. Design as: pre-filter eligible pool with indexed predicates → in-memory selection (seeded) → persist selection. Bias correctness matters for paper quality.
- **[LOW] Dashboard queries** must hit precomputed aggregates, never ad-hoc GROUP BY over live response tables.

### 2.12 Disaster Recovery

- **[HIGH] No RPO/RTO or restore-drill plan.** Supabase managed backups exist, but restore time for 10M-row tables, point-in-time recovery targets, and a tested rollback path are undefined.
- **[MEDIUM] Migration rollback is "additive" but backfills are not.** The unify/backfill service writes data; it must be idempotent, reversible, and verification-hashed (row counts + content hash) — not a one-way migration.
- **[MEDIUM] No corruption/consistency job.** Define jobs to detect orphaned media, dangling `bank_question_id`, snapshot/current drift, and version-snapshot mismatch.

### 2.13 Security

- **[CRITICAL] Service-role bypass of RLS** (see 2.6) — the single biggest security item.
- **[HIGH] PostgREST filter injection surface.** The service layer builds `.ilike`/`.eq`/`.or` filters from request params. PostgREST accepts operator/embedded-filter strings; un-validated params can inject filters or select columns. Whitelist columns, validate enum values, and never pass raw filter strings from clients.
- **[HIGH] AI prompt-injection surface.** OCR/PDF/Word/Excel content is fed to the LLM; malicious documents can inject instructions. Need prompt hardening (delimit untrusted content), output validation, and no autonomous action from model output.
- **[HIGH] No API-level rate limiting beyond auth.** `assert_not_rate_limited` is used only for login/OTP (`routes/auth.py`). AI generation, import, export, and bulk endpoints need per-user/per-school throttles + daily budgets.
- **[MEDIUM] File-upload security** (MIME sniffing, size caps, AV scan, storage-path traversal) must be specified for the new import/media endpoints (reuse existing uploads module + harden).

### 2.14 Migration Risk

- **[MEDIUM] Compat-view column drift.** `online_test_question_bank` becomes a UNION over `qb_questions`; the view's columns/names must exactly match what existing clients (`api.ts`, import endpoint) read, or the import/listing breaks silently. Add a contract test.
- **[MEDIUM] Backfill must not change displayed results.** The 19 existing questions / 4 results must be copied to `qb_questions` and linked without altering published results/ranks. Idempotent + hash-verified.
- **[LOW] `question_code` uniqueness across namespaces** (global vs school) needs a generator (prefix + sequence) to avoid import collisions.

### 2.15 Future Expansion

- **[LOW] Mobile** — bank is REST-friendly; fine. Test-taking on mobile should reuse the online-tests API; no new constraint.
- **[MEDIUM] Marketplace** — licensing model must support purchase/revocation and cross-school transfers; design the license state machine to be extensible now.
- **[MEDIUM] Adaptive testing (IRT)** — if planned, bank schema should reserve IRT parameter fields (`a/b/c` or `theta`) and a calibration job; add as nullable columns now to avoid a later ALTER on 10M rows.
- **[MEDIUM] Internationalization** — bilingual papers + Hindi search are core (see 2.10); also design content-language codes and per-question translation lineage.
- **[LOW] Public APIs / webhooks** — design API-key auth and versioned endpoints for the future marketplace/integrations.

---

## 3. TOP 20 RISKS (ranked)

| # | Risk | Class | Impact |
|---|---|---|---|
| 1 | Service-role client bypasses all RLS → tenant isolation is pure Python correctness | **CRITICAL** | Cross-tenant data leak |
| 2 | Partition key undecided; FK-to-`qb_questions` makes retrofit very costly | **CRITICAL** | Months of migration later |
| 3 | Snapshot-vs-reference delivery model ambiguous | **CRITICAL** | Data integrity / answer-key propagation |
| 4 | No offline re-evaluation / grace / answer-key-change workflow | **CRITICAL** | Exam integrity, must-have for coaching |
| 5 | AI provider is Gemini-only in code; no provider interface | **CRITICAL** | Vendor lock-in, no fallback |
| 6 | AI prompt templates not versioned → non-reproducible results | **CRITICAL** | Trust/audit of AI output |
| 7 | Server-side shuffle absent; scoring for 6+ new question types undefined | HIGH | Exam correctness |
| 8 | No API rate limits on AI/import/export; cost abuse possible | HIGH | Unbounded spend / abuse |
| 9 | PostgREST filter injection surface | HIGH | Data access / injection |
| 10 | FTS cannot serve Hindi/Indic (primary NEET market) | HIGH | Search useless in-market |
| 11 | pgvector dedupe/search at 10M scale unspecified + tenant-scoping of vectors | HIGH | Slow/leaky search |
| 12 | License metering races; oversubscription | HIGH | Revenue/compliance |
| 13 | `school_id=NULL` global rows break RLS and scoping | HIGH | Global bank invisible/broken |
| 14 | Online-tests single-subject FK vs multi-subject blueprints | HIGH | Paper→test mismatch |
| 15 | Analytics rollup strategy unpinned | HIGH | Dashboard perf |
| 16 | Version storage growth unbounded | HIGH | Storage/compute cost |
| 17 | Media pipeline (validation, optimization, CDN, linkage) under-specified | HIGH | Asset integrity/security |
| 18 | Generator/attempt concurrency (double-select, double-submit, max_attempts) | HIGH | Paper/attempt corruption |
| 19 | Backfill not idempotent/verifiable; compat-view drift | MEDIUM | Silent data/result corruption |
| 20 | Timer drift, reference propagation, withdraw-in-flight semantics undefined | MEDIUM | Wrong auto-submits |

---

## 4. TOP 20 IMPROVEMENTS

| # | Improvement | Class |
|---|---|---|
| 1 | Build a scoped PostgREST client that injects `school_id` from the authenticated token + a "tenant guard"; add RLS keyed on app claims for all new tables | **CRITICAL** |
| 2 | Decide partition keys now: bank by `school_id` (hash), responses by `created_at`/`test_id`; bake partition key into FKs/PK/unique | **CRITICAL** |
| 3 | Define the delivery artifact: frozen paper/test snapshot tables; `bank_question_id` = provenance; bank edits never mutate delivered content | **CRITICAL** |
| 4 | Add offline re-evaluation, challenge window, grace marks, answer-key correction + re-score policy | **CRITICAL** |
| 5 | Define `LLMProvider` interface + model registry (reuse `ai_provider.py` internals); add prompt-template table with versioning in `ai_question_jobs` | **CRITICAL** |
| 6 | Implement seeded server-side shuffle (options shuffle with keys) + scoring spec for every question type incl. partial credit | HIGH |
| 7 | Add API rate limits + per-school/per-user daily AI budgets beyond the credit engine | HIGH |
| 8 | Whitelist/validate all PostgREST filter params (columns, enums; no raw filter strings) | HIGH |
| 9 | Select search engine for Indic languages (OpenSearch/Meilisearch/Typesense vs PG-FTS+ICU); keep PG-FTS fallback | HIGH |
| 10 | Specify pgvector: embedding model, table, HNSW params, incremental jobs, dedupe threshold calibration, tenant-scoped vectors | HIGH |
| 11 | Atomic license reservation; license-derived entitlements; revocation semantics | HIGH |
| 12 | Explicit `is_global` handling for global rows (visible to licensed schools, read-only) — never NULL-dependent | HIGH |
| 13 | Multi-subject support in online-tests schema or explicit paper→test mapping | HIGH |
| 14 | Aggregate tables + idempotent background jobs + daily buckets; matviews only for small dims | HIGH |
| 15 | Version retention policy (N versions + archive + cleanup job) | HIGH |
| 16 | Media: MIME/size/AV validation, thumbnails, CDN signed URLs, media↔question-version linkage, orphan sweep | HIGH |
| 17 | Atomic selection reservation in generator; submit idempotency key; DB-enforced `max_attempts` | HIGH |
| 18 | Seed new system roles (`reviewer`, `senior_faculty`, `hod`, `academic_head`); verify `managed_*` inheritance | MEDIUM |
| 19 | Idempotent, hash-verified backfill; compat-view contract test; freeze published results | MEDIUM |
| 20 | Timer drift/grace policy; reference-propagation rule; withdraw-in-flight semantics | MEDIUM |

---

## 5. MUST REDESIGN BEFORE IMPLEMENTATION

These five are **structural**: deciding them later is disproportionately expensive, and three of them interact (partitioning ↔ snapshot model ↔ tenancy).

1. **[CRITICAL] Tenancy enforcement model.** Replace "service-role + Python discipline" with scoped-token access + tenant guard + RLS on new tables. This changes every data-access call, so it must be the foundation, not an afterthought.
2. **[CRITICAL] Partitioning decision.** Choose the partition key(s) now and design all FKs/PK/unique constraints to include them. Postponing this guarantees a painful rebuild at ~10M questions.
3. **[CRITICAL] Delivery artifact model.** Commit to the frozen snapshot model for papers/tests. This drives schema, scoring, audit, withdraw, and re-grade semantics — get it wrong and every downstream feature inherits the bug.
4. **[CRITICAL] Offline examination lifecycle.** Re-evaluation, grace, and answer-key correction are missing entirely from the spec and are non-negotiable for a coaching ERP. Design the workflow + state machine before build.
5. **[CRITICAL] AI layer.** Provider interface + prompt versioning + cost caps. The credit engine is excellent; the layer on top of it is not specified and cannot be "added later" without rework of every AI endpoint and every stored result.

Additionally, the following HIGH items should be resolved during Phase A (schema) because they affect column/table design: multi-subject tests, `is_global` handling, `question_code` namespaces, IRT-reserve columns, exact-duplicate key, option normalization for scoring, and per-set key versioning.

---

## 6. FINAL DECISION

### REQUIRES ARCHITECTURE CHANGES

The architecture's **breadth, additive discipline, and alignment with the existing codebase are strong** — it correctly identifies the unified bank, blueprint engine, snapshot-first delivery, multi-school scoping, and audit-everywhere AI as the right spine. But **five structural decisions are unresolved**, the **security model has a critical hole** (service-role bypass of RLS), and **three core exam workflows are missing or ambiguous** (offline re-evaluation, snapshot-vs-reference, shuffle/scoring). Given the implementation will cost months of work, these must be settled — and reflected back into `FINAL_EXAMINATION_ARCHITECTURE.md` — **before any code, schema, or migration is written.**

**Do not begin implementation until:** (1)–(5) in §5 are decided and written into the architecture document, and the §4 critical/high improvements are assigned to a phase.
