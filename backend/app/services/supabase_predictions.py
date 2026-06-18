"""Predictive intelligence layer backed strictly by warehouse facts."""

from __future__ import annotations

import logging
import time as _time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from statistics import mean
from typing import Any
from uuid import UUID

from fastapi import HTTPException

from app.services.supabase_admin import get_supabase_admin_client
from app.services.supabase_analytics import _get_student_by_profile_id
from app.services.supabase_bi import _ensure_school_refresh
from app.services.supabase_lms import _list_parent_linked_students

logger = logging.getLogger("predictions.performance")

WAREHOUSE_SCHEMA = "warehouse"
ANALYTICS_SCHEMA = "analytics"
MODULE_KEY = "predictions"


def _client():
    return get_supabase_admin_client()


def _public_table(name: str):
    return _client().table(name)


def _warehouse_table(name: str):
    return _public_table(f"warehouse_{name}")


def _schema_table(schema: str, name: str):
    return _client().schema(schema).table(name)


def _analytics_table(name: str):
    return _public_table(f"analytics_{name}")


def _normalize(value: Any) -> str:
    return str(value or "").strip()


def _normalize_optional_uuid(value: Any) -> str | None:
    text = _normalize(value)
    if not text:
        return None
    try:
        return str(UUID(text))
    except (TypeError, ValueError, AttributeError) as exc:
        raise HTTPException(status_code=400, detail="Expected a valid UUID value") from exc


def _normalize_json_object(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _normalize_json_list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _today() -> date:
    return _utc_now().date()


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


def _clamp(value: float, minimum: float = 0.0, maximum: float = 100.0) -> float:
    return round(max(minimum, min(maximum, value)), 2)


def _risk_level(score: float) -> str:
    if score >= 80:
        return "critical"
    if score >= 60:
        return "high"
    if score >= 35:
        return "medium"
    return "low"


def _confidence_score(signal_count: int, coverage: float) -> float:
    return _clamp(45 + (signal_count * 10) + (coverage * 20), 40, 95)


def _month_key(value: Any) -> str:
    text = _normalize(value)
    if not text:
        return _today().strftime("%Y-%m")
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).strftime("%Y-%m")
    except ValueError:
        return text[:7] or _today().strftime("%Y-%m")


def _safe_list(schema: str | None, table: str, select: str = "*", **filters: Any) -> list[dict[str, Any]]:
    try:
        if schema == WAREHOUSE_SCHEMA:
            query = _warehouse_table(table).select(select)
        else:
            query = (_schema_table(schema, table) if schema else _public_table(table)).select(select)
        for key, value in filters.items():
            if value is None:
                continue
            query = query.eq(key, value)
        return [dict(row) for row in list(query.execute().data or [])]
    except Exception:
        return []


def _upsert(schema: str, table: str, rows: list[dict[str, Any]], *, on_conflict: str) -> None:
    if not rows:
        return
    _schema_table(schema, table).upsert(rows, on_conflict=on_conflict).execute()


def _log_audit_entry(*, school_id: str | None, profile_id: str | None, action: str, payload: dict[str, Any] | None = None) -> None:
    try:
        _public_table("audit_logs").insert(
            {
                "school_id": _normalize_optional_uuid(school_id),
                "profile_id": _normalize_optional_uuid(profile_id),
                "action": action,
                "module_key": MODULE_KEY,
                "payload": payload or {},
            }
        ).execute()
    except Exception:
        return


