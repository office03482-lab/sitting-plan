"""AI Academic Operating System orchestration layer."""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import HTTPException

from app.services.ai_provider import AIProviderError, generate_text
from app.services.supabase_admin import get_supabase_admin_client
from app.services.supabase_bi import get_academic_dashboard, get_finance_dashboard, get_operations_dashboard
from app.services.supabase_predictions import (
    get_campus_predictions_dashboard,
    get_finance_predictions_dashboard,
    get_student_predictions_dashboard,
)

MODULE_KEY = "ai_agents"
AI_SCHEMA = "ai"


def _client():
    return get_supabase_admin_client()


def _public_table(name: str):
    return _client().table(name)


def _ai_table(name: str):
    return _public_table(f"ai_{name}")


def _schema_table(schema: str, name: str):
    return _client().schema(schema).table(name)


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


def _utc_now_iso() -> str:
    return _utc_now().isoformat()


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


def _ai_summary_text(title: str, rationale: dict[str, Any], fallback: str) -> str:
    try:
        text = generate_text(
            "You are the Aspire ERP AI Command Center. Write one concise executive summary sentence "
            "grounded in the supplied recommendation title and rationale.\n"
            f"Title: {title}\n"
            f"Rationale: {rationale}\n"
            f"Fallback: {fallback}"
        )
        return _normalize(text) or fallback
    except AIProviderError:
        return fallback


def _log_audit_entry(
    *,
    school_id: str | None,
    profile_id: str | None,
    action: str,
    payload: dict[str, Any] | None = None,
) -> None:
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


def _upsert(schema: str, table: str, rows: list[dict[str, Any]], *, on_conflict: str) -> None:
    if not rows:
        return
    if schema == AI_SCHEMA:
        _ai_table(table).upsert(rows, on_conflict=on_conflict).execute()
        return
    _schema_table(schema, table).upsert(rows, on_conflict=on_conflict).execute()


