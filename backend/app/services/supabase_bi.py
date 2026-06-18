"""Enterprise BI warehouse refresh and dashboard reads."""

from __future__ import annotations

import logging
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from io import BytesIO
from typing import Any

from fastapi import HTTPException

from app.services.supabase_admin import get_supabase_admin_client

logger = logging.getLogger("bi.performance")

WAREHOUSE_SCHEMA = "warehouse"
LMS_SCHEMA = "lms"
TESTS_SCHEMA = "online_tests"
ATTENDANCE_SCHEMA = "attendance"
FINANCE_SCHEMA = "finance"
ACADEMIC_SCHEMA = "academic"
HOSTEL_SCHEMA = "hostel"
INVENTORY_SCHEMA = "inventory"
REPORTING_SCHEMA = "reporting"
MODULE_KEY = "bi"
_WAREHOUSE_TTL = timedelta(hours=6)
_EXPOSED_SCHEMAS = frozenset({"public", "inventory", "academic", "attendance", "exam", "finance", "hostel", "reporting", "scheduling", "workflow"})
_school_last_refresh: dict[str, datetime] = {}
_platform_last_refresh: datetime | None = None
_bad_query_cache: set[tuple[str | None, str]] = set()
_dim_date_refreshed_today: bool = False


def _client():
    return get_supabase_admin_client()


def _public_table(name: str):
    return _client().table(name)


def _warehouse_table(name: str):
    return _public_table(f"warehouse_{name}")


def _online_test_table(name: str):
    return _public_table(f"online_test_{name}")


def _lms_table(name: str):
    return _public_table(f"lms_{name}")


def _schema_table(schema: str, name: str):
    return _client().schema(schema).table(name)


def _normalize(value: Any) -> str:
    return str(value or "").strip()


