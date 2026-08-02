"""Read-side analytics engine for online tests."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any
import time
from uuid import UUID

from fastapi import HTTPException

from app.services.supabase_admin import get_supabase_admin_client

ANALYTICS_CACHE_TTL_SECONDS = 60
_ANALYTICS_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_SCHOOL_RANKING_CACHE_TTL_SECONDS = 300
_SCHOOL_RANKING_CACHE: dict[str, tuple[float, list[tuple[str, float]]]] = {}


def _client():
    return get_supabase_admin_client()


def _public_table(name: str):
    return _client().table(name)


def _online_test_table(name: str):
    return _public_table(f"online_test_{name}")


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


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _month_key(value: Any) -> str:
    text = _normalize(value)
    if not text:
        return "Unknown"
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed.strftime("%Y-%m")
    except ValueError:
        return text[:7] or "Unknown"


def _safe_percentage(numerator: float, denominator: float) -> float:
    if denominator <= 0:
        return 0.0
    return round((numerator / denominator) * 100, 2)


def _cache_get(key: str) -> dict[str, Any] | None:
    cached = _ANALYTICS_CACHE.get(key)
    if not cached:
        return None
    expires_at, payload = cached
    if expires_at <= time.monotonic():
        _ANALYTICS_CACHE.pop(key, None)
        return None
    return dict(payload)


def _cache_set(key: str, payload: dict[str, Any]) -> dict[str, Any]:
    _ANALYTICS_CACHE[key] = (time.monotonic() + ANALYTICS_CACHE_TTL_SECONDS, dict(payload))
    return payload


def _log_audit_entry(
    *,
    school_id: str | None,
    profile_id: str | None,
    action: str,
    payload: dict[str, Any] | None = None,
) -> None:
    row: dict[str, Any] = {
        "school_id": _normalize_optional_uuid(school_id),
        "profile_id": _normalize_optional_uuid(profile_id),
        "action": action,
        "module_key": "analytics",
        "payload": payload or {},
    }
    _public_table("audit_logs").insert(row).execute()


def _load_tests(*, school_id: str | None = None, test_ids: list[str] | None = None, batch_id: str | None = None) -> list[dict[str, Any]]:
    query = (
        _online_test_table("tests")
        .select("id,school_id,title,subject_id,batch_id,created_by_profile_id,status,total_marks,starts_at,ends_at,created_at,metadata")
        .is_("deleted_at", "null")
        .eq("is_active", True)
    )
    if school_id:
        query = query.eq("school_id", school_id)
    if test_ids:
        query = query.in_("id", test_ids)
    if batch_id:
        query = query.eq("batch_id", batch_id)
    return [dict(row) for row in list(query.execute().data or [])]


def _load_results(*, school_id: str | None = None, test_id: str | None = None, student_ids: list[str] | None = None) -> list[dict[str, Any]]:
    query = (
        _online_test_table("test_results")
        .select("id,school_id,attempt_id,test_id,student_id,total_questions,attempted_questions,correct_answers,incorrect_answers,unanswered_questions,score_obtained,max_score,percentage,rank_in_batch,rank_in_school,published_at,created_at")
        .is_("deleted_at", "null")
        .eq("is_active", True)
    )
    if school_id:
        query = query.eq("school_id", school_id)
    if test_id:
        query = query.eq("test_id", test_id)
    if student_ids:
        query = query.in_("student_id", student_ids)
    return [dict(row) for row in list(query.execute().data or [])]


def _load_attempts(*, school_id: str | None = None, test_id: str | None = None, attempt_ids: list[str] | None = None, student_ids: list[str] | None = None) -> list[dict[str, Any]]:
    query = (
        _online_test_table("test_attempts")
        .select("id,school_id,test_id,student_id,status,time_spent_seconds,answered_questions_snapshot,started_at,submitted_at,created_at")
        .is_("deleted_at", "null")
        .eq("is_active", True)
    )
    if school_id:
        query = query.eq("school_id", school_id)
    if test_id:
        query = query.eq("test_id", test_id)
    if attempt_ids:
        query = query.in_("id", attempt_ids)
    if student_ids:
        query = query.in_("student_id", student_ids)
    return [dict(row) for row in list(query.execute().data or [])]


def _load_responses(*, school_id: str | None = None, attempt_ids: list[str] | None = None, test_id: str | None = None, student_ids: list[str] | None = None) -> list[dict[str, Any]]:
    query = (
        _online_test_table("test_responses")
        .select("id,school_id,attempt_id,test_id,question_id,student_id,is_correct,marks_awarded,response_payload,created_at")
        .is_("deleted_at", "null")
        .eq("is_active", True)
    )
    if school_id:
        query = query.eq("school_id", school_id)
    if attempt_ids:
        query = query.in_("attempt_id", attempt_ids)
    if test_id:
        query = query.eq("test_id", test_id)
    if student_ids:
        query = query.in_("student_id", student_ids)
    return [dict(row) for row in list(query.execute().data or [])]


def _load_questions(*, school_id: str | None = None, test_ids: list[str] | None = None) -> list[dict[str, Any]]:
    query = (
        _online_test_table("test_questions")
        .select("id,school_id,test_id,section_id,prompt_text,difficulty_level,marks,metadata")
        .is_("deleted_at", "null")
        .eq("is_active", True)
    )
    if school_id:
        query = query.eq("school_id", school_id)
    if test_ids:
        query = query.in_("test_id", test_ids)
    return [dict(row) for row in list(query.execute().data or [])]


def _load_sections(*, school_id: str | None = None, section_ids: list[str] | None = None, test_ids: list[str] | None = None) -> list[dict[str, Any]]:
    query = (
        _online_test_table("test_sections")
        .select("id,school_id,test_id,title,metadata")
        .is_("deleted_at", "null")
        .eq("is_active", True)
    )
    if school_id:
        query = query.eq("school_id", school_id)
    if section_ids:
        query = query.in_("id", section_ids)
    if test_ids:
        query = query.in_("test_id", test_ids)
    return [dict(row) for row in list(query.execute().data or [])]


def _load_students(*, school_id: str | None = None, student_ids: list[str] | None = None, batch_id: str | None = None) -> list[dict[str, Any]]:
    query = _public_table("students").select("id,school_id,profile_id,batch_id,full_name,class_name,section,is_active").eq("is_active", True)
    if school_id:
        query = query.eq("school_id", school_id)
    if student_ids:
        query = query.in_("id", student_ids)
    if batch_id:
        query = query.eq("batch_id", batch_id)
    return [dict(row) for row in list(query.execute().data or [])]


def _load_batches(batch_ids: list[str], *, school_id: str | None = None) -> dict[str, dict[str, Any]]:
    ids = [item for item in batch_ids if item]
    if not ids:
        return {}
    query = _public_table("batches").select("id,school_id,name,class_name,section").in_("id", ids)
    if school_id:
        query = query.eq("school_id", school_id)
    rows = list(query.execute().data or [])
    return {_normalize(row.get("id")): dict(row) for row in rows}


def _load_subjects(subject_ids: list[str], *, school_id: str | None = None) -> dict[str, dict[str, Any]]:
    ids = [item for item in subject_ids if item]
    if not ids:
        return {}
    query = _public_table("subjects").select("id,school_id,name,class_name").in_("id", ids)
    if school_id:
        query = query.eq("school_id", school_id)
    rows = list(query.execute().data or [])
    return {_normalize(row.get("id")): dict(row) for row in rows}


def _load_profiles(profile_ids: list[str], *, school_id: str | None = None) -> dict[str, dict[str, Any]]:
    ids = [item for item in profile_ids if item]
    if not ids:
        return {}
    scoped_ids = ids
    if school_id:
        membership_rows = list(
            _public_table("school_memberships")
            .select("profile_id")
            .eq("school_id", school_id)
            .eq("is_active", True)
            .eq("status", "active")
            .in_("profile_id", ids)
            .execute()
            .data
            or []
        )
        scoped_ids = [
            _normalize(row.get("profile_id"))
            for row in membership_rows
            if _normalize(row.get("profile_id"))
        ]
        if not scoped_ids:
            return {}
    rows = list(_public_table("profiles").select("id,full_name,display_name,email").in_("id", scoped_ids).execute().data or [])
    return {_normalize(row.get("id")): dict(row) for row in rows}


def _load_schools(school_ids: list[str]) -> dict[str, dict[str, Any]]:
    ids = [item for item in school_ids if item]
    if not ids:
        return {}
    rows = list(_public_table("schools").select("id,name").in_("id", ids).execute().data or [])
    return {_normalize(row.get("id")): dict(row) for row in rows}


def _get_student_by_profile_id(school_id: str, profile_id: str) -> dict[str, Any]:
    rows = list(
        _public_table("students")
        .select("id,school_id,profile_id,batch_id,full_name,class_name,section")
        .eq("school_id", school_id)
        .eq("profile_id", profile_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Active student record not found for this profile")
    return dict(rows[0])


def _get_student(school_id: str, student_id: str) -> dict[str, Any]:
    rows = list(
        _public_table("students")
        .select("id,school_id,profile_id,batch_id,full_name,class_name,section")
        .eq("school_id", school_id)
        .eq("id", student_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Student not found")
    return dict(rows[0])


def _get_test(school_id: str, test_id: str) -> dict[str, Any]:
    rows = list(
        _online_test_table("tests")
        .select("id,school_id,title,subject_id,batch_id,created_by_profile_id,status,total_marks,starts_at,ends_at,created_at,metadata")
        .eq("school_id", school_id)
        .eq("id", test_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Online test not found")
    return dict(rows[0])


def _get_batch(school_id: str, batch_id: str) -> dict[str, Any]:
    rows = list(
        _public_table("batches")
        .select("id,school_id,name,class_name,section")
        .eq("school_id", school_id)
        .eq("id", batch_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Batch not found")
    return dict(rows[0])


def _topic_labels(question: dict[str, Any], section_map: dict[str, dict[str, Any]]) -> tuple[str, str]:
    metadata = _normalize_json_object(question.get("metadata"))
    chapter_name = (
        _normalize(metadata.get("chapter_name"))
        or _normalize(metadata.get("chapter"))
        or _normalize(section_map.get(_normalize(question.get("section_id")), {}).get("title"))
        or "General"
    )
    topic_name = (
        _normalize(metadata.get("topic_name"))
        or _normalize(metadata.get("topic"))
        or chapter_name
    )
    return chapter_name, topic_name


def _build_topic_metrics(
    responses: list[dict[str, Any]],
    question_map: dict[str, dict[str, Any]],
    section_map: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for response in responses:
        question = question_map.get(_normalize(response.get("question_id")))
        if not question:
            continue
        chapter_name, topic_name = _topic_labels(question, section_map)
        key = (chapter_name, topic_name)
        bucket = grouped.setdefault(
            key,
            {
                "chapter_name": chapter_name,
                "topic_name": topic_name,
                "attempts_count": 0,
                "correct_count": 0,
                "incorrect_count": 0,
                "unanswered_count": 0,
                "score_obtained": 0.0,
                "max_score": 0.0,
            },
        )
        bucket["attempts_count"] += 1
        if response.get("is_correct") is True:
            bucket["correct_count"] += 1
        elif response.get("is_correct") is False:
            bucket["incorrect_count"] += 1
        else:
            bucket["unanswered_count"] += 1
        bucket["score_obtained"] += float(response.get("marks_awarded") or 0)
        bucket["max_score"] += float(question.get("marks") or 0)

    metrics: list[dict[str, Any]] = []
    for bucket in grouped.values():
        metrics.append(
            {
                "chapter_name": bucket["chapter_name"],
                "topic_name": bucket["topic_name"],
                "attempts_count": bucket["attempts_count"],
                "correct_count": bucket["correct_count"],
                "incorrect_count": bucket["incorrect_count"],
                "unanswered_count": bucket["unanswered_count"],
                "percentage": _safe_percentage(float(bucket["score_obtained"]), float(bucket["max_score"])),
                "score_obtained": round(float(bucket["score_obtained"]), 2),
                "max_score": round(float(bucket["max_score"]), 2),
            }
        )
    return sorted(metrics, key=lambda item: (item["percentage"], item["topic_name"]))


def _replace_topic_performance_rows(
    *,
    owner_type: str,
    owner_id: str,
    school_id: str | None,
    topic_rows: list[dict[str, Any]],
    context: dict[str, Any],
) -> None:
    scoped_query = _analytics_table("topic_performance").update(
        {"is_active": False, "deleted_at": _utc_now_iso()}
    ).eq("owner_type", owner_type).eq("owner_id", owner_id).is_("deleted_at", "null")
    if school_id:
        scoped_query = scoped_query.eq("school_id", school_id)
    else:
        scoped_query = scoped_query.is_("school_id", "null")
    scoped_query.execute()

    if not topic_rows:
        return

    payload = []
    generated_at = _utc_now_iso()
    for row in topic_rows:
        payload.append(
            {
                "school_id": school_id,
                "owner_type": owner_type,
                "owner_id": owner_id,
                "student_id": context.get("student_id"),
                "test_id": context.get("test_id"),
                "batch_id": context.get("batch_id"),
                "subject_id": context.get("subject_id"),
                "chapter_name": row.get("chapter_name"),
                "topic_name": row.get("topic_name"),
                "attempts_count": int(row.get("attempts_count") or 0),
                "correct_count": int(row.get("correct_count") or 0),
                "incorrect_count": int(row.get("incorrect_count") or 0),
                "unanswered_count": int(row.get("unanswered_count") or 0),
                "percentage": float(row.get("percentage") or 0),
                "summary": {
                    "score_obtained": row.get("score_obtained"),
                    "max_score": row.get("max_score"),
                },
                "generated_at": generated_at,
                "is_active": True,
            }
        )
    _analytics_table("topic_performance").insert(payload).execute()


def _upsert_student_performance_snapshot(
    school_id: str,
    student_id: str,
    payload: dict[str, Any],
) -> None:
    rows = list(
        _analytics_table("student_performance")
        .select("id")
        .eq("school_id", school_id)
        .eq("student_id", student_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    data = {
        "latest_test_id": payload.get("latest_test_id"),
        "overall_percentage": payload.get("overall_percentage", 0),
        "accuracy": payload.get("accuracy", 0),
        "speed": payload.get("speed", 0),
        "rank_in_school": payload.get("rank"),
        "percentile": payload.get("percentile"),
        "summary": payload,
        "metadata": {"source": "online_tests"},
        "generated_at": payload.get("generated_at") or _utc_now_iso(),
        "is_active": True,
        "deleted_at": None,
    }
    if rows:
        _analytics_table("student_performance").update(data).eq("id", _normalize(rows[0].get("id"))).execute()
    else:
        data["school_id"] = school_id
        data["student_id"] = student_id
        _analytics_table("student_performance").insert(data).execute()


def _upsert_test_analytics_snapshot(school_id: str, test_id: str, payload: dict[str, Any]) -> None:
    rows = list(
        _analytics_table("test_analytics")
        .select("id")
        .eq("school_id", school_id)
        .eq("test_id", test_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    data = {
        "average_percentage": payload.get("average_percentage", 0),
        "average_score": payload.get("average_score", 0),
        "completion_rate": payload.get("completion_rate", 0),
        "participant_count": payload.get("participant_count", 0),
        "summary": payload,
        "generated_at": payload.get("generated_at") or _utc_now_iso(),
        "is_active": True,
        "deleted_at": None,
    }
    if rows:
        _analytics_table("test_analytics").update(data).eq("id", _normalize(rows[0].get("id"))).execute()
    else:
        data["school_id"] = school_id
        data["test_id"] = test_id
        _analytics_table("test_analytics").insert(data).execute()


def _upsert_school_analytics_snapshot(scope_type: str, scope_id: str, school_id: str | None, payload: dict[str, Any]) -> None:
    query = (
        _analytics_table("school_analytics")
        .select("id")
        .eq("scope_type", scope_type)
        .eq("scope_id", scope_id)
        .is_("deleted_at", "null")
        .limit(1)
    )
    if school_id:
        query = query.eq("school_id", school_id)
    else:
        query = query.is_("school_id", "null")
    rows = list(query.execute().data or [])
    data = {
        "average_percentage": payload.get("average_percentage", 0),
        "active_students_count": payload.get("active_students", 0),
        "active_tests_count": payload.get("active_tests", 0),
        "summary": payload,
        "generated_at": payload.get("generated_at") or _utc_now_iso(),
        "is_active": True,
        "deleted_at": None,
    }
    if rows:
        _analytics_table("school_analytics").update(data).eq("id", _normalize(rows[0].get("id"))).execute()
    else:
        data["scope_type"] = scope_type
        data["scope_id"] = scope_id
        data["school_id"] = school_id
        _analytics_table("school_analytics").insert(data).execute()


def _named_score_rows(
    result_rows: list[dict[str, Any]],
    student_map: dict[str, dict[str, Any]],
    batch_map: dict[str, dict[str, Any]],
    limit: int,
    *,
    reverse: bool,
) -> list[dict[str, Any]]:
    sorted_rows = sorted(
        result_rows,
        key=lambda row: (float(row.get("percentage") or 0), float(row.get("score_obtained") or 0)),
        reverse=reverse,
    )[:limit]
    items: list[dict[str, Any]] = []
    for index, row in enumerate(sorted_rows, start=1):
        student = student_map.get(_normalize(row.get("student_id")), {})
        batch = batch_map.get(_normalize(student.get("batch_id")), {})
        items.append(
            {
                "student_id": _normalize(row.get("student_id")),
                "student_name": _normalize(student.get("full_name")) or "Student",
                "batch_id": _normalize(student.get("batch_id")) or None,
                "batch_name": _normalize(batch.get("name")) or None,
                "class_name": _normalize(student.get("class_name")) or None,
                "percentage": round(float(row.get("percentage") or 0), 2),
                "score_obtained": round(float(row.get("score_obtained") or 0), 2),
                "max_score": round(float(row.get("max_score") or 0), 2),
                "rank": index,
            }
        )
    return items


def get_student_analytics(school_id: str, student_id: str, *, actor_profile_id: str | None = None) -> dict[str, Any]:
    cache_key = f"student:{school_id}:{student_id}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    student = _get_student(school_id, student_id)
    result_rows = _load_results(school_id=school_id, student_ids=[student_id])
    attempt_rows = _load_attempts(school_id=school_id, student_ids=[student_id])
    attempt_map = {_normalize(row.get("id")): row for row in attempt_rows}
    test_rows = _load_tests(school_id=school_id, test_ids=[_normalize(row.get("test_id")) for row in result_rows])
    test_map = {_normalize(row.get("id")): row for row in test_rows}
    subject_map = _load_subjects([_normalize(row.get("subject_id")) for row in test_rows], school_id=school_id)
    response_rows = _load_responses(school_id=school_id, attempt_ids=[_normalize(row.get("attempt_id")) for row in result_rows])
    question_rows = _load_questions(school_id=school_id, test_ids=[_normalize(row.get("id")) for row in test_rows])
    question_map = {_normalize(row.get("id")): row for row in question_rows}
    section_map = {
        _normalize(row.get("id")): row
        for row in _load_sections(school_id=school_id, section_ids=[_normalize(row.get("section_id")) for row in question_rows])
    }
    ranking = _get_school_ranking(school_id)

    payload = _build_student_analytics_payload(
        school_id=school_id,
        student=student,
        result_rows=result_rows,
        attempt_map=attempt_map,
        test_map=test_map,
        subject_map=subject_map,
        response_rows=response_rows,
        question_map=question_map,
        section_map=section_map,
        ranking=ranking,
    )
    return _cache_set(cache_key, payload)


def _get_school_ranking(school_id: str) -> list[tuple[str, float]]:
    school_ranking_key = f"ranking:{school_id}"
    cached_ranking = _SCHOOL_RANKING_CACHE.get(school_ranking_key)
    if cached_ranking and time.time() - cached_ranking[0] < _SCHOOL_RANKING_CACHE_TTL_SECONDS:
        return cached_ranking[1]
    school_result_rows = _load_results(school_id=school_id)
    student_scoreboard: dict[str, dict[str, float]] = defaultdict(lambda: {"score": 0.0, "max_score": 0.0})
    for row in school_result_rows:
        student_key = _normalize(row.get("student_id"))
        student_scoreboard[student_key]["score"] += float(row.get("score_obtained") or 0)
        student_scoreboard[student_key]["max_score"] += float(row.get("max_score") or 0)
    ranking = sorted(
        [(student_key, _safe_percentage(item["score"], item["max_score"])) for student_key, item in student_scoreboard.items()],
        key=lambda item: item[1], reverse=True,
    )
    _SCHOOL_RANKING_CACHE[school_ranking_key] = (time.time(), ranking)
    return ranking


def _build_student_analytics_payload(
    *,
    school_id: str,
    student: dict[str, Any],
    result_rows: list[dict[str, Any]],
    attempt_map: dict[str, dict[str, Any]],
    test_map: dict[str, dict[str, Any]],
    subject_map: dict[str, dict[str, Any]],
    response_rows: list[dict[str, Any]],
    question_map: dict[str, dict[str, Any]],
    section_map: dict[str, dict[str, Any]],
    ranking: list[tuple[str, float]],
) -> dict[str, Any]:
    student_id = _normalize(student.get("id"))

    total_score = sum(float(row.get("score_obtained") or 0) for row in result_rows)
    total_max_score = sum(float(row.get("max_score") or 0) for row in result_rows)
    total_correct = sum(int(row.get("correct_answers") or 0) for row in result_rows)
    total_attempted = sum(int(row.get("attempted_questions") or 0) for row in result_rows)
    total_time_spent = sum(int(row.get("time_spent_seconds") or attempt_map.get(_normalize(row.get("attempt_id")), {}).get("time_spent_seconds") or 0) for row in result_rows)
    overall_percentage = _safe_percentage(total_score, total_max_score)
    accuracy = _safe_percentage(total_correct, total_attempted)
    speed = round(total_time_spent / max(total_attempted, 1), 2) if total_attempted else 0.0

    subject_group: dict[str, dict[str, Any]] = defaultdict(lambda: {"subject_name": "General", "score_obtained": 0.0, "max_score": 0.0, "tests_taken": 0})
    for row in result_rows:
        test = test_map.get(_normalize(row.get("test_id")), {})
        subject_id = _normalize(test.get("subject_id")) or "general"
        subject = subject_map.get(subject_id, {})
        bucket = subject_group[subject_id]
        bucket["subject_id"] = None if subject_id == "general" else subject_id
        bucket["subject_name"] = _normalize(subject.get("name")) or "General"
        bucket["score_obtained"] += float(row.get("score_obtained") or 0)
        bucket["max_score"] += float(row.get("max_score") or 0)
        bucket["tests_taken"] += 1
    subject_percentages = [
        {
            "subject_id": bucket.get("subject_id"),
            "subject_name": bucket["subject_name"],
            "percentage": _safe_percentage(bucket["score_obtained"], bucket["max_score"]),
            "tests_taken": bucket["tests_taken"],
            "score_obtained": round(bucket["score_obtained"], 2),
            "max_score": round(bucket["max_score"], 2),
        }
        for bucket in subject_group.values()
    ]
    subject_percentages.sort(key=lambda item: item["subject_name"])

    topic_metrics = _build_topic_metrics(response_rows, question_map, section_map)
    chapter_group: dict[str, dict[str, Any]] = defaultdict(lambda: {"score_obtained": 0.0, "max_score": 0.0, "attempts_count": 0, "topics": set()})
    for metric in topic_metrics:
        bucket = chapter_group[metric["chapter_name"]]
        bucket["score_obtained"] += float(metric["score_obtained"])
        bucket["max_score"] += float(metric["max_score"])
        bucket["attempts_count"] += int(metric["attempts_count"])
        bucket["topics"].add(metric["topic_name"])
    chapter_percentages = [
        {
            "chapter_name": chapter_name,
            "percentage": _safe_percentage(bucket["score_obtained"], bucket["max_score"]),
            "attempts_count": bucket["attempts_count"],
            "topic_count": len(bucket["topics"]),
        }
        for chapter_name, bucket in chapter_group.items()
    ]
    chapter_percentages.sort(key=lambda item: item["chapter_name"])

    rank = next((index for index, item in enumerate(ranking, start=1) if item[0] == student_id), None)
    below_count = len([item for item in ranking if item[1] < overall_percentage])
    percentile = round((below_count / len(ranking)) * 100, 2) if ranking else 0.0

    latest_test_id = _normalize(result_rows[0].get("test_id")) if result_rows else None
    weak_topics = [item["topic_name"] for item in topic_metrics[:3]]
    strong_topics = [item["topic_name"] for item in sorted(topic_metrics, key=lambda item: item["percentage"], reverse=True)[:3]]
    weakest_chapter = chapter_percentages[0]["chapter_name"] if chapter_percentages else "core concepts"
    latest_test_title = _normalize(test_map.get(latest_test_id or "", {}).get("title")) if latest_test_id else ""
    suggestions = [
        f"Attempt 20 more questions on {weak_topics[0]}" if weak_topics else "Attempt 20 more mixed practice questions",
        f"Revise {weakest_chapter}" if chapter_percentages else "Revise recent weak chapters",
        f"Reattempt {latest_test_title}" if latest_test_title else "Reattempt your latest scheduled test",
    ]

    return {
        "school_id": school_id,
        "student_id": student_id,
        "student_name": _normalize(student.get("full_name")) or "Student",
        "overall_percentage": overall_percentage,
        "subject_percentages": subject_percentages,
        "chapter_percentages": chapter_percentages,
        "weak_topics": weak_topics,
        "strong_topics": strong_topics,
        "accuracy": accuracy,
        "speed": speed,
        "rank": rank,
        "percentile": percentile,
        "suggestions": suggestions,
        "latest_test_id": latest_test_id,
        "generated_at": _utc_now_iso(),
    }


def get_student_analytics_batch(school_id: str, student_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Compute per-student analytics with a single round of shared dataset loads.

    Shared Online Test metadata (tests, questions, sections) plus batch-loaded
    attempts and responses are fetched exactly once, then each student's
    analytics payload is composed in memory — no per-student aggregator calls.
    """
    ids = sorted({_normalize(s) for s in student_ids if _normalize(s)})
    if not ids:
        return {}

    student_rows = _load_students(school_id=school_id, student_ids=ids)
    student_map = {_normalize(row.get("id")): row for row in student_rows}

    result_rows = _load_results(school_id=school_id, student_ids=ids)
    result_by_student: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in result_rows:
        result_by_student[_normalize(row.get("student_id"))].append(row)

    attempt_ids = sorted({_normalize(row.get("attempt_id")) for row in result_rows if _normalize(row.get("attempt_id"))})
    attempt_map = {_normalize(row.get("id")): row for row in _load_attempts(school_id=school_id, attempt_ids=attempt_ids)}

    test_ids = sorted({_normalize(row.get("test_id")) for row in result_rows if _normalize(row.get("test_id"))})
    test_rows = _load_tests(school_id=school_id, test_ids=test_ids)
    test_map = {_normalize(row.get("id")): row for row in test_rows}
    subject_map = _load_subjects([_normalize(row.get("subject_id")) for row in test_rows], school_id=school_id)

    response_rows = _load_responses(school_id=school_id, attempt_ids=attempt_ids)
    question_rows = _load_questions(school_id=school_id, test_ids=test_ids)
    question_map = {_normalize(row.get("id")): row for row in question_rows}
    section_map = {
        _normalize(row.get("id")): row
        for row in _load_sections(school_id=school_id, section_ids=[_normalize(row.get("section_id")) for row in question_rows])
    }

    ranking = _get_school_ranking(school_id)

    payloads: dict[str, dict[str, Any]] = {}
    for student_id in ids:
        payloads[student_id] = _build_student_analytics_payload(
            school_id=school_id,
            student=student_map.get(student_id, {"id": student_id}),
            result_rows=result_by_student.get(student_id, []),
            attempt_map=attempt_map,
            test_map=test_map,
            subject_map=subject_map,
            response_rows=[row for row in response_rows if _normalize(row.get("student_id")) == student_id],
            question_map=question_map,
            section_map=section_map,
            ranking=ranking,
        )
    return payloads


