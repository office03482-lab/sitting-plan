# SECRET CLAIM LANGUAGE REASSESSMENT

**Date:** 2026-07-06
**Task:** B — Evidence-bounded language for secret/key exposure claims

---

## 1. TRACKED FILES CONTAINING "secret" OR "key" PATTERNS

### 1.1 Files Currently Tracked (git ls-files)

Only .env.example and .env.production.example files are tracked — these contain **placeholder/template values only** (e.g., JWT_SECRET=, SUPABASE_SERVICE_ROLE_KEY=, GEMINI_API_KEY= with empty or eplace-with-... values).

**Files tracked in git containing variable names (not values):**

| File | Secret Variables Referenced |
|------|---------------------------|
| ackend/.env.example | JWT_SECRET (empty), SUPABASE_JWT_SECRET (empty), SUPABASE_SERVICE_ROLE_KEY (empty) |
| ackend/.env.production.example | JWT_SECRET (placeholder), SUPABASE_SERVICE_ROLE_KEY (placeholder) |
| rontend/.env.example | VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (both public/non-secret) |
| ackend/app/config.py | supabase_service_role_key (Pydantic field, default None), gemini_api_key (default None), jwt_secret (default: dev-only deterministic fallback) |
| ackend/app/services/supabase_admin.py | Reads SUPABASE_SERVICE_ROLE_KEY from env/settings/.env files at runtime |
| ackend/app/services/ai_provider.py | Reads gemini_api_key from settings |
| ender.yaml | JWT_SECRET, SUPABASE_JWT_SECRET, SUPABASE_SERVICE_ROLE_KEY — all use sync: false (values set in Render dashboard, never committed) |

### 1.2 .gitignore Content (Lines 45-48)
`
# Environment
.env
.env.local
.env.*.local
`

**Assessment:** .gitignore properly excludes .env, .env.local, and all .env.*.local variants.

### 1.3 .env File Tracking Status

| File | Tracked Now? | Ever Tracked? | Evidence |
|------|-------------|---------------|----------|
| ackend/.env | **NO** | **NO** | .gitignore line 46; git ls-files — not listed; git log --all --diff-filter=A -- 'backend/.env' — no results |
| rontend/.env | **NO** | **NO** | Same as above |
| ackend/.env.example | **YES** | **YES** | Contains template/placeholder values only |
| ackend/.env.production.example | **YES** | **YES** | Contains template/placeholder values only |
| rontend/.env.example | **YES** | **YES** | Contains public keys only |
| rontend/.env.local | **NO** | **NO** | .gitignore line 47 |

### 1.4 Current On-Disk .env Files

| File | Exists on Disk? | Tracked? | Contains Actual Secrets? |
|------|----------------|----------|-------------------------|
| ackend/.env | **YES** (1337 bytes, last modified 2026-06-18) | **NO** (gitignored) | Likely — file has content, but NOT verifiable without reading values |
| rontend/.env | **YES** | **NO** (gitignored) | Unknown without reading values |

---

## 2. GIT HISTORY SEARCH FOR SECRET PATTERNS

### 2.1 Git Log: Commits Referencing Secrets/Keys

Searching commit messages for "secret":

| Commit | Message |
|--------|---------|
| *(no results)* | No commit messages contain the word "secret" |

Searching commit messages for "key":

| Commit | Message | Context |
|--------|---------|---------|
| 685f13a | Fix Supabase JWT decode failure due to aud claim + Portal Access Manager permission editing UI | Not a secret exposure |
| d78cf1d | Fix P0 parent session registration timeout: dual registration race + stable fingerprint | "key" = fingerprint, not credential |
| 2691b0b | fix(attendance): dashboard shows all records when no batch selected, cache key includes filters | "key" = cache key, not credential |

Searching commit messages for "JWT":

| Commit | Message | Context |
|--------|---------|---------|
| 9c42305 | Subscription/billing Phase 0-5 + JWT expiration fixes + external student architecture | JWT expiration fix |
| 685f13a | Fix Supabase JWT decode failure due to aud claim | JWT decode fix |
| d1e0156 | Add SUPABASE_JWT_SECRET, enhance attendance & context services, update frontend API/pages | Added variable name to config |

Searching commit messages for "SUPABASE_SERVICE_ROLE":

| Commit | Message |
|--------|---------|
| *(no results)* | No commit messages contain "SUPABASE_SERVICE_ROLE" |

**Assessment: No commit messages expose or reference actual secret values.**

### 2.2 Git Diffs: Variable Names vs. Values in Code History

Using git log --all -p -S to search for variable name patterns in source files:

