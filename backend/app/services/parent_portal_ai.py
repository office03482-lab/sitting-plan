"""Intent-driven AI engine for the Parent Portal assistant.

This module replaces the previous per-student serial pipeline (which issued
10-14 database queries per student and could not serve school-wide questions
without silently dropping students) with a five-stage pipeline:

    Stage 1  Scope resolution  -> resolve the full set of visible students
                                 (parents: linked children; school/platform
                                 admins: every active student, no truncation)
    Stage 2  Question analysis -> intent classification (EN + Hinglish),
                                 entity resolution (student/batch/subject/
                                 teacher/date-range), aggregation mode, and
                                 the minimal set of datasets actually needed
    Stage 3  Data loading      -> each required dataset is loaded once via the
                                 shared batched loaders, all in parallel, with
                                 student-id chunking (never a per-student loop)
    Stage 4  Context assembly  -> progressive context: compact roll-ups and
                                 exact counts over ALL students for wide
                                 scopes, plus full detail blocks for parents
                                 or the top/most-relevant students
    Stage 5  Answer            -> a single Gemini call grounded on the context

No student is ever silently excluded: every roll-up/count below is computed
over the complete resolved student set.
"""
from __future__ import annotations

import logging
import re
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import timedelta
from functools import partial
from typing import Any

from fastapi import HTTPException, status

from . import parent_portal_service as pps
from .ai_provider import AIProviderError, AIQuotaError, chat
from .supabase_analytics import (
    _load_results,
    _load_tests,
    get_student_analytics_batch,
)
from .supabase_lms import (
    _course_visible_to_student,
    _load_assignment_rows,
    _serialize_assignment,
    _serialize_submission,
    _table as _lms_table,
)
from .supabase_parent_intelligence import (
    _load_discipline_records_batch,
    _load_study_plans_batch as _load_study_plans_rows_batch,
)

logger = logging.getLogger("parent_portal_ai")

# ─── Dataset constants ─────────────────────────────────────────────────

DATASET_ATTENDANCE = "attendance"
DATASET_FEES = "fees"
DATASET_ASSIGNMENTS = "assignments"
DATASET_TESTS = "tests"
DATASET_ACADEMIC = "academic"
DATASET_DISCIPLINE = "discipline"
DATASET_STUDY_PLANS = "study_plans"

ALL_DATASETS = {
    DATASET_ATTENDANCE,
    DATASET_FEES,
    DATASET_ASSIGNMENTS,
    DATASET_TESTS,
    DATASET_ACADEMIC,
    DATASET_DISCIPLINE,
    DATASET_STUDY_PLANS,
}

INTENT_OVERALL = "overall"
INTENT_ATTENDANCE = "attendance"
INTENT_FEES = "fees"
INTENT_ASSIGNMENTS = "assignments"
INTENT_TESTS = "tests"
INTENT_ACADEMIC = "academic"
INTENT_DISCIPLINE = "discipline"
INTENT_STUDY_PLANS = "study_plans"
INTENT_RISK = "risk"
INTENT_PERFORMANCE = "performance"

# intent -> datasets that must be loaded to answer it
INTENT_DATASETS: dict[str, set[str]] = {
    INTENT_ATTENDANCE: {DATASET_ATTENDANCE},
    INTENT_FEES: {DATASET_FEES},
    INTENT_ASSIGNMENTS: {DATASET_ASSIGNMENTS},
    INTENT_TESTS: {DATASET_TESTS},
    INTENT_ACADEMIC: {DATASET_ACADEMIC, DATASET_TESTS},
    INTENT_DISCIPLINE: {DATASET_DISCIPLINE},
    INTENT_STUDY_PLANS: {DATASET_STUDY_PLANS},
    INTENT_RISK: {DATASET_ATTENDANCE, DATASET_FEES, DATASET_TESTS, DATASET_ACADEMIC},
    INTENT_PERFORMANCE: {DATASET_TESTS, DATASET_ATTENDANCE, DATASET_ACADEMIC},
    INTENT_OVERALL: set(ALL_DATASETS),
}

# intent -> primary metric used for ranking / roll-ups
INTENT_METRIC: dict[str, str | None] = {
    INTENT_ATTENDANCE: DATASET_ATTENDANCE,
    INTENT_FEES: DATASET_FEES,
    INTENT_ASSIGNMENTS: DATASET_ASSIGNMENTS,
    INTENT_TESTS: DATASET_TESTS,
    INTENT_ACADEMIC: DATASET_ACADEMIC,
    INTENT_DISCIPLINE: DATASET_DISCIPLINE,
    INTENT_STUDY_PLANS: DATASET_STUDY_PLANS,
    INTENT_RISK: "risk",
    INTENT_PERFORMANCE: "performance",
    INTENT_OVERALL: None,
}

# intent -> matched keyword groups (all lower-cased; short words match on
# word boundaries, longer phrases on substring)
_INTENT_KEYWORDS: dict[str, tuple[str, ...]] = {
    INTENT_ATTENDANCE: (
        "attendance", "present days", "absent days", "absent", "absentee",
        "leave", "haziri", "punctual", "truant", "absentees",
    ),
    INTENT_FEES: (
        "fee", "fees", "dues", "dues amount", "payment", "installment",
        "balance", "defaulters", "amount due", "rupees", "charge", "paid up",
    ),
    INTENT_ASSIGNMENTS: (
        "assignment", "homework", "hw", "submission", "project", "pending work",
        "assignments",
    ),
    INTENT_TESTS: (
        "test", "tests", "exam", "exams", "marks", "mark", "score", "scores",
        "quiz", "assessment", "mock", "paper", "result", "results",
    ),
    INTENT_ACADEMIC: (
        "academic", "progress", "course", "courses", "learning", "lessons",
        "weak", "strong", "topics", "revision", "curriculum",
    ),
    INTENT_DISCIPLINE: (
        "discipline", "misconduct", "behavior", "behaviour", "incident",
        "punishment", "warning", "detention",
    ),
    INTENT_STUDY_PLANS: (
        "study plan", "study plans", "revision plan", "syllabus", "schedule",
    ),
    INTENT_RISK: (
        "risk", "at-risk", "at risk", "danger", "struggling", "failing",
        "dropout", "falling behind",
    ),
    INTENT_PERFORMANCE: (
        "performance", "perform", "improve", "improving", "best", "worst",
        "top", "ranked", "rank", "percentile",
    ),
}

# "percentage" is ambiguous: resolved by surrounding keywords in _classify_intent
_PERCENT_AMBIGUOUS = ("percentage", "percent", "avg")

_WINDOW_RULES: tuple[tuple[str, int], ...] = (
    ("today", 1),
    ("yesterday", 2),
    ("this week", 7),
    ("last week", 7),
    ("past 7 days", 7),
    ("last 7 days", 7),
    ("7 days", 7),
    ("this month", 30),
    ("last month", 30),
    ("past 30 days", 30),
    ("last 30 days", 30),
    ("30 days", 30),
    ("past 90 days", 90),
    ("last 90 days", 90),
    ("90 days", 90),
    ("this year", 365),
    ("last year", 365),
    ("this session", 365),
    ("past 365 days", 365),
)

_DEICTIC_PHRASES = (
    "this student", "this child", "my child", "my daughter", "my son",
    "selected student", "the student", "that student",
)
_DEICTIC_WORDS = ("him", "her", "she", "he")


def _phrase_matches(question_lower: str, phrase: str) -> bool:
    if len(phrase.split()) == 1 and len(phrase) <= 4:
        return bool(re.search(rf"(?<![a-z]){re.escape(phrase)}(?![a-z])", question_lower))
    return phrase in question_lower

# short tokens that must match on whole-word boundaries only
_BOUNDARY_TOKENS = {"due", "fee", "fees", "mark", "marks", "plan", "paper", "top", "rank", "avg"}

_STUDENT_CACHE_TTL_SECONDS = 30.0
_META_CACHE_TTL_SECONDS = 120.0


# ─── Small helpers ─────────────────────────────────────────────────────


def _norm(value: Any) -> str:
    return pps._normalize(value)


def _lower(value: Any) -> str:
    return pps._normalize(value).lower()