def persist_student_analytics(school_id: str, student_id: str, *, actor_profile_id: str | None = None) -> None:
    payload = get_student_analytics(school_id, student_id, actor_profile_id=actor_profile_id)
    result_rows = _load_results(school_id=school_id, student_ids=[student_id])
    response_rows = _load_responses(school_id=school_id, student_ids=[student_id])
    question_rows = _load_questions(school_id=school_id, test_ids=[
        _normalize(row.get("test_id")) for row in result_rows
    ])
    topic_metrics = _build_topic_metrics(
        response_rows,
        {_normalize(row.get("id")): row for row in question_rows},
        {},
    )
    _upsert_student_performance_snapshot(school_id, student_id, payload)
    _replace_topic_performance_rows(
        owner_type="student",
        owner_id=student_id,
        school_id=school_id,
        topic_rows=topic_metrics,
        context={"student_id": student_id},
    )
    _log_audit_entry(
        school_id=school_id,
        profile_id=actor_profile_id,
        action="analytics.student.generated",
        payload={"student_id": student_id},
    )


def get_test_analytics(school_id: str, test_id: str, *, actor_profile_id: str | None = None) -> dict[str, Any]:
    cache_key = f"test:{school_id}:{test_id}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    test = _get_test(school_id, test_id)
    result_rows = _load_results(school_id=school_id, test_id=test_id)
    attempt_rows = _load_attempts(school_id=school_id, test_id=test_id)
    attempt_map = {_normalize(row.get("id")): row for row in attempt_rows}
    response_rows = _load_responses(school_id=school_id, test_id=test_id)
    question_rows = _load_questions(school_id=school_id, test_ids=[test_id])
    question_map = {_normalize(row.get("id")): row for row in question_rows}
    section_map = {
        _normalize(row.get("id")): row
        for row in _load_sections(school_id=school_id, section_ids=[_normalize(row.get("section_id")) for row in question_rows])
    }
    student_rows = _load_students(school_id=school_id, student_ids=[_normalize(row.get("student_id")) for row in result_rows])
    student_map = {_normalize(row.get("id")): row for row in student_rows}
    batch_map = _load_batches(
        [_normalize(row.get("batch_id")) for row in student_rows] + [_normalize(test.get("batch_id"))],
        school_id=school_id,
    )
    creator_profile_map = _load_profiles([_normalize(test.get("created_by_profile_id"))], school_id=school_id)

    average_percentage = round(sum(float(row.get("percentage") or 0) for row in result_rows) / len(result_rows), 2) if result_rows else 0.0
    average_score = round(sum(float(row.get("score_obtained") or 0) for row in result_rows) / len(result_rows), 2) if result_rows else 0.0
    completed_attempts = len([row for row in attempt_rows if _normalize(row.get("status")) in {"submitted", "evaluated"}])
    completion_rate = _safe_percentage(completed_attempts, len(attempt_rows))

    topper_list = _named_score_rows(result_rows, student_map, batch_map, 5, reverse=True)
    weak_students = _named_score_rows(result_rows, student_map, batch_map, 5, reverse=False)

    response_group: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for response in response_rows:
        response_group[_normalize(response.get("question_id"))].append(response)
    question_difficulty_analysis: list[dict[str, Any]] = []
    for question in question_rows:
        group = response_group.get(_normalize(question.get("id")), [])
        attempted_count = len(group)
        correct_count = len([item for item in group if item.get("is_correct") is True])
        average_marks = round(sum(float(item.get("marks_awarded") or 0) for item in group) / attempted_count, 2) if attempted_count else 0.0
        correct_rate = _safe_percentage(correct_count, attempted_count)
        classification = "hard" if correct_rate < 40 else "medium" if correct_rate < 75 else "easy"
        question_difficulty_analysis.append(
            {
                "question_id": _normalize(question.get("id")),
                "prompt_text": _normalize(question.get("prompt_text"))[:120],
                "difficulty_level": _normalize(question.get("difficulty_level")) or "medium",
                "correct_rate": correct_rate,
                "attempted_count": attempted_count,
                "average_marks": average_marks,
                "classification": classification,
            }
        )

    topic_metrics = _build_topic_metrics(response_rows, question_map, section_map)
    chapter_group: dict[str, dict[str, Any]] = defaultdict(lambda: {"score_obtained": 0.0, "max_score": 0.0, "attempts_count": 0, "topics": set()})
    for metric in topic_metrics:
        bucket = chapter_group[metric["chapter_name"]]
        bucket["score_obtained"] += float(metric["score_obtained"])
        bucket["max_score"] += float(metric["max_score"])
        bucket["attempts_count"] += int(metric["attempts_count"])
        bucket["topics"].add(metric["topic_name"])
    chapter_performance = [
        {
            "chapter_name": chapter_name,
            "percentage": _safe_percentage(bucket["score_obtained"], bucket["max_score"]),
            "attempts_count": bucket["attempts_count"],
            "topic_count": len(bucket["topics"]),
        }
        for chapter_name, bucket in chapter_group.items()
    ]
    chapter_performance.sort(key=lambda item: item["percentage"])

    batch_group: dict[str, dict[str, Any]] = defaultdict(lambda: {"batch_name": "Unassigned", "student_ids": set(), "score": 0.0, "max_score": 0.0})
    for row in result_rows:
        student = student_map.get(_normalize(row.get("student_id")), {})
        batch_id = _normalize(student.get("batch_id")) or "unassigned"
        batch = batch_map.get(batch_id, {})
        bucket = batch_group[batch_id]
        bucket["batch_id"] = None if batch_id == "unassigned" else batch_id
        bucket["batch_name"] = _normalize(batch.get("name")) or "Unassigned"
        bucket["student_ids"].add(_normalize(row.get("student_id")))
        bucket["score"] += float(row.get("score_obtained") or 0)
        bucket["max_score"] += float(row.get("max_score") or 0)
    batch_comparison = [
        {
            "batch_id": bucket.get("batch_id"),
            "batch_name": bucket["batch_name"],
            "student_count": len(bucket["student_ids"]),
            "average_percentage": _safe_percentage(bucket["score"], bucket["max_score"]),
            "average_score": round(bucket["score"] / max(len(bucket["student_ids"]), 1), 2) if bucket["student_ids"] else 0.0,
        }
        for bucket in batch_group.values()
    ]
    batch_comparison.sort(key=lambda item: item["average_percentage"], reverse=True)

    payload = {
        "school_id": school_id,
        "test_id": test_id,
        "test_title": _normalize(test.get("title")) or "Online Test",
        "subject_id": _normalize(test.get("subject_id")) or None,
        "batch_id": _normalize(test.get("batch_id")) or None,
        "teacher_name": _normalize(creator_profile_map.get(_normalize(test.get("created_by_profile_id")), {}).get("display_name"))
        or _normalize(creator_profile_map.get(_normalize(test.get("created_by_profile_id")), {}).get("full_name"))
        or None,
        "average_percentage": average_percentage,
        "average_score": average_score,
        "participant_count": len(result_rows),
        "completion_rate": completion_rate,
        "topper_list": topper_list,
        "weak_students": weak_students,
        "question_difficulty_analysis": sorted(question_difficulty_analysis, key=lambda item: item["correct_rate"]),
        "chapter_performance": chapter_performance,
        "batch_comparison": batch_comparison,
        "generated_at": _utc_now_iso(),
    }
    _upsert_test_analytics_snapshot(school_id, test_id, payload)
    _replace_topic_performance_rows(
        owner_type="test",
        owner_id=test_id,
        school_id=school_id,
        topic_rows=topic_metrics,
        context={"test_id": test_id, "batch_id": payload.get("batch_id"), "subject_id": payload.get("subject_id")},
    )
    _log_audit_entry(
        school_id=school_id,
        profile_id=actor_profile_id,
        action="analytics.test.generated",
        payload={"test_id": test_id},
    )
    return _cache_set(cache_key, payload)


