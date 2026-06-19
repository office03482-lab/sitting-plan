"""Consolidated AI assistant helpers for school-facing workflows."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.services.ai_provider import AIProviderError, generate_text
from app.services.supabase_ai_agents import get_ai_agents_dashboard
from app.services.supabase_analytics import get_school_analytics
from app.services.supabase_bi import get_academic_dashboard
from app.services.supabase_predictions import get_campus_predictions_dashboard, get_finance_predictions_dashboard


def _normalize(value: Any) -> str:
    return str(value or "").strip()


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def answer_school_ai_question(school_id: str, question: str, *, actor_profile_id: str | None = None) -> dict[str, Any]:
    normalized_question = _normalize(question)
    if not normalized_question:
        return {
            "question": "",
            "answer": "Please enter a school question.",
            "attendance_insights": [],
            "performance_insights": [],
            "risk_alerts": [],
            "generated_at": _utc_now_iso(),
        }

    school_analytics = get_school_analytics(school_id, actor_profile_id=actor_profile_id)
    academic_bi = get_academic_dashboard(school_id)
    campus_predictions = get_campus_predictions_dashboard(school_id, actor_profile_id=actor_profile_id)
    finance_predictions = get_finance_predictions_dashboard(school_id, actor_profile_id=actor_profile_id)
    ai_agents = get_ai_agents_dashboard(school_id, actor_profile_id=actor_profile_id)

    attendance_insights = [
        f"Academic BI attendance trend {item.get('period')}: {float(item.get('value') or 0):.1f}%"
        for item in list(academic_bi.get("attendance_trends") or [])[:3]
    ]
    performance_insights = [
        f"Monthly school performance {item.get('period')}: {float(item.get('average_percentage') or 0):.1f}% across {int(item.get('tests_count') or 0)} tests"
        for item in list(school_analytics.get("monthly_progress") or [])[:3]
    ]
    risk_alerts = [
        _normalize(item.get("headline")) or _normalize(item.get("summary"))
        for item in list(campus_predictions.get("risk_overview") or [])[:2] + list(finance_predictions.get("risk_overview") or [])[:2]
        if _normalize(item.get("headline")) or _normalize(item.get("summary"))
    ]
    risk_alerts.extend(
        _normalize(item.get("title")) or _normalize(item.get("summary"))
        for item in list(ai_agents.get("critical_alerts") or [])[:3]
        if _normalize(item.get("title")) or _normalize(item.get("summary"))
    )
    risk_alerts = risk_alerts[:5]

    fallback_answer = (
        f"Attendance is averaging {float(school_analytics.get('average_percentage') or 0):.1f}% across current school analytics, "
        f"active tests are {int(school_analytics.get('active_tests') or 0)}, and there are {int(ai_agents.get('summary', {}).get('critical_alerts') or 0)} critical AI alerts. "
        f"Top attendance insights: {', '.join(attendance_insights[:2]) or 'No attendance trend data yet'}. "
        f"Top risk alerts: {', '.join(risk_alerts[:2]) or 'No risk alerts yet'}."
    )

    prompt = (
        "You are the Aspire ERP School AI Assistant. Answer the leadership question using only the grounded school context below. "
        "Be concise, operational, and specific. Avoid generic school advice. "
        "If data is missing, say so clearly. Prioritize attendance, online test performance, LMS progress, and assignments when relevant.\n"
        f"Question: {normalized_question}\n"
        f"School analytics: {school_analytics}\n"
        f"Academic BI: {academic_bi}\n"
        f"Campus predictions: {campus_predictions}\n"
        f"Finance predictions: {finance_predictions}\n"
        f"AI agent dashboard: {ai_agents}\n"
        f"Fallback answer: {fallback_answer}"
    )
    try:
        answer = _normalize(generate_text(prompt)) or fallback_answer
    except AIProviderError:
        answer = fallback_answer

    return {
        "question": normalized_question,
        "answer": answer,
        "attendance_insights": attendance_insights,
        "performance_insights": performance_insights,
        "risk_alerts": risk_alerts,
        "generated_at": _utc_now_iso(),
    }