def _seed_model_registry(school_id: str) -> dict[str, dict[str, Any]]:
    rows = [
        {
            "school_id": school_id,
            "model_key": "student_dropout_risk",
            "model_name": "Student Dropout Risk",
            "model_scope": "student",
            "model_type": "rule_based",
            "target_metric": "dropout_risk",
            "version": "v1",
            "status": "active",
            "feature_sources": ["warehouse.fact_students", "warehouse.fact_attendance", "warehouse.fact_tests", "warehouse.fact_lms", "warehouse.fact_live_classes"],
            "thresholds": {"medium": 35, "high": 60, "critical": 80},
            "confidence_notes": "Rule-based model calibrated from attendance, tests, LMS, and live-class engagement.",
            "last_run_at": _utc_now().isoformat(),
            "metadata": {"family": "student-risk"},
            "is_active": True,
        },
        {
            "school_id": school_id,
            "model_key": "student_attendance_risk",
            "model_name": "Student Attendance Risk",
            "model_scope": "student",
            "model_type": "rule_based",
            "target_metric": "attendance_risk",
            "version": "v1",
            "status": "active",
            "feature_sources": ["warehouse.fact_attendance", "warehouse.fact_live_classes"],
            "thresholds": {"medium": 35, "high": 60, "critical": 80},
            "confidence_notes": "Attendance and live class attendance percentages determine forward-looking risk.",
            "last_run_at": _utc_now().isoformat(),
            "metadata": {"family": "student-risk"},
            "is_active": True,
        },
        {
            "school_id": school_id,
            "model_key": "student_exam_failure_risk",
            "model_name": "Student Exam Failure Risk",
            "model_scope": "student",
            "model_type": "rule_based",
            "target_metric": "exam_failure_risk",
            "version": "v1",
            "status": "active",
            "feature_sources": ["warehouse.fact_tests", "warehouse.fact_lms"],
            "thresholds": {"medium": 35, "high": 60, "critical": 80},
            "confidence_notes": "Based on recent test averages, trend slope, and incomplete revision signals.",
            "last_run_at": _utc_now().isoformat(),
            "metadata": {"family": "student-risk"},
            "is_active": True,
        },
        {
            "school_id": school_id,
            "model_key": "student_engagement_decline",
            "model_name": "Student Engagement Decline",
            "model_scope": "student",
            "model_type": "rule_based",
            "target_metric": "engagement_decline_risk",
            "version": "v1",
            "status": "active",
            "feature_sources": ["warehouse.fact_lms", "warehouse.fact_live_classes", "warehouse.fact_students"],
            "thresholds": {"medium": 35, "high": 60, "critical": 80},
            "confidence_notes": "Course completion, watch rate, live attendance, and assignment completion act as engagement signals.",
            "last_run_at": _utc_now().isoformat(),
            "metadata": {"family": "student-risk"},
            "is_active": True,
        },
        {
            "school_id": school_id,
            "model_key": "parent_involvement_risk",
            "model_name": "Parent Involvement Risk",
            "model_scope": "parent",
            "model_type": "rule_based",
            "target_metric": "low_involvement_risk",
            "version": "v1",
            "status": "active",
            "feature_sources": ["warehouse.fact_students", "warehouse.fact_attendance", "warehouse.fact_tests"],
            "thresholds": {"medium": 30, "high": 55, "critical": 75},
            "confidence_notes": "Proxy model based on unresolved academic decline at cohort level.",
            "last_run_at": _utc_now().isoformat(),
            "metadata": {"family": "campus-risk"},
            "is_active": True,
        },
        {
            "school_id": school_id,
            "model_key": "teacher_workload_risk",
            "model_name": "Teacher Workload Risk",
            "model_scope": "teacher",
            "model_type": "rule_based",
            "target_metric": "workload_risk",
            "version": "v1",
            "status": "active",
            "feature_sources": ["warehouse.fact_operations", "warehouse.dim_staff"],
            "thresholds": {"medium": 35, "high": 60, "critical": 80},
            "confidence_notes": "Uses staff workload intensity and active staff count from warehouse operations facts.",
            "last_run_at": _utc_now().isoformat(),
            "metadata": {"family": "campus-risk"},
            "is_active": True,
        },
        {
            "school_id": school_id,
            "model_key": "hostel_capacity_forecast",
            "model_name": "Hostel Capacity Forecast",
            "model_scope": "hostel",
            "model_type": "statistical",
            "target_metric": "occupancy_forecast",
            "version": "v1",
            "status": "active",
            "feature_sources": ["warehouse.fact_operations", "warehouse.fact_students"],
            "thresholds": {"medium": 70, "high": 85, "critical": 95},
            "confidence_notes": "Rolling-average occupancy forecast from hostel utilization and hostel-required student growth.",
            "last_run_at": _utc_now().isoformat(),
            "metadata": {"family": "campus-forecast"},
            "is_active": True,
        },
        {
            "school_id": school_id,
            "model_key": "fee_default_prediction",
            "model_name": "Fee Default Prediction",
            "model_scope": "finance",
            "model_type": "statistical",
            "target_metric": "fee_default_risk",
            "version": "v1",
            "status": "active",
            "feature_sources": ["warehouse.fact_finance"],
            "thresholds": {"medium": 25, "high": 45, "critical": 65},
            "confidence_notes": "Pending and failed finance events are smoothed into monthly default risk forecasts.",
            "last_run_at": _utc_now().isoformat(),
            "metadata": {"family": "finance-forecast"},
            "is_active": True,
        },
        {
            "school_id": school_id,
            "model_key": "revenue_forecast",
            "model_name": "Revenue Forecast",
            "model_scope": "finance",
            "model_type": "statistical",
            "target_metric": "revenue_forecast",
            "version": "v1",
            "status": "active",
            "feature_sources": ["warehouse.fact_finance"],
            "thresholds": {"medium": 35, "high": 60, "critical": 80},
            "confidence_notes": "Trailing monthly revenue averages and recent trend deltas produce short-horizon forecasts.",
            "last_run_at": _utc_now().isoformat(),
            "metadata": {"family": "finance-forecast"},
            "is_active": True,
        },
        {
            "school_id": school_id,
            "model_key": "campus_growth_forecast",
            "model_name": "Campus Growth Forecast",
            "model_scope": "campus",
            "model_type": "statistical",
            "target_metric": "admission_forecast",
            "version": "v1",
            "status": "active",
            "feature_sources": ["warehouse.fact_students"],
            "thresholds": {"medium": 30, "high": 50, "critical": 70},
            "confidence_notes": "Uses monthly active-student movement as a proxy for admissions and growth momentum.",
            "last_run_at": _utc_now().isoformat(),
            "metadata": {"family": "campus-forecast"},
            "is_active": True,
        },
    ]
    _analytics_table("model_registry").upsert(rows, on_conflict="school_id,model_key,version").execute()
    registry_rows = [
        dict(row) for row in list(
            _analytics_table("model_registry")
            .select("id,school_id,model_key,model_name,model_scope,model_type,target_metric,version,status,confidence_notes,last_run_at,feature_sources,thresholds")
            .eq("school_id", school_id)
            .eq("is_active", True)
            .execute()
            .data or []
        )
    ]
    return {str(row.get("model_key")): dict(row) for row in registry_rows if row.get("model_key")}