def _seed_agent_registry(school_id: str) -> dict[str, dict[str, Any]]:
    rows = [
        {
            "school_id": school_id,
            "agent_key": "ai_principal",
            "agent_name": "AI Principal",
            "domain_key": "leadership",
            "description": "Monitors academics, attendance, discipline, revenue, and hostel signals for leadership summaries.",
            "target_roles": ["school_admin", "platform_admin"],
            "source_modules": ["analytics", "predictions", "bi", "hostels", "edupay"],
            "approval_scope": "admin",
            "orchestration_mode": "approval_required",
            "metadata": {"summary_frequency": "daily"},
            "is_active": True,
        },
        {
            "school_id": school_id,
            "agent_key": "ai_academic_coordinator",
            "agent_name": "AI Academic Coordinator",
            "domain_key": "academics",
            "description": "Tracks syllabus completion, LMS completion, and weak-topic clusters.",
            "target_roles": ["teacher", "school_admin"],
            "source_modules": ["lms", "analytics", "bi"],
            "approval_scope": "teacher",
            "orchestration_mode": "approval_required",
            "metadata": {"summary_frequency": "weekly"},
            "is_active": True,
        },
        {
            "school_id": school_id,
            "agent_key": "ai_attendance_officer",
            "agent_name": "AI Attendance Officer",
            "domain_key": "attendance",
            "description": "Detects attendance decline and absentee clusters for escalation recommendations.",
            "target_roles": ["teacher", "school_admin"],
            "source_modules": ["attendance", "predictions", "parent_intelligence"],
            "approval_scope": "teacher",
            "orchestration_mode": "approval_required",
            "metadata": {},
            "is_active": True,
        },
        {
            "school_id": school_id,
            "agent_key": "ai_exam_coordinator",
            "agent_name": "AI Exam Coordinator",
            "domain_key": "exams",
            "description": "Monitors exam readiness, test coverage, and question quality.",
            "target_roles": ["teacher", "school_admin"],
            "source_modules": ["online_tests", "analytics", "study_planner"],
            "approval_scope": "teacher",
            "orchestration_mode": "approval_required",
            "metadata": {},
            "is_active": True,
        },
        {
            "school_id": school_id,
            "agent_key": "ai_faculty_advisor",
            "agent_name": "AI Faculty Advisor",
            "domain_key": "faculty",
            "description": "Tracks workload, performance, and student outcomes to suggest interventions.",
            "target_roles": ["teacher", "school_admin"],
            "source_modules": ["predictions", "bi", "timetable"],
            "approval_scope": "admin",
            "orchestration_mode": "approval_required",
            "metadata": {},
            "is_active": True,
        },
        {
            "school_id": school_id,
            "agent_key": "ai_student_success_advisor",
            "agent_name": "AI Student Success Advisor",
            "domain_key": "student_success",
            "description": "Generates personalized goals, learning plans, and improvement strategies.",
            "target_roles": ["teacher", "student", "school_admin"],
            "source_modules": ["study_planner", "predictions", "analytics", "lms"],
            "approval_scope": "teacher",
            "orchestration_mode": "approval_required",
            "metadata": {},
            "is_active": True,
        },
        {
            "school_id": school_id,
            "agent_key": "ai_parent_advisor",
            "agent_name": "AI Parent Advisor",
            "domain_key": "parent_engagement",
            "description": "Builds engagement recommendations and communication summaries for parents.",
            "target_roles": ["teacher", "school_admin", "parent"],
            "source_modules": ["parent_intelligence", "attendance", "predictions"],
            "approval_scope": "teacher",
            "orchestration_mode": "approval_required",
            "metadata": {},
            "is_active": True,
        },
        {
            "school_id": school_id,
            "agent_key": "ai_revenue_advisor",
            "agent_name": "AI Revenue Advisor",
            "domain_key": "revenue",
            "description": "Forecasts revenue, subscriptions, and fee collection risk.",
            "target_roles": ["school_admin", "platform_admin"],
            "source_modules": ["edupay", "bi", "predictions"],
            "approval_scope": "admin",
            "orchestration_mode": "approval_required",
            "metadata": {},
            "is_active": True,
        },
        {
            "school_id": school_id,
            "agent_key": "ai_operations_advisor",
            "agent_name": "AI Operations Advisor",
            "domain_key": "operations",
            "description": "Monitors hostel utilization, inventory usage, and resource allocation.",
            "target_roles": ["school_admin", "platform_admin"],
            "source_modules": ["hostels", "inventory", "bi", "predictions"],
            "approval_scope": "admin",
            "orchestration_mode": "approval_required",
            "metadata": {},
            "is_active": True,
        },
    ]
    _upsert(AI_SCHEMA, "agent_registry", rows, on_conflict="school_id,agent_key")
    registry_rows = (
        _ai_table("agent_registry")
        .select("id,school_id,agent_key,agent_name,domain_key,description,target_roles,source_modules,approval_scope,orchestration_mode,metadata")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .execute()
        .data
        or []
    )
    return {str(row.get("agent_key")): dict(row) for row in registry_rows if row.get("agent_key")}


def _create_job(
    school_id: str,
    *,
    registry_row: dict[str, Any],
    actor_profile_id: str | None,
    trigger_mode: str,
    scope_key: str = "school",
    summary: dict[str, Any] | None = None,
) -> str:
    response = (
        _ai_table("agent_jobs")
        .insert(
            {
                "school_id": school_id,
                "agent_id": registry_row.get("id"),
                "agent_key": registry_row.get("agent_key"),
                "triggered_by_profile_id": _normalize_optional_uuid(actor_profile_id),
                "trigger_mode": trigger_mode,
                "scope_key": scope_key,
                "status": "completed",
                "started_at": _utc_now_iso(),
                "completed_at": _utc_now_iso(),
                "summary": summary or {},
                "metadata": {"agent_name": registry_row.get("agent_name")},
                "is_active": True,
            }
        )
        .execute()
    )
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Unable to create AI agent job")
    return str(rows[0].get("id"))


def _deactivate_agent_records(school_id: str, agent_key: str) -> None:
    try:
        _ai_table("agent_recommendations").update({"is_active": False}).eq("school_id", school_id).eq("agent_key", agent_key).eq("is_active", True).execute()
        _ai_table("agent_actions").update({"is_active": False, "execution_status": "cancelled"}).eq("school_id", school_id).eq("agent_key", agent_key).eq("is_active", True).execute()
    except Exception:
        return