def get_batch_analytics(school_id: str, batch_id: str, *, actor_profile_id: str | None = None) -> dict[str, Any]:
    cache_key = f"batch:{school_id}:{batch_id}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    batch = _get_batch(school_id, batch_id)
    student_rows = _load_students(school_id=school_id, batch_id=batch_id)
    student_ids = [_normalize(row.get("id")) for row in student_rows]
    result_rows = _load_results(school_id=school_id, student_ids=student_ids)
    test_rows = _load_tests(school_id=school_id, test_ids=[_normalize(row.get("test_id")) for row in result_rows])
    test_map = {_normalize(row.get("id")): row for row in test_rows}
    subject_map = _load_subjects([_normalize(row.get("subject_id")) for row in test_rows], school_id=school_id)
    attempt_rows = _load_attempts(school_id=school_id, student_ids=student_ids)
    response_rows = _load_responses(school_id=school_id, student_ids=student_ids)
    question_rows = _load_questions(school_id=school_id, test_ids=[_normalize(row.get("id")) for row in test_rows])
    question_map = {_normalize(row.get("id")): row for row in question_rows}
    section_map = {
        _normalize(row.get("id")): row
        for row in _load_sections(school_id=school_id, section_ids=[_normalize(row.get("section_id")) for row in question_rows])
    }
    batch_map = _load_batches([batch_id], school_id=school_id)
    student_map = {_normalize(row.get("id")): row for row in student_rows}

    total_score = sum(float(row.get("score_obtained") or 0) for row in result_rows)
    total_max_score = sum(float(row.get("max_score") or 0) for row in result_rows)
    overall_percentage = _safe_percentage(total_score, total_max_score)

    subject_group: dict[str, dict[str, Any]] = defaultdict(lambda: {"subject_name": "General", "score": 0.0, "max_score": 0.0, "tests_taken": 0})
    for row in result_rows:
        test = test_map.get(_normalize(row.get("test_id")), {})
        subject_id = _normalize(test.get("subject_id")) or "general"
        subject = subject_map.get(subject_id, {})
        bucket = subject_group[subject_id]
        bucket["subject_id"] = None if subject_id == "general" else subject_id
        bucket["subject_name"] = _normalize(subject.get("name")) or "General"
        bucket["score"] += float(row.get("score_obtained") or 0)
        bucket["max_score"] += float(row.get("max_score") or 0)
        bucket["tests_taken"] += 1
    subject_percentages = [
        {
            "subject_id": bucket.get("subject_id"),
            "subject_name": bucket["subject_name"],
            "percentage": _safe_percentage(bucket["score"], bucket["max_score"]),
            "tests_taken": bucket["tests_taken"],
            "score_obtained": round(bucket["score"], 2),
            "max_score": round(bucket["max_score"], 2),
        }
        for bucket in subject_group.values()
    ]
    subject_percentages.sort(key=lambda item: item["percentage"])

    student_rankings = _named_score_rows(result_rows, student_map, batch_map, 5, reverse=True)
    weak_students = _named_score_rows(result_rows, student_map, batch_map, 5, reverse=False)

    month_group: dict[str, dict[str, float]] = defaultdict(lambda: {"score": 0.0, "max_score": 0.0, "tests_taken": 0})
    for row in result_rows:
        key = _month_key(row.get("published_at") or row.get("created_at"))
        month_group[key]["score"] += float(row.get("score_obtained") or 0)
        month_group[key]["max_score"] += float(row.get("max_score") or 0)
        month_group[key]["tests_taken"] += 1
    monthly_progress = [
        {
            "period": period,
            "average_percentage": _safe_percentage(bucket["score"], bucket["max_score"]),
            "tests_count": int(bucket["tests_taken"]),
        }
        for period, bucket in sorted(month_group.items())
    ]

    topic_metrics = _build_topic_metrics(response_rows, question_map, section_map)
    weak_topics = [item["topic_name"] for item in topic_metrics[:3]]
    suggestions = [
        f"Focus revision sessions on {weak_topics[0]}" if weak_topics else "Focus on mixed revision sessions",
        f"Schedule one timed practice for {batch.get('name') or 'this batch'}",
        "Review the lowest-performing subject trend before the next test cycle",
    ]

    payload = {
        "school_id": school_id,
        "batch_id": batch_id,
        "batch_name": _normalize(batch.get("name")) or "Batch",
        "class_name": _normalize(batch.get("class_name")) or None,
        "section": _normalize(batch.get("section")) or None,
        "overall_percentage": overall_percentage,
        "active_students": len(student_rows),
        "subject_percentages": subject_percentages,
        "weak_students": weak_students,
        "strong_students": student_rankings,
        "monthly_progress": monthly_progress,
        "weak_topics": weak_topics,
        "suggestions": suggestions,
        "generated_at": _utc_now_iso(),
    }
    _replace_topic_performance_rows(
        owner_type="batch",
        owner_id=batch_id,
        school_id=school_id,
        topic_rows=topic_metrics,
        context={"batch_id": batch_id},
    )
    _log_audit_entry(
        school_id=school_id,
        profile_id=actor_profile_id,
        action="analytics.batch.generated",
        payload={"batch_id": batch_id},
    )
    return _cache_set(cache_key, payload)