def _chunks(items: list[str], size: int = 500):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def _pct_of(value: Any, total: Any) -> float:
    return pps._safe_percentage(value, max(total, 1))


def _result_percentage(row: dict[str, Any]) -> float:
    pct = pps._safe_float(row.get("percentage"))
    if pct:
        return round(pct, 1)
    score = pps._safe_float(row.get("score_obtained"))
    max_score = pps._safe_float(row.get("max_score"))
    return _pct_of(score, max_score)


# ─── TTL caches ────────────────────────────────────────────────────────

_CACHE_LOCK = threading.Lock()
_STUDENT_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_META_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}


def _cache_get(cache: dict[str, tuple[float, Any]], key: str, ttl: float) -> Any | None:
    entry = cache.get(key)
    if entry and (time.monotonic() - entry[0]) < ttl:
        return entry[1]
    return None


def _cache_set(cache: dict[str, tuple[float, Any]], key: str, value: Any) -> None:
    with _CACHE_LOCK:
        cache[key] = (time.monotonic(), value)


# ─── Stage 1: scope resolution ─────────────────────────────────────────


def _load_all_active_students(school_id: str) -> list[dict[str, Any]]:
    """Every active student for the school — intentionally without any cap."""
    rows = list(
        pps._public_table("students")
        .select("id,school_id,profile_id,batch_id,full_name,class_name,section,roll_number")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .execute()
        .data
        or []
    )
    return [dict(row) for row in rows]


def _resolve_parent_students_fast(school_id: str, profile_id: str | None, email: str | None) -> list[dict[str, Any]]:
    """Narrow guardian->student_guardians->students lookups instead of
    scanning every guardian/student row in the school."""
    if not profile_id and not email:
        return []
    try:
        guardian_query = (
            pps._client()
            .schema("academic")
            .table("guardians")
            .select("id,profile_id,email")
            .eq("school_id", school_id)
            .eq("is_active", True)
        )
        if profile_id:
            guardian_query = guardian_query.eq("profile_id", profile_id)
        else:
            guardian_query = guardian_query.ilike("email", f"%{email}%")
        guardians = list(guardian_query.execute().data or [])
        if not guardians:
            return []
        guardian_ids = sorted({_norm(row.get("id")) for row in guardians if _norm(row.get("id"))})
        if not guardian_ids:
            return []
        links = list(
            pps._client()
            .schema("academic")
            .table("student_guardians")
            .select("student_id")
            .eq("school_id", school_id)
            .in_("guardian_id", guardian_ids)
            .execute()
            .data
            or []
        )
        student_ids = sorted({_norm(row.get("student_id")) for row in links if _norm(row.get("student_id"))})
        if not student_ids:
            return []
        rows = list(
            pps._public_table("students")
            .select("id,school_id,profile_id,batch_id,full_name,class_name,section,roll_number")
            .eq("school_id", school_id)
            .eq("is_active", True)
            .in_("id", student_ids)
            .execute()
            .data
            or []
        )
        if rows:
            return [dict(row) for row in rows]
    except Exception as exc:  # defensive: fall back to the legacy resolver
        logger.warning("fast parent resolver failed for school %s: %s", school_id, exc)
    return _legacy_parent_students(school_id, profile_id, email)


def _legacy_parent_students(school_id: str, profile_id: str | None, email: str | None) -> list[dict[str, Any]]:
    """Legacy metadata-based matcher (used as a rare fallback)."""
    from .supabase_lms import _list_parent_linked_students

    rows = _list_parent_linked_students(school_id, profile_id, email)
    result: list[dict[str, Any]] = []
    for row in rows:
        result.append(
            {
                "id": row.get("id"),
                "school_id": row.get("school_id"),
                "profile_id": row.get("profile_id"),
                "batch_id": row.get("batch_id"),
                "full_name": row.get("full_name"),
                "class_name": row.get("class_name"),
                "section": row.get("section"),
                "roll_number": row.get("roll_number"),
            }
        )
    return result


def resolve_scope_students(
    school_id: str,
    *,
    scope_context: Any,
    actor: dict[str, Any],
    user: Any,
) -> list[dict[str, Any]]:
    """Resolve the full visible student set, mirroring the route's scope
    rules but never truncating school-wide scopes to 500."""
    is_wide = bool(scope_context is not None and getattr(scope_context, "is_school_wide", False))
    if is_wide:
        def _role_value(attr: str) -> str:
            raw = getattr(user, attr, None)
            if raw is None:
                return ""
            return getattr(raw, "value", raw) or ""

        role_key = _lower(_role_value("role_key"))
        role = _lower(_role_value("role"))
        is_admin = role_key == "school_admin" or role == "admin" or _is_platform_admin(user)
        if is_admin:
            cache_key = f"wide:{school_id}"
            cached = _cache_get(_STUDENT_CACHE, cache_key, _STUDENT_CACHE_TTL_SECONDS)
            if cached is not None:
                return cached
            students = _load_all_active_students(school_id)
            _cache_set(_STUDENT_CACHE, cache_key, students)
            return students

    profile_id = _norm(actor.get("profile_id")) or None
    email = getattr(user, "email", None) or None
    cache_key = f"parent:{school_id}:{profile_id}:{_norm(email)}"
    cached = _cache_get(_STUDENT_CACHE, cache_key, _STUDENT_CACHE_TTL_SECONDS)
    if cached is not None:
        return cached
    students = _resolve_parent_students_fast(school_id, profile_id, email)
    _cache_set(_STUDENT_CACHE, cache_key, students)
    return students


def _is_platform_admin(user: Any) -> bool:
    try:
        from .bulk_action_requests import is_platform_admin_user

        return bool(is_platform_admin_user(user))
    except Exception:
        return False


# ─── Metadata (batches / subjects / courses / teachers) ────────────────


def _load_metadata(school_id: str) -> dict[str, Any]:
    batches: dict[str, dict[str, Any]] = {}
    subjects: dict[str, dict[str, Any]] = {}
    teachers: dict[str, dict[str, Any]] = {}
    courses: dict[str, dict[str, Any]] = {}
    try:
        for row in list(
            pps._public_table("batches")
            .select("id,name,class_name,section")
            .eq("school_id", school_id)
            .execute()
            .data
            or []
        ):
            batches[_norm(row.get("id"))] = dict(row)
    except Exception as exc:
        logger.warning("batches metadata unavailable for %s: %s", school_id, exc)
    try:
        for row in list(
            pps._public_table("subjects")
            .select("id,name,class_name")
            .eq("school_id", school_id)
            .execute()
            .data
            or []
        ):
            subjects[_norm(row.get("id"))] = dict(row)
    except Exception as exc:
        logger.warning("subjects metadata unavailable for %s: %s", school_id, exc)
    try:
        for row in list(
            pps._public_table("courses")
            .select("*")
            .eq("school_id", school_id)
            .eq("is_active", True)
            .is_("deleted_at", "null")
            .execute()
            .data
            or []
        ):
            courses[_norm(row.get("id"))] = dict(row)
    except Exception:
        try:
            for row in list(
                _lms_table("courses")
                .select("*")
                .eq("school_id", school_id)
                .eq("is_active", True)
                .is_("deleted_at", "null")
                .execute()
                .data
                or []
            ):
                courses[_norm(row.get("id"))] = dict(row)
        except Exception as exc:
            logger.warning("courses metadata unavailable for %s: %s", school_id, exc)
    for table_name in ("teachers", "staff"):
        try:
            for row in list(
                pps._public_table(table_name)
                .select("id,full_name,batch_id")
                .eq("school_id", school_id)
                .execute()
                .data
                or []
            ):
                teachers[_norm(row.get("id"))] = dict(row)
            if teachers:
                break
        except Exception:
            continue
    return {
        "batches": batches,
        "subjects": subjects,
        "teachers": teachers,
        "courses": courses,
    }


def get_metadata(school_id: str) -> dict[str, Any]:
    cache_key = f"meta:{school_id}"
    cached = _cache_get(_META_CACHE, cache_key, _META_CACHE_TTL_SECONDS)
    if cached is not None:
        return cached
    meta = _load_metadata(school_id)
    _cache_set(_META_CACHE, cache_key, meta)
    return meta


# ─── Stage 2: question analysis ────────────────────────────────────────