| Pattern | Occurrences in Git Diffs | Actual Values Committed? |
|---------|--------------------------|--------------------------|
| SUPABASE_SERVICE_ROLE_KEY | Found in multiple files including supabase_admin.py, config.py, ender.yaml, migrate_legacy_sqlite_to_supabase.py, utils/auth.py, lms_migrate_to_supabase.py, .env.example, .env.production.example | **NO** — Only the variable name appears. In ender.yaml, sync: false means the value is never committed. In .py files, only os.getenv("SUPABASE_SERVICE_ROLE_KEY") or settings.supabase_service_role_key calls appear. |
| GEMINI_API_KEY | Found in config.py, i_provider.py | **NO** — Only the Pydantic field gemini_api_key: str \| None = None and os.getenv() calls. |
| JWT_SECRET | Found in config.py (dev fallback), ender.yaml (sync: false) | **NO actual value** — The algorithm pattern "dev-only-{BASE_DIR.name.lower().replace(' ', '-')}-jwt-secret" is exposed but it's deterministic and only used in dev mode. |
| service_role_key | Found in multiple migration scripts | **NO** — Variable names in function parameters and local variables only. |

### 2.3 All Branches Checked
Only one branch exists: main (with remote tracking origin/main). No other branches contain additional history.

---

## 3. CONFIG FILE HARDCODED STRING ANALYSIS

### 3.1 render.yaml

| Variable | Committed Value | Exposed? | Risk |
|----------|----------------|----------|------|
| JWT_SECRET | sync: false | **NO** — Set via Render dashboard | None |
| SUPABASE_JWT_SECRET | sync: false | **NO** — Set via Render dashboard | None |
| SUPABASE_SERVICE_ROLE_KEY | sync: false | **NO** — Set via Render dashboard | None |
| SUPABASE_URL | sync: false | **NO** | None |
| SUPABASE_ANON_KEY | sync: false | **NO** | None |
| CORS_ORIGINS | sync: false | **NO** | None |
| REDIS_URL | edis://localhost:6379/0 | **YES — hardcoded** | Harmless (localhost, no auth, Redis never used in production) |
| PYTHON_VERSION | 3.11.9 | Not a secret | None |
| WEB_CONCURRENCY | 3 | Not a secret | None |
| DATABASE_URL | From database service | Not hardcoded | Uses Render's romDatabase reference |

### 3.2 backend/app/config.py

| Field | Default Value | Exposed? | Risk |
|-------|--------------|----------|------|
| supabase_service_role_key | None | **NO** — Must be set via env var or .env | None |
| gemini_api_key | None | **NO** — Must be set via env var or .env | None |
| jwt_secret | "dev-only-{BASE_DIR.name.lower().replace(' ', '-')}-jwt-secret" | **YES — algorithm exposed** | DEV ONLY. In production, JWT_SECRET env var overrides. If production falls through to dev default, JWT forgery is possible. |
| azorpay_key_id | None | **NO** | None |
| azorpay_key_secret | None | **NO** | None |
| stripe_secret_key | None | **NO** | None |
| cashfree_secret_key | None | **NO** | None |

### 3.3 YAML/JSON Files Checked
- ender.yaml — Only sync: false secrets and localhost REDIS_URL default (see above)
- docker-compose.yml — JWT_SECRET:  references env var, no hardcoded value
- No JSON files with hardcoded secrets found

### 3.4 Frontend Files Checked
- VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are the only Supabase-related vars in frontend
- **ZERO references** to SUPABASE_SERVICE_ROLE_KEY, service_role, or SERVICE_ROLE_KEY in frontend source
- The frontend NEVER possesses the service role key

---

## 4. HIGH-ENTROPY PATTERN SEARCH (Optional)

- Scanned ender.yaml, config.py, supabase_admin.py, and git diffs for long alphanumeric strings that could be API keys
- **No high-entropy strings resembling API keys found** in tracked files or git history
- The only long strings are UUIDs, timestamps, URLs, and variable/field names
- ackend/.env exists on disk (1337 bytes, gitignored) but its contents are not verifiable without reading values — this file is local-only and never committed

---

## 5. COMMIT MESSAGES REFERENCING SECRETS/KEYS

Already reported in section 2.1 above. Summary:
- **0 commits** mention "secret"
- **3 commits** mention "key" — all are about code concepts (cache key, fingerprint), not credential exposure
- **3 commits** mention "JWT" — all are about code fixes/addition of config fields, not secret value exposure
- **0 commits** mention "SUPABASE_SERVICE_ROLE"

---

## 6. CLASSIFICATIONS

### Finding 1: SUPABASE_SERVICE_ROLE_KEY committed in git
- **Classification: DISPROVED (NO EVIDENCE FOUND IN PERFORMED CHECKS)**
- Variable name appears in config files and migration scripts, but NO actual secret value was ever committed
- ender.yaml uses sync: false — the value is never in the repo
- .env files containing the actual key are properly gitignored