def _severity_to_priority(value: str) -> int:
    normalized = _normalize(value).lower()
    return {"critical": 4, "warning": 3, "positive": 2, "info": 1}.get(normalized, 1)


def _recommendation_row(
    school_id: str,
    *,
    job_id: str,
    registry_row: dict[str, Any],
    title: str,
    summary: str,
    severity: str,
    recommendation_type: str,
    target_scope: str = "school",
    target_entity_id: str | None = None,
    confidence_score: float = 70,
    rationale: dict[str, Any] | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "school_id": school_id,
        "job_id": job_id,
        "agent_id": registry_row.get("id"),
        "agent_key": registry_row.get("agent_key"),
        "title": title,
        "summary": summary,
        "severity": severity,
        "recommendation_type": recommendation_type,
        "target_scope": target_scope,
        "target_entity_id": _normalize_optional_uuid(target_entity_id),
        "approval_scope": registry_row.get("approval_scope") or "admin",
        "approval_status": "pending",
        "source_modules": _normalize_json_list(registry_row.get("source_modules")),
        "confidence_score": confidence_score,
        "rationale": rationale or {},
        "payload": payload or {},
        "metadata": {"priority": _severity_to_priority(severity)},
        "is_active": True,
    }


def _action_row(
    school_id: str,
    *,
    job_id: str,
    recommendation_id: str,
    registry_row: dict[str, Any],
    action_label: str,
    target_module: str,
    action_type: str,
    execution_payload: dict[str, Any],
) -> dict[str, Any]:
    return {
        "school_id": school_id,
        "job_id": job_id,
        "recommendation_id": recommendation_id,
        "agent_id": registry_row.get("id"),
        "agent_key": registry_row.get("agent_key"),
        "action_label": action_label,
        "target_module": target_module,
        "action_type": action_type,
        "execution_payload": execution_payload,
        "approval_scope": registry_row.get("approval_scope") or "admin",
        "approval_status": "pending",
        "execution_status": "awaiting_approval",
        "metadata": {"manual_only": True},
        "is_active": True,
    }


def _role_key(role_key: str | None) -> str:
    return _normalize(role_key).lower()


def _can_approve_scope(user_role_key: str, approval_scope: str) -> bool:
    normalized_role = _role_key(user_role_key)
    scope = _normalize(approval_scope).lower()
    if normalized_role == "platform_admin":
        return True
    if scope == "teacher":
        return normalized_role in {"teacher", "school_admin"}
    if scope == "admin":
        return normalized_role == "school_admin"
    if scope == "platform":
        return normalized_role == "platform_admin"
    return False