@dataclass
class AiPlan:
    intents: list[str] = field(default_factory=list)
    metric: str | None = None
    aggregation: str = "detail"  # detail | count | rank | summary | trend
    window_days: int | None = None
    named_students: list[str] = field(default_factory=list)
    batch_ids: list[str] = field(default_factory=list)
    subject_names: list[str] = field(default_factory=list)
    teacher_names: list[str] = field(default_factory=list)
    deictic: bool = False
    datasets: set[str] = field(default_factory=lambda: set(ALL_DATASETS))
    detail_top_n: int = 5


def _has_token(question_lower: str, token: str) -> bool:
    token = token.lower().strip()
    if not token:
        return False
    if token in _BOUNDARY_TOKENS:
        return bool(re.search(rf"(?<![a-z]){re.escape(token)}(?![a-z])", question_lower))
    return token in question_lower


def _classify_intent(question_lower: str) -> list[str]:
    matched: list[str] = []
    for intent, keywords in _INTENT_KEYWORDS.items():
        if any(_has_token(question_lower, kw) for kw in keywords):
            matched.append(intent)

    has_ambiguous_pct = any(_has_token(question_lower, t) for t in _PERCENT_AMBIGUOUS)
    if has_ambiguous_pct and not matched:
        matched.append(INTENT_TESTS)

    if not matched:
        matched.append(INTENT_OVERALL)
    return matched


def _detect_window(question_lower: str) -> int | None:
    for phrase, days in _WINDOW_RULES:
        if phrase in question_lower:
            return days
    match = re.search(r"\b(\d{1,3})\s*(days?|months?)\b", question_lower)
    if match:
        count = int(match.group(1))
        return count * 30 if match.group(2).startswith("month") else count
    return None


_NAME_TOKEN_BLOCKLIST = {
    "child", "kid", "student", "pupil", "test", "verify", "rt", "demo",
    "new", "add", "the", "and", "for", "this", "that", "who", "what",
    "how", "which", "show", "list", "any", "all", "my", "his", "her",
    "our", "your", "about", "with", "have", "has", "been", "doing",
}


def _match_names(question_lower: str, students: list[dict[str, Any]]) -> list[str]:
    q_words = re.findall(r"[a-z]+", question_lower)
    q_set = set(q_words)
    matched: list[str] = []
    for student in students:
        name = _lower(student.get("full_name"))
        if not name:
            continue
        if name in question_lower:
            matched.append(_norm(student.get("id")))
            continue
        name_tokens = [
            w for w in re.findall(r"[a-z]+", name)
            if len(w) >= 3 and w not in _NAME_TOKEN_BLOCKLIST
        ]
        if any(tok in q_set and re.search(rf"(?<![a-z]){re.escape(tok)}(?![a-z])", question_lower) for tok in name_tokens):
            matched.append(_norm(student.get("id")))
    return sorted({sid for sid in matched if sid})


def _match_batches(question_lower: str, batches: dict[str, dict[str, Any]]) -> list[str]:
    matched: list[str] = []
    for batch_id, batch in batches.items():
        name = _lower(batch.get("name"))
        class_name = _lower(batch.get("class_name"))
        section = _lower(batch.get("section"))
        candidates = [name]
        if class_name:
            candidates.append(class_name)
        if class_name and section:
            candidates.append(f"{class_name} {section}")
        if any(candidate and candidate in question_lower for candidate in candidates):
            matched.append(batch_id)
    return matched


def _match_subjects(question_lower: str, subjects: dict[str, dict[str, Any]]) -> list[str]:
    matched: list[str] = []
    for subject in subjects.values():
        name = _lower(subject.get("name"))
        if name and name in question_lower:
            matched.append(name)
    return sorted({m for m in matched if m})


def _match_teachers(question_lower: str, teachers: dict[str, dict[str, Any]]) -> list[str]:
    matched: list[str] = []
    for teacher in teachers.values():
        name = _lower(teacher.get("full_name"))
        if name and name in question_lower:
            matched.append(name)
    return sorted({m for m in matched if m})


def _detect_aggregation(question_lower: str) -> tuple[str, bool]:
    trend_words = ("trend", "pattern", "weekly", "monthly", "over time")
    count_words = ("how many", "kitne", "number of", "count", "total")
    rank_words = (
        "which", "who", "top", "bottom", "best", "worst", "below", "above",
        "list", "show", "defaulters", "highest", "lowest", "least", "most",
        "at-risk", "at risk", "ranked",
    )
    summary_words = ("summary", "summarize", "overview", "overall", "school",
                     "all students", "everyone", "report", "health check")
    has_window = _detect_window(question_lower) is not None
    if any(w in question_lower for w in trend_words) and has_window:
        return "trend", True
    if any(w in question_lower for w in count_words):
        return "count", True
    if any(w in question_lower for w in rank_words):
        return "rank", True
    if any(w in question_lower for w in summary_words):
        return "summary", True
    return "detail", False


def analyze_question(
    question: str,
    students: list[dict[str, Any]],
    meta: dict[str, Any],
    *,
    scope_is_wide: bool,
) -> AiPlan:
    question_lower = _lower(question)
    intents = _classify_intent(question_lower)

    datasets: set[str] = set()
    for intent in intents:
        datasets |= INTENT_DATASETS.get(intent, set(ALL_DATASETS))
    metric = None
    for intent in intents:
        candidate = INTENT_METRIC.get(intent)
        if candidate:
            metric = candidate
            break

    named_students = _match_names(question_lower, students)
    batch_ids = _match_batches(question_lower, meta.get("batches", {}))
    subject_names = _match_subjects(question_lower, meta.get("subjects", {}))
    teacher_names = _match_teachers(question_lower, meta.get("teachers", {}))
    window_days = _detect_window(question_lower)
    deictic = (any(_phrase_matches(question_lower, phrase) for phrase in _DEICTIC_PHRASES)
               or any(_phrase_matches(question_lower, word) for word in _DEICTIC_WORDS)) and not named_students

    aggregation, has_signal = ("detail", False)
    if scope_is_wide and not named_students and not deictic:
        aggregation, has_signal = _detect_aggregation(question_lower)
        if not has_signal:
            aggregation = "summary"

    return AiPlan(
        intents=intents,
        metric=metric,
        aggregation=aggregation,
        window_days=window_days,
        named_students=named_students,
        batch_ids=batch_ids,
        subject_names=subject_names,
        teacher_names=teacher_names,
        deictic=deictic,
        datasets=datasets,
    )


def resolve_targets(
    plan: AiPlan,
    students: list[dict[str, Any]],
    *,
    student_id: str | None,
    scope_is_wide: bool,
) -> tuple[list[dict[str, Any]], str]:
    """Return (target_students, mode) where mode in {detail, wide}."""
    by_id = {_norm(s.get("id")): s for s in students if _norm(s.get("id"))}

    if plan.named_students:
        targets = [by_id[sid] for sid in plan.named_students if sid in by_id]
        if targets:
            return targets, "detail"

    if plan.deictic and student_id:
        target = by_id.get(_norm(student_id))
        if target:
            return [target], "detail"

    if scope_is_wide:
        filtered = students
        if plan.batch_ids:
            batch_set = set(plan.batch_ids)
            filtered = [s for s in filtered if _norm(s.get("batch_id")) in batch_set]
        if plan.teacher_names and not filtered:
            pass
        return filtered, "wide"

    if student_id:
        target = by_id.get(_norm(student_id))
        if target:
            return [target], "detail"
    return students, "detail"


# ─── Stage 3: batched, parallel dataset loading ────────────────────────


@dataclass
class DataBundle:
    school_id: str
    students: list[dict[str, Any]] = field(default_factory=list)
    batches: dict[str, dict[str, Any]] = field(default_factory=dict)
    subjects: dict[str, dict[str, Any]] = field(default_factory=dict)
    courses: dict[str, dict[str, Any]] = field(default_factory=dict)
    teachers: dict[str, dict[str, Any]] = field(default_factory=dict)
    attendance: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    fees: dict[str, dict[str, Any]] = field(default_factory=dict)
    test_results: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    progress: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    discipline: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    study_plans: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    assignment_rows: list[dict[str, Any]] = field(default_factory=list)
    submissions_by_student: dict[str, dict[str, dict[str, Any]]] = field(default_factory=dict)
    shared_tests: list[dict[str, Any]] = field(default_factory=list)
    test_by_id: dict[str, dict[str, Any]] = field(default_factory=dict)
    subject_names: list[str] = field(default_factory=list)
    analytics: dict[str, dict[str, Any]] = field(default_factory=dict)

    def student(self, sid: str) -> dict[str, Any] | None:
        for student in self.students:
            if _norm(student.get("id")) == sid:
                return student
        return None