def _to_float(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _to_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _today() -> date:
    return _utc_now().date()


def _iso_date(value: Any) -> str:
    text = _normalize(value)
    if not text:
        return _today().isoformat()
    return text[:10]


def _safe_list(schema: str | None, table: str, select: str = "*", **filters: Any) -> list[dict[str, Any]]:
    cache_key = (schema, table)
    if cache_key in _bad_query_cache:
        return []
    if schema and schema not in _EXPOSED_SCHEMAS and schema != WAREHOUSE_SCHEMA and schema != TESTS_SCHEMA:
        _bad_query_cache.add(cache_key)
        return []
    start = time.perf_counter()
    try:
        if schema == WAREHOUSE_SCHEMA:
            query = _warehouse_table(table).select(select)
        elif schema == LMS_SCHEMA:
            query = _lms_table(table).select(select)
        elif schema == TESTS_SCHEMA:
            query = _online_test_table(table).select(select)
        else:
            query = (_schema_table(schema, table) if schema else _public_table(table)).select(select)
        for key, value in filters.items():
            if value is None:
                continue
            query = query.eq(key, value)
        data = list(query.execute().data or [])
        elapsed = time.perf_counter() - start
        logger.info("query  schema=%s table=%s rows=%d time=%.3fs", schema, table, len(data), elapsed)
        return [dict(row) for row in data]
    except Exception:
        elapsed = time.perf_counter() - start
        if elapsed > 0.5:
            _bad_query_cache.add(cache_key)
            logger.info("query  schema=%s table=%s CACHED_BAD time=%.3fs", schema, table, elapsed)
        else:
            logger.warning("query  schema=%s table=%s ERROR time=%.3fs", schema, table, elapsed)
        return []


def _delete_snapshot_rows(schema: str, table: str, *, school_id: str | None = None, snapshot_date: str | None = None) -> None:
    start = time.perf_counter()
    try:
        query = _warehouse_table(table).delete() if schema == WAREHOUSE_SCHEMA else _schema_table(schema, table).delete()
        if school_id is not None:
            query = query.eq("school_id", school_id)
        if snapshot_date is not None:
            query = query.eq("snapshot_date", snapshot_date)
        query.execute()
        elapsed = time.perf_counter() - start
        logger.info("delete  schema=%s table=%s time=%.3fs", schema, table, elapsed)
    except Exception:
        elapsed = time.perf_counter() - start
        logger.warning("delete  schema=%s table=%s ERROR time=%.3fs", schema, table, elapsed)
        return


def _upsert(schema: str, table: str, rows: list[dict[str, Any]], *, on_conflict: str) -> None:
    if not rows:
        return
    start = time.perf_counter()
    if schema == WAREHOUSE_SCHEMA:
        _warehouse_table(table).upsert(rows, on_conflict=on_conflict).execute()
    else:
        _schema_table(schema, table).upsert(rows, on_conflict=on_conflict).execute()
    elapsed = time.perf_counter() - start
    logger.info("upsert  schema=%s table=%s rows=%d time=%.3fs", schema, table, len(rows), elapsed)


def _log_audit_entry(*, school_id: str | None, profile_id: str | None, action: str, payload: dict[str, Any] | None = None) -> None:
    try:
        _public_table("audit_logs").insert(
            {
                "school_id": school_id,
                "profile_id": profile_id,
                "action": action,
                "module_key": MODULE_KEY,
                "payload": payload or {},
            }
        ).execute()
    except Exception:
        return


def _refresh_dim_date() -> None:
    global _dim_date_refreshed_today
    if _dim_date_refreshed_today:
        return
    today = _today()
    start = today - timedelta(days=730)
    rows: list[dict[str, Any]] = []
    for offset in range(0, 1461):
        current = start + timedelta(days=offset)
        rows.append(
            {
                "date_key": current.isoformat(),
                "day_of_week": current.isoweekday(),
                "day_name": current.strftime("%A"),
                "week_of_year": int(current.strftime("%V")),
                "month_of_year": current.month,
                "month_name": current.strftime("%B"),
                "quarter_of_year": ((current.month - 1) // 3) + 1,
                "year_number": current.year,
                "is_weekend": current.weekday() >= 5,
            }
        )
    _upsert(WAREHOUSE_SCHEMA, "dim_date", rows, on_conflict="date_key")
    _dim_date_refreshed_today = True


def _refresh_school_dimension(school_id: str) -> None:
    schools = _safe_list(None, "schools", school_id=school_id)
    if not schools:
        return
    school = schools[0]
    metadata = school.get("metadata") if isinstance(school.get("metadata"), dict) else {}
    _upsert(
        WAREHOUSE_SCHEMA,
        "dim_school",
        [
            {
                "school_id": school_id,
                "school_name": school.get("name") or school.get("school_name") or "School",
                "campus_name": metadata.get("campus_name"),
                "tenant_tier": metadata.get("tenant_tier"),
                "franchise_code": metadata.get("franchise_code"),
                "is_active": bool(school.get("is_active", True)),
                "metadata": metadata,
            }
        ],
        on_conflict="school_id",
    )


def _refresh_student_dimension(school_id: str) -> list[dict[str, Any]]:
    students = _safe_list(None, "students", school_id=school_id, is_active=True)
    rows = [
        {
            "school_id": school_id,
            "student_id": row.get("id"),
            "profile_id": row.get("profile_id"),
            "batch_id": row.get("batch_id"),
            "admission_no": row.get("admission_no"),
            "full_name": row.get("full_name") or "Student",
            "class_name": row.get("class_name"),
            "section": row.get("section"),
            "academic_session": row.get("academic_session"),
            "boarding_type": row.get("boarding_type"),
            "hostel_required": bool(row.get("hostel_required", False)),
            "is_active": bool(row.get("is_active", True)),
            "metadata": row.get("metadata") if isinstance(row.get("metadata"), dict) else {},
        }
        for row in students
        if row.get("id")
    ]
    _upsert(WAREHOUSE_SCHEMA, "dim_student", rows, on_conflict="school_id,student_id")
    return students


def _refresh_staff_dimension(school_id: str) -> list[dict[str, Any]]:
    memberships = _safe_list(None, "school_memberships", school_id=school_id, is_active=True)
    role_map = {
        row.get("id"): row
        for row in _safe_list(None, "roles")
        if row.get("id")
    }
    profile_ids = [row.get("profile_id") for row in memberships if row.get("profile_id")]
    profiles = _safe_list(None, "profiles")
    profile_map = {row.get("id"): row for row in profiles if row.get("id") in profile_ids}
    staff_rows = _safe_list(None, "staff_members", school_id=school_id, is_active=True)
    staff_by_profile = {row.get("profile_id"): row for row in staff_rows if row.get("profile_id")}
    rows: list[dict[str, Any]] = []
    for membership in memberships:
        profile_id = membership.get("profile_id")
        if not profile_id:
            continue
        profile = profile_map.get(profile_id, {})
        role = role_map.get(membership.get("role_id"), {})
        staff_member = staff_by_profile.get(profile_id, {})
        rows.append(
            {
                "school_id": school_id,
                "profile_id": profile_id,
                "membership_id": membership.get("id"),
                "staff_member_id": staff_member.get("id"),
                "role_id": membership.get("role_id"),
                "role_key": role.get("role_key"),
                "full_name": profile.get("full_name") or profile.get("display_name") or profile.get("email") or "Staff",
                "email": profile.get("email"),
                "user_type": (profile.get("metadata") or {}).get("user_type") if isinstance(profile.get("metadata"), dict) else None,
                "is_active": bool(membership.get("is_active", True)),
                "metadata": {
                    "membership_status": membership.get("status"),
                    "is_primary": bool(membership.get("is_primary", False)),
                },
            }
        )
    _upsert(WAREHOUSE_SCHEMA, "dim_staff", rows, on_conflict="school_id,profile_id")
    return memberships


def _refresh_course_dimension(school_id: str) -> list[dict[str, Any]]:
    courses = _safe_list(LMS_SCHEMA, "courses", school_id=school_id, is_active=True)
    rows = [
        {
            "school_id": school_id,
            "course_id": row.get("id"),
            "batch_id": row.get("batch_id"),
            "subject_id": row.get("subject_id"),
            "course_code": row.get("course_code"),
            "title": row.get("title") or "Course",
            "visibility": row.get("visibility"),
            "is_published": bool(row.get("is_published", False)),
            "estimated_duration_minutes": _to_int(row.get("estimated_duration_minutes")),
            "is_active": bool(row.get("is_active", True)),
            "metadata": row.get("metadata") if isinstance(row.get("metadata"), dict) else {},
        }
        for row in courses
        if row.get("id")
    ]
    _upsert(WAREHOUSE_SCHEMA, "dim_course", rows, on_conflict="school_id,course_id")
    return courses


def _refresh_fact_attendance(school_id: str, snapshot_date: str) -> list[dict[str, Any]]:
    _delete_snapshot_rows(WAREHOUSE_SCHEMA, "fact_attendance", school_id=school_id, snapshot_date=snapshot_date)
    student_attendance = _safe_list(ATTENDANCE_SCHEMA, "student_attendance", school_id=school_id)
    staff_attendance = _safe_list(ATTENDANCE_SCHEMA, "staff_attendance", school_id=school_id)
    rows: list[dict[str, Any]] = []
    for row in student_attendance:
        status = _normalize(row.get("status")).lower()
        rows.append(
            {
                "school_id": school_id,
                "snapshot_date": _iso_date(row.get("attendance_date")),
                "attendance_scope": "student",
                "grain_key": f"student:{row.get('student_id')}",
                "student_id": row.get("student_id"),
                "present_count": 1 if status == "present" else 0,
                "absent_count": 1 if status == "absent" else 0,
                "late_count": 1 if status == "late" else 0,
                "excused_count": 1 if status == "excused" else 0,
                "attendance_percentage": 100 if status in {"present", "late", "excused"} else 0,
                "metadata": {"subject_id": row.get("subject_id"), "batch_id": row.get("batch_id")},
            }
        )
    for row in staff_attendance:
        status = _normalize(row.get("status")).lower()
        rows.append(
            {
                "school_id": school_id,
                "snapshot_date": _iso_date(row.get("attendance_date")),
                "attendance_scope": "staff",
                "grain_key": f"staff:{row.get('staff_member_id')}",
                "staff_member_id": row.get("staff_member_id"),
                "present_count": 1 if status == "present" else 0,
                "absent_count": 1 if status == "absent" else 0,
                "late_count": 1 if status == "late" else 0,
                "half_day_count": 1 if status == "half_day" else 0,
                "leave_count": 1 if status == "leave" else 0,
                "attendance_percentage": 100 if status == "present" else 50 if status in {"late", "half_day"} else 0,
                "metadata": {},
            }
        )
    _upsert(WAREHOUSE_SCHEMA, "fact_attendance", rows, on_conflict="school_id,snapshot_date,attendance_scope,grain_key")
    return rows


def _refresh_fact_tests(school_id: str) -> list[dict[str, Any]]:
    results = _safe_list(TESTS_SCHEMA, "test_results", school_id=school_id, is_active=True)
    attempts = {row.get("id"): row for row in _safe_list(TESTS_SCHEMA, "test_attempts", school_id=school_id, is_active=True)}
    tests = {row.get("id"): row for row in _safe_list(TESTS_SCHEMA, "tests", school_id=school_id, is_active=True)}
    rows: list[dict[str, Any]] = []
    for row in results:
        attempt = attempts.get(row.get("attempt_id"), {})
        test = tests.get(row.get("test_id"), {})
        snapshot_date = _iso_date(row.get("published_at") or row.get("created_at"))
        rows.append(
            {
                "school_id": school_id,
                "snapshot_date": snapshot_date,
                "result_id": row.get("id"),
                "test_id": row.get("test_id"),
                "attempt_id": row.get("attempt_id"),
                "student_id": row.get("student_id"),
                "batch_id": test.get("batch_id"),
                "subject_id": test.get("subject_id"),
                "test_title": test.get("title"),
                "score_obtained": _to_float(row.get("score_obtained")),
                "max_score": _to_float(row.get("max_score")),
                "percentage": _to_float(row.get("percentage")),
                "correct_answers": _to_int(row.get("correct_answers")),
                "incorrect_answers": _to_int(row.get("incorrect_answers")),
                "unanswered_questions": _to_int(row.get("unanswered_questions")),
                "time_spent_seconds": _to_int(attempt.get("time_spent_seconds")),
                "metadata": row.get("metadata") if isinstance(row.get("metadata"), dict) else {},
            }
        )
    _upsert(WAREHOUSE_SCHEMA, "fact_tests", rows, on_conflict="school_id,result_id")
    return rows


def _refresh_fact_finance(school_id: str) -> list[dict[str, Any]]:
    orders = _safe_list(FINANCE_SCHEMA, "orders", school_id=school_id)
    subscriptions = _safe_list(FINANCE_SCHEMA, "subscriptions", school_id=school_id)
    products = {row.get("id"): row for row in _safe_list(FINANCE_SCHEMA, "products", school_id=school_id)}
    rows: list[dict[str, Any]] = []
    for row in orders:
        if _normalize(row.get("order_status")).lower() != "paid":
            continue
        snapshot_date = _iso_date(row.get("paid_at") or row.get("created_at"))
        rows.append(
            {
                "school_id": school_id,
                "snapshot_date": snapshot_date,
                "metric_type": "order",
                "source_key": f"order:{row.get('id')}",
                "source_id": row.get("id"),
                "student_id": row.get("student_id"),
                "profile_id": row.get("profile_id"),
                "provider_key": row.get("provider_key"),
                "status": row.get("order_status"),
                "category": "revenue",
                "amount": _to_float(row.get("total_amount")),
                "quantity": 1,
                "metadata": row.get("metadata") if isinstance(row.get("metadata"), dict) else {},
            }
        )
    for row in subscriptions:
        product = products.get(row.get("product_id"), {})
        snapshot_date = _iso_date(row.get("start_date") or row.get("created_at"))
        rows.append(
            {
                "school_id": school_id,
                "snapshot_date": snapshot_date,
                "metric_type": "subscription",
                "source_key": f"subscription:{row.get('id')}",
                "source_id": row.get("id"),
                "student_id": row.get("student_id"),
                "profile_id": row.get("profile_id"),
                "product_id": row.get("product_id"),
                "provider_key": row.get("provider_key"),
                "status": row.get("subscription_status"),
                "category": product.get("category") or "subscription",
                "amount": _to_float(row.get("amount")),
                "quantity": 1,
                "metadata": row.get("metadata") if isinstance(row.get("metadata"), dict) else {},
            }
        )
    _upsert(WAREHOUSE_SCHEMA, "fact_finance", rows, on_conflict="school_id,metric_type,source_key,snapshot_date")
    return rows


def _refresh_fact_lms(school_id: str) -> list[dict[str, Any]]:
    progress_rows = _safe_list(LMS_SCHEMA, "student_progress", school_id=school_id, is_active=True)
    rows: list[dict[str, Any]] = []
    for row in progress_rows:
        snapshot_date = _iso_date(row.get("last_accessed_at") or row.get("updated_at") or row.get("created_at"))
        rows.append(
            {
                "school_id": school_id,
                "snapshot_date": snapshot_date,
                "progress_id": row.get("id"),
                "student_id": row.get("student_id"),
                "course_id": row.get("course_id"),
                "module_id": row.get("module_id"),
                "lesson_id": row.get("lesson_id"),
                "watch_percentage": _to_float(row.get("watch_percentage")),
                "minutes_watched": round(_to_int(row.get("last_watched_position_seconds")) / 60),
                "lessons_completed": _to_int(row.get("lessons_completed")),
                "assignment_completion_percentage": _to_float(row.get("assignment_completion_percentage")),
                "course_completion_percentage": _to_float(row.get("course_completion_percentage")),
                "is_completed": bool(row.get("is_completed", False)),
                "metadata": row.get("metadata") if isinstance(row.get("metadata"), dict) else {},
            }
        )
    _upsert(WAREHOUSE_SCHEMA, "fact_lms", rows, on_conflict="school_id,progress_id")
    return rows


def _refresh_fact_live_classes(school_id: str) -> list[dict[str, Any]]:
    attendance_rows = _safe_list(ACADEMIC_SCHEMA, "live_class_attendance", school_id=school_id, is_active=True)
    sessions = {row.get("id"): row for row in _safe_list(ACADEMIC_SCHEMA, "live_class_sessions", school_id=school_id, is_active=True)}
    rows: list[dict[str, Any]] = []
    for row in attendance_rows:
        session = sessions.get(row.get("session_id"), {})
        snapshot_date = _iso_date(row.get("join_timestamp") or row.get("created_at"))
        attendance_pct = _to_float(row.get("attendance_percentage"))
        rows.append(
            {
                "school_id": school_id,
                "snapshot_date": snapshot_date,
                "attendance_id": row.get("id"),
                "session_id": row.get("session_id"),
                "student_id": row.get("student_id"),
                "course_id": session.get("course_id"),
                "total_duration_seconds": _to_int(row.get("total_duration_seconds")),
                "attendance_percentage": attendance_pct,
                "attendance_status": row.get("attendance_status") or "absent",
                "watch_completion_percentage": attendance_pct,
                "metadata": row.get("metadata") if isinstance(row.get("metadata"), dict) else {},
            }
        )
    _upsert(WAREHOUSE_SCHEMA, "fact_live_classes", rows, on_conflict="school_id,attendance_id")
    return rows


def _refresh_fact_operations(school_id: str, snapshot_date: str, memberships: list[dict[str, Any]]) -> list[dict[str, Any]]:
    _delete_snapshot_rows(WAREHOUSE_SCHEMA, "fact_operations", school_id=school_id, snapshot_date=snapshot_date)
    hostel_rooms = _safe_list(HOSTEL_SCHEMA, "hostel_rooms", school_id=school_id, is_active=True)
    material_items = _safe_list(INVENTORY_SCHEMA, "material_items", school_id=school_id, is_active=True)
    timetable_entries = _safe_list("scheduling", "timetable_entries", school_id=school_id)
    total_beds = sum(_to_int(row.get("total_beds")) for row in hostel_rooms)
    occupied_beds = sum(_to_int(row.get("occupied_beds")) for row in hostel_rooms)
    current_stock = sum(_to_float(row.get("current_stock")) for row in material_items)
    low_stock_items = len([row for row in material_items if _to_float(row.get("current_stock")) <= _to_float(row.get("low_stock_threshold"))])
    teacher_count = len([row for row in memberships if _normalize((row.get("role_id") or "")).lower()])
    rows = [
        {
            "school_id": school_id,
            "snapshot_date": snapshot_date,
            "metric_type": "hostel",
            "metric_key": "utilization",
            "metric_value": round((occupied_beds / total_beds) * 100, 2) if total_beds else 0,
            "quantity": occupied_beds,
            "metadata": {"total_beds": total_beds},
        },
        {
            "school_id": school_id,
            "snapshot_date": snapshot_date,
            "metric_type": "inventory",
            "metric_key": "current_stock",
            "metric_value": round(current_stock, 2),
            "quantity": len(material_items),
            "metadata": {"low_stock_items": low_stock_items},
        },
        {
            "school_id": school_id,
            "snapshot_date": snapshot_date,
            "metric_type": "staff",
            "metric_key": "workload",
            "metric_value": round((len(timetable_entries) / teacher_count), 2) if teacher_count else 0,
            "quantity": len(timetable_entries),
            "metadata": {"teacher_count": teacher_count},
        },
    ]
    _upsert(WAREHOUSE_SCHEMA, "fact_operations", rows, on_conflict="school_id,snapshot_date,metric_type,metric_key")
    return rows


def _refresh_fact_platform_usage(snapshot_date: str) -> list[dict[str, Any]]:
    _delete_snapshot_rows(WAREHOUSE_SCHEMA, "fact_platform_usage", snapshot_date=snapshot_date)
    schools = _safe_list(None, "schools")
    memberships = _safe_list(None, "school_memberships", is_active=True)
    progress_rows = _safe_list(LMS_SCHEMA, "student_progress", is_active=True)
    audit_logs = _safe_list(None, "audit_logs")
    rows: list[dict[str, Any]] = []
    active_users_by_school: dict[str, int] = defaultdict(int)
    for membership in memberships:
        school_id = _normalize(membership.get("school_id"))
        if school_id:
            active_users_by_school[school_id] += 1
    ai_modules = {"ai_tutor", "doubt_solver", "teacher_ai", "study_planner", "parent_intelligence"}
    ai_usage_by_school: dict[str, int] = defaultdict(int)
    lms_usage_by_school: dict[str, int] = defaultdict(int)
    recent_school_activity: dict[str, int] = defaultdict(int)
    thirty_days_ago = _today() - timedelta(days=30)
    for item in audit_logs:
        school_id = _normalize(item.get("school_id"))
        module_key = _normalize(item.get("module_key"))
        created_on = _iso_date(item.get("created_at"))
        if module_key in ai_modules:
            ai_usage_by_school[school_id] += 1
        if module_key == "lms":
            lms_usage_by_school[school_id] += 1
        if created_on >= thirty_days_ago.isoformat():
            recent_school_activity[school_id] += 1
    for school in schools:
        school_id = _normalize(school.get("id"))
        if not school_id:
            continue
        active_users = active_users_by_school.get(school_id, 0)
        ai_usage = ai_usage_by_school.get(school_id, 0)
        lms_usage = lms_usage_by_school.get(school_id, 0)
        churn_risk = 85 if recent_school_activity.get(school_id, 0) < 25 else 35
        rows.extend(
            [
                {
                    "snapshot_date": snapshot_date,
                    "school_id": school_id,
                    "scope_key": f"school:{school_id}",
                    "metric_type": "tenant",
                    "metric_key": "active_users",
                    "metric_value": float(active_users),
                    "quantity": active_users,
                    "metadata": {"school_name": school.get("name")},
                },
                {
                    "snapshot_date": snapshot_date,
                    "school_id": school_id,
                    "scope_key": f"school:{school_id}",
                    "metric_type": "ai",
                    "metric_key": "usage_events",
                    "metric_value": float(ai_usage),
                    "quantity": ai_usage,
                    "metadata": {},
                },
                {
                    "snapshot_date": snapshot_date,
                    "school_id": school_id,
                    "scope_key": f"school:{school_id}",
                    "metric_type": "lms",
                    "metric_key": "progress_events",
                    "metric_value": float(lms_usage),
                    "quantity": lms_usage,
                    "metadata": {},
                },
                {
                    "snapshot_date": snapshot_date,
                    "school_id": school_id,
                    "scope_key": f"school:{school_id}",
                    "metric_type": "tenant",
                    "metric_key": "churn_risk",
                    "metric_value": float(churn_risk),
                    "quantity": churn_risk,
                    "metadata": {},
                },
            ]
        )
    rows.extend(
        [
            {
                "snapshot_date": snapshot_date,
                "school_id": None,
                "scope_key": "platform",
                "metric_type": "tenant",
                "metric_key": "tenant_growth",
                "metric_value": float(len(schools)),
                "quantity": len(schools),
                "metadata": {},
            },
            {
                "snapshot_date": snapshot_date,
                "school_id": None,
                "scope_key": "platform",
                "metric_type": "lms",
                "metric_key": "usage_rows",
                "metric_value": float(len(progress_rows)),
                "quantity": len(progress_rows),
                "metadata": {},
            },
        ]
    )
    _upsert(WAREHOUSE_SCHEMA, "fact_platform_usage", rows, on_conflict="snapshot_date,scope_key,metric_type,metric_key")
    return rows


def _refresh_fact_students(
    school_id: str,
    snapshot_date: str,
    students: list[dict[str, Any]],
    attendance_rows: list[dict[str, Any]],
    test_rows: list[dict[str, Any]],
    lms_rows: list[dict[str, Any]],
    live_rows: list[dict[str, Any]],
    finance_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    _delete_snapshot_rows(WAREHOUSE_SCHEMA, "fact_students", school_id=school_id, snapshot_date=snapshot_date)
    attendance_summary: dict[str, dict[str, float]] = defaultdict(lambda: {"present": 0, "total": 0})
    for row in attendance_rows:
        if row.get("attendance_scope") != "student" or not row.get("student_id"):
            continue
        student_id = str(row["student_id"])
        attendance_summary[student_id]["present"] += _to_int(row.get("present_count")) + _to_int(row.get("late_count")) + _to_int(row.get("excused_count"))
        attendance_summary[student_id]["total"] += 1
    test_counts: dict[str, int] = defaultdict(int)
    lms_assignment_completion: dict[str, int] = defaultdict(int)
    live_counts: dict[str, int] = defaultdict(int)
    revenue_ltv: dict[str, float] = defaultdict(float)
    for row in test_rows:
        if row.get("student_id"):
            test_counts[str(row["student_id"])] += 1
    for row in lms_rows:
        if row.get("student_id") and _to_float(row.get("assignment_completion_percentage")) >= 100:
            lms_assignment_completion[str(row["student_id"])] += 1
    for row in live_rows:
        if row.get("student_id") and _normalize(row.get("attendance_status")) in {"present", "partial"}:
            live_counts[str(row["student_id"])] += 1
    for row in finance_rows:
        if row.get("student_id"):
            revenue_ltv[str(row["student_id"])] += _to_float(row.get("amount"))
    rows: list[dict[str, Any]] = []
    for student in students:
        student_id = _normalize(student.get("id"))
        if not student_id:
            continue
        attendance = attendance_summary[student_id]
        rows.append(
            {
                "school_id": school_id,
                "student_id": student_id,
                "snapshot_date": snapshot_date,
                "batch_id": student.get("batch_id"),
                "is_active": bool(student.get("is_active", True)),
                "hostel_required": bool(student.get("hostel_required", False)),
                "attendance_rate": round((attendance["present"] / attendance["total"]) * 100, 2) if attendance["total"] else 0,
                "tests_attempted_count": test_counts[student_id],
                "assignments_completed_count": lms_assignment_completion[student_id],
                "live_classes_attended_count": live_counts[student_id],
                "revenue_ltv": round(revenue_ltv[student_id], 2),
                "metadata": {"class_name": student.get("class_name"), "section": student.get("section")},
            }
        )
    _upsert(WAREHOUSE_SCHEMA, "fact_students", rows, on_conflict="school_id,student_id,snapshot_date")
    return rows


def refresh_school_warehouse(school_id: str, *, actor_profile_id: str | None = None) -> dict[str, Any]:
    start = time.perf_counter()
    _refresh_dim_date()
    _refresh_school_dimension(school_id)
    students = _refresh_student_dimension(school_id)
    memberships = _refresh_staff_dimension(school_id)
    _refresh_course_dimension(school_id)
    attendance_rows = _refresh_fact_attendance(school_id, _today().isoformat())
    test_rows = _refresh_fact_tests(school_id)
    finance_rows = _refresh_fact_finance(school_id)
    lms_rows = _refresh_fact_lms(school_id)
    live_rows = _refresh_fact_live_classes(school_id)
    operations_rows = _refresh_fact_operations(school_id, _today().isoformat(), memberships)
    student_rows = _refresh_fact_students(school_id, _today().isoformat(), students, attendance_rows, test_rows, lms_rows, live_rows, finance_rows)
    _log_audit_entry(
        school_id=school_id,
        profile_id=actor_profile_id,
        action="bi.warehouse.refresh_school",
        payload={
            "students": len(student_rows),
            "attendance": len(attendance_rows),
            "tests": len(test_rows),
            "finance": len(finance_rows),
            "lms": len(lms_rows),
            "live_classes": len(live_rows),
            "operations": len(operations_rows),
        },
    )
    elapsed = time.perf_counter() - start
    logger.info("REFRESH refresh_school_warehouse time=%.3fs", elapsed)
    return {"school_id": school_id, "snapshot_date": _today().isoformat()}


def refresh_platform_warehouse(*, actor_profile_id: str | None = None) -> dict[str, Any]:
    start = time.perf_counter()
    _refresh_dim_date()
    snapshot_date = _today().isoformat()
    rows = _refresh_fact_platform_usage(snapshot_date)
    _log_audit_entry(
        school_id=None,
        profile_id=actor_profile_id,
        action="bi.warehouse.refresh_platform",
        payload={"rows": len(rows), "snapshot_date": snapshot_date},
    )
    elapsed = time.perf_counter() - start
    logger.info("REFRESH refresh_platform_warehouse time=%.3fs", elapsed)
    return {"snapshot_date": snapshot_date, "rows": len(rows)}


def _latest_snapshot_rows(table: str, *, school_id: str | None = None) -> list[dict[str, Any]]:
    start = time.perf_counter()
    query = _warehouse_table(table).select("*").order("snapshot_date", desc=True).limit(400)
    if school_id is not None:
        query = query.eq("school_id", school_id)
    data = list(query.execute().data or [])
    elapsed = time.perf_counter() - start
    logger.info("latest  table=warehouse_%s rows=%d time=%.3fs", table, len(data), elapsed)
    return [dict(row) for row in data]


def _ensure_school_refresh(school_id: str, *, actor_profile_id: str | None = None) -> None:
    last_refresh = _school_last_refresh.get(school_id)
    if last_refresh and _utc_now() - last_refresh < _WAREHOUSE_TTL:
        return
    _school_last_refresh[school_id] = _utc_now()
    refresh_school_warehouse(school_id, actor_profile_id=actor_profile_id)


def _ensure_platform_refresh(*, actor_profile_id: str | None = None) -> None:
    global _platform_last_refresh
    if _platform_last_refresh and _utc_now() - _platform_last_refresh < _WAREHOUSE_TTL:
        return
    _platform_last_refresh = _utc_now()
    refresh_platform_warehouse(actor_profile_id=actor_profile_id)


def _bucket_key(snapshot_date: str, period: str) -> str:
    parsed = datetime.fromisoformat(f"{snapshot_date}T00:00:00+00:00").date()
    if period == "daily":
        return parsed.isoformat()
    if period == "weekly":
        return f"{parsed.isocalendar().year}-W{parsed.isocalendar().week:02d}"
    if period == "monthly":
        return f"{parsed.year}-{parsed.month:02d}"
    return str(parsed.year)


def _aggregate_rows(rows: list[dict[str, Any]], *, value_key: str, period: str) -> list[dict[str, Any]]:
    buckets: dict[str, float] = defaultdict(float)
    for row in rows:
        buckets[_bucket_key(_iso_date(row.get("snapshot_date")), period)] += _to_float(row.get(value_key))
    return [{"period": key, "value": round(value, 2)} for key, value in sorted(buckets.items())]


def get_academic_dashboard(school_id: str, *, period: str = "monthly", actor_profile_id: str | None = None) -> dict[str, Any]:
    total_start = time.perf_counter()
    _ensure_school_refresh(school_id, actor_profile_id=actor_profile_id)
    attendance = _latest_snapshot_rows("fact_attendance", school_id=school_id)
    tests = _latest_snapshot_rows("fact_tests", school_id=school_id)
    lms_rows = _latest_snapshot_rows("fact_lms", school_id=school_id)
    student_rows = _latest_snapshot_rows("fact_students", school_id=school_id)
    weak_topics: dict[str, int] = defaultdict(int)
    for row in tests:
        metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        for topic in list(metadata.get("weak_topics") or []):
            weak_topics[_normalize(topic)] += 1
    result = {
        "scope": "school",
        "school_id": school_id,
        "period": period,
        "attendance_trends": _aggregate_rows(attendance, value_key="attendance_percentage", period=period),
        "performance_trends": _aggregate_rows(tests, value_key="percentage", period=period),
        "completion_rates": _aggregate_rows(lms_rows, value_key="course_completion_percentage", period=period),
        "weak_topics": [{"topic": topic, "mentions": count} for topic, count in sorted(weak_topics.items(), key=lambda item: item[1], reverse=True)[:8] if topic],
        "student_count": len({row.get("student_id") for row in student_rows if row.get("student_id")}),
        "generated_at": _utc_now().isoformat(),
    }
    total_elapsed = time.perf_counter() - total_start
    logger.info("ENDPOINT get_academic_dashboard time=%.3fs", total_elapsed)
    return result


def get_finance_dashboard(school_id: str, *, period: str = "monthly", actor_profile_id: str | None = None) -> dict[str, Any]:
    total_start = time.perf_counter()
    _ensure_school_refresh(school_id, actor_profile_id=actor_profile_id)
    rows = _latest_snapshot_rows("fact_finance", school_id=school_id)
    subscriptions = [row for row in rows if _normalize(row.get("metric_type")) == "subscription"]
    orders = [row for row in rows if _normalize(row.get("metric_type")) == "order"]
    mrr = sum(_to_float(row.get("amount")) for row in subscriptions if _normalize(row.get("status")) == "active")
    arr = mrr * 12
    campus_revenue: dict[str, float] = defaultdict(float)
    school = _safe_list(WAREHOUSE_SCHEMA, "dim_school", school_id=school_id)
    campus_name = (school[0].get("campus_name") if school else None) or "Main Campus"
    campus_revenue[campus_name] = sum(_to_float(row.get("amount")) for row in orders)
    result = {
        "scope": "school",
        "school_id": school_id,
        "period": period,
        "revenue_trends": _aggregate_rows(orders, value_key="amount", period=period),
        "subscriptions": len(subscriptions),
        "mrr": round(mrr, 2),
        "arr": round(arr, 2),
        "campus_revenue": [{"campus_name": key, "revenue": round(value, 2)} for key, value in campus_revenue.items()],
        "generated_at": _utc_now().isoformat(),
    }
    total_elapsed = time.perf_counter() - total_start
    logger.info("ENDPOINT get_finance_dashboard time=%.3fs", total_elapsed)
    return result


def get_operations_dashboard(school_id: str, *, period: str = "monthly", actor_profile_id: str | None = None) -> dict[str, Any]:
    total_start = time.perf_counter()
    _ensure_school_refresh(school_id, actor_profile_id=actor_profile_id)
    rows = _latest_snapshot_rows("fact_operations", school_id=school_id)
    result = {
        "scope": "school",
        "school_id": school_id,
        "period": period,
        "hostel_utilization": next((_to_float(row.get("metric_value")) for row in rows if row.get("metric_type") == "hostel"), 0),
        "inventory_utilization": next((_to_float(row.get("metric_value")) for row in rows if row.get("metric_type") == "inventory"), 0),
        "staff_workload": next((_to_float(row.get("metric_value")) for row in rows if row.get("metric_type") == "staff"), 0),
        "operations_trends": _aggregate_rows(rows, value_key="metric_value", period=period),
        "generated_at": _utc_now().isoformat(),
    }
    total_elapsed = time.perf_counter() - total_start
    logger.info("ENDPOINT get_operations_dashboard time=%.3fs", total_elapsed)
    return result


def get_platform_dashboard(*, period: str = "monthly", actor_profile_id: str | None = None) -> dict[str, Any]:
    total_start = time.perf_counter()
    _ensure_platform_refresh(actor_profile_id=actor_profile_id)
    rows = _latest_snapshot_rows("fact_platform_usage")
    platform_rows = [row for row in rows if _normalize(row.get("scope_key")) == "platform"]
    school_rows = [row for row in rows if _normalize(row.get("scope_key")).startswith("school:")]
    result = {
        "scope": "platform",
        "period": period,
        "tenant_growth": next((_to_int(row.get("quantity")) for row in platform_rows if row.get("metric_key") == "tenant_growth"), 0),
        "ai_usage": sum(_to_int(row.get("quantity")) for row in school_rows if row.get("metric_type") == "ai"),
        "lms_usage": next((_to_int(row.get("quantity")) for row in platform_rows if row.get("metric_key") == "usage_rows"), 0),
        "active_users": sum(_to_int(row.get("quantity")) for row in school_rows if row.get("metric_key") == "active_users"),
        "churn_risk": round(sum(_to_float(row.get("metric_value")) for row in school_rows if row.get("metric_key") == "churn_risk") / max(len([row for row in school_rows if row.get("metric_key") == "churn_risk"]), 1), 2),
        "trends": _aggregate_rows(rows, value_key="quantity", period=period),
        "generated_at": _utc_now().isoformat(),
    }
    total_elapsed = time.perf_counter() - total_start
    logger.info("ENDPOINT get_platform_dashboard time=%.3fs", total_elapsed)
    return result


def list_saved_reports(school_id: str | None, *, actor_profile_id: str | None = None, include_platform: bool = False) -> list[dict[str, Any]]:
    start = time.perf_counter()
    query = _warehouse_table("report_definitions").select("*").order("created_at", desc=True)
    if school_id and not include_platform:
        query = query.eq("school_id", school_id)
    rows = [dict(row) for row in list(query.execute().data or [])]
    result = [row for row in rows if include_platform or _normalize(row.get("school_id")) == school_id or _normalize(row.get("created_by_profile_id")) == _normalize(actor_profile_id)]
    elapsed = time.perf_counter() - start
    logger.info("ENDPOINT list_saved_reports time=%.3fs rows=%d", elapsed, len(result))
    return result


def create_saved_report(
    school_id: str | None,
    *,
    actor_profile_id: str | None,
    report_name: str,
    dashboard_key: str,
    filters: dict[str, Any] | None,
    selected_metrics: list[str] | None,
    export_format: str,
    cadence: str | None = None,
) -> dict[str, Any]:
    payload = {
        "school_id": school_id,
        "created_by_profile_id": actor_profile_id,
        "report_name": report_name,
        "dashboard_key": dashboard_key,
        "filters": filters or {},
        "selected_metrics": selected_metrics or [],
        "export_format": export_format,
        "metadata": {},
    }
    response = _warehouse_table("report_definitions").insert(payload).execute()
    rows = [dict(row) for row in list(response.data or [])]
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to save report definition")
    saved = rows[0]
    if cadence:
        _warehouse_table("report_schedules").insert(
            {
                "school_id": school_id,
                "report_definition_id": saved.get("id"),
                "scheduled_by_profile_id": actor_profile_id,
                "cadence": cadence,
                "delivery_channel": "download",
                "next_run_at": (_utc_now() + timedelta(days=1)).isoformat(),
            }
        ).execute()
    _log_audit_entry(school_id=school_id, profile_id=actor_profile_id, action="bi.report.saved", payload={"report_id": saved.get("id"), "dashboard_key": dashboard_key})
    return saved


def export_dashboard_payload(dashboard_key: str, payload: dict[str, Any], *, school_id: str | None, actor_profile_id: str | None, export_format: str = "csv") -> dict[str, Any]:
    lines = ["metric,value"]
    for key, value in payload.items():
        if isinstance(value, (str, int, float)):
            lines.append(f"{key},{value}")
    csv_bytes = BytesIO("\n".join(lines).encode("utf-8"))
    generated = _schema_table(REPORTING_SCHEMA, "generated_reports").insert(
        {
            "school_id": school_id,
            "requested_by_profile_id": actor_profile_id,
            "module_key": MODULE_KEY,
            "report_key": dashboard_key,
            "export_format": "csv" if export_format not in {"pdf", "xlsx", "csv", "json"} else export_format,
            "status": "completed",
            "filters": {"dashboard_key": dashboard_key},
            "generated_at": _utc_now().isoformat(),
            "expires_at": (_utc_now() + timedelta(days=7)).isoformat(),
            "storage_bucket": "download",
            "storage_path": f"inline://{dashboard_key}-{_today().isoformat()}.csv",
        }
    ).execute()
    report_id = None
    if generated.data:
        report_id = generated.data[0].get("id")
    return {
        "report_id": report_id,
        "filename": f"{dashboard_key}-{_today().isoformat()}.csv",
        "content_type": "text/csv",
        "content": csv_bytes.getvalue().decode("utf-8"),
        "generated_at": _utc_now().isoformat(),
    }