def get_school_analytics(school_id: str, *, actor_profile_id: str | None = None) -> dict[str, Any]:
    cache_key = f"school:{school_id}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    result_rows = _load_results(school_id=school_id)
    test_rows = _load_tests(school_id=school_id)
    student_rows = _load_students(school_id=school_id)
    test_map = {_normalize(row.get("id")): row for row in test_rows}
    subject_map = _load_subjects([_normalize(row.get("subject_id")) for row in test_rows], school_id=school_id)
    profile_map = _load_profiles([_normalize(row.get("created_by_profile_id")) for row in test_rows], school_id=school_id)
    school_map = _load_schools([school_id])

    total_score = sum(float(row.get("score_obtained") or 0) for row in result_rows)
    total_max_score = sum(float(row.get("max_score") or 0) for row in result_rows)
    average_score = round(total_score / len(result_rows), 2) if result_rows else 0.0
    average_percentage = _safe_percentage(total_score, total_max_score)

    student_map = {_normalize(row.get("id")): row for row in student_rows}
    class_group: dict[str, dict[str, float]] = defaultdict(lambda: {"score": 0.0, "max_score": 0.0, "tests_count": 0})
    teacher_group: dict[str, dict[str, float]] = defaultdict(lambda: {"score": 0.0, "max_score": 0.0, "tests_count": 0})
    subject_group: dict[str, dict[str, float]] = defaultdict(lambda: {"score": 0.0, "max_score": 0.0, "tests_count": 0})
    month_group: dict[str, dict[str, float]] = defaultdict(lambda: {"score": 0.0, "max_score": 0.0, "tests_count": 0})

    for row in result_rows:
        test = test_map.get(_normalize(row.get("test_id")), {})
        student = student_map.get(_normalize(row.get("student_id")), {})
        class_name = _normalize(student.get("class_name")) or "Unknown"
        teacher_id = _normalize(test.get("created_by_profile_id")) or "unknown"
        teacher_profile = profile_map.get(teacher_id, {})
        teacher_name = _normalize(teacher_profile.get("display_name")) or _normalize(teacher_profile.get("full_name")) or "Unknown"
        subject_id = _normalize(test.get("subject_id")) or "general"
        subject_name = _normalize(subject_map.get(subject_id, {}).get("name")) or "General"
        month = _month_key(row.get("published_at") or row.get("created_at"))

        for bucket in (class_group[class_name], teacher_group[teacher_name], subject_group[subject_name], month_group[month]):
            bucket["score"] += float(row.get("score_obtained") or 0)
            bucket["max_score"] += float(row.get("max_score") or 0)
            bucket["tests_count"] += 1

    class_wise_performance = [
        {"name": name, "average_percentage": _safe_percentage(bucket["score"], bucket["max_score"]), "tests_count": int(bucket["tests_count"])}
        for name, bucket in class_group.items()
    ]
    teacher_wise_performance = [
        {"name": name, "average_percentage": _safe_percentage(bucket["score"], bucket["max_score"]), "tests_count": int(bucket["tests_count"])}
        for name, bucket in teacher_group.items()
    ]
    subject_wise_trends = [
        {"name": name, "average_percentage": _safe_percentage(bucket["score"], bucket["max_score"]), "tests_count": int(bucket["tests_count"])}
        for name, bucket in subject_group.items()
    ]
    monthly_progress = [
        {"period": period, "average_percentage": _safe_percentage(bucket["score"], bucket["max_score"]), "tests_count": int(bucket["tests_count"])}
        for period, bucket in sorted(month_group.items())
    ]

    payload = {
        "school_id": school_id,
        "school_name": _normalize(school_map.get(school_id, {}).get("name")) or "School",
        "class_wise_performance": sorted(class_wise_performance, key=lambda item: item["average_percentage"], reverse=True),
        "teacher_wise_performance": sorted(teacher_wise_performance, key=lambda item: item["average_percentage"], reverse=True),
        "subject_wise_trends": sorted(subject_wise_trends, key=lambda item: item["average_percentage"], reverse=True),
        "monthly_progress": monthly_progress,
        "active_students": len(student_rows),
        "active_tests": len([row for row in test_rows if _normalize(row.get("status")) in {"published", "in_progress", "completed"}]),
        "average_score": average_score,
        "average_percentage": average_percentage,
        "generated_at": _utc_now_iso(),
    }
    _upsert_school_analytics_snapshot("school", school_id, school_id, payload)
    _log_audit_entry(
        school_id=school_id,
        profile_id=actor_profile_id,
        action="analytics.school.generated",
        payload={"school_id": school_id},
    )
    return _cache_set(cache_key, payload)