def _load_attendance_batch(school_id: str, ids: list[str], days: int) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for chunk in _chunks(ids):
        for sid, rows in (pps._batch_load_attendance(school_id, chunk, days=days) or {}).items():
            result[sid].extend(rows)
    return dict(result)


def _load_fees_batch(school_id: str, ids: list[str]) -> dict[str, dict[str, Any]]:
    if not ids:
        return {}
    result: dict[str, dict[str, Any]] = {}
    try:
        client = pps._client()
        for chunk in _chunks(ids):
            rows = list(
                client.schema("finance")
                .table("fee_assignments")
                .select("student_id,amount_due,amount_paid,late_fee_applied,due_date,status")
                .eq("school_id", school_id)
                .in_("student_id", chunk)
                .execute()
                .data
                or []
            )
            by_student: dict[str, list[dict[str, Any]]] = defaultdict(list)
            for row in rows:
                sid = _norm(row.get("student_id"))
                if sid:
                    by_student[sid].append(dict(row))
            for sid, assignments in by_student.items():
                if sid in result:
                    continue
                amount_due = sum(pps._safe_float(a.get("amount_due")) for a in assignments)
                amount_paid = sum(pps._safe_float(a.get("amount_paid")) for a in assignments)
                late_fee = sum(pps._safe_float(a.get("late_fee_applied")) for a in assignments)
                outstanding = max(amount_due + late_fee - amount_paid, 0.0)
                due_date = None
                any_overdue = False
                for assignment in assignments:
                    if pps._safe_float(assignment.get("amount_due")) + pps._safe_float(assignment.get("late_fee_applied")) - pps._safe_float(assignment.get("amount_paid")) > 0.01:
                        due_date = assignment.get("due_date") or due_date
                        if _lower(assignment.get("status")) in ("overdue",):
                            any_overdue = True
                if outstanding <= 0.01:
                    status = "paid"
                elif any_overdue:
                    status = "overdue"
                else:
                    status = "pending"
                result[sid] = {
                    "total_fee": round(amount_due, 2),
                    "paid_amount": round(amount_paid, 2),
                    "due_amount": round(outstanding, 2),
                    "status": status,
                    "due_date": due_date,
                    "payment_percentage": pps._safe_percentage(amount_paid, max(amount_due, 1)),
                }
    except Exception as exc:
        logger.warning("fees load failed for %s: %s", school_id, exc)
    return result


def _load_test_results_batch(school_id: str, ids: list[str], limit: int) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for chunk in _chunks(ids):
        rows = _load_results(school_id=school_id, student_ids=chunk) or []
        for row in rows:
            sid = _norm(row.get("student_id"))
            if sid:
                result[sid].append(dict(row))
    return dict(result)