def _load_students(school_id: str, student_ids: list[str] | None = None) -> list[dict[str, Any]]:
    query = (
        _warehouse_table("dim_student")
        .select("student_id,profile_id,full_name,class_name,section,batch_id,hostel_required")
        .eq("school_id", school_id)
        .eq("is_active", True)
    )
    if student_ids:
        query = query.in_("student_id", student_ids)
    return [dict(row) for row in list(query.execute().data or [])]


def _load_staff(school_id: str) -> list[dict[str, Any]]:
    return _safe_list(
        WAREHOUSE_SCHEMA,
        "dim_staff",
        "profile_id,role_key,full_name,is_active",
        school_id=school_id,
        is_active=True,
    )


def _load_fact_rows(school_id: str, table: str, select: str, *, days: int) -> list[dict[str, Any]]:
    start_date = (_today() - timedelta(days=max(days, 1) - 1)).isoformat()
    query = (
        _warehouse_table(table)
        .select(select)
        .eq("school_id", school_id)
        .gte("snapshot_date", start_date)
    )
    return [dict(row) for row in list(query.execute().data or [])]


def _monthly_series(rows: list[dict[str, Any]], *, value_getter) -> list[tuple[str, float]]:
    buckets: dict[str, list[float]] = defaultdict(list)
    for row in rows:
        buckets[_month_key(row.get("snapshot_date"))].append(value_getter(row))
    series = [(month, round(sum(values), 2)) for month, values in buckets.items()]
    return sorted(series, key=lambda item: item[0])