def _agent_recommendation_blueprints(
    school_id: str,
    *,
    registry: dict[str, dict[str, Any]],
    actor_profile_id: str | None,
) -> dict[str, list[dict[str, Any]]]:
    student_predictions = get_student_predictions_dashboard(
        school_id,
        role_key="school_admin",
        profile_id=actor_profile_id,
        user_email=None,
        requested_student_id=None,
        limit=10,
        actor_profile_id=actor_profile_id,
    )
    campus_predictions = get_campus_predictions_dashboard(school_id, actor_profile_id=actor_profile_id)
    finance_predictions = get_finance_predictions_dashboard(school_id, actor_profile_id=actor_profile_id)
    academic_bi = get_academic_dashboard(school_id, period="monthly", actor_profile_id=actor_profile_id)
    finance_bi = get_finance_dashboard(school_id, period="monthly", actor_profile_id=actor_profile_id)
    operations_bi = get_operations_dashboard(school_id, period="monthly", actor_profile_id=actor_profile_id)

    weak_topics = [item.get("topic") for item in list(academic_bi.get("weak_topics") or []) if _normalize(item.get("topic"))][:3]
    at_risk_students = [item for item in list(student_predictions.get("students") or []) if _normalize(item.get("overall_risk_level")) in {"high", "critical"}][:3]
    campus_risks = list(campus_predictions.get("risk_overview") or [])
    finance_risks = list(finance_predictions.get("risk_overview") or [])

    blueprints: dict[str, list[dict[str, Any]]] = defaultdict(list)

    blueprints["ai_principal"].append(
        {
            "title": "Daily institutional command summary",
            "summary": f"{len(at_risk_students)} high-risk students, {len(weak_topics)} weak-topic clusters, hostel utilization {operations_bi.get('hostel_utilization', 0):.1f}%, and MRR Rs {finance_bi.get('mrr', 0):.2f}.",
            "severity": "critical" if at_risk_students else "info",
            "recommendation_type": "principal_summary",
            "confidence_score": 84,
            "rationale": {
                "at_risk_students": at_risk_students,
                "weak_topics": weak_topics,
                "mrr": finance_bi.get("mrr", 0),
                "hostel_utilization": operations_bi.get("hostel_utilization", 0),
            },
            "payload": {
                "critical_alerts": student_predictions.get("early_warnings", [])[:5],
                "finance_risks": finance_risks[:2],
                "campus_risks": campus_risks[:2],
            },
            "target_scope": "school",
        }
    )
    if weak_topics:
        blueprints["ai_academic_coordinator"].append(
            {
                "title": "Remedial plan for weak topic cluster",
                "summary": f"Weak-topic concentration detected in {', '.join(weak_topics)}. Plan remedial classes and revision checkpoints.",
                "severity": "warning",
                "recommendation_type": "remedial_classes",
                "confidence_score": 78,
                "rationale": {"weak_topics": weak_topics, "completion_rates": academic_bi.get("completion_rates", [])},
                "payload": {"topics": weak_topics, "recommended_modules": ["lms", "study_planner", "online_tests"]},
                "target_scope": "school",
            }
        )
    if at_risk_students:
        worst_student = at_risk_students[0]
        blueprints["ai_attendance_officer"].append(
            {
                "title": "Attendance decline early warning",
                "summary": f"{worst_student.get('student_name')} is showing {worst_student.get('attendance_risk', 0):.1f}% attendance risk. Parent alert and counselor referral should be reviewed.",
                "severity": "critical",
                "recommendation_type": "attendance_escalation",
                "confidence_score": worst_student.get("confidence_score", 75),
                "rationale": {"student": worst_student},
                "payload": {"student_id": worst_student.get("student_id"), "actions": ["parent_alert", "counselor_referral"]},
                "target_scope": "student",
                "target_entity_id": worst_student.get("student_id"),
            }
        )
    if weak_topics or at_risk_students:
        blueprints["ai_exam_coordinator"].append(
            {
                "title": "Mock-test coverage recommendation",
                "summary": "Exam readiness signals suggest additional mock tests and revision schedules for weak-topic coverage.",
                "severity": "warning",
                "recommendation_type": "mock_test_plan",
                "confidence_score": 76,
                "rationale": {"weak_topics": weak_topics, "student_warnings": student_predictions.get("early_warnings", [])[:3]},
                "payload": {"topics": weak_topics, "target_students": [item.get("student_id") for item in at_risk_students]},
                "target_scope": "school",
            }
        )
    teacher_risk = next((item for item in campus_risks if _normalize(item.get("risk_type")) == "teacher_workload_risk"), None)
    if teacher_risk:
        blueprints["ai_faculty_advisor"].append(
            {
                "title": "Faculty workload intervention",
                "summary": teacher_risk.get("explanation") or "Teacher workload risk requires rebalancing.",
                "severity": teacher_risk.get("risk_level", "warning"),
                "recommendation_type": "faculty_intervention",
                "confidence_score": teacher_risk.get("confidence_score", 72),
                "rationale": teacher_risk,
                "payload": {"recommended_actions": teacher_risk.get("recommended_actions", [])},
                "target_scope": "school",
            }
        )
    if at_risk_students:
        worst_student = at_risk_students[0]
        blueprints["ai_student_success_advisor"].append(
            {
                "title": "Personalized student success plan",
                "summary": f"Create a personalized goal stack and learning plan for {worst_student.get('student_name')} using planner, LMS, and test data.",
                "severity": "warning",
                "recommendation_type": "student_success_plan",
                "confidence_score": worst_student.get("confidence_score", 75),
                "rationale": {"student": worst_student, "actions": worst_student.get("recommended_actions", [])},
                "payload": {"student_id": worst_student.get("student_id"), "planner_actions": worst_student.get("recommended_actions", [])},
                "target_scope": "student",
                "target_entity_id": worst_student.get("student_id"),
            }
        )
        blueprints["ai_parent_advisor"].append(
            {
                "title": "Parent communication summary required",
                "summary": f"Prepare a communication summary for the parent of {worst_student.get('student_name')} covering attendance, exams, and engagement decline.",
                "severity": "warning",
                "recommendation_type": "parent_summary",
                "confidence_score": worst_student.get("confidence_score", 74),
                "rationale": {"student": worst_student, "warnings": student_predictions.get("early_warnings", [])[:2]},
                "payload": {"student_id": worst_student.get("student_id"), "summary_topics": ["attendance", "exam readiness", "engagement"]},
                "target_scope": "student",
                "target_entity_id": worst_student.get("student_id"),
            }
        )
    if finance_risks:
        top_finance_risk = finance_risks[0]
        blueprints["ai_revenue_advisor"].append(
            {
                "title": "Revenue risk escalation",
                "summary": top_finance_risk.get("explanation") or "Revenue or fee-default risk needs review.",
                "severity": top_finance_risk.get("risk_level", "warning"),
                "recommendation_type": "revenue_forecast_review",
                "confidence_score": top_finance_risk.get("confidence_score", 73),
                "rationale": top_finance_risk,
                "payload": {
                    "revenue_forecast": finance_predictions.get("revenue_forecast", [])[:3],
                    "fee_default_forecast": finance_predictions.get("fee_default_forecast", [])[:3],
                },
                "target_scope": "school",
            }
        )
    hostel_risk = next((item for item in campus_risks if _normalize(item.get("risk_type")) == "hostel_capacity_risk"), None)
    if hostel_risk:
        blueprints["ai_operations_advisor"].append(
            {
                "title": "Operations utilization review",
                "summary": f"Hostel utilization {operations_bi.get('hostel_utilization', 0):.1f}% and inventory utilization {operations_bi.get('inventory_utilization', 0):.1f} suggest a resource-allocation review.",
                "severity": hostel_risk.get("risk_level", "warning"),
                "recommendation_type": "operations_review",
                "confidence_score": hostel_risk.get("confidence_score", 72),
                "rationale": {"hostel_risk": hostel_risk, "operations_bi": operations_bi},
                "payload": {"hostel_forecast": campus_predictions.get("hostel_forecast", [])[:3]},
                "target_scope": "school",
            }
        )
    for items in blueprints.values():
        for item in items:
            item["summary"] = _ai_summary_text(
                str(item.get("title") or "AI recommendation"),
                _normalize_json_object(item.get("rationale")),
                str(item.get("summary") or ""),
            )
    return blueprints