def _load_progress_batch(school_id: str, ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for chunk in _chunks(ids):
        for sid, rows in (pps._batch_load_progress(school_id, chunk) or {}).items():
            result[sid].extend(rows)
    return dict(result)


def _load_discipline_batch(school_id: str, ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for chunk in _chunks(ids):
        for sid, rows in (_load_discipline_records_batch(school_id, chunk) or {}).items():
            result[sid].extend(rows)
    return dict(result)


def _load_study_plans_bundle(school_id: str, ids: list[str], days: int) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for chunk in _chunks(ids):
        for sid, rows in (_load_study_plans_rows_batch(school_id, chunk, days=days) or {}).items():
            result[sid].extend(rows)
    return dict(result)


def _load_assignments_bundle(school_id: str) -> tuple[list[dict[str, Any]], dict[str, dict[str, dict[str, Any]]]]:
    try:
        rows = _load_assignment_rows(school_id)
        assignment_rows = [dict(row) for row in rows]
        assignment_ids = sorted({_norm(row.get("id")) for row in assignment_rows if _norm(row.get("id"))})
        submissions: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
        if assignment_ids:
            sub_rows = list(
                _lms_table("assignment_submissions")
                .select("*")
                .eq("school_id", school_id)
                .in_("assignment_id", assignment_ids)
                .is_("deleted_at", "null")
                .execute()
                .data
                or []
            )
            for row in sub_rows:
                student_key = _norm(row.get("student_id"))
                assignment_key = _norm(row.get("assignment_id"))
                if student_key and assignment_key:
                    submissions[student_key][assignment_key] = _serialize_submission(dict(row))
        return assignment_rows, dict(submissions)
    except Exception as exc:
        logger.warning("assignments bundle unavailable for %s: %s", school_id, exc)
        return [], {}


def _load_bundle(
    school_id: str,
    *,
    datasets: set[str],
    students: list[dict[str, Any]],
    meta: dict[str, Any],
    window_days: int | None = None,
    wide: bool = False,
    load_students: list[dict[str, Any]] | None = None,
) -> DataBundle:
    load_students = students if load_students is None else load_students
    ids = sorted({_norm(s.get("id")) for s in load_students if _norm(s.get("id"))})
    att_days = window_days or (90 if wide else 365)
    results_limit = 5 if wide else 50

    defaults: dict[str, Any] = {
        DATASET_ATTENDANCE: {},
        DATASET_FEES: {},
        DATASET_TESTS: {},
        DATASET_ACADEMIC: {},
        DATASET_DISCIPLINE: {},
        DATASET_STUDY_PLANS: {},
        DATASET_ASSIGNMENTS: ([], {}),
        "shared_tests": [],
    }
    specs: list[list[Any]] = []
    if DATASET_ATTENDANCE in datasets:
        specs.append([DATASET_ATTENDANCE, _load_attendance_batch, (school_id, ids, att_days), None])
    if DATASET_FEES in datasets:
        specs.append([DATASET_FEES, _load_fees_batch, (school_id, ids), None])
    if DATASET_TESTS in datasets:
        specs.append([DATASET_TESTS, _load_test_results_batch, (school_id, ids, results_limit), None])
    if DATASET_ACADEMIC in datasets:
        specs.append([DATASET_ACADEMIC, _load_progress_batch, (school_id, ids), None])
    if DATASET_DISCIPLINE in datasets:
        specs.append([DATASET_DISCIPLINE, _load_discipline_batch, (school_id, ids), None])
    if DATASET_STUDY_PLANS in datasets:
        specs.append([DATASET_STUDY_PLANS, _load_study_plans_bundle, (school_id, ids, 30), None])
    if DATASET_ASSIGNMENTS in datasets:
        specs.append([DATASET_ASSIGNMENTS, _load_assignments_bundle, (school_id,), None])
    if DATASET_TESTS in datasets:
        specs.append(["shared_tests", partial(_load_tests, school_id=school_id), (), None])

    with ThreadPoolExecutor(max_workers=3) as pool:
        for spec in specs:
            spec[3] = pool.submit(spec[1], *spec[2])

    loaded: dict[str, Any] = {}
    for name, fn, args, future in specs:
        try:
            loaded[name] = future.result()
        except Exception as exc:
            logger.warning("parallel dataset load failed for school %s (%s): %s", school_id, name, exc)
            try:
                loaded[name] = fn(*args)
            except Exception as exc2:
                logger.warning("sequential dataset load failed for school %s (%s): %s", school_id, name, exc2)
                loaded[name] = defaults.get(name)

    attendance = loaded.get(DATASET_ATTENDANCE, {})
    fees = loaded.get(DATASET_FEES, {})
    test_results = loaded.get(DATASET_TESTS, {})
    progress = loaded.get(DATASET_ACADEMIC, {})
    discipline = loaded.get(DATASET_DISCIPLINE, {})
    study_plans = loaded.get(DATASET_STUDY_PLANS, {})
    assignment_rows, submissions_by_student = loaded.get(DATASET_ASSIGNMENTS, ([], {}))
    shared_tests = loaded.get("shared_tests", [])

    shared_tests = [dict(t) for t in shared_tests]
    test_by_id: dict[str, dict[str, Any]] = {}
    for test in shared_tests:
        test = dict(test)
        subject_id = _norm(test.get("subject_id"))
        if subject_id and subject_id in meta.get("subjects", {}):
            test["subject"] = meta["subjects"][subject_id].get("name") or test.get("subject")
        test_by_id[_norm(test.get("id"))] = test

    return DataBundle(
        school_id=school_id,
        students=list(students),
        batches=meta.get("batches", {}),
        subjects=meta.get("subjects", {}),
        courses=meta.get("courses", {}),
        teachers=meta.get("teachers", {}),
        attendance=attendance,
        fees=fees,
        test_results=test_results,
        progress=progress,
        discipline=discipline,
        study_plans=study_plans,
        assignment_rows=assignment_rows,
        submissions_by_student=submissions_by_student,
        shared_tests=shared_tests,
        test_by_id=test_by_id,
    )


# ─── Per-student summaries (pure in-memory, from the shared bundle) ─────


def _assignments_for_student(bundle: DataBundle, student: dict[str, Any]) -> list[dict[str, Any]]:
    sid = _norm(student.get("id"))
    visible_courses = {
        cid for cid, course in bundle.courses.items()
        if _course_visible_to_student(course, student)
    }
    subs = bundle.submissions_by_student.get(sid, {})
    items: list[dict[str, Any]] = []
    for row in bundle.assignment_rows:
        if not bool(row.get("is_active", True)):
            continue
        if _norm(row.get("status")) not in {"published", "closed"}:
            continue
        course_id = _norm(row.get("course_id"))
        if course_id and bundle.courses and course_id not in visible_courses:
            continue
        items.append(_serialize_assignment(dict(row), submission=subs.get(_norm(row.get("id")))))
    return items


def _assignment_summary(bundle: DataBundle, student: dict[str, Any]) -> dict[str, int]:
    sid = _norm(student.get("id"))
    subs = bundle.submissions_by_student.get(sid, {})
    visible_courses = {
        cid for cid, course in bundle.courses.items()
        if _course_visible_to_student(course, student)
    }
    pending = submitted = graded = late = 0
    for row in bundle.assignment_rows:
        if not bool(row.get("is_active", True)):
            continue
        status = _norm(row.get("status"))
        if status not in {"published", "closed"}:
            continue
        course_id = _norm(row.get("course_id"))
        if course_id and bundle.courses and course_id not in visible_courses:
            continue
        sub = subs.get(_norm(row.get("id")))
        if sub:
            submitted += 1
            if sub.get("score_awarded") is not None:
                graded += 1
            elif _norm(sub.get("status")) == "late":
                late += 1
        elif status != "closed":
            pending += 1
    return {
        "pending": pending,
        "submitted": submitted,
        "graded": graded,
        "late": late,
    }


def _test_summary(bundle: DataBundle, student: dict[str, Any]) -> dict[str, Any]:
    sid = _norm(student.get("id"))
    rows = bundle.test_results.get(sid, [])
    items: list[dict[str, Any]] = []
    for row in rows:
        test = bundle.test_by_id.get(_norm(row.get("test_id")))
        title = (test or {}).get("title") or row.get("test_title") or row.get("title")
        subject = (test or {}).get("subject") or row.get("subject") or row.get("subject_name")
        items.append(
            {
                "title": _norm(title),
                "subject": _norm(subject),
                "percentage": _result_percentage(row),
                "rank": pps._safe_int(row.get("rank_in_batch") or row.get("rank_in_school") or 0),
                "score": pps._safe_float(row.get("score_obtained")),
                "max_score": pps._safe_float(row.get("max_score")),
                "created_at": row.get("created_at"),
            }
        )
    if bundle.subject_names:
        subject_set = set(bundle.subject_names)
        items = [item for item in items if item.get("subject") and item["subject"] in subject_set]
    average = round(sum(item["percentage"] for item in items) / len(items), 1) if items else None
    return {
        "total_tests": len(items),
        "average_percentage": average,
        "latest": items[0] if items else None,
        "items": items,
    }


def _simplified_results(bundle: DataBundle, sid: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in bundle.test_results.get(sid, []):
        test = bundle.test_by_id.get(_norm(row.get("test_id")))
        out.append(
            {
                "title": (test or {}).get("title") or row.get("test_title") or row.get("title"),
                "score": pps._safe_float(row.get("score_obtained")),
                "total_marks": pps._safe_float(row.get("max_score")),
                "percentage": _result_percentage(row),
                "rank": pps._safe_int(row.get("rank_in_batch") or row.get("rank_in_school") or 0),
            }
        )
    return out


def _plan_completion(row: dict[str, Any]) -> float:
    pct = pps._safe_float(row.get("completion_percentage"))
    if pct:
        return round(pct, 1)
    pct = pps._safe_float(row.get("progress"))
    if pct:
        return round(pct, 1)
    status = _lower(row.get("status"))
    if status in ("completed", "done", "finished"):
        return 100.0
    return 0.0


def _study_plan_summary(bundle: DataBundle, student: dict[str, Any]) -> dict[str, Any]:
    plans = bundle.study_plans.get(_norm(student.get("id")), [])
    completions = [_plan_completion(row) for row in plans]
    avg = round(sum(completions) / len(completions), 1) if completions else None
    return {
        "total": len(plans),
        "completed": sum(1 for c in completions if c >= 100),
        "average_completion": avg,
    }


# ─── Metrics / ranking for wide scopes ─────────────────────────────────


def _attendance_percentage(bundle: DataBundle, sid: str) -> float | None:
    rows = bundle.attendance.get(sid, [])
    if not rows:
        return None
    present = sum(1 for r in rows if _lower(r.get("status")) == "present")
    return round(_pct_of(present, len(rows)), 1)


def _tests_average(bundle: DataBundle, sid: str) -> float | None:
    summary = _test_summary(bundle, bundle.student(sid) or {"id": sid})
    return summary.get("average_percentage")


def _academic_average(bundle: DataBundle, sid: str) -> float | None:
    progress = bundle.progress.get(sid, [])
    watch = [pps._safe_float(p.get("watch_percentage") or 0) for p in progress]
    if not watch:
        return None
    return round(sum(watch) / len(watch), 1)


def _risk_score(bundle: DataBundle, sid: str) -> float | None:
    att = _attendance_percentage(bundle, sid)
    tests = _tests_average(bundle, sid)
    academic = _academic_average(bundle, sid)
    fee = (bundle.fees.get(sid) or {}).get("due_amount") or 0
    components = []
    if att is not None:
        components.append((100 - att) * 0.4)
    if tests is not None:
        components.append((100 - tests) * 0.3)
    if academic is not None:
        components.append((100 - academic) * 0.2)
    if fee and fee > 0:
        components.append(50 * 0.1)
    if not components:
        return None
    return round(min(sum(components), 100.0), 1)


def _metric_value(bundle: DataBundle, student: dict[str, Any], metric: str) -> tuple[float | None, bool]:
    sid = _norm(student.get("id"))
    if metric == DATASET_ATTENDANCE:
        return _attendance_percentage(bundle, sid), bool(bundle.attendance.get(sid))
    if metric == DATASET_FEES:
        fee = bundle.fees.get(sid)
        return ((fee or {}).get("due_amount") or 0), fee is not None
    if metric == DATASET_TESTS:
        avg = _tests_average(bundle, sid)
        return avg, avg is not None
    if metric == DATASET_ACADEMIC:
        avg = _academic_average(bundle, sid)
        return avg, avg is not None
    if metric == DATASET_ASSIGNMENTS:
        summary = _assignment_summary(bundle, student)
        return float(summary["pending"]), True
    if metric == DATASET_DISCIPLINE:
        records = bundle.discipline.get(sid, [])
        return float(len(records)), bool(records)
    if metric == DATASET_STUDY_PLANS:
        summary = _study_plan_summary(bundle, student)
        return (summary["average_completion"] if summary["average_completion"] is not None else None), summary["total"] > 0
    if metric == "risk":
        score = _risk_score(bundle, sid)
        return score, score is not None
    if metric == "performance":
        values = [v for v in (_attendance_percentage(bundle, sid), _tests_average(bundle, sid), _academic_average(bundle, sid)) if v is not None]
        if not values:
            return None, False
        return round(sum(values) / len(values), 1), True
    return None, False


def _metric_label(metric: str) -> str:
    return {
        DATASET_ATTENDANCE: "Attendance",
        DATASET_FEES: "Fees Due",
        DATASET_TESTS: "Test Average",
        DATASET_ACADEMIC: "Course Progress",
        DATASET_ASSIGNMENTS: "Pending Assignments",
        DATASET_DISCIPLINE: "Discipline Incidents",
        DATASET_STUDY_PLANS: "Study Plan Completion",
        "risk": "Risk Score",
        "performance": "Overall Performance",
    }.get(metric, metric)


def _metric_format(metric: str, value: float | None) -> str:
    if value is None:
        return "no data"
    if metric in (DATASET_FEES,):
        return f"Rs {value:,.0f}"
    return f"{round(value, 1)}%"


def _evaluated(bundle: DataBundle, metric: str) -> list[tuple[dict[str, Any], float]]:
    out: list[tuple[dict[str, Any], float]] = []
    for student in bundle.students:
        value, has_data = _metric_value(bundle, student, metric)
        if has_data and value is not None:
            out.append((student, value))
    return out


def _order_detail_students(bundle: DataBundle, metric: str, students: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Order detail profiles by the plan metric (best first). Students with no
    data for the metric keep their original relative order at the end."""
    by_id = {_norm(s.get("id")): s for s in students if _norm(s.get("id"))}
    scored: list[tuple[float | None, dict[str, Any]]] = []
    for sid, student in by_id.items():
        value, has_data = _metric_value(bundle, student, metric)
        scored.append((value if has_data else None, student))
    with_data = [pair for pair in scored if pair[0] is not None]
    without_data = [pair for pair in scored if pair[0] is None]
    with_data.sort(key=lambda pair: float(pair[0]), reverse=True)
    return [student for _, student in with_data + without_data]


def _metric_rollup(bundle: DataBundle, metric: str) -> str:
    entries = _evaluated(bundle, metric)
    label = _metric_label(metric)
    if not entries:
        return f"{label}: no data available for any student in scope"
    values = [value for _, value in entries]
    total_students = len(bundle.students)

    if metric == DATASET_FEES:
        due_total = sum(values)
        defaulters = sum(1 for v in values if v > 0)
        paid_up = sum(1 for v in values if v == 0)
        return (
            f"{label} (over {total_students} students):\n"
            f"  students with fee records: {len(values)}\n"
            f"  total due amount: Rs {due_total:,.0f}\n"
            f"  defaulters (due > 0): {defaulters}\n"
            f"  paid-up (due = 0): {paid_up}"
        )

    avg = round(sum(values) / len(values), 1)
    if metric == DATASET_ASSIGNMENTS:
        pending_total = sum(values)
        return (
            f"{label} (over {total_students} students):\n"
            f"  students evaluated: {len(values)}\n"
            f"  total pending assignments: {pending_total}\n"
            f"  students with pending assignments: {sum(1 for v in values if v > 0)}"
        )
    if metric in (DATASET_DISCIPLINE,):
        total_incidents = sum(values)
        return (
            f"{label} (over {total_students} students):\n"
            f"  students evaluated: {len(values)}\n"
            f"  total incidents: {total_incidents}\n"
            f"  students with incidents: {sum(1 for v in values if v > 0)}"
        )

    buckets = {"80-100%": 0, "60-79%": 0, "40-59%": 0, "below 40%": 0}
    for value in values:
        if value >= 80:
            buckets["80-100%"] += 1
        elif value >= 60:
            buckets["60-79%"] += 1
        elif value >= 40:
            buckets["40-59%"] += 1
        else:
            buckets["below 40%"] += 1
    threshold_label = "below 75%" if metric == DATASET_ATTENDANCE else "below 50%"
    threshold = 75 if metric == DATASET_ATTENDANCE else 50
    below = sum(1 for v in values if v < threshold)
    return (
        f"{label} (over {total_students} students):\n"
        f"  students evaluated: {len(values)}\n"
        f"  average: {avg}%\n"
        f"  distribution: " + ", ".join(f"{k}: {v}" for k, v in buckets.items()) + "\n"
        f"  students {threshold_label}: {below}"
    )


def _batch_avg_table(bundle: DataBundle, metric: str) -> str:
    entries = _evaluated(bundle, metric)
    if not entries:
        return f"Batch averages for {_metric_label(metric)}: no data"
    by_batch: dict[str, list[float]] = defaultdict(list)
    for student, value in entries:
        by_batch[_norm(student.get("batch_id"))].append(value)
    lines: list[str] = []
    for batch_id, values in sorted(by_batch.items(), key=lambda kv: -sum(kv[1]) / len(kv[1])):
        batch = bundle.batches.get(batch_id, {})
        batch_name = batch.get("name") or batch.get("class_name") or batch_id or "Unassigned"
        avg = round(sum(values) / len(values), 1)
        lines.append(f"  {batch_name}: avg {_metric_format(metric, avg)} over {len(values)} students")
    return f"Batch averages for {_metric_label(metric)}:\n" + "\n".join(lines)


def _ranking(bundle: DataBundle, metric: str, top: int = 10, bottom: int = 10) -> str:
    entries = _evaluated(bundle, metric)
    if not entries:
        return f"Ranking for {_metric_label(metric)}: no data"
    label = _metric_label(metric)
    if metric == DATASET_FEES:
        entries_sorted = sorted(entries, key=lambda pair: pair[1], reverse=True)
    else:
        entries_sorted = sorted(entries, key=lambda pair: pair[1], reverse=True)

    def _line(student: dict[str, Any], value: float) -> str:
        class_label = " ".join(
            x for x in (student.get("class_name"), student.get("section")) if _norm(x)
        )
        return f"  {_norm(student.get('full_name')) or 'Student'} ({class_label}): {_metric_format(metric, value)}"

    if metric in (DATASET_FEES, DATASET_ASSIGNMENTS, DATASET_DISCIPLINE):
        at_risk = entries_sorted[: max(top, bottom)]
        return (
            f"Top students by {label}:\n"
            + "\n".join(_line(s, v) for s, v in at_risk)
        )

    best = entries_sorted[:top]
    worst = entries_sorted[-bottom:] if len(entries_sorted) > top else []
    worst = sorted(worst, key=lambda pair: pair[1])
    lines = [f"Top {len(best)} students by {label} (best):"]
    lines += [_line(s, v) for s, v in best]
    if worst:
        lines.append(f"Bottom {len(worst)} students by {label} (at risk):")
        lines += [_line(s, v) for s, v in worst]
    return "\n".join(lines)


def _count_block(bundle: DataBundle, metric: str) -> str:
    entries = _evaluated(bundle, metric)
    total_students = len(bundle.students)
    values = [value for _, value in entries]
    if metric == DATASET_FEES:
        return (
            f"EXACT COUNTS for fee defaulters:\n"
            f"  total students in scope: {total_students}\n"
            f"  students with fee records: {len(values)}\n"
            f"  defaulters (due amount > 0): {sum(1 for v in values if v > 0)}\n"
            f"  total due amount: Rs {sum(values):,.0f}"
        )
    if metric == DATASET_ATTENDANCE:
        below_75 = sum(1 for v in values if v < 75)
        below_60 = sum(1 for v in values if v < 60)
        return (
            f"EXACT COUNTS for attendance:\n"
            f"  total students in scope: {total_students}\n"
            f"  students with attendance records: {len(values)}\n"
            f"  students below 75% attendance: {below_75}\n"
            f"  students below 60% attendance: {below_60}"
        )
    if metric == DATASET_TESTS:
        below_50 = sum(1 for v in values if v < 50)
        return (
            f"EXACT COUNTS for test performance:\n"
            f"  total students in scope: {total_students}\n"
            f"  students with test results: {len(values)}\n"
            f"  students averaging below 50%: {below_50}"
        )
    if metric == DATASET_ASSIGNMENTS:
        return (
            f"EXACT COUNTS for assignments:\n"
            f"  total students in scope: {total_students}\n"
            f"  students with at least one pending assignment: {sum(1 for v in values if v > 0)}\n"
            f"  total pending assignments: {sum(values)}"
        )
    if metric == DATASET_ACADEMIC:
        below_60 = sum(1 for v in values if v < 60)
        return (
            f"EXACT COUNTS for course progress:\n"
            f"  total students in scope: {total_students}\n"
            f"  students with progress records: {len(values)}\n"
            f"  students below 60% course progress: {below_60}"
        )
    return f"EXACT COUNTS for {_metric_label(metric)}:\n  students evaluated: {len(values)} of {total_students}"


def _school_trend(bundle: DataBundle, window_days: int) -> str:
    all_rows = [row for rows in bundle.attendance.values() for row in rows]
    window = max(window_days or 30, 1)
    start = pps._today() - timedelta(days=window - 1)
    rows = [r for r in all_rows if (pps._parse_iso_date(r.get("attendance_date")) or pps._today()) >= start]
    buckets: dict[int, list[int]] = defaultdict(lambda: [0, 0])
    for row in rows:
        date = pps._parse_iso_date(row.get("attendance_date")) or pps._today()
        week_index = (date - start).days // 7
        buckets[week_index][0] += 1
        if _lower(row.get("status")) == "present":
            buckets[week_index][1] += 1
    if not rows:
        return f"School-wide attendance trend for last {window} days: no attendance data in this window"
    lines = []
    for week_index in sorted(buckets):
        total, present = buckets[week_index]
        week_start = start + timedelta(days=week_index * 7)
        lines.append(f"  week of {week_start.strftime('%d %b %Y')}: {round(_pct_of(present, total))}% ({present} present / {total} total)")
    overall = round(_pct_of(sum(p[1] for p in buckets.values()), sum(p[0] for p in buckets.values())))
    return f"School-wide attendance trend (last {window} days, all students):\n" + "\n".join(lines) + f"\n  overall: {overall}%"


# ─── Stage 4: context assembly ─────────────────────────────────────────


def _student_detail_block(plan: AiPlan, bundle: DataBundle, student: dict[str, Any]) -> str:
    sid = _norm(student.get("id"))
    sname = _norm(student.get("full_name")) or "Student"
    class_name = _norm(student.get("class_name"))
    section = _norm(student.get("section"))
    datasets = plan.datasets

    dash = pps._build_child_dashboard_from_batch(
        bundle.school_id,
        student,
        attendance_rows=bundle.attendance.get(sid, []),
        fee_data=bundle.fees.get(sid),
        all_assignments=_assignments_for_student(bundle, student),
        test_results_list=_simplified_results(bundle, sid),
        progress_items=bundle.progress.get(sid, []),
        shared_tests=bundle.shared_tests,
    )
    assignment_summary = _assignment_summary(bundle, student)
    test_summary = _test_summary(bundle, student)

    lines = [f"--- {sname} (ID: {sid}) ---"]
    lines.append(f"Class: {class_name} {section}".strip())

    if DATASET_ATTENDANCE in datasets:
        att = pps._build_attendance_from_batch(student, bundle.attendance.get(sid, []))
        overall = att.get("overall", {})
        lines.append(
            f"Attendance: {overall.get('attendance_percentage', dash.get('attendance_percentage'))}% "
            f"({overall.get('present_days', dash.get('present_days'))} present, "
            f"{overall.get('absent_days', dash.get('absent_days'))} absent)"
        )
        lines.append(f"Attendance Trend: {att.get('trend', {}).get('trend', 'insufficient_data')}")

    if DATASET_FEES in datasets:
        fee = dash.get("fee_status") or {}
        lines.append(f"Fee Status: {fee.get('status')} (Due: Rs {pps._safe_float(fee.get('due_amount') or 0):,.0f})")

    if DATASET_ASSIGNMENTS in datasets:
        lines.append(f"Pending Assignments: {assignment_summary['pending']}")
        lines.append(
            f"Assignment Summary: pending={assignment_summary['pending']}, "
            f"submitted={assignment_summary['submitted']}, "
            f"graded={assignment_summary['graded']}, "
            f"late={assignment_summary['late']}"
        )

    if DATASET_TESTS in datasets:
        latest = test_summary.get("latest")
        if latest:
            lines.append(f"Latest Test: {latest.get('title') or 'N/A'} - {latest.get('percentage', 0)}%")
        lines.append(f"Test Average: {test_summary.get('average_percentage')}% over {test_summary.get('total_tests')} tests")
        lines.append(f"Upcoming Tests: {len(dash.get('upcoming_tests', []))}")

    if DATASET_ACADEMIC in datasets:
        lines.append(f"Learning Score: {dash.get('learning_score')}%")
        analytics = bundle.analytics.get(sid) if getattr(bundle, "analytics", None) else None
        if analytics:
            weak = list(analytics.get("weak_topics") or [])[:3]
            strong = list(analytics.get("strong_topics") or [])[:3]
            lines.append(f"Weak Topics: {weak}")
            lines.append(f"Strong Topics: {strong}")

    if DATASET_STUDY_PLANS in datasets:
        plan_summary = _study_plan_summary(bundle, student)
        if plan_summary["total"]:
            lines.append(
                f"Study Plans: {plan_summary['total']} plans, {plan_summary['completed']} completed "
                f"({plan_summary['average_completion']}% avg completion)"
            )

    if DATASET_DISCIPLINE in datasets:
        records = bundle.discipline.get(sid, [])
        if records:
            kinds = [_norm(r.get("type") or r.get("reason") or r.get("severity")) for r in records[:3]]
            lines.append(f"Discipline: {len(records)} incident(s){' - ' + ', '.join(x for x in kinds if x) if kinds else ''}")

    return "\n".join(lines)


def _build_wide_context(plan: AiPlan, bundle: DataBundle, detail_students: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    total = len(bundle.students)
    parts.append(f"SCOPE: All {total} active students at this school. Counts below are exact and include every student in scope (none omitted).")

    if plan.batch_ids:
        names = [bundle.batches.get(bid, {}).get("name") or bundle.batches.get(bid, {}).get("class_name") or bid for bid in plan.batch_ids]
        parts.append(f"BATCH FOCUS: {' , '.join(str(n) for n in names)} — figures below are limited to these batches.")
    if plan.subject_names:
        parts.append(f"SUBJECT FOCUS: {', '.join(plan.subject_names)} — test/performance figures are limited to these subjects.")
    if plan.teacher_names:
        parts.append(f"TEACHER FOCUS: {', '.join(plan.teacher_names)} — query resolved against this teacher.")

    metric = plan.metric or DATASET_ATTENDANCE
    if plan.aggregation == "count":
        parts.append(_count_block(bundle, metric))
    elif plan.aggregation == "trend":
        parts.append(_metric_rollup(bundle, metric))
        parts.append(_school_trend(bundle, plan.window_days or 30))
        parts.append(_ranking(bundle, metric, 5, 5))
    elif plan.aggregation == "rank":
        parts.append(_metric_rollup(bundle, metric))
        parts.append(_batch_avg_table(bundle, metric))
        parts.append(_ranking(bundle, metric, 10, 10))
    else:  # summary
        for metric_key in (
            DATASET_ATTENDANCE,
            DATASET_TESTS,
            DATASET_FEES,
            DATASET_ASSIGNMENTS,
            DATASET_ACADEMIC,
            DATASET_DISCIPLINE,
            DATASET_STUDY_PLANS,
        ):
            if metric_key in plan.datasets:
                parts.append(_metric_rollup(bundle, metric_key))
        parts.append(_batch_avg_table(bundle, metric))
        parts.append(_ranking(bundle, metric, 5, 5))

    if detail_students:
        detail_students = _order_detail_students(bundle, plan.metric or DATASET_ATTENDANCE, detail_students)
        blocks = [_student_detail_block(plan, bundle, student) for student in detail_students]
        parts.append("DETAILED STUDENT PROFILES (most relevant students):\n" + "\n\n".join(blocks))
    return "\n\n".join(parts)


def _build_detail_context(plan: AiPlan, bundle: DataBundle, targets: list[dict[str, Any]]) -> str:
    blocks = [_student_detail_block(plan, bundle, student) for student in targets]
    return "\n\n".join(blocks)


def _build_messages(context_text: str, history: list[dict[str, str]] | None, question: str) -> list[dict[str, str]]:
    system_prompt = (
        "You are the Aspire Academy Parent Portal AI Assistant. "
        "Answer only from the grounded data provided below. "
        "Use attendance, assignments, test scores, course progress, fees, "
        "study plans and topic analysis whenever relevant. "
        "Do not invent facts, percentages, student names, or counts. "
        "If a requested detail is not present in the data, say so clearly. "
        "Use simple, supportive language and keep the answer concise in 3-6 sentences.\n\n"
        f"DATA CONTEXT:\n{context_text}"
    )
    messages: list[dict[str, str]] = [{"role": "assistant", "content": system_prompt}]
    if history:
        messages.extend(history[-10:])
    messages.append({"role": "user", "content": question})
    return messages


def _attach_analytics(bundle: DataBundle, detail_ids: list[str]) -> None:
    if not detail_ids:
        return
    try:
        bundle.analytics = _analytics_chunked(bundle.school_id, detail_ids)
    except Exception as exc:
        logger.warning("analytics batch failed for school %s: %s", bundle.school_id, exc)
        bundle.analytics = {}


def _analytics_chunked(school_id: str, ids: list[str]) -> dict[str, dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for chunk in _chunks(sorted({_norm(s) for s in ids if _norm(s)})):
        merged.update(get_student_analytics_batch(school_id, chunk) or {})
    return merged


# ─── Stage 5: orchestrator ─────────────────────────────────────────────


def run_ai_ask(
    school_id: str,
    *,
    question: str,
    history: list[dict[str, str]] | None = None,
    scope_context: Any = None,
    actor: dict[str, Any] | None = None,
    user: Any = None,
    student_id: str | None = None,
) -> dict[str, Any]:
    actor = actor or {}
    started = time.perf_counter()

    meta = get_metadata(school_id)
    students = resolve_scope_students(school_id, scope_context=scope_context, actor=actor, user=user)
    if not students:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No linked students found for this request")

    scope_is_wide = bool(scope_context is not None and getattr(scope_context, "is_school_wide", False))
    plan = analyze_question(question, students, meta, scope_is_wide=scope_is_wide)
    targets, mode = resolve_targets(plan, students, student_id=student_id, scope_is_wide=scope_is_wide)
    logger.info(
        "school=%s mode=%s aggregation=%s intents=%s datasets=%s targets=%d window=%s elapsed_scope=%.2fs",
        school_id, mode, plan.aggregation, plan.intents, sorted(plan.datasets),
        len(targets), plan.window_days, time.perf_counter() - started,
    )

    window_days = plan.window_days
    if mode == "wide" and plan.aggregation == "summary" and not window_days:
        window_days = 30
    bundle = _load_bundle(
        school_id,
        datasets=plan.datasets,
        students=students,
        meta=meta,
        window_days=window_days,
        wide=(mode == "wide"),
        load_students=None if mode == "wide" else targets,
    )
    bundle.subject_names = plan.subject_names

    detail_students: list[dict[str, Any]] = []
    if mode == "wide":
        by_id = {_norm(s.get("id")): s for s in students if _norm(s.get("id"))}
        ranked = _evaluated(bundle, plan.metric or DATASET_ATTENDANCE)
        if ranked:
            detail_students = [s for s, _ in ranked[: plan.detail_top_n]]
        if not detail_students:
            detail_students = targets[: plan.detail_top_n]
    else:
        detail_students = targets

    logger.info(
        "school=%s mode=%s detail=%d phase=bundle_elapsed=%.2fs",
        school_id, mode, len(detail_students), time.perf_counter() - started,
    )

    if DATASET_ACADEMIC in plan.datasets and len(detail_students) <= 60 and plan.aggregation != "summary":
        _attach_analytics(bundle, [_norm(s.get("id")) for s in detail_students])
    logger.info(
        "school=%s mode=%s phase=analytics_elapsed=%.2fs analytics=%d",
        school_id, mode, time.perf_counter() - started, len(getattr(bundle, "analytics", {}) or {}),
    )

    context_text = (
        _build_wide_context(plan, bundle, detail_students)
        if mode == "wide"
        else _build_detail_context(plan, bundle, targets)
    )
    logger.info(
        "school=%s mode=%s phase=context_elapsed=%.2fs context_chars=%d",
        school_id, mode, time.perf_counter() - started, len(context_text),
    )

    try:
        answer = chat(_build_messages(context_text, history, question))
    except AIQuotaError:
        answer = (
            "The AI assistant's daily request limit has been reached for today, "
            "so I can't answer right now. Please try again after a while — the limit resets around midnight."
        )
    except AIProviderError:
        answer = "I'm sorry, I'm having trouble connecting right now. Please try again in a moment."
    except Exception as exc:
        logger.warning("AI chat failed for school %s: %s", school_id, exc)
        answer = "I'm sorry, I ran into an unexpected problem. Please try again in a moment."

    logger.info("school=%s mode=%s phase=chat_elapsed=%.2fs total_elapsed=%.2fs", school_id, mode, time.perf_counter() - started, time.perf_counter() - started)
    return {
        "answer": answer,
        "context_students": [
            {"student_id": _norm(student.get("id")), "student_name": _norm(student.get("full_name"))}
            for student in students
        ],
    }


# ─── Batched recommendations (replaces per-student _build_recommendations) ──


def build_recommendations_batch(school_id: str, students: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not students:
        return []
    ids = sorted({_norm(s.get("id")) for s in students if _norm(s.get("id"))})
    meta = get_metadata(school_id)
    bundle = _load_bundle(
        school_id,
        datasets=set(ALL_DATASETS),
        students=students,
        meta=meta,
        wide=False,
    )
    if ids:
        try:
            bundle.analytics = _analytics_chunked(school_id, ids)
        except Exception as exc:
            logger.warning("analytics batch failed for recommendations, school %s: %s", school_id, exc)
            bundle.analytics = {}

    results: list[dict[str, Any]] = []
    for student in students:
        sid = _norm(student.get("id"))
        sname = _norm(student.get("full_name")) or "Student"
        try:
            dash = pps._build_child_dashboard_from_batch(
                school_id,
                student,
                attendance_rows=bundle.attendance.get(sid, []),
                fee_data=bundle.fees.get(sid),
                all_assignments=_assignments_for_student(bundle, student),
                test_results_list=_simplified_results(bundle, sid),
                progress_items=bundle.progress.get(sid, []),
                shared_tests=bundle.shared_tests,
            )
            test = _test_summary(bundle, student)
            academic = pps._build_academic_progress_from_batch(
                school_id,
                student,
                _assignments_for_student(bundle, student),
                bundle.progress.get(sid, []),
                bundle.test_results.get(sid, []),
                analytics=bundle.analytics.get(sid),
            )

            recs: list[str] = []
            if dash.get("attendance_percentage", 100) < 75:
                recs.append("Encourage regular attendance — missing school affects learning continuity.")
            if dash.get("learning_score", 100) < 60:
                recs.append("Review course progress and help your child catch up on lessons.")
            if dash.get("pending_assignments", 0) > 2:
                recs.append(f"Your child has {dash.get('pending_assignments')} pending assignments. A study schedule may help.")
            if (test.get("average_percentage") or 100) < 50:
                recs.append("Consider extra practice in weak subjects to improve test scores.")
            if (dash.get("fee_status") or {}).get("due_amount", 0) > 0:
                recs.append(f"Fee payment of ₹{pps._safe_float((dash.get('fee_status') or {}).get('due_amount', 0)):.0f} is due.")
            if dash.get("absent_days", 0) > 10:
                recs.append("Frequent absences may impact learning. A consistent routine helps.")
            weak = list(academic.get("weak_topics") or [])
            if weak:
                recs.append(f"Focus areas: {', '.join(weak[:3])}.")
            if not recs:
                recs.append("Your child is doing well! Keep supporting their learning journey.")
            results.append({"student_id": sid, "student_name": sname, "recommendations": recs})
        except Exception as exc:
            logger.warning("recommendations build failed for %s (%s): %s", sname, sid, exc)
            results.append(
                {
                    "student_id": sid,
                    "student_name": sname,
                    "recommendations": ["Recommendation data is unavailable right now. Please try again."],
                }
            )
    return results