def _series_delta(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    return round(values[-1] - values[-2], 2)


def _moving_average(values: list[float], window: int = 3) -> float:
    if not values:
        return 0.0
    usable = values[-window:] if len(values) >= window else values
    return round(sum(usable) / max(len(usable), 1), 2)


def _forecast_points(series: list[tuple[str, float]], months: int = 3) -> list[dict[str, Any]]:
    values = [value for _, value in series]
    baseline = _moving_average(values, 3)
    delta = _series_delta(values)
    current_date = _today().replace(day=1)
    points: list[dict[str, Any]] = []
    for index in range(1, months + 1):
        period_start = date(current_date.year + ((current_date.month - 1 + index) // 12), ((current_date.month - 1 + index) % 12) + 1, 1)
        forecast_value = _clamp(baseline + (delta * index), 0, 100000000)
        spread = max(abs(delta) * 0.5, max(forecast_value * 0.05, 1.0))
        points.append(
            {
                "period": period_start.strftime("%Y-%m"),
                "period_start": period_start.isoformat(),
                "period_end": (period_start + timedelta(days=27)).isoformat(),
                "forecast_value": forecast_value,
                "lower_bound": round(max(forecast_value - spread, 0), 2),
                "upper_bound": round(forecast_value + spread, 2),
            }
        )
    return points


def _build_student_prediction(
    student: dict[str, Any],
    *,
    attendance_rows: list[dict[str, Any]],
    test_rows: list[dict[str, Any]],
    lms_rows: list[dict[str, Any]],
    live_rows: list[dict[str, Any]],
    latest_fact_row: dict[str, Any] | None,
    registry: dict[str, dict[str, Any]],
    school_id: str,
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    student_id = _normalize(student.get("student_id"))
    attendance_values = [_safe_float(row.get("attendance_percentage")) for row in attendance_rows]
    test_values = [_safe_float(row.get("percentage")) for row in test_rows]
    watch_values = [_safe_float(row.get("watch_percentage")) for row in lms_rows]
    completion_values = [_safe_float(row.get("course_completion_percentage")) for row in lms_rows]
    assignment_values = [_safe_float(row.get("assignment_completion_percentage")) for row in lms_rows]
    live_values = [_safe_float(row.get("attendance_percentage")) for row in live_rows]

    attendance_avg = round(mean(attendance_values), 2) if attendance_values else _safe_float((latest_fact_row or {}).get("attendance_rate"))
    test_avg = round(mean(test_values), 2) if test_values else 0.0
    watch_avg = round(mean(watch_values), 2) if watch_values else 0.0
    completion_avg = round(mean(completion_values), 2) if completion_values else 0.0
    assignment_avg = round(mean(assignment_values), 2) if assignment_values else 0.0
    live_avg = round(mean(live_values), 2) if live_values else 0.0
    test_delta = _series_delta(test_values)
    signal_count = len([value for value in [attendance_avg, test_avg, watch_avg, completion_avg, live_avg] if value > 0])
    coverage = signal_count / 5

    dropout_score = _clamp((100 - attendance_avg) * 0.35 + (100 - test_avg) * 0.25 + (100 - completion_avg) * 0.2 + (100 - live_avg) * 0.2)
    attendance_score = _clamp((100 - attendance_avg) * 0.7 + (100 - live_avg) * 0.3)
    exam_failure_score = _clamp((100 - test_avg) * 0.65 + max(-test_delta, 0) * 1.5 + (100 - assignment_avg) * 0.2)
    engagement_score = _clamp((100 - watch_avg) * 0.35 + (100 - completion_avg) * 0.3 + (100 - assignment_avg) * 0.2 + (100 - live_avg) * 0.15)
    overall_score = _clamp(max(dropout_score, attendance_score, exam_failure_score, engagement_score) * 0.6 + mean([dropout_score, attendance_score, exam_failure_score, engagement_score]) * 0.4)
    confidence = _confidence_score(signal_count, coverage)

    factors: list[str] = []
    actions: list[str] = []
    if attendance_avg < 75:
        factors.append(f"Attendance trend is {attendance_avg:.1f}% over the recent warehouse window.")
        actions.append("Trigger attendance follow-up and counselor check-in.")
    if test_avg < 55:
        factors.append(f"Recent test average is {test_avg:.1f}%, which signals exam-failure risk.")
        actions.append("Assign targeted revision tests for weak subjects.")
    if completion_avg < 60:
        factors.append(f"LMS completion is only {completion_avg:.1f}%, showing low learning continuity.")
        actions.append("Push adaptive study-plan tasks for incomplete chapters.")
    if live_avg < 70:
        factors.append(f"Live class participation is {live_avg:.1f}%, indicating engagement decline.")
        actions.append("Notify class teacher to follow up on live-class attendance.")
    if test_delta < -8:
        factors.append(f"Recent test trajectory dropped by {abs(test_delta):.1f} points from the prior period.")
        actions.append("Schedule teacher review before the next assessment.")
    if not actions:
        actions.append("Continue the current study rhythm and monitor the next assessment window.")

    prediction_definitions = [
        ("dropout_risk", "student_dropout_risk", dropout_score, "Student has an elevated risk of disengaging from the academic journey."),
        ("attendance_risk", "student_attendance_risk", attendance_score, "Attendance is likely to move below the healthy threshold if no intervention is made."),
        ("exam_failure_risk", "student_exam_failure_risk", exam_failure_score, "Test performance signals a possible drop below passing expectations."),
        ("engagement_decline_risk", "student_engagement_decline", engagement_score, "Learning engagement is softening across LMS and live-class channels."),
    ]

    prediction_rows: list[dict[str, Any]] = []
    risk_rows: list[dict[str, Any]] = []
    serialized_predictions: list[dict[str, Any]] = []
    for prediction_type, model_key, score, message in prediction_definitions:
        model = registry.get(model_key, {})
        level = _risk_level(score)
        recommendation_set = actions[:2] if level in {"high", "critical"} else actions[:1]
        row = {
            "school_id": school_id,
            "subject_type": "student",
            "subject_key": student_id,
            "subject_id": student_id,
            "model_registry_id": model.get("id"),
            "prediction_type": prediction_type,
            "risk_level": level,
            "probability": score,
            "confidence_score": confidence,
            "horizon_days": 30,
            "predicted_for_date": (_today() + timedelta(days=30)).isoformat(),
            "headline": f"{student.get('full_name') or 'Student'}: {prediction_type.replace('_', ' ').title()}",
            "explanation": message,
            "recommended_actions": recommendation_set,
            "warnings": factors[:3],
            "feature_snapshot": {
                "attendance_avg": attendance_avg,
                "test_avg": test_avg,
                "test_delta": test_delta,
                "completion_avg": completion_avg,
                "assignment_avg": assignment_avg,
                "live_avg": live_avg,
            },
            "generated_at": _utc_now().isoformat(),
            "metadata": {"model_key": model_key},
            "is_active": True,
        }
        prediction_rows.append(row)
        risk_rows.append(
            {
                "school_id": school_id,
                "scope_type": "student",
                "scope_key": student_id,
                "scope_id": student_id,
                "risk_type": prediction_type,
                "risk_level": level,
                "score": score,
                "probability": score,
                "confidence_score": confidence,
                "contributing_factors": factors[:4],
                "automated_actions": recommendation_set,
                "generated_at": _utc_now().isoformat(),
                "metadata": {"model_key": model_key},
                "is_active": True,
            }
        )
        serialized_predictions.append(
            {
                "prediction_type": prediction_type,
                "risk_level": level,
                "score": score,
                "confidence_score": confidence,
                "headline": row["headline"],
                "explanation": row["explanation"],
                "recommended_actions": recommendation_set,
                "contributing_factors": factors[:4],
                "model_key": model_key,
                "model_type": _normalize(model.get("model_type")) or "rule_based",
                "predicted_for_date": row["predicted_for_date"],
            }
        )

    summary = {
        "student_id": student_id,
        "student_name": student.get("full_name") or "Student",
        "class_name": student.get("class_name"),
        "section": student.get("section"),
        "overall_risk_score": overall_score,
        "overall_risk_level": _risk_level(overall_score),
        "dropout_risk": dropout_score,
        "attendance_risk": attendance_score,
        "exam_failure_risk": exam_failure_score,
        "engagement_decline_risk": engagement_score,
        "confidence_score": confidence,
        "attendance_average": attendance_avg,
        "test_average": test_avg,
        "engagement_average": round(mean([watch_avg, completion_avg, assignment_avg, live_avg]) if any([watch_avg, completion_avg, assignment_avg, live_avg]) else 0, 2),
        "top_factors": factors[:4],
        "recommended_actions": actions[:3],
        "predictions": serialized_predictions,
    }
    return summary, prediction_rows, risk_rows


def _role_key(role_key: str | None) -> str:
    return _normalize(role_key).lower()


def _resolve_student_scope(
    school_id: str,
    *,
    role_key: str | None,
    profile_id: str | None,
    user_email: str | None,
    requested_student_id: str | None,
) -> list[str]:
    normalized_role = _role_key(role_key)
    requested = _normalize(requested_student_id)
    if normalized_role == "student":
        if not profile_id:
            raise HTTPException(status_code=403, detail="Student profile context is missing")
        return [_normalize(_get_student_by_profile_id(school_id, profile_id).get("id"))]
    if normalized_role == "parent":
        linked_students = _list_parent_linked_students(school_id, profile_id, user_email)
        linked_ids = [_normalize(row.get("id")) for row in linked_students if _normalize(row.get("id"))]
        if requested:
            if requested not in linked_ids:
                raise HTTPException(status_code=403, detail="Requested student is not linked to this parent")
            return [requested]
        return linked_ids
    if requested:
        return [requested]
    return []


def get_student_predictions_dashboard(
    school_id: str,
    *,
    role_key: str | None,
    profile_id: str | None,
    user_email: str | None,
    requested_student_id: str | None = None,
    limit: int = 20,
    actor_profile_id: str | None = None,
) -> dict[str, Any]:
    _t0 = _time.time()
    _ensure_school_refresh(school_id, actor_profile_id=actor_profile_id)
    registry = _seed_model_registry(school_id)
    scoped_ids = _resolve_student_scope(
        school_id,
        role_key=role_key,
        profile_id=profile_id,
        user_email=user_email,
        requested_student_id=requested_student_id,
    )

    students = _load_students(school_id, scoped_ids or None)
    if scoped_ids:
        students = [row for row in students if _normalize(row.get("student_id")) in scoped_ids]
    students = students[: max(1, min(limit, 100))]

    student_rows = _load_fact_rows(school_id, "fact_students", "student_id,snapshot_date,attendance_rate,assignments_completed_count,live_classes_attended_count", days=90)
    attendance_rows = _load_fact_rows(school_id, "fact_attendance", "student_id,snapshot_date,attendance_percentage", days=90)
    test_rows = _load_fact_rows(school_id, "fact_tests", "student_id,snapshot_date,percentage", days=90)
    lms_rows = _load_fact_rows(school_id, "fact_lms", "student_id,snapshot_date,watch_percentage,course_completion_percentage,assignment_completion_percentage", days=90)
    live_rows = _load_fact_rows(school_id, "fact_live_classes", "student_id,snapshot_date,attendance_percentage", days=90)

    latest_student_fact: dict[str, dict[str, Any]] = {}
    for row in student_rows:
        student_id = _normalize(row.get("student_id"))
        if not student_id:
            continue
        previous = latest_student_fact.get(student_id)
        if previous is None or _normalize(row.get("snapshot_date")) > _normalize(previous.get("snapshot_date")):
            latest_student_fact[student_id] = row

    attendance_by_student: dict[str, list[dict[str, Any]]] = defaultdict(list)
    tests_by_student: dict[str, list[dict[str, Any]]] = defaultdict(list)
    lms_by_student: dict[str, list[dict[str, Any]]] = defaultdict(list)
    live_by_student: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for row in attendance_rows:
        attendance_by_student[_normalize(row.get("student_id"))].append(row)
    for row in test_rows:
        tests_by_student[_normalize(row.get("student_id"))].append(row)
    for row in lms_rows:
        lms_by_student[_normalize(row.get("student_id"))].append(row)
    for row in live_rows:
        live_by_student[_normalize(row.get("student_id"))].append(row)

    prediction_rows: list[dict[str, Any]] = []
    risk_rows: list[dict[str, Any]] = []
    students_payload: list[dict[str, Any]] = []
    for student in students:
        summary, student_prediction_rows, student_risk_rows = _build_student_prediction(
            student,
            attendance_rows=attendance_by_student.get(_normalize(student.get("student_id")), []),
            test_rows=tests_by_student.get(_normalize(student.get("student_id")), []),
            lms_rows=lms_by_student.get(_normalize(student.get("student_id")), []),
            live_rows=live_by_student.get(_normalize(student.get("student_id")), []),
            latest_fact_row=latest_student_fact.get(_normalize(student.get("student_id"))),
            registry=registry,
            school_id=school_id,
        )
        students_payload.append(summary)
        prediction_rows.extend(student_prediction_rows)
        risk_rows.extend(student_risk_rows)

    _analytics_table("predictions").upsert(prediction_rows, on_conflict="school_id,prediction_type,subject_type,subject_key,predicted_for_date").execute()
    _analytics_table("risk_scores").upsert(risk_rows, on_conflict="school_id,scope_type,scope_key,risk_type").execute()

    early_warnings = [
        f"{item['student_name']} has {item['overall_risk_score']:.1f}% predicted academic risk with {item['overall_risk_level']} severity."
        for item in students_payload
        if item["overall_risk_level"] in {"high", "critical"}
    ][:5]
    automated_actions = sorted({action for item in students_payload for action in item.get("recommended_actions", [])})[:6]
    _log_audit_entry(
        school_id=school_id,
        profile_id=actor_profile_id,
        action="predictions.student.viewed",
        payload={"student_count": len(students_payload), "requested_student_id": requested_student_id},
    )
    _elapsed = _time.time() - _t0
    logger.info("PREDICTIONS student school=%s time=%.3fs", school_id, _elapsed)
    return {
        "scope": "student",
        "school_id": school_id,
        "generated_at": _utc_now().isoformat(),
        "students": students_payload,
        "early_warnings": early_warnings,
        "automated_actions": automated_actions,
        "model_registry": list(registry.values()),
    }


def get_campus_predictions_dashboard(
    school_id: str,
    *,
    actor_profile_id: str | None = None,
) -> dict[str, Any]:
    _t0 = _time.time()
    _ensure_school_refresh(school_id, actor_profile_id=actor_profile_id)
    registry = _seed_model_registry(school_id)

    student_facts = _load_fact_rows(school_id, "fact_students", "student_id,snapshot_date,hostel_required", days=365)
    operation_facts = _load_fact_rows(school_id, "fact_operations", "snapshot_date,metric_type,metric_key,metric_value,quantity", days=365)
    staff_rows = _load_staff(school_id)

    monthly_student_series = _monthly_series(student_facts, value_getter=lambda row: 1.0)
    monthly_hostel_series = _monthly_series(
        [row for row in student_facts if bool(row.get("hostel_required"))],
        value_getter=lambda row: 1.0,
    )
    staff_workload_values = [
        _safe_float(row.get("metric_value"))
        for row in operation_facts
        if _normalize(row.get("metric_key")) == "staff_workload"
    ]
    hostel_utilization_values = [
        _safe_float(row.get("metric_value"))
        for row in operation_facts
        if _normalize(row.get("metric_key")) == "hostel_utilization"
    ]

    admissions_forecast = _forecast_points(monthly_student_series, 3)
    hostel_forecast = _forecast_points(monthly_hostel_series, 3)
    parent_risk_score = _clamp(100 - (_moving_average([value for _, value in monthly_student_series], 3) / max(len(staff_rows), 1)))
    teacher_workload_score = _clamp(mean(staff_workload_values) if staff_workload_values else 35)
    hostel_capacity_score = _clamp(mean(hostel_utilization_values) if hostel_utilization_values else (hostel_forecast[0]["forecast_value"] if hostel_forecast else 0))

    risk_items = [
        {
            "risk_type": "admission_growth_risk",
            "risk_level": _risk_level(_clamp(max(-_series_delta([value for _, value in monthly_student_series]), 0) * 4)),
            "score": _clamp(max(-_series_delta([value for _, value in monthly_student_series]), 0) * 4),
            "confidence_score": _confidence_score(3, 0.75),
            "headline": "Campus admission momentum risk",
            "explanation": "If the monthly active-student trend keeps flattening, the next admission cycle can soften.",
            "recommended_actions": ["Launch admissions outreach for the weakest classes.", "Review monthly conversion and inquiry follow-ups."],
        },
        {
            "risk_type": "teacher_workload_risk",
            "risk_level": _risk_level(teacher_workload_score),
            "score": teacher_workload_score,
            "confidence_score": _confidence_score(2, 0.5),
            "headline": "Teacher workload pressure",
            "explanation": "Operations facts show concentrated workload that can lead to burnout indicators.",
            "recommended_actions": ["Rebalance teaching slots in the next timetable cycle.", "Review faculty coverage for high-load subjects."],
        },
        {
            "risk_type": "parent_involvement_risk",
            "risk_level": _risk_level(parent_risk_score),
            "score": parent_risk_score,
            "confidence_score": _confidence_score(2, 0.45),
            "headline": "Parent involvement needs attention",
            "explanation": "Cohort-level academic drift suggests more proactive communication may be required.",
            "recommended_actions": ["Push parent alerts for at-risk students.", "Schedule targeted PTM follow-ups."],
        },
        {
            "risk_type": "hostel_capacity_risk",
            "risk_level": _risk_level(hostel_capacity_score),
            "score": hostel_capacity_score,
            "confidence_score": _confidence_score(2, 0.55),
            "headline": "Hostel occupancy pressure forecast",
            "explanation": "Hostel-required student growth and utilization trends suggest capacity pressure ahead.",
            "recommended_actions": ["Review hostel room turnover and vacancy pipeline.", "Prepare allocation buffer for the next intake window."],
        },
    ]

    prediction_rows = [
        {
            "school_id": school_id,
            "subject_type": "campus",
            "subject_key": school_id,
            "subject_id": school_id,
            "model_registry_id": registry.get("campus_growth_forecast", {}).get("id"),
            "prediction_type": item["risk_type"],
            "risk_level": item["risk_level"],
            "probability": item["score"],
            "confidence_score": item["confidence_score"],
            "horizon_days": 90,
            "predicted_for_date": (_today() + timedelta(days=90)).isoformat(),
            "headline": item["headline"],
            "explanation": item["explanation"],
            "recommended_actions": item["recommended_actions"],
            "warnings": [],
            "feature_snapshot": {"student_monthly_series": monthly_student_series[-6:], "hostel_monthly_series": monthly_hostel_series[-6:]},
            "generated_at": _utc_now().isoformat(),
            "metadata": {"scope": "campus"},
            "is_active": True,
        }
        for item in risk_items
    ]
    risk_rows = [
        {
            "school_id": school_id,
            "scope_type": "campus",
            "scope_key": school_id,
            "scope_id": school_id,
            "risk_type": item["risk_type"],
            "risk_level": item["risk_level"],
            "score": item["score"],
            "probability": item["score"],
            "confidence_score": item["confidence_score"],
            "contributing_factors": [item["explanation"]],
            "automated_actions": item["recommended_actions"],
            "generated_at": _utc_now().isoformat(),
            "metadata": {"scope": "campus"},
            "is_active": True,
        }
        for item in risk_items
    ]
    forecast_rows = []
    for point in admissions_forecast:
        forecast_rows.append(
            {
                "school_id": school_id,
                "scope_type": "campus",
                "scope_key": school_id,
                "scope_id": school_id,
                "forecast_type": "admissions",
                "model_registry_id": registry.get("campus_growth_forecast", {}).get("id"),
                "period_key": point["period"],
                "period_start": point["period_start"],
                "period_end": point["period_end"],
                "forecast_value": point["forecast_value"],
                "lower_bound": point["lower_bound"],
                "upper_bound": point["upper_bound"],
                "confidence_score": 72,
                "driver_snapshot": {"monthly_series": monthly_student_series[-6:]},
                "generated_at": _utc_now().isoformat(),
                "metadata": {"scope": "admissions"},
                "is_active": True,
            }
        )
    for point in hostel_forecast:
        forecast_rows.append(
            {
                "school_id": school_id,
                "scope_type": "hostel",
                "scope_key": school_id,
                "scope_id": school_id,
                "forecast_type": "occupancy",
                "model_registry_id": registry.get("hostel_capacity_forecast", {}).get("id"),
                "period_key": point["period"],
                "period_start": point["period_start"],
                "period_end": point["period_end"],
                "forecast_value": point["forecast_value"],
                "lower_bound": point["lower_bound"],
                "upper_bound": point["upper_bound"],
                "confidence_score": 70,
                "driver_snapshot": {"monthly_series": monthly_hostel_series[-6:]},
                "generated_at": _utc_now().isoformat(),
                "metadata": {"scope": "hostel"},
                "is_active": True,
            }
        )

    _analytics_table("predictions").upsert(prediction_rows, on_conflict="school_id,prediction_type,subject_type,subject_key,predicted_for_date").execute()
    _analytics_table("risk_scores").upsert(risk_rows, on_conflict="school_id,scope_type,scope_key,risk_type").execute()
    _analytics_table("forecasts").upsert(forecast_rows, on_conflict="school_id,scope_type,scope_key,forecast_type,period_key").execute()
    _log_audit_entry(school_id=school_id, profile_id=actor_profile_id, action="predictions.campus.viewed", payload={"forecast_count": len(forecast_rows)})
    _elapsed = _time.time() - _t0
    logger.info("PREDICTIONS campus school=%s time=%.3fs", school_id, _elapsed)
    return {
        "scope": "campus",
        "school_id": school_id,
        "generated_at": _utc_now().isoformat(),
        "risk_overview": risk_items,
        "admissions_forecast": admissions_forecast,
        "hostel_forecast": hostel_forecast,
        "active_staff_count": len(staff_rows),
        "model_registry": list(registry.values()),
        "automated_actions": sorted({action for item in risk_items for action in item["recommended_actions"]})[:6],
    }


def get_finance_predictions_dashboard(
    school_id: str,
    *,
    actor_profile_id: str | None = None,
) -> dict[str, Any]:
    _t0 = _time.time()
    _ensure_school_refresh(school_id, actor_profile_id=actor_profile_id)
    registry = _seed_model_registry(school_id)

    finance_rows = _load_fact_rows(school_id, "fact_finance", "snapshot_date,metric_type,status,amount,quantity", days=365)
    revenue_rows = [row for row in finance_rows if _safe_float(row.get("amount")) > 0]
    monthly_revenue = _monthly_series(revenue_rows, value_getter=lambda row: _safe_float(row.get("amount")))
    pending_rows = [row for row in finance_rows if _normalize(row.get("status")).lower() in {"pending", "failed", "overdue"}]
    monthly_defaults = _monthly_series(pending_rows, value_getter=lambda row: _safe_float(row.get("amount")) or float(_safe_int(row.get("quantity"))))

    total_revenue = sum(value for _, value in monthly_revenue)
    total_pending = sum(value for _, value in monthly_defaults)
    default_risk_score = _clamp((total_pending / total_revenue) * 100 if total_revenue > 0 else 0)
    revenue_delta = _series_delta([value for _, value in monthly_revenue])
    revenue_risk_score = _clamp(max(-revenue_delta, 0) * 2)

    revenue_forecast = _forecast_points(monthly_revenue, 3)
    default_forecast = _forecast_points(monthly_defaults, 3)

    risk_overview = [
        {
            "risk_type": "fee_default_risk",
            "risk_level": _risk_level(default_risk_score),
            "score": default_risk_score,
            "confidence_score": _confidence_score(2, 0.55),
            "headline": "Fee payment delay risk detected",
            "explanation": "Pending and failed collection events in the warehouse are above the expected healthy band.",
            "recommended_actions": ["Trigger fee reminders for pending accounts.", "Escalate overdue collections to admin office."],
        },
        {
            "risk_type": "revenue_forecast_risk",
            "risk_level": _risk_level(revenue_risk_score),
            "score": revenue_risk_score,
            "confidence_score": _confidence_score(2, 0.5),
            "headline": "Revenue momentum is softening",
            "explanation": "Trailing revenue trend shows a slowdown compared with the prior monthly window.",
            "recommended_actions": ["Review expiring subscriptions and renewals.", "Push targeted offers for paid courses and test series."],
        },
    ]

    prediction_rows = [
        {
            "school_id": school_id,
            "subject_type": "finance",
            "subject_key": school_id,
            "subject_id": school_id,
            "model_registry_id": registry.get("fee_default_prediction", {}).get("id") if item["risk_type"] == "fee_default_risk" else registry.get("revenue_forecast", {}).get("id"),
            "prediction_type": item["risk_type"],
            "risk_level": item["risk_level"],
            "probability": item["score"],
            "confidence_score": item["confidence_score"],
            "horizon_days": 90,
            "predicted_for_date": (_today() + timedelta(days=90)).isoformat(),
            "headline": item["headline"],
            "explanation": item["explanation"],
            "recommended_actions": item["recommended_actions"],
            "warnings": [],
            "feature_snapshot": {"monthly_revenue": monthly_revenue[-6:], "monthly_defaults": monthly_defaults[-6:]},
            "generated_at": _utc_now().isoformat(),
            "metadata": {"scope": "finance"},
            "is_active": True,
        }
        for item in risk_overview
    ]
    risk_rows = [
        {
            "school_id": school_id,
            "scope_type": "finance",
            "scope_key": school_id,
            "scope_id": school_id,
            "risk_type": item["risk_type"],
            "risk_level": item["risk_level"],
            "score": item["score"],
            "probability": item["score"],
            "confidence_score": item["confidence_score"],
            "contributing_factors": [item["explanation"]],
            "automated_actions": item["recommended_actions"],
            "generated_at": _utc_now().isoformat(),
            "metadata": {"scope": "finance"},
            "is_active": True,
        }
        for item in risk_overview
    ]
    forecast_rows = []
    for point in revenue_forecast:
        forecast_rows.append(
            {
                "school_id": school_id,
                "scope_type": "finance",
                "scope_key": school_id,
                "scope_id": school_id,
                "forecast_type": "revenue",
                "model_registry_id": registry.get("revenue_forecast", {}).get("id"),
                "period_key": point["period"],
                "period_start": point["period_start"],
                "period_end": point["period_end"],
                "forecast_value": point["forecast_value"],
                "lower_bound": point["lower_bound"],
                "upper_bound": point["upper_bound"],
                "confidence_score": 74,
                "driver_snapshot": {"monthly_revenue": monthly_revenue[-6:]},
                "generated_at": _utc_now().isoformat(),
                "metadata": {"scope": "revenue"},
                "is_active": True,
            }
        )
    for point in default_forecast:
        forecast_rows.append(
            {
                "school_id": school_id,
                "scope_type": "finance",
                "scope_key": school_id,
                "scope_id": school_id,
                "forecast_type": "fee_default",
                "model_registry_id": registry.get("fee_default_prediction", {}).get("id"),
                "period_key": point["period"],
                "period_start": point["period_start"],
                "period_end": point["period_end"],
                "forecast_value": point["forecast_value"],
                "lower_bound": point["lower_bound"],
                "upper_bound": point["upper_bound"],
                "confidence_score": 71,
                "driver_snapshot": {"monthly_defaults": monthly_defaults[-6:]},
                "generated_at": _utc_now().isoformat(),
                "metadata": {"scope": "default"},
                "is_active": True,
            }
        )

    _analytics_table("predictions").upsert(prediction_rows, on_conflict="school_id,prediction_type,subject_type,subject_key,predicted_for_date").execute()
    _analytics_table("risk_scores").upsert(risk_rows, on_conflict="school_id,scope_type,scope_key,risk_type").execute()
    _analytics_table("forecasts").upsert(forecast_rows, on_conflict="school_id,scope_type,scope_key,forecast_type,period_key").execute()
    _log_audit_entry(school_id=school_id, profile_id=actor_profile_id, action="predictions.finance.viewed", payload={"forecast_count": len(forecast_rows)})
    _elapsed = _time.time() - _t0
    logger.info("PREDICTIONS finance school=%s time=%.3fs", school_id, _elapsed)
    return {
        "scope": "finance",
        "school_id": school_id,
        "generated_at": _utc_now().isoformat(),
        "risk_overview": risk_overview,
        "revenue_forecast": revenue_forecast,
        "fee_default_forecast": default_forecast,
        "total_revenue_window": round(total_revenue, 2),
        "total_pending_window": round(total_pending, 2),
        "model_registry": list(registry.values()),
        "automated_actions": sorted({action for item in risk_overview for action in item["recommended_actions"]})[:6],
    }