def run_ai_agent_jobs(
    school_id: str,
    *,
    actor_profile_id: str | None,
    requested_agent_key: str | None = None,
) -> dict[str, Any]:
    registry = _seed_agent_registry(school_id)
    blueprints = _agent_recommendation_blueprints(school_id, registry=registry, actor_profile_id=actor_profile_id)
    agent_keys = [requested_agent_key] if _normalize(requested_agent_key) else list(registry.keys())
    created_recommendations = 0
    created_actions = 0
    created_jobs: list[dict[str, Any]] = []

    for agent_key in agent_keys:
        registry_row = registry.get(_normalize(agent_key))
        if not registry_row:
            continue
        _deactivate_agent_records(school_id, _normalize(agent_key))
        job_id = _create_job(
            school_id,
            registry_row=registry_row,
            actor_profile_id=actor_profile_id,
            trigger_mode="manual",
            summary={"recommendation_count": len(blueprints.get(_normalize(agent_key), []))},
        )
        created_jobs.append({"job_id": job_id, "agent_key": agent_key, "agent_name": registry_row.get("agent_name")})
        recommendation_rows = []
        for blueprint in blueprints.get(_normalize(agent_key), []):
            recommendation_rows.append(
                _recommendation_row(
                    school_id,
                    job_id=job_id,
                    registry_row=registry_row,
                    title=blueprint["title"],
                    summary=blueprint["summary"],
                    severity=blueprint["severity"],
                    recommendation_type=blueprint["recommendation_type"],
                    target_scope=blueprint.get("target_scope", "school"),
                    target_entity_id=blueprint.get("target_entity_id"),
                    confidence_score=_safe_float(blueprint.get("confidence_score")),
                    rationale=_normalize_json_object(blueprint.get("rationale")),
                    payload=_normalize_json_object(blueprint.get("payload")),
                )
            )
        if not recommendation_rows:
            continue
        inserted_recommendations = (
            _ai_table("agent_recommendations")
            .insert(recommendation_rows)
            .execute()
            .data
            or []
        )
        created_recommendations += len(inserted_recommendations)
        action_rows = []
        for inserted in inserted_recommendations:
            row = dict(inserted)
            payload = _normalize_json_object(row.get("payload"))
            if _normalize(row.get("recommendation_type")) == "attendance_escalation":
                action_rows.append(
                    _action_row(
                        school_id,
                        job_id=job_id,
                        recommendation_id=str(row.get("id")),
                        registry_row=registry_row,
                        action_label="Review parent alert and counselor referral",
                        target_module="parent_intelligence",
                        action_type="manual_escalation_review",
                        execution_payload=payload,
                    )
                )
            else:
                action_rows.append(
                    _action_row(
                        school_id,
                        job_id=job_id,
                        recommendation_id=str(row.get("id")),
                        registry_row=registry_row,
                        action_label=f"Review {row.get('title')}",
                        target_module=_normalize((_normalize_json_list(row.get("source_modules")) or ["ai_agents"])[0]) or "ai_agents",
                        action_type="manual_review",
                        execution_payload=payload,
                    )
                )
        if action_rows:
            inserted_actions = _ai_table("agent_actions").insert(action_rows).execute().data or []
            created_actions += len(inserted_actions)

    _log_audit_entry(
        school_id=school_id,
        profile_id=actor_profile_id,
        action="ai_agents.run",
        payload={"requested_agent_key": requested_agent_key, "jobs": created_jobs, "recommendations": created_recommendations},
    )
    return {
        "message": "AI agent orchestration completed.",
        "jobs": created_jobs,
        "recommendations_created": created_recommendations,
        "actions_created": created_actions,
        "generated_at": _utc_now_iso(),
    }