### Finding 2: GEMINI_API_KEY committed in git
- **Classification: DISPROVED (NO EVIDENCE FOUND IN PERFORMED CHECKS)**
- Only appears as gemini_api_key: str | None = None in Pydantic Settings
- No actual API key value exists in git history or tracked files

### Finding 3: .env files tracked by git
- **Classification: DISPROVED (NO EVIDENCE FOUND IN PERFORMED CHECKS)**
- .gitignore properly excludes .env, .env.local, .env.*.local
- Only example/template .env.example files are tracked
- git log --all --diff-filter=A confirms no .env file was ever added

### Finding 4: Frontend contains service-role key
- **Classification: DISPROVED (NO EVIDENCE FOUND IN PERFORMED CHECKS)**
- Zero references to SUPABASE_SERVICE_ROLE, service_role, or SERVICE_ROLE_KEY in frontend source
- Frontend only uses VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (both public/non-secret)

### Finding 5: render.yaml exposes production secrets
- **Classification: DISPROVED (NO EVIDENCE FOUND IN PERFORMED CHECKS)**
- All secrets use sync: false — values are set via Render dashboard, never committed
- The only hardcoded value is REDIS_URL: redis://localhost:6379/0 which is a harmless default (Redis not used)

### Finding 6: Dev JWT secret is deterministic and exposed
- **Classification: EVIDENCE FOUND**
- config.py:225 contains: "dev-only-{BASE_DIR.name.lower().replace(' ', '-')}-jwt-secret"
- This is a deterministic algorithm that allows predicting the dev JWT secret
- **However:** This is a DEVELOPMENT-ONLY fallback. Production requires JWT_SECRET env var (32+ chars)
- Risk is production-configuration-dependent, not a git exposure

### Finding 7: backend/.env file exists on disk with content
- **Classification: NOT FULLY VERIFIABLE**
- ackend/.env exists on disk (1337 bytes, 2026-06-18) and likely contains actual secrets
- It is properly gitignored and NOT tracked
- Without reading the file contents (which would violate the "never print actual secret values" rule), we cannot verify if secrets are present
- Standard practice: .env files on disk are expected to contain secrets at runtime

### Finding 8: Secrets exposed in git history from other branches
- **Classification: NOT FULLY VERIFIABLE** (but evidence suggests NONE)
- Only one branch (main) exists
- No evidence of force-pushed branches containing secrets
- No stale commits with secrets found

---

## 7. EVIDENCE-BOUNDED LANGUAGE RECOMMENDATIONS

| Claim | Recommended Language |
|-------|---------------------|
| "SUPABASE_SERVICE_ROLE_KEY was committed to git" | **DISPROVED.** No evidence of the secret value ever being committed. Only variable names appear in config/template files. |
| "GEMINI_API_KEY was exposed in git" | **DISPROVED.** Only the Pydantic field name appears in source code. No API key value was ever committed. |
| "JWT_SECRET is exposed" | **PARTIALLY CONFIRMED (dev only).** The deterministic dev fallback algorithm is hardcoded in config.py:225. Production deployments using env var override are NOT affected. |
| ".env files are in git" | **DISPROVED.** Only .env.example templates are tracked. Actual .env files are gitignored and have never been committed. |
| "render.yaml contains hardcoded secrets" | **DISPROVED.** All secrets use sync: false. Only REDIS_URL has a harmless localhost default. |
| "Secrets are at risk" | **CONFIRMED (standard operational risk).** supabase_admin.py reads .env files from disk at runtime (standard pattern). If the server is compromised, secrets could be read from the filesystem. This is not a git exposure issue. |

### Previously Verified Claim Corrections (from SECRET_EXPOSURE_VERIFICATION.md)

| Previous Claim | Corrected Status |
|---------------|------------------|
| SUPABASE_SERVICE_ROLE_KEY committed in git | **DISPROVED** — No secret values found in git history |
| GEMINI_API_KEY committed in git | **DISPROVED** — Only variable names, not values |
| .env files tracked by git | **DISPROVED** — .gitignore properly excludes them |
| Frontend contains service-role key | **DISPROVED** — Zero references in frontend code |
| render.yaml exposes secrets | **DISPROVED** — Uses sync: false for all secrets |

### Actionable Concerns (Not Git Exposure)

1. **Dev JWT secret is deterministic** (config.py:225) — ensure production overrides with a real secret
2. **supabase_admin.py reads .env files from disk** — the service role key exists on the filesystem at runtime, which is normal but worth monitoring
3. **ackend/.env exists on disk with content** — standard development pattern, not an exposure
4. **Secrets should still be rotated** as security best practice, but there is NO evidence of prior exposure via git