def get_platform_analytics(*, actor_profile_id: str | None = None) -> dict[str, Any]:
    cache_key = "platform:global"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    result_rows = _load_results()
    attempt_rows = _load_attempts()
    test_rows = _load_tests()
    school_ids = sorted({_normalize(row.get("school_id")) for row in result_rows + test_rows if _normalize(row.get("school_id"))})
    school_map = _load_schools(school_ids)

    school_group: dict[str, dict[str, float]] = defaultdict(lambda: {"score": 0.0, "max_score": 0.0, "tests_count": 0, "students": set()})
    for row in result_rows:
        school_id = _normalize(row.get("school_id"))
        if not school_id:
            continue
        bucket = school_group[school_id]
        bucket["score"] += float(row.get("score_obtained") or 0)
        bucket["max_score"] += float(row.get("max_score") or 0)
        bucket["tests_count"] += 1
        bucket["students"].add(_normalize(row.get("student_id")))

    cross_school_comparison = [
        {
            "school_id": school_id,
            "school_name": _normalize(school_map.get(school_id, {}).get("name")) or "School",
            "average_percentage": _safe_percentage(bucket["score"], bucket["max_score"]),
            "tests_count": int(bucket["tests_count"]),
            "active_students": len(bucket["students"]),
        }
        for school_id, bucket in school_group.items()
    ]
    cross_school_comparison.sort(key=lambda item: item["average_percentage"], reverse=True)

    unique_student_ids = {_normalize(row.get("student_id")) for row in result_rows if _normalize(row.get("student_id"))}
    active_tests = len([row for row in test_rows if _normalize(row.get("status")) in {"published", "in_progress", "completed"}])
    total_score = sum(float(row.get("score_obtained") or 0) for row in result_rows)
    total_max_score = sum(float(row.get("max_score") or 0) for row in result_rows)
    usage_metrics = {
        "total_attempts": len(attempt_rows),
        "submitted_attempts": len([row for row in attempt_rows if _normalize(row.get("status")) in {"submitted", "evaluated"}]),
        "results_generated": len(result_rows),
        "schools_active": len(cross_school_comparison),
    }

    payload = {
        "cross_school_comparison": cross_school_comparison,
        "active_students": len(unique_student_ids),
        "active_tests": active_tests,
        "average_score": round(total_score / len(result_rows), 2) if result_rows else 0.0,
        "average_percentage": _safe_percentage(total_score, total_max_score),
        "usage_metrics": usage_metrics,
        "generated_at": _utc_now_iso(),
    }
    _upsert_school_analytics_snapshot("platform", "platform", None, payload)
    _log_audit_entry(
        school_id=None,
        profile_id=actor_profile_id,
        action="analytics.platform.generated",
        payload={"schools_count": len(cross_school_comparison)},
    )
    return _cache_set(cache_key, payload)