def list_ai_agent_recommendations(
    school_id: str,
    *,
    status_filter: str | None = None,
    agent_key: str | None = None,
) -> list[dict[str, Any]]:
    query = (
        _ai_table("agent_recommendations")
        .select("*")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
    )
    if _normalize(status_filter):
        query = query.eq("approval_status", _normalize(status_filter))
    if _normalize(agent_key):
        query = query.eq("agent_key", _normalize(agent_key))
    rows = [dict(row) for row in list(query.execute().data or [])]
    action_rows = (
        _ai_table("agent_actions")
        .select("*")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .is_("deleted_at", "null")
        .execute()
        .data
        or []
    )
    actions_by_recommendation: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in action_rows:
        actions_by_recommendation[_normalize(row.get("recommendation_id"))].append(dict(row))
    registry_map = _seed_agent_registry(school_id)
    results = []
    for row in rows:
        recommendation_id = _normalize(row.get("id"))
        registry_row = registry_map.get(_normalize(row.get("agent_key")), {})
        results.append(
            {
                **row,
                "agent_name": registry_row.get("agent_name") or row.get("agent_key"),
                "actions": actions_by_recommendation.get(recommendation_id, []),
            }
        )
    return results


def approve_ai_agent_recommendation(
    school_id: str,
    *,
    recommendation_id: str,
    decision: str,
    approver_profile_id: str | None,
    approver_role_key: str,
    notes: str | None = None,
) -> dict[str, Any]:
    rows = (
        _ai_table("agent_recommendations")
        .select("*")
        .eq("school_id", school_id)
        .eq("id", recommendation_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="AI recommendation not found")
    recommendation = dict(rows[0])
    if not _can_approve_scope(approver_role_key, _normalize(recommendation.get("approval_scope"))):
        raise HTTPException(status_code=403, detail="You cannot approve this recommendation scope")

    normalized_decision = _normalize(decision).lower()
    if normalized_decision not in {"approved", "rejected"}:
        raise HTTPException(status_code=400, detail="Decision must be approved or rejected")

    updated_recommendation = (
        _ai_table("agent_recommendations")
        .update(
            {
                "approval_status": normalized_decision,
                "approval_notes": notes,
                "approved_by_profile_id": _normalize_optional_uuid(approver_profile_id),
                "approved_at": _utc_now_iso(),
            }
        )
        .eq("id", recommendation_id)
        .execute()
        .data
        or []
    )
    action_updates = {
        "approval_status": normalized_decision,
        "approved_by_profile_id": _normalize_optional_uuid(approver_profile_id),
        "approved_at": _utc_now_iso(),
        "notes": notes,
        "execution_status": "ready_for_manual_execution" if normalized_decision == "approved" else "cancelled",
    }
    _ai_table("agent_actions").update(action_updates).eq("recommendation_id", recommendation_id).execute()
    _log_audit_entry(
        school_id=school_id,
        profile_id=approver_profile_id,
        action=f"ai_agents.{normalized_decision}",
        payload={"recommendation_id": recommendation_id, "notes": notes},
    )
    updated = dict(updated_recommendation[0]) if updated_recommendation else recommendation
    updated["actions"] = (
        _ai_table("agent_actions")
        .select("*")
        .eq("recommendation_id", recommendation_id)
        .eq("is_active", True)
        .execute()
        .data
        or []
    )
    return updated


def get_ai_agents_dashboard(
    school_id: str,
    *,
    actor_profile_id: str | None = None,
) -> dict[str, Any]:
    registry = _seed_agent_registry(school_id)
    recommendations = list_ai_agent_recommendations(school_id)
    if not recommendations:
        run_ai_agent_jobs(school_id, actor_profile_id=actor_profile_id)
        recommendations = list_ai_agent_recommendations(school_id)

    severity_counter = Counter(_normalize(item.get("severity")).lower() or "info" for item in recommendations)
    pending_approvals = [item for item in recommendations if _normalize(item.get("approval_status")) == "pending"]
    critical_alerts = [item for item in recommendations if _normalize(item.get("severity")) == "critical"][:6]
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in recommendations:
        grouped[_normalize(item.get("agent_key"))].append(item)

    cards = []
    for agent_key, agent in registry.items():
        items = grouped.get(agent_key, [])
        cards.append(
            {
                "agent_key": agent_key,
                "agent_name": agent.get("agent_name"),
                "domain_key": agent.get("domain_key"),
                "approval_scope": agent.get("approval_scope"),
                "source_modules": _normalize_json_list(agent.get("source_modules")),
                "recommendation_count": len(items),
                "pending_count": len([item for item in items if _normalize(item.get("approval_status")) == "pending"]),
                "critical_count": len([item for item in items if _normalize(item.get("severity")) == "critical"]),
                "latest_recommendations": items[:3],
            }
        )

    _log_audit_entry(
        school_id=school_id,
        profile_id=actor_profile_id,
        action="ai_agents.dashboard.viewed",
        payload={"recommendation_count": len(recommendations), "pending_count": len(pending_approvals)},
    )
    return {
        "scope": "school",
        "school_id": school_id,
        "generated_at": _utc_now_iso(),
        "summary": {
            "agents": len(registry),
            "recommendations": len(recommendations),
            "pending_approvals": len(pending_approvals),
            "critical_alerts": len(critical_alerts),
            "severity_breakdown": dict(severity_counter),
        },
        "critical_alerts": critical_alerts,
        "pending_approvals": pending_approvals[:10],
        "agent_cards": sorted(cards, key=lambda item: item["critical_count"], reverse=True),
    }
