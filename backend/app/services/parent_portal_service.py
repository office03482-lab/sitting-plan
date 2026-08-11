"""Parent Portal Service - simplified data aggregation for parent-facing views."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from fastapi import HTTPException

from app.services.supabase_admin import get_supabase_admin_client
from app.services.supabase_lms import _list_parent_linked_students, get_progress_dashboard, list_assignments
from app.services.supabase_online_tests import list_results, list_tests

ATTENDANCE_SCHEMA = "attendance"
ACADEMIC_SCHEMA = "academic"
LMS_SCHEMA = "lms"
SCHEDULING_SCHEMA = "scheduling"

MODULE_KEY = "parent_portal"


def _client():
    return get_supabase_admin_client()


def _public_table(name: str):
    return _client().table(name)


def _schema_table(schema: str, name: str):
    return _client().schema(schema).table(name)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _today() -> date:
    return _now().date()


def _normalize(value: Any) -> str:
    return str(value or "").strip()


def _safe_float(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _safe_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _safe_percentage(numerator: float, denominator: float) -> float:
    if denominator <= 0:
        return 0.0
    return round((numerator / denominator) * 100, 2)


def _parse_iso_date(value: Any) -> date | None:
    text = _normalize(value)
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except (ValueError, TypeError):
        return None


def _resolve_parent_students(school_id: str, profile_id: str | None, user_email: str | None) -> list[dict[str, Any]]:
    linked = _list_parent_linked_students(school_id, profile_id, user_email)
    if not linked:
        raise HTTPException(status_code=404, detail="No linked students found for this parent")
    return linked


def _get_student(school_id: str, student_id: str) -> dict[str, Any]:
    rows = list(
        _public_table("students")
        .select("id,school_id,full_name,class_name,section,batch_id,roll_number,guardian_name,guardian_phone")
        .eq("school_id", school_id)
        .eq("id", student_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
        .data or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Student not found")
    return dict(rows[0])


# ─── Batched Loaders ──────────────────────────────────────────────────

def _batch_load_attendance(school_id: str, student_ids: list[str], *, days: int = 365) -> dict[str, list[dict[str, Any]]]:
    if not student_ids:
        return {}
    start = (_today() - timedelta(days=max(days, 1) - 1)).isoformat()
    rows = list(
        _schema_table(ATTENDANCE_SCHEMA, "student_attendance")
        .select("student_id,attendance_date,status")
        .eq("school_id", school_id)
        .in_("student_id", student_ids)
        .gte("attendance_date", start)
        .execute()
        .data or []
    )
    result: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        sid = _normalize(r.get("student_id"))
        if sid:
            result[sid].append(dict(r))
    return dict(result)


def _batch_load_fees(school_id: str, student_ids: list[str]) -> dict[str, dict[str, Any]]:
    if not student_ids:
        return {}
    try:
        rows = list(
            _public_table("student_fees")
            .select("student_id,id,total_fee,paid_amount,due_amount,due_date,status")
            .eq("school_id", school_id)
            .in_("student_id", student_ids)
            .execute()
            .data or []
        )
        result: dict[str, dict[str, Any]] = {}
        for r in rows:
            sid = _normalize(r.get("student_id"))
            if sid and sid not in result:
                total = _safe_float(r.get("total_fee") or 0)
                paid = _safe_float(r.get("paid_amount") or 0)
                result[sid] = {
                    "total_fee": total,
                    "paid_amount": paid,
                    "due_amount": _safe_float(r.get("due_amount") or 0),
                    "status": _normalize(r.get("status")) or "unknown",
                    "due_date": _normalize(r.get("due_date")),
                    "payment_percentage": _safe_percentage(paid, max(total, 1)),
                }
        return result
    except Exception:
        return {}


def _batch_load_test_results(school_id: str, student_ids: list[str], limit: int = 50) -> dict[str, list[dict[str, Any]]]:
    if not student_ids:
        return {}
    try:
        rows = list(
            _client().schema("online_tests").table("test_results")
            .select("*")
            .eq("school_id", school_id)
            .in_("student_id", student_ids)
            .is_("deleted_at", "null")
            .order("created_at", desc=True)
            .limit(max(len(student_ids) * limit, 200))
            .execute()
            .data or []
        )
    except Exception:
        try:
            rows = list(
                _public_table("online_test_results")
                .select("*")
                .eq("school_id", school_id)
                .in_("student_id", student_ids)
                .is_("deleted_at", "null")
                .order("created_at", desc=True)
                .limit(max(len(student_ids) * limit, 200))
                .execute()
                .data or []
            )
        except Exception:
            return {}
    result: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        sid = _normalize(r.get("student_id"))
        if sid:
            result[sid].append(dict(r))
    return dict(result)


def _batch_load_progress(school_id: str, student_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    if not student_ids:
        return {}
    rows = list(
        _public_table("lms_student_progress")
        .select("*")
        .eq("school_id", school_id)
        .in_("student_id", student_ids)
        .is_("deleted_at", "null")
        .order("updated_at", desc=True)
        .execute()
        .data or []
    )
    result: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        sid = _normalize(r.get("student_id"))
        if sid:
            result[sid].append(dict(r))
    return dict(result)


def _batch_load_submissions(school_id: str, student_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    if not student_ids:
        return {}
    rows = list(
        _public_table("lms_assignment_submissions")
        .select("*")
        .eq("school_id", school_id)
        .in_("student_id", student_ids)
        .execute()
        .data or []
    )
    result: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        sid = _normalize(r.get("student_id"))
        if sid:
            result[sid].append(dict(r))
    return dict(result)


def _batch_load_assignments(school_id: str) -> list[dict[str, Any]]:
    try:
        rows = list(
            _public_table("lms_assignments")
            .select("*")
            .eq("school_id", school_id)
            .in_("status", ["published", "closed"])
            .is_("deleted_at", "null")
            .execute()
            .data or []
        )
        return [dict(r) for r in rows]
    except Exception:
        return []


def _load_shared_courses(school_id: str) -> list[dict[str, Any]]:
    try:
        rows = list(
            _public_table("lms_courses")
            .select("*")
            .eq("school_id", school_id)
            .eq("is_active", True)
            .execute()
            .data or []
        )
        return [dict(r) for r in rows]
    except Exception:
        return []


def _load_shared_tests(school_id: str) -> list[dict[str, Any]]:
    try:
        rows = list(
            _client().schema("online_tests").table("tests")
            .select("*")
            .eq("school_id", school_id)
            .in_("status", ["published", "in_progress", "completed", "closed"])
            .is_("deleted_at", "null")
            .execute()
            .data or []
        )
        return [dict(r) for r in rows]
    except Exception:
        try:
            rows = list(
                _public_table("test_sessions")
                .select("*")
                .eq("school_id", school_id)
                .in_("status", ["published", "in_progress", "completed", "closed"])
                .is_("deleted_at", "null")
                .execute()
                .data or []
            )
            return [dict(r) for r in rows]
        except Exception:
            return []


# ─── Dashboard (Phase 1) ───────────────────────────────────────────────

def get_dashboard(school_id: str, *, profile_id: str | None, user_email: str | None) -> dict[str, Any]:
    try:
        linked = _resolve_parent_students(school_id, profile_id, user_email)
    except HTTPException as exc:
        if exc.status_code == 404 and str(exc.detail or "").strip().lower() == "no linked students found for this parent":
            return {
                "role": "parent",
                "children_count": 0,
                "academic_health_score": 0,
                "risk_level": "low",
                "children": [],
                "generated_at": _now().isoformat(),
            }
        raise

    student_ids = [_normalize(s.get("id")) for s in linked if _normalize(s.get("id"))]

    attendance_by_student = _batch_load_attendance(school_id, student_ids, days=180)
    fee_by_student = _batch_load_fees(school_id, student_ids)
    assignments = _batch_load_assignments(school_id)
    test_results = _batch_load_test_results(school_id, student_ids, limit=5)
    progress_by_student = _batch_load_progress(school_id, student_ids)
    shared_tests = _load_shared_tests(school_id)

    children = []
    for student in linked:
        sid = _normalize(student.get("id"))
        children.append(_build_child_dashboard_from_batch(
            school_id, student,
            attendance_rows=attendance_by_student.get(sid, []),
            fee_data=fee_by_student.get(sid),
            all_assignments=assignments,
            test_results_list=test_results.get(sid, []),
            progress_items=progress_by_student.get(sid, []),
            shared_tests=shared_tests,
        ))

    return {
        "role": "parent",
        "academic_health_score": 0,
        "risk_level": "low",
        "children": children,
        "children_count": len(children),
        "generated_at": _now().isoformat(),
    }


def _build_child_dashboard_from_batch(
    school_id: str,
    student: dict[str, Any],
    *,
    attendance_rows: list[dict[str, Any]],
    fee_data: dict[str, Any] | None,
    all_assignments: list[dict[str, Any]],
    test_results_list: list[dict[str, Any]],
    progress_items: list[dict[str, Any]],
    shared_tests: list[dict[str, Any]],
) -> dict[str, Any]:
    sid = _normalize(student.get("id"))
    sname = _normalize(student.get("full_name")) or "Student"
    class_name = _normalize(student.get("class_name")) or ""
    section = _normalize(student.get("section")) or ""

    total = len(attendance_rows)
    present = len([r for r in attendance_rows if _normalize(r.get("status")).lower() == "present"])
    absent = total - present
    att_pct = _safe_percentage(present, max(total, 1))

    fee_status = fee_data or {"total_fee": 0, "paid_amount": 0, "due_amount": 0, "status": "unavailable", "due_date": None, "payment_percentage": 0}

    student_assignments = all_assignments
    pending_assignments = len([
        a for a in student_assignments
        if not a.get("submission") and _normalize(a.get("status")).lower() != "closed"
    ])
    submitted_count = len([a for a in student_assignments if a.get("submission")])

    batch_id = _normalize(student.get("batch_id")) or None
    upcoming = _get_upcoming_tests_from_shared(shared_tests, batch_id)

    latest_result = test_results_list[0] if test_results_list else None
    latest_test = {
        "title": _normalize(latest_result.get("test_title") or latest_result.get("title") or ""),
        "score": _safe_float(latest_result.get("score") or latest_result.get("marks") or 0),
        "total": _safe_float(latest_result.get("total_marks") or latest_result.get("total") or 0),
        "percentage": _safe_float(latest_result.get("percentage") or 0),
        "rank": _safe_int(latest_result.get("rank") or 0),
    } if latest_result else None

    course_watch_pcts = [_safe_float(p.get("watch_percentage") or 0) for p in progress_items]
    course_progress = round(
        sum(course_watch_pcts) / max(len(course_watch_pcts), 1), 1
    ) if course_watch_pcts else 0.0

    return {
        "student_id": sid,
        "student_name": sname,
        "class_name": class_name,
        "section": section,
        "attendance_percentage": att_pct,
        "present_days": present,
        "absent_days": absent,
        "total_days": total,
        "learning_score": course_progress,
        "pending_assignments": pending_assignments + len([a for a in student_assignments if a.get("submission") and not a.get("grade")]),
        "submitted_assignments": submitted_count,
        "upcoming_tests": [_simplify_test(t) for t in upcoming[:5]],
        "latest_test_result": latest_test,
        "fee_status": fee_status,
    }


# ─── Fee Status ────────────────────────────────────────────────────────

_FEE_TABLE_CANDIDATES = [
    ("public", "student_fees"),
]


def _get_fee_status(school_id: str, student_id: str) -> dict[str, Any]:
    for schema, table in _FEE_TABLE_CANDIDATES:
        try:
            if schema == "public":
                query = _public_table(table)
            else:
                query = _client().schema(schema).table(table)
            rows = list(
                query
                .select("id,total_fee,paid_amount,due_amount,due_date,status")
                .eq("school_id", school_id)
                .eq("student_id", student_id)
                .order("due_date", desc=True)
                .limit(1)
                .execute()
                .data or []
            )
            if rows:
                r = dict(rows[0])
                total = _safe_float(r.get("total_fee") or r.get("total_amount") or 0)
                paid = _safe_float(r.get("paid_amount") or 0)
                due = _safe_float(r.get("due_amount") or 0)
                return {
                    "total_fee": total,
                    "paid_amount": paid,
                    "due_amount": due,
                    "status": _normalize(r.get("status")) or "unknown",
                    "due_date": _normalize(r.get("due_date")),
                    "payment_percentage": _safe_percentage(paid, max(total, 1)),
                }
        except Exception:
            continue
    return {"total_fee": 0, "paid_amount": 0, "due_amount": 0, "status": "unavailable", "due_date": None, "payment_percentage": 0}


# ─── Upcoming Tests ────────────────────────────────────────────────────

def _get_upcoming_tests(school_id: str, batch_id: str | None) -> list[dict[str, Any]]:
    if not batch_id:
        return []
    try:
        tests = list_tests(school_id, student_batch_id=batch_id, limit=20)
        now = _now()
        upcoming = []
        for t in tests:
            starts = _parse_iso_date(t.get("starts_at"))
            if starts and starts >= _today():
                upcoming.append(t)
        upcoming.sort(key=lambda t: _parse_iso_date(t.get("starts_at")) or _today())
        return upcoming[:10]
    except Exception:
        return []


def _get_upcoming_tests_from_shared(shared_tests: list[dict[str, Any]], batch_id: str | None) -> list[dict[str, Any]]:
    if not batch_id or not shared_tests:
        return []
    try:
        upcoming = []
        for t in shared_tests:
            t_batch_id = _normalize(t.get("batch_id"))
            if t_batch_id and t_batch_id != batch_id:
                continue
            starts = _parse_iso_date(t.get("starts_at"))
            if starts and starts >= _today():
                upcoming.append(t)
        upcoming.sort(key=lambda t: _parse_iso_date(t.get("starts_at")) or _today())
        return upcoming[:10]
    except Exception:
        return []


def _simplify_test(t: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _normalize(t.get("id")),
        "title": _normalize(t.get("title")) or "Untitled Test",
        "subject": _normalize(t.get("subject") or t.get("subject_name") or ""),
        "starts_at": _normalize(t.get("starts_at")),
        "duration_minutes": _safe_int(t.get("duration_minutes") or t.get("duration") or 0),
        "total_marks": _safe_float(t.get("total_marks") or t.get("total") or 0),
    }


# ─── Academic Progress (Phase 2) ───────────────────────────────────────

def get_academic_progress(school_id: str, *, profile_id: str | None, user_email: str | None, student_id: str | None = None) -> dict[str, Any]:
    linked = _resolve_parent_students(school_id, profile_id, user_email)
    if student_id:
        linked = [s for s in linked if _normalize(s.get("id")) == student_id]
    if not linked:
        return {"children": []}

    student_ids = [_normalize(s.get("id")) for s in linked if _normalize(s.get("id"))]
    assignments = _batch_load_assignments(school_id)
    progress_by_student = _batch_load_progress(school_id, student_ids)
    test_results = _batch_load_test_results(school_id, student_ids, limit=50)
    analytics_by_student = _get_students_analytics_data(school_id, student_ids)

    children = [_build_academic_progress_from_batch(
        school_id,
        s,
        assignments,
        progress_by_student.get(_normalize(s.get("id")), []),
        test_results.get(_normalize(s.get("id")), []),
        analytics=analytics_by_student.get(_normalize(s.get("id"))),
    ) for s in linked]
    return {"children": children}


def _build_academic_progress_from_batch(
    school_id: str,
    student: dict[str, Any],
    all_assignments: list[dict[str, Any]],
    progress_items: list[dict[str, Any]],
    test_results_list: list[dict[str, Any]],
    analytics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    sid = _normalize(student.get("id"))
    sname = _normalize(student.get("full_name")) or "Student"

    courses = [
        {
            "course_name": _normalize(p.get("course_name") or p.get("title") or "Course"),
            "watch_percentage": _safe_float(p.get("watch_percentage") or 0),
            "completed_lessons": _safe_int(p.get("completed_lessons") or 0),
            "total_lessons": _safe_int(p.get("total_lessons") or 0),
        }
        for p in progress_items
    ]

    student_assignments = all_assignments
    total_assignments = len(student_assignments)
    completed = len([a for a in student_assignments if a.get("submission")])
    graded = len([a for a in student_assignments if a.get("grade") is not None])
    assignment_completion = _safe_percentage(completed, max(total_assignments, 1))

    revision_items = list(progress_items) or []
    revision_summary = {
        "total_revisions": len(revision_items),
        "completed_revisions": len([r for r in revision_items if r.get("is_completed") or _normalize(r.get("status")).lower() == "completed"]),
    }

    analytics = analytics or _get_student_analytics_data(school_id, sid)
    weak = list(analytics.get("weak_topics") or [])[:5]
    strong = list(analytics.get("strong_topics") or [])[:5]

    return {
        "student_id": sid,
        "student_name": sname,
        "course_progress": {
            "overall_percentage": round(
                sum(p["watch_percentage"] for p in courses) / max(len(courses), 1), 1
            ) if courses else 0.0,
            "courses": courses,
            "total_courses": len(courses),
        },
        "assignment_completion": {
            "total": total_assignments,
            "completed": completed,
            "graded": graded,
            "completion_percentage": assignment_completion,
        },
        "revision_tracker": revision_summary,
        "weak_topics": weak,
        "strong_topics": strong,
    }


def _get_student_analytics_data(school_id: str, student_id: str) -> dict[str, Any]:
    try:
        from app.services.supabase_analytics import get_student_analytics
        return get_student_analytics(school_id, student_id)
    except Exception:
        return {}


def _get_students_analytics_data(school_id: str, student_ids: list[str]) -> dict[str, dict[str, Any]]:
    try:
        from app.services.supabase_analytics import get_student_analytics_batch
        return get_student_analytics_batch(school_id, student_ids)
    except Exception:
        return {}


# ─── Attendance Center (Phase 3) ───────────────────────────────────────

def get_attendance_center(school_id: str, *, profile_id: str | None, user_email: str | None, student_id: str | None = None) -> dict[str, Any]:
    linked = _resolve_parent_students(school_id, profile_id, user_email)
    if student_id:
        linked = [s for s in linked if _normalize(s.get("id")) == student_id]
    if not linked:
        return {"children": []}

    student_ids = [_normalize(s.get("id")) for s in linked if _normalize(s.get("id"))]
    attendance_by_student = _batch_load_attendance(school_id, student_ids, days=365)

    children = [_build_attendance_from_batch(s, attendance_by_student.get(_normalize(s.get("id")), [])) for s in linked]
    return {"children": children}


def _build_attendance_from_batch(student: dict[str, Any], all_rows: list[dict[str, Any]]) -> dict[str, Any]:
    sid = _normalize(student.get("id"))
    sname = _normalize(student.get("full_name")) or "Student"

    month_start = _today().replace(day=1)
    month_rows = [r for r in all_rows if (_parse_iso_date(r.get("attendance_date")) or _today()) >= month_start]

    total = len(all_rows)
    present = len([r for r in all_rows if _normalize(r.get("status")).lower() == "present"])
    absent = total - present
    att_pct = _safe_percentage(present, max(total, 1))

    monthly = _build_monthly_breakdown(all_rows)

    return {
        "student_id": sid,
        "student_name": sname,
        "overall": {
            "total_days": total,
            "present_days": present,
            "absent_days": absent,
            "attendance_percentage": att_pct,
        },
        "current_month": {
            "total_days": len(month_rows),
            "present_days": len([r for r in month_rows if _normalize(r.get("status")).lower() == "present"]),
            "absent_days": len([r for r in month_rows if _normalize(r.get("status")).lower() != "present"]),
            "attendance_percentage": _safe_percentage(
                len([r for r in month_rows if _normalize(r.get("status")).lower() == "present"]),
                max(len(month_rows), 1),
            ),
        },
        "monthly_breakdown": monthly,
        "trend": _build_attendance_trend(all_rows),
    }


def _build_monthly_breakdown(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_month: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        d = _parse_iso_date(r.get("attendance_date"))
        if d:
            key = f"{d.year}-{d.month:02d}"
            by_month[key].append(r)
    result = []
    for month_key in sorted(by_month.keys()):
        month_rows = by_month[month_key]
        present = len([r for r in month_rows if _normalize(r.get("status")).lower() == "present"])
        total = len(month_rows)
        result.append({
            "month": month_key,
            "total_days": total,
            "present_days": present,
            "absent_days": total - present,
            "attendance_percentage": _safe_percentage(present, max(total, 1)),
        })
    return result[-12:]


def _build_attendance_trend(rows: list[dict[str, Any]]) -> dict[str, Any]:
    by_month = _build_monthly_breakdown(rows)
    percentages = [m["attendance_percentage"] for m in by_month[-6:]]
    improvement = None
    if len(percentages) >= 2:
        diff = percentages[-1] - percentages[-2]
        if diff > 2:
            improvement = "improving"
        elif diff < -2:
            improvement = "declining"
        else:
            improvement = "stable"
    return {
        "monthly_percentages": percentages,
        "trend": improvement or "insufficient_data",
    }


# ─── Online Test Results (Phase 4) ─────────────────────────────────────

def get_test_results(school_id: str, *, profile_id: str | None, user_email: str | None, student_id: str | None = None) -> dict[str, Any]:
    linked = _resolve_parent_students(school_id, profile_id, user_email)
    if student_id:
        linked = [s for s in linked if _normalize(s.get("id")) == student_id]
    if not linked:
        return {"children": []}

    student_ids = [_normalize(s.get("id")) for s in linked if _normalize(s.get("id"))]
    test_results = _batch_load_test_results(school_id, student_ids, limit=50)

    children = [_build_test_results_from_batch(s, test_results.get(_normalize(s.get("id")), [])) for s in linked]
    return {"children": children}


def _build_test_results_from_batch(student: dict[str, Any], results: list[dict[str, Any]]) -> dict[str, Any]:
    sid = _normalize(student.get("id"))
    sname = _normalize(student.get("full_name")) or "Student"

    tests = [
        {
            "id": _normalize(r.get("id") or r.get("test_id") or ""),
            "title": _normalize(r.get("test_title") or r.get("title") or "Test"),
            "subject": _normalize(r.get("subject") or r.get("subject_name") or ""),
            "score": _safe_float(r.get("score") or r.get("marks") or 0),
            "total_marks": _safe_float(r.get("total_marks") or r.get("total") or 0),
            "percentage": _safe_float(r.get("percentage") or 0),
            "rank": _safe_int(r.get("rank") or 0),
            "completed_at": _normalize(r.get("completed_at") or r.get("published_at") or r.get("created_at") or ""),
        }
        for r in results
    ]

    percentages = [t["percentage"] for t in tests if t["percentage"] > 0]
    avg_percentage = round(sum(percentages) / max(len(percentages), 1), 1) if percentages else 0.0

    improvement = None
    if len(percentages) >= 2:
        recent = sum(percentages[-3:]) / min(len(percentages[-3:]), 3)
        earlier = sum(percentages[:-3]) / max(len(percentages[:-3]), 1) if len(percentages) > 3 else percentages[0] if percentages else 0
        diff = recent - earlier
        if diff > 3:
            improvement = "improving"
        elif diff < -3:
            improvement = "declining"
        else:
            improvement = "stable"

    best_rank = min((t["rank"] for t in tests if t["rank"] > 0), default=None)

    return {
        "student_id": sid,
        "student_name": sname,
        "recent_tests": tests[:10],
        "average_percentage": avg_percentage,
        "best_rank": best_rank,
        "total_tests": len(tests),
        "improvement_trend": improvement or "insufficient_data",
        "percentage_history": percentages,
    }


# ─── Assignments (Phase 5) ─────────────────────────────────────────────

def get_assignments(school_id: str, *, profile_id: str | None, user_email: str | None, student_id: str | None = None) -> dict[str, Any]:
    linked = _resolve_parent_students(school_id, profile_id, user_email)
    if student_id:
        linked = [s for s in linked if _normalize(s.get("id")) == student_id]
    if not linked:
        return {"children": []}

    assignments = _batch_load_assignments(school_id)
    children = [_build_assignments_from_batch(s, assignments) for s in linked]
    return {"children": children}


def _build_assignments_from_batch(student: dict[str, Any], all_assignments: list[dict[str, Any]]) -> dict[str, Any]:
    sid = _normalize(student.get("id"))
    sname = _normalize(student.get("full_name")) or "Student"

    student_assignments = all_assignments

    now = _now()
    items = []
    pending = 0
    submitted = 0
    graded = 0
    late = 0

    for a in student_assignments:
        due = _parse_iso_date(a.get("due_date"))
        has_submission = bool(a.get("submission"))
        has_grade = a.get("grade") is not None
        is_late = has_submission and due and due < _today()

        status = "pending"
        if has_grade:
            status = "graded"
            graded += 1
        elif has_submission:
            status = "submitted" if not is_late else "late"
            if is_late:
                late += 1
            else:
                submitted += 1
        else:
            pending += 1

        items.append({
            "id": _normalize(a.get("id")),
            "title": _normalize(a.get("title")) or "Assignment",
            "course_name": _normalize(a.get("course_name") or ""),
            "due_date": _normalize(a.get("due_date")),
            "status": status,
            "grade": a.get("grade"),
            "max_grade": a.get("max_grade"),
            "submitted_at": _normalize(a.get("submitted_at") or ""),
        })

    return {
        "student_id": sid,
        "student_name": sname,
        "summary": {
            "pending": pending,
            "submitted": submitted,
            "graded": graded,
            "late": late,
            "total": len(items),
        },
        "assignments": items,
    }


# ─── Alerts (Phase 6) ──────────────────────────────────────────────────

def get_alerts(school_id: str, *, profile_id: str | None, user_email: str | None, student_id: str | None = None) -> dict[str, Any]:
    linked = _resolve_parent_students(school_id, profile_id, user_email)
    if student_id:
        linked = [s for s in linked if _normalize(s.get("id")) == student_id]
    if not linked:
        return {"children": []}

    student_ids = [_normalize(s.get("id")) for s in linked if _normalize(s.get("id"))]
    attendance_by_student = _batch_load_attendance(school_id, student_ids, days=90)
    test_results = _batch_load_test_results(school_id, student_ids, limit=10)
    assignments = _batch_load_assignments(school_id)
    shared_tests = _load_shared_tests(school_id)

    children = []
    for s in linked:
        sid = _normalize(s.get("id"))
        children.append(_build_alerts_from_batch(
            school_id, s,
            attendance_rows=attendance_by_student.get(sid, []),
            test_results_list=test_results.get(sid, []),
            assignments=assignments,
            shared_tests=shared_tests,
        ))

    return {"children": children}


def _build_alerts_from_batch(
    school_id: str,
    student: dict[str, Any],
    *,
    attendance_rows: list[dict[str, Any]],
    test_results_list: list[dict[str, Any]],
    assignments: list[dict[str, Any]],
    shared_tests: list[dict[str, Any]],
    fee_data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    sid = _normalize(student.get("id"))
    sname = _normalize(student.get("full_name")) or "Student"

    alerts = []

    total = len(attendance_rows)
    present = len([r for r in attendance_rows if _normalize(r.get("status")).lower() == "present"])
    att_pct = _safe_percentage(present, max(total, 1))
    if att_pct < 75:
        alerts.append({
            "type": "low_attendance",
            "severity": "critical" if att_pct < 60 else "warning",
            "title": "Low Attendance",
            "message": f"Attendance is {att_pct:.0f}% — below the recommended 75% threshold.",
            "value": att_pct,
        })

    if test_results_list:
        avg = round(sum(_safe_float(r.get("percentage") or 0) for r in test_results_list) / len(test_results_list), 1)
        if avg < 50:
            alerts.append({
                "type": "low_performance",
                "severity": "critical" if avg < 35 else "warning",
                "title": "Low Performance",
                "message": f"Average test score is {avg}% — needs improvement.",
                "value": avg,
            })

    student_assignments = assignments
    missed = [a for a in student_assignments if not a.get("submission")]
    if missed:
        alerts.append({
            "type": "missed_assignments",
            "severity": "warning",
            "title": "Missed Assignments",
            "message": f"{len(missed)} assignment{'s' if len(missed) > 1 else ''} still need{'s' if len(missed) == 1 else ''} submission.",
            "value": len(missed),
        })

    batch_id = _normalize(student.get("batch_id"))
    upcoming = _get_upcoming_tests_from_shared(shared_tests, batch_id or None)
    if upcoming:
        next_test = upcoming[0]
        alerts.append({
            "type": "upcoming_test",
            "severity": "info",
            "title": "Upcoming Test",
            "message": f"'{next_test.get('title')}' is scheduled soon.",
            "value": _normalize(next_test.get("starts_at")),
        })

    if fee_data is not None:
        fee_status = fee_data
    else:
        fee_status = _get_fee_status(school_id, sid)
    if fee_status.get("due_amount", 0) > 0:
        alerts.append({
            "type": "fee_due",
            "severity": "warning",
            "title": "Fee Due",
            "message": f"₹{_safe_float(fee_status.get('due_amount')):.0f} fee payment is pending.",
            "value": _safe_float(fee_status.get("due_amount")),
        })

    return {
        "student_id": sid,
        "student_name": sname,
        "alerts": alerts,
        "total_alerts": len(alerts),
    }


# ─── Children List (Phase 7) ──────────────────────────────────────────

def get_children(school_id: str, *, profile_id: str | None, user_email: str | None) -> list[dict[str, Any]]:
    linked = _resolve_parent_students(school_id, profile_id, user_email)
    return [
        {
            "student_id": _normalize(s.get("id")),
            "student_name": _normalize(s.get("full_name")) or "Student",
            "class_name": _normalize(s.get("class_name")) or "",
            "section": _normalize(s.get("section")) or "",
            "roll_number": _normalize(s.get("roll_number")) or "",
        }
        for s in linked
    ]


# ─── Legacy individual student functions (kept for backward compat) ──

def _load_attendance_rows(school_id: str, student_id: str, *, days: int = 365) -> list[dict[str, Any]]:
    start = (_today() - timedelta(days=max(days, 1) - 1)).isoformat()
    try:
        rows = list(
            _schema_table(ATTENDANCE_SCHEMA, "student_attendance")
            .select("attendance_date,status")
            .eq("school_id", school_id)
            .eq("student_id", student_id)
            .gte("attendance_date", start)
            .execute()
            .data or []
        )
    except Exception:
        return []
    return [dict(r) for r in rows]


def _build_child_dashboard(school_id: str, student: dict[str, Any]) -> dict[str, Any]:
    sid = _normalize(student.get("id"))
    sname = _normalize(student.get("full_name")) or "Student"
    class_name = _normalize(student.get("class_name")) or ""
    section = _normalize(student.get("section")) or ""

    try:
        att_rows = _load_attendance_rows(school_id, sid, days=180)
    except Exception:
        att_rows = []
    total = len(att_rows)
    present = len([r for r in att_rows if _normalize(r.get("status")).lower() == "present"])
    absent = total - present
    att_pct = _safe_percentage(present, max(total, 1))

    fee_status = _get_fee_status(school_id, sid)

    try:
        all_assignments = list_assignments(school_id, student=student)
    except Exception:
        all_assignments = []
    pending_assignments = len([
        a for a in all_assignments
        if not a.get("submission") and _normalize(a.get("status")).lower() != "closed"
    ])
    submitted_count = len([a for a in all_assignments if a.get("submission")])

    upcoming = _get_upcoming_tests(school_id, _normalize(student.get("batch_id")) or None)

    try:
        results = list_results(school_id, student_id=sid, limit=5)
    except Exception:
        results = []
    latest_result = results[0] if results else None
    latest_test = {
        "title": _normalize(latest_result.get("test_title") or latest_result.get("title") or ""),
        "score": _safe_float(latest_result.get("score") or latest_result.get("marks") or 0),
        "total": _safe_float(latest_result.get("total_marks") or latest_result.get("total") or 0),
        "percentage": _safe_float(latest_result.get("percentage") or 0),
        "rank": _safe_int(latest_result.get("rank") or 0),
    } if latest_result else None

    try:
        progress = get_progress_dashboard(school_id, student=student)
    except Exception:
        progress = {}
    progress_items = list(progress.get("progress_items") or [])
    course_progress = round(
        sum(_safe_float(p.get("watch_percentage") or 0) for p in progress_items) / max(len(progress_items), 1), 1
    ) if progress_items else 0.0

    return {
        "student_id": sid,
        "student_name": sname,
        "class_name": class_name,
        "section": section,
        "attendance_percentage": att_pct,
        "present_days": present,
        "absent_days": absent,
        "total_days": total,
        "learning_score": course_progress,
        "pending_assignments": pending_assignments + len([a for a in all_assignments if a.get("submission") and not a.get("grade")]),
        "submitted_assignments": submitted_count,
        "upcoming_tests": [_simplify_test(t) for t in upcoming[:5]],
        "latest_test_result": latest_test,
        "fee_status": fee_status,
    }


def _build_recommendations(school_id: str, student: dict[str, Any]) -> dict[str, Any]:
    sid = _normalize(student.get("id"))
    sname = _normalize(student.get("full_name")) or "Student"

    try:
        dash = _build_child_dashboard(school_id, student)
        att = _build_attendance(school_id, student)
        assign = _build_assignments(school_id, student)
        test = _build_test_results(school_id, student)
        academic = _build_academic_progress(school_id, student)
    except Exception:
        return {
            "student_id": sid,
            "student_name": sname,
            "recommendations": ["Recommendation data is unavailable right now. Please try again."],
        }

    recs = []

    if dash.get("attendance_percentage", 100) < 75:
        recs.append("Encourage regular attendance — missing school affects learning continuity.")
    if dash.get("learning_score", 100) < 60:
        recs.append("Review course progress and help your child catch up on lessons.")
    if dash.get("pending_assignments", 0) > 2:
        recs.append(f"Your child has {dash.get('pending_assignments')} pending assignments. A study schedule may help.")
    if test.get("average_percentage", 100) < 50:
        recs.append("Consider extra practice in weak subjects to improve test scores.")
    if (dash.get("fee_status") or {}).get("due_amount", 0) > 0:
        recs.append(f"Fee payment of ₹{_safe_float((dash.get('fee_status') or {}).get('due_amount', 0)):.0f} is due.")
    if dash.get("absent_days", 0) > 10:
        recs.append("Frequent absences may impact learning. A consistent routine helps.")
    if not recs:
        recs.append("Your child is doing well! Keep supporting their learning journey.")

    weak = list(academic.get("weak_topics") or [])
    if weak:
        recs.append(f"Focus areas: {', '.join(weak[:3])}.")

    return {
        "student_id": sid,
        "student_name": sname,
        "recommendations": recs,
    }


# ─── Legacy individual student functions (kept for backward compat from route) ──

def _build_attendance(school_id: str, student: dict[str, Any]) -> dict[str, Any]:
    sid = _normalize(student.get("id"))
    sname = _normalize(student.get("full_name")) or "Student"

    all_rows = _load_attendance_rows(school_id, sid, days=365)

    month_start = _today().replace(day=1)
    month_rows = [r for r in all_rows if (_parse_iso_date(r.get("attendance_date")) or _today()) >= month_start]

    total = len(all_rows)
    present = len([r for r in all_rows if _normalize(r.get("status")).lower() == "present"])
    absent = total - present
    att_pct = _safe_percentage(present, max(total, 1))

    monthly = _build_monthly_breakdown(all_rows)

    return {
        "student_id": sid,
        "student_name": sname,
        "overall": {
            "total_days": total,
            "present_days": present,
            "absent_days": absent,
            "attendance_percentage": att_pct,
        },
        "current_month": {
            "total_days": len(month_rows),
            "present_days": len([r for r in month_rows if _normalize(r.get("status")).lower() == "present"]),
            "absent_days": len([r for r in month_rows if _normalize(r.get("status")).lower() != "present"]),
            "attendance_percentage": _safe_percentage(
                len([r for r in month_rows if _normalize(r.get("status")).lower() == "present"]),
                max(len(month_rows), 1),
            ),
        },
        "monthly_breakdown": monthly,
        "trend": _build_attendance_trend(all_rows),
    }


def _build_test_results(school_id: str, student: dict[str, Any]) -> dict[str, Any]:
    sid = _normalize(student.get("id"))
    sname = _normalize(student.get("full_name")) or "Student"
    results = list_results(school_id, student_id=sid, limit=50)

    tests = [
        {
            "id": _normalize(r.get("id") or r.get("test_id") or ""),
            "title": _normalize(r.get("test_title") or r.get("title") or "Test"),
            "subject": _normalize(r.get("subject") or r.get("subject_name") or ""),
            "score": _safe_float(r.get("score") or r.get("marks") or 0),
            "total_marks": _safe_float(r.get("total_marks") or r.get("total") or 0),
            "percentage": _safe_float(r.get("percentage") or 0),
            "rank": _safe_int(r.get("rank") or 0),
            "completed_at": _normalize(r.get("completed_at") or r.get("published_at") or r.get("created_at") or ""),
        }
        for r in results
    ]

    percentages = [t["percentage"] for t in tests if t["percentage"] > 0]
    avg_percentage = round(sum(percentages) / max(len(percentages), 1), 1) if percentages else 0.0

    improvement = None
    if len(percentages) >= 2:
        recent = sum(percentages[-3:]) / min(len(percentages[-3:]), 3)
        earlier = sum(percentages[:-3]) / max(len(percentages[:-3]), 1) if len(percentages) > 3 else percentages[0] if percentages else 0
        diff = recent - earlier
        if diff > 3:
            improvement = "improving"
        elif diff < -3:
            improvement = "declining"
        else:
            improvement = "stable"

    best_rank = min((t["rank"] for t in tests if t["rank"] > 0), default=None)

    return {
        "student_id": sid,
        "student_name": sname,
        "recent_tests": tests[:10],
        "average_percentage": avg_percentage,
        "best_rank": best_rank,
        "total_tests": len(tests),
        "improvement_trend": improvement or "insufficient_data",
        "percentage_history": percentages,
    }


def _build_assignments(school_id: str, student: dict[str, Any]) -> dict[str, Any]:
    sid = _normalize(student.get("id"))
    sname = _normalize(student.get("full_name")) or "Student"
    all_a = list_assignments(school_id, student=student)

    now = _now()
    items = []
    pending = 0
    submitted = 0
    graded = 0
    late = 0

    for a in all_a:
        due = _parse_iso_date(a.get("due_date"))
        has_submission = bool(a.get("submission"))
        has_grade = a.get("grade") is not None
        is_late = has_submission and due and due < _today()

        status = "pending"
        if has_grade:
            status = "graded"
            graded += 1
        elif has_submission:
            status = "submitted" if not is_late else "late"
            if is_late:
                late += 1
            else:
                submitted += 1
        else:
            pending += 1

        items.append({
            "id": _normalize(a.get("id")),
            "title": _normalize(a.get("title")) or "Assignment",
            "course_name": _normalize(a.get("course_name") or ""),
            "due_date": _normalize(a.get("due_date")),
            "status": status,
            "grade": a.get("grade"),
            "max_grade": a.get("max_grade"),
            "submitted_at": _normalize(a.get("submitted_at") or ""),
        })

    return {
        "student_id": sid,
        "student_name": sname,
        "summary": {
            "pending": pending,
            "submitted": submitted,
            "graded": graded,
            "late": late,
            "total": len(items),
        },
        "assignments": items,
    }


def _build_academic_progress(school_id: str, student: dict[str, Any]) -> dict[str, Any]:
    sid = _normalize(student.get("id"))
    sname = _normalize(student.get("full_name")) or "Student"

    progress = get_progress_dashboard(school_id, student=student)
    progress_items = list(progress.get("progress_items") or [])
    courses = [
        {
            "course_name": _normalize(p.get("course_name") or p.get("title") or "Course"),
            "watch_percentage": _safe_float(p.get("watch_percentage") or 0),
            "completed_lessons": _safe_int(p.get("completed_lessons") or 0),
            "total_lessons": _safe_int(p.get("total_lessons") or 0),
        }
        for p in progress_items
    ]

    all_assignments = list_assignments(school_id, student=student)
    total_assignments = len(all_assignments)
    completed = len([a for a in all_assignments if a.get("submission")])
    graded = len([a for a in all_assignments if a.get("grade") is not None])
    assignment_completion = _safe_percentage(completed, max(total_assignments, 1))

    revision_items = list(progress.get("revision_tracker") or []) or list(progress.get("revision_activities") or [])
    revision_summary = {
        "total_revisions": len(revision_items),
        "completed_revisions": len([r for r in revision_items if r.get("completed") or _normalize(r.get("status")).lower() == "completed"]),
    }

    analytics = _get_student_analytics_data(school_id, sid)
    weak = list(analytics.get("weak_topics") or [])[:5]
    strong = list(analytics.get("strong_topics") or [])[:5]

    return {
        "student_id": sid,
        "student_name": sname,
        "course_progress": {
            "overall_percentage": round(
                sum(p["watch_percentage"] for p in courses) / max(len(courses), 1), 1
            ) if courses else 0.0,
            "courses": courses,
            "total_courses": len(courses),
        },
        "assignment_completion": {
            "total": total_assignments,
            "completed": completed,
            "graded": graded,
            "completion_percentage": assignment_completion,
        },
        "revision_tracker": revision_summary,
        "weak_topics": weak,
        "strong_topics": strong,
    }


def _build_alerts(school_id: str, student: dict[str, Any]) -> dict[str, Any]:
    sid = _normalize(student.get("id"))
    sname = _normalize(student.get("full_name")) or "Student"

    alerts = []

    att_rows = _load_attendance_rows(school_id, sid, days=90)
    total = len(att_rows)
    present = len([r for r in att_rows if _normalize(r.get("status")).lower() == "present"])
    att_pct = _safe_percentage(present, max(total, 1))
    if att_pct < 75:
        alerts.append({
            "type": "low_attendance",
            "severity": "critical" if att_pct < 60 else "warning",
            "title": "Low Attendance",
            "message": f"Attendance is {att_pct:.0f}% — below the recommended 75% threshold.",
            "value": att_pct,
        })

    results = list_results(school_id, student_id=sid, limit=10)
    if results:
        avg = round(sum(_safe_float(r.get("percentage") or 0) for r in results) / len(results), 1)
        if avg < 50:
            alerts.append({
                "type": "low_performance",
                "severity": "critical" if avg < 35 else "warning",
                "title": "Low Performance",
                "message": f"Average test score is {avg}% — needs improvement.",
                "value": avg,
            })

    all_a = list_assignments(school_id, student=student)
    missed = [a for a in all_a if not a.get("submission")]
    if missed:
        alerts.append({
            "type": "missed_assignments",
            "severity": "warning",
            "title": "Missed Assignments",
            "message": f"{len(missed)} assignment{'s' if len(missed) > 1 else ''} still need{'s' if len(missed) == 1 else ''} submission.",
            "value": len(missed),
        })

    batch_id = _normalize(student.get("batch_id"))
    upcoming = _get_upcoming_tests(school_id, batch_id or None)
    if upcoming:
        next_test = upcoming[0]
        alerts.append({
            "type": "upcoming_test",
            "severity": "info",
            "title": "Upcoming Test",
            "message": f"'{next_test.get('title')}' is scheduled soon.",
            "value": _normalize(next_test.get("starts_at")),
        })

    fee = _get_fee_status(school_id, sid)
    if fee.get("due_amount", 0) > 0:
        alerts.append({
            "type": "fee_due",
            "severity": "warning",
            "title": "Fee Due",
            "message": f"₹{_safe_float(fee.get('due_amount')):.0f} fee payment is pending.",
            "value": _safe_float(fee.get("due_amount")),
        })

    return {
        "student_id": sid,
        "student_name": sname,
        "alerts": alerts,
        "total_alerts": len(alerts),
    }
