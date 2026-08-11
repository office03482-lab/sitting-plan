"""Grounded academic doubt solver using OCR-style extraction and platform context."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from app.services.ai_provider import AIProviderError, generate_json
from app.services.supabase_ai_tutor import (
    _ai_table,
    _build_context_snapshot,
    _find_matching_assignments,
    _find_matching_lessons,
    _find_matching_recordings,
    _find_matching_recommendations,
    _log_audit_entry,
    _normalize,
    _normalize_json_object,
    _normalize_optional_uuid,
    _public_table,
    _resolve_student_context,
)
from app.services.supabase_attendance import create_notification
from app.services.supabase_online_tests import list_tests

MODULE_KEY = "doubt_solver"
AI_SCHEMA = "ai"

DETECTABLE_SUBJECTS = ("physics", "chemistry", "biology", "mathematics")
TOPIC_KEYWORDS: dict[str, dict[str, tuple[str, ...]]] = {
    "physics": {
        "kinematics": ("velocity", "acceleration", "displacement", "motion", "speed", "projectile"),
        "thermodynamics": ("heat", "temperature", "entropy", "enthalpy", "engine", "thermodynamics"),
        "electricity": ("current", "voltage", "resistance", "circuit", "ohm"),
        "optics": ("ray", "mirror", "lens", "refraction", "reflection"),
    },
    "chemistry": {
        "mole concept": ("mole", "avogadro", "molar", "mass", "stoichiometry"),
        "chemical bonding": ("bond", "ionic", "covalent", "electronegativity", "valency"),
        "thermodynamics": ("enthalpy", "gibbs", "spontaneous", "heat", "entropy"),
        "equilibrium": ("equilibrium", "le chatelier", "kc", "reaction quotient"),
    },
    "biology": {
        "genetics": ("gene", "dna", "inheritance", "allele", "genetics", "chromosome"),
        "ecology": ("ecosystem", "population", "food chain", "ecology", "biosphere"),
        "cell biology": ("cell", "organelle", "mitochondria", "membrane"),
    },
    "mathematics": {
        "algebra": ("equation", "polynomial", "factor", "quadratic", "algebra"),
        "calculus": ("derivative", "integration", "limit", "differentiate", "integrate"),
        "trigonometry": ("sin", "cos", "tan", "angle", "trigonometry"),
        "coordinate geometry": ("slope", "line", "circle", "coordinate", "distance formula"),
    },
}

SUBJECT_KEYWORDS: dict[str, tuple[str, ...]] = {
    "physics": ("velocity", "force", "acceleration", "current", "circuit", "lens", "ray", "displacement"),
    "chemistry": ("mole", "bond", "compound", "reaction", "atom", "ionic", "covalent", "equilibrium"),
    "biology": ("cell", "gene", "dna", "organism", "ecology", "respiration", "photosynthesis"),
    "mathematics": ("solve", "equation", "integral", "derivative", "triangle", "matrix", "probability"),
}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_text(raw: str) -> str:
    return re.sub(r"\s+", " ", _normalize(raw)).strip()


def _student_tool_role_key(role_key: str) -> str:
    normalized = _normalize(role_key).lower()
    if normalized == "platform_admin":
        return "platform_admin"
    return "student"


def _detect_language(text: str, fallback: str | None = None) -> str:
    requested = _normalize(fallback).lower()
    if requested in {"english", "hindi", "mixed"}:
        return requested
    has_devanagari = bool(re.search(r"[\u0900-\u097F]", text))
    has_latin = bool(re.search(r"[A-Za-z]", text))
    if has_devanagari and has_latin:
        return "mixed"
    if has_devanagari:
        return "hindi"
    return "english"


def _extract_text(payload: dict[str, Any], input_type: str) -> tuple[str, dict[str, Any]]:
    text_candidates = [
        payload.get("question"),
        payload.get("prompt"),
        payload.get("extracted_text"),
        payload.get("ocr_text"),
        payload.get("file_name"),
    ]
    combined = " ".join(_normalize(candidate) for candidate in text_candidates if _normalize(candidate))
    normalized = _normalize_text(combined)
    extraction_meta = {
        "ocr_engine": "heuristic_pipeline",
        "input_type": input_type,
        "used_uploaded_text": bool(_normalize(payload.get("extracted_text")) or _normalize(payload.get("ocr_text"))),
        "text_length": len(normalized),
    }
    if not normalized:
        raise HTTPException(status_code=400, detail="Question text or extracted OCR text is required")
    return normalized, extraction_meta


def _extract_equations(text: str) -> list[str]:
    matches = re.findall(r"[A-Za-z0-9\(\)\+\-\*/\^ ]{2,}=[A-Za-z0-9\(\)\+\-\*/\^ ]{1,}", text)
    if matches:
        return list(dict.fromkeys(_normalize_text(match) for match in matches))[:5]
    formula_like = re.findall(r"(?:sin|cos|tan|log|ln|dx|dy|H2O|CO2|NaCl|E=mc\^2)[A-Za-z0-9\(\)\+\-\*/\^ ]*", text, flags=re.IGNORECASE)
    return list(dict.fromkeys(_normalize_text(match) for match in formula_like if _normalize_text(match)))[:5]


def _extract_numericals(text: str) -> list[str]:
    numeric_matches = re.findall(r"\b\d+(?:\.\d+)?\s?(?:m/s|kg|g|mol|cm|mm|K|J|V|A|ohm|%)?\b", text, flags=re.IGNORECASE)
    return list(dict.fromkeys(_normalize_text(match) for match in numeric_matches if _normalize_text(match)))[:8]


def _extract_mcqs(text: str) -> list[dict[str, Any]]:
    option_pattern = re.compile(r"([A-D])[\)\.\-]\s*([^A-D]{1,80}?)(?=(?:\s+[A-D][\)\.\-])|$)")
    options = option_pattern.findall(text)
    if len(options) < 2:
        return []
    return [{"option": letter, "text": _normalize_text(value)} for letter, value in options[:4]]


def _extract_diagrams(text: str) -> list[str]:
    diagram_keywords = ("diagram", "figure", "graph", "circuit", "ray", "table", "flowchart", "triangle")
    found = [keyword for keyword in diagram_keywords if keyword in text.lower()]
    return found[:5]


def _detect_subject(text: str) -> tuple[str, float]:
    lowered = text.lower()
    scores: dict[str, int] = {subject: 0 for subject in DETECTABLE_SUBJECTS}
    for subject, keywords in SUBJECT_KEYWORDS.items():
        for keyword in keywords:
            if keyword in lowered:
                scores[subject] += len(keyword)
    if re.search(r"\b(?:sin|cos|tan|integral|derivative|matrix)\b", lowered):
        scores["mathematics"] += 12
    if re.search(r"\b(?:current|voltage|resistance|force|lens)\b", lowered):
        scores["physics"] += 12
    if re.search(r"\b(?:mole|bond|reaction|atom|compound)\b", lowered):
        scores["chemistry"] += 12
    if re.search(r"\b(?:dna|gene|cell|organism|ecology)\b", lowered):
        scores["biology"] += 12
    subject, score = max(scores.items(), key=lambda item: item[1])
    if score <= 0:
        return "general", 35.0
    return subject, min(95.0, 45.0 + score)


def _detect_topic(subject: str, text: str) -> tuple[str, float]:
    subject_topics = TOPIC_KEYWORDS.get(subject, {})
    lowered = text.lower()
    topic_scores: dict[str, int] = {}
    for topic, keywords in subject_topics.items():
        topic_scores[topic] = sum(len(keyword) for keyword in keywords if keyword in lowered)
    if not topic_scores:
        return "general", 30.0
    topic, score = max(topic_scores.items(), key=lambda item: item[1])
    if score <= 0:
        return "general", 35.0
    return topic, min(92.0, 40.0 + score)


def _confidence_score(*, input_type: str, text: str, subject_confidence: float, topic_confidence: float, entity_count: int) -> float:
    score = 25.0
    score += min(len(text) / 6, 20)
    score += subject_confidence * 0.25
    score += topic_confidence * 0.25
    score += min(entity_count * 4, 12)
    if input_type in {"image", "pdf", "screenshot", "handwritten"} and len(text) < 24:
        score -= 20
    return max(0.0, min(99.0, round(score, 2)))


def _teacher_escalation_target(school_id: str) -> str | None:
    response = (
        _public_table("school_memberships")
        .select("profile_id,roles!inner(role_key)")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .eq("status", "active")
        .eq("roles.role_key", "teacher")
        .limit(1)
        .execute()
    )
    rows = list(response.data or [])
    if not rows:
        return None
    return _normalize(rows[0].get("profile_id")) or None


def _select_related_tests(school_id: str, student: dict[str, Any] | None, topic: str) -> list[dict[str, Any]]:
    candidate_tests = list_tests(
        school_id,
        student_batch_id=_normalize((student or {}).get("batch_id")) or None,
        limit=10,
    )
    matches = []
    for row in candidate_tests:
        title = _normalize(row.get("title") or row.get("subject_name") or row.get("description"))
        score = 20 if topic.lower() in title.lower() else 0
        if score:
            matches.append({"recommendation_type": "test", "title": row.get("title") or "Practice test", "payload": row})
    return matches[:3]


def _stepwise_solution(subject: str, topic: str, text: str, equations: list[str], numericals: list[str], context: dict[str, Any]) -> dict[str, Any]:
    weak_topics = [str(item) for item in list(context.get("weak_topic_history") or [])]
    is_weak = topic.lower() in {item.lower() for item in weak_topics}
    tone = "simple" if is_weak else "exam-oriented"
    first_equation = equations[0] if equations else None
    first_value = numericals[0] if numericals else None

    steps = [
        f"Identify the chapter as {topic.title()} under {subject.title()}.",
        "Read the demand of the question carefully and separate the given data from what needs to be found.",
        "Choose the governing concept, law, formula, or biological principle before calculation.",
    ]
    if first_equation:
        steps.append(f"Use the extracted relation `{first_equation}` as the working equation if it matches the question statement.")
    if first_value:
        steps.append(f"Track the numerical values carefully, starting with `{first_value}`, and maintain consistent units.")
    steps.append("Substitute values or concept statements in a clean order and verify that the final result matches the question type.")

    explanation = (
        f"This {tone} solution is grounded in your detected topic `{topic}` and your existing academic context. "
        f"The solver is prioritizing the chapter pattern first, then mapping the question text into a reproducible method."
    )
    final_answer = (
        "Concept answer derived from the extracted prompt. Recheck the final value with the exact source image/PDF if OCR was partial."
        if subject == "general"
        else f"The likely final answer follows the standard {topic} method. Confirm the exact final expression after matching the extracted values."
    )
    shortcut = f"For {topic}, first classify the question pattern, then apply the direct formula/principle before expanding the explanation."
    mistakes = [
        "Misreading the requirement of the question before starting the solution.",
        "Using the wrong formula or principle for a nearby topic.",
        "Skipping units, sign conventions, or option elimination logic.",
    ]
    return {
        "explanation": explanation,
        "final_answer": final_answer,
        "shortcut_method": shortcut,
        "common_mistakes": mistakes,
        "step_by_step": steps,
    }


def _extract_first_number(pattern: str, text: str) -> float | None:
    match = re.search(pattern, text, flags=re.IGNORECASE)
    if not match:
        return None
    try:
        return float(match.group(1))
    except (TypeError, ValueError, IndexError):
        return None


def _deterministic_solution(subject: str, topic: str, text: str) -> dict[str, Any] | None:
    lowered = text.lower()

    if any(keyword in lowered for keyword in ("ohm", "resistor", "voltage", "current", "resistance")):
        voltage = _extract_first_number(r"(\d+(?:\.\d+)?)\s*v", text)
        resistance = _extract_first_number(r"(\d+(?:\.\d+)?)\s*(?:ohm|Ω)", text)
        if voltage is not None and resistance not in (None, 0) and "current" in lowered:
            current = voltage / resistance
            return {
                "explanation": "Use Ohm's Law. Current is equal to voltage divided by resistance.",
                "final_answer": f"{current:g} A",
                "shortcut_method": "Apply I = V / R after identifying the given voltage and resistance.",
                "common_mistakes": [
                    "Multiplying V and R instead of dividing.",
                    "Forgetting the final unit ampere (A).",
                    "Using the wrong required quantity in the formula.",
                ],
                "step_by_step": [
                    f"Given values: V = {voltage:g} V and R = {resistance:g} ohm.",
                    "Required quantity: current I.",
                    "Formula: I = V / R.",
                    f"Substitution: I = {voltage:g} / {resistance:g}.",
                    f"Calculation: I = {current:g}.",
                    f"Final answer: {current:g} A.",
                ],
            }

    linear_match = re.search(r"([+-]?\d*)x([+-]\d+)?=([+-]?\d+)", text.replace(" ", ""), flags=re.IGNORECASE)
    if linear_match:
        a_raw, b_raw, c_raw = linear_match.groups()
        a = -1 if a_raw == "-" else 1 if a_raw in {"", "+"} else int(a_raw)
        b = int(b_raw or "0")
        c = int(c_raw)
        if a != 0:
            result = (c - b) / a
            return {
                "explanation": "Rearrange the linear equation and divide by the coefficient of x.",
                "final_answer": f"x = {result:g}",
                "shortcut_method": "For ax + b = c, use x = (c - b) / a.",
                "common_mistakes": [
                    "Changing the sign incorrectly while moving the constant term.",
                    "Forgetting to divide by the coefficient of x.",
                ],
                "step_by_step": [
                    f"Equation: {a}x + ({b}) = {c}.",
                    f"Move the constant term: {a}x = {c} - ({b}) = {c - b:g}.",
                    f"Divide by {a}: x = {c - b:g} / {a}.",
                    f"Final answer: x = {result:g}.",
                ],
            }

    if any(keyword in lowered for keyword in ("mole", "moles")) and "molar mass" in lowered:
        mass = _extract_first_number(r"(\d+(?:\.\d+)?)\s*g", text)
        molar_mass = _extract_first_number(r"molar mass(?:\s+of)?(?:\s+[A-Za-z0-9]+)?\s*(\d+(?:\.\d+)?)\s*g", text)
        if mass is not None and molar_mass not in (None, 0):
            moles = mass / molar_mass
            return {
                "explanation": "Number of moles is mass divided by molar mass.",
                "final_answer": f"{moles:g} mol",
                "shortcut_method": "Use n = m / M.",
                "common_mistakes": [
                    "Multiplying mass and molar mass instead of dividing.",
                    "Ignoring the mol unit in the final answer.",
                ],
                "step_by_step": [
                    f"Given values: mass = {mass:g} g and molar mass = {molar_mass:g} g/mol.",
                    "Required quantity: number of moles n.",
                    "Formula: n = m / M.",
                    f"Substitution: n = {mass:g} / {molar_mass:g}.",
                    f"Calculation: n = {moles:g}.",
                    f"Final answer: {moles:g} mol.",
                ],
            }

    return None


def _ai_solution(subject: str, topic: str, text: str, context: dict[str, Any]) -> dict[str, Any] | None:
    prompt = (
        "You are an academic doubt solver.\n"
        "Return strict JSON only with keys: interpretation, given, formula, calculation, result, unit, explanation, common_mistakes, step_by_step, uncertainty.\n"
        "Rules:\n"
        "- Prioritize correctness over generic language.\n"
        "- For numerical questions, identify values, formula, substitution, calculation, and final answer with units.\n"
        "- For conceptual questions, explain directly and clearly.\n"
        "- If the information is incomplete or ambiguous, set uncertainty and do not invent values.\n"
        f"- Detected subject: {subject}\n"
        f"- Detected topic: {topic}\n"
        f"- Context summary: {context.get('analytics_summary')}\n"
        f"- Question: {text}\n"
    )
    try:
        generated = generate_json(prompt)
    except AIProviderError:
        return None
    uncertainty = _normalize(generated.get("uncertainty"))
    result_text = _normalize(generated.get("result"))
    unit = _normalize(generated.get("unit"))
    final_answer = f"{result_text} {unit}".strip() if result_text else None
    explanation = _normalize(generated.get("explanation")) or uncertainty or ""
    step_by_step = [_normalize(item) for item in list(generated.get("step_by_step") or []) if _normalize(item)]
    common_mistakes = [_normalize(item) for item in list(generated.get("common_mistakes") or []) if _normalize(item)]
    if not explanation:
        return None
    return {
        "explanation": explanation,
        "final_answer": final_answer,
        "shortcut_method": _normalize(generated.get("formula")) or None,
        "common_mistakes": common_mistakes,
        "step_by_step": step_by_step or ([uncertainty] if uncertainty else []),
    }


def _recommendations_bundle(school_id: str, student: dict[str, Any] | None, topic: str) -> list[dict[str, Any]]:
    student_id = _normalize((student or {}).get("id")) or None
    lesson_rows = _find_matching_lessons(school_id, student, topic)[:2]
    recording_rows = _find_matching_recordings(school_id, topic)[:2]
    assignment_rows = _find_matching_assignments(school_id, student, topic)[:2]
    recommendation_rows = _find_matching_recommendations(school_id, student_id, topic)[:2]
    test_rows = _select_related_tests(school_id, student, topic)[:2]
    payload: list[dict[str, Any]] = []
    payload.extend({"recommendation_type": "lesson", "title": row.get("lesson_title") or row.get("title") or "Lesson", "summary": row.get("lesson_description"), "payload": row} for row in lesson_rows)
    payload.extend({"recommendation_type": "recording", "title": row.get("title") or "Recording", "summary": row.get("notes_url"), "payload": row} for row in recording_rows)
    payload.extend({"recommendation_type": "assignment", "title": row.get("title") or "Assignment", "summary": row.get("description"), "payload": row} for row in assignment_rows)
    payload.extend({"recommendation_type": "notes", "title": row.get("title") or "Recommendation", "summary": row.get("summary"), "payload": row} for row in recommendation_rows)
    payload.extend(test_rows)
    return payload[:8]


def _persist_doubt_session(
    school_id: str,
    *,
    student_id: str | None,
    profile_id: str | None,
    role_key: str,
    input_type: str,
    source_language: str,
    detected_subject: str,
    detected_topic: str,
    confidence_score: float,
    escalation_status: str,
    escalated_to_profile_id: str | None,
    metadata: dict[str, Any],
) -> str:
    response = _ai_table("doubt_sessions").insert(
        {
            "school_id": school_id,
            "student_id": _normalize_optional_uuid(student_id),
            "profile_id": _normalize_optional_uuid(profile_id),
            "role_key": _student_tool_role_key(role_key),
            "input_type": input_type,
            "source_language": source_language,
            "detected_subject": detected_subject,
            "detected_topic": detected_topic,
            "confidence_score": confidence_score,
            "escalation_status": escalation_status,
            "escalated_to_profile_id": _normalize_optional_uuid(escalated_to_profile_id),
            "escalated_at": _utc_now_iso() if escalation_status == "pending_teacher" else None,
            "metadata": metadata,
            "is_active": True,
        }
    ).execute()
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create doubt session")
    return _normalize(rows[0].get("id"))


def _persist_doubt_question(
    school_id: str,
    *,
    session_id: str,
    source_type: str,
    source_url: str | None,
    source_name: str | None,
    raw_prompt: str | None,
    ocr_text: str,
    normalized_text: str,
    extracted_equations: list[str],
    extracted_diagrams: list[str],
    extracted_mcqs: list[dict[str, Any]],
    extracted_numericals: list[str],
    metadata: dict[str, Any],
) -> str:
    response = _ai_table("doubt_questions").insert(
        {
            "school_id": school_id,
            "session_id": _normalize_optional_uuid(session_id),
            "source_type": source_type,
            "source_url": source_url,
            "source_name": source_name,
            "raw_prompt": raw_prompt,
            "ocr_text": ocr_text,
            "normalized_text": normalized_text,
            "extracted_equations": extracted_equations,
            "extracted_diagrams": extracted_diagrams,
            "extracted_mcqs": extracted_mcqs,
            "extracted_numericals": extracted_numericals,
            "metadata": metadata,
            "is_active": True,
        }
    ).execute()
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to persist doubt question")
    return _normalize(rows[0].get("id"))


def _persist_doubt_solution(
    school_id: str,
    *,
    session_id: str,
    question_id: str,
    solution_title: str,
    final_answer: str | None,
    explanation: str,
    shortcut_method: str | None,
    common_mistakes: list[str],
    step_by_step: list[str],
    confidence_score: float,
    metadata: dict[str, Any],
) -> str:
    response = _ai_table("doubt_solutions").insert(
        {
            "school_id": school_id,
            "session_id": _normalize_optional_uuid(session_id),
            "question_id": _normalize_optional_uuid(question_id),
            "solution_title": solution_title,
            "final_answer": final_answer,
            "explanation": explanation,
            "shortcut_method": shortcut_method,
            "common_mistakes": common_mistakes,
            "step_by_step": step_by_step,
            "confidence_score": confidence_score,
            "metadata": metadata,
            "is_active": True,
        }
    ).execute()
    rows = list(response.data or [])
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to persist doubt solution")
    return _normalize(rows[0].get("id"))


def _persist_doubt_recommendations(school_id: str, *, session_id: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    persisted: list[dict[str, Any]] = []
    for index, item in enumerate(rows, start=1):
        response = _ai_table("doubt_recommendations").insert(
            {
                "school_id": school_id,
                "session_id": _normalize_optional_uuid(session_id),
                "recommendation_type": item.get("recommendation_type") or "lesson",
                "title": item.get("title") or "Recommendation",
                "summary": item.get("summary"),
                "payload": item.get("payload") or {},
                "priority": index,
                "metadata": {"source": MODULE_KEY},
                "is_active": True,
            }
        ).execute()
        inserted = list(response.data or [])
        if inserted:
            persisted.append(dict(inserted[0]))
    return persisted


def _history_rows(school_id: str, *, role_key: str, profile_id: str | None, user_email: str | None, target_student_id: str | None = None, limit: int = 25) -> list[dict[str, Any]]:
    normalized_target_student_id = _normalize(target_student_id) or None
    student = _resolve_student_context(
        school_id,
        role_key=role_key,
        profile_id=profile_id,
        user_email=user_email,
        target_student_id=normalized_target_student_id,
    )
    query = (
        _ai_table("doubt_sessions")
        .select("id,student_id,profile_id,input_type,source_language,detected_subject,detected_topic,confidence_score,escalation_status,teacher_resolution_notes,created_at")
        .eq("school_id", school_id)
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
        .limit(max(1, min(limit, 100)))
    )
    normalized_role = _normalize(role_key).lower()
    if normalized_role == "student":
        if not student:
            return []
        query = query.eq("student_id", _normalize(student.get("id")))
    elif normalized_target_student_id:
        query = query.eq("student_id", normalized_target_student_id)

    sessions = list(query.execute().data or [])
    session_ids = [_normalize(row.get("id")) for row in sessions if _normalize(row.get("id"))]
    solutions_by_session: dict[str, str | None] = {}
    if session_ids:
        solution_rows = list(
            _ai_table("doubt_solutions")
            .select("session_id,final_answer")
            .eq("school_id", school_id)
            .in_("session_id", session_ids)
            .is_("deleted_at", "null")
            .execute()
            .data
            or []
        )
        solutions_by_session = {_normalize(row.get("session_id")): row.get("final_answer") for row in solution_rows}
    student_names: dict[str, str] = {}
    student_ids = sorted({_normalize(row.get("student_id")) for row in sessions if _normalize(row.get("student_id"))})
    if student_ids:
        student_rows = list(
            _public_table("students")
            .select("id,full_name")
            .eq("school_id", school_id)
            .in_("id", student_ids)
            .execute()
            .data
            or []
        )
        student_names = {_normalize(row.get("id")): _normalize(row.get("full_name")) for row in student_rows}

    return [
        {
            "session_id": _normalize(row.get("id")),
            "student_id": _normalize(row.get("student_id")) or None,
            "student_name": student_names.get(_normalize(row.get("student_id"))) or None,
            "input_type": row.get("input_type") or "text",
            "source_language": row.get("source_language") or "english",
            "detected_subject": row.get("detected_subject"),
            "detected_topic": row.get("detected_topic"),
            "confidence_score": float(row.get("confidence_score") or 0),
            "escalation_status": row.get("escalation_status") or "not_required",
            "final_answer": solutions_by_session.get(_normalize(row.get("id"))),
            "created_at": row.get("created_at"),
        }
        for row in sessions
    ]


def get_doubt_solver_overview(
    school_id: str,
    *,
    role_key: str,
    profile_id: str | None,
    user_email: str | None,
    target_student_id: str | None = None,
    limit: int = 10,
) -> dict[str, Any]:
    history = _history_rows(
        school_id,
        role_key=role_key,
        profile_id=profile_id,
        user_email=user_email,
        target_student_id=target_student_id,
        limit=limit,
    )
    pending_teacher_reviews = sum(1 for item in history if _normalize(item.get("escalation_status")) == "pending_teacher")
    return {
        "scope": "doubt_solver",
        "school_id": school_id,
        "total_history": len(history),
        "pending_teacher_reviews": pending_teacher_reviews,
        "recent_history": history,
        "generated_at": _utc_now_iso(),
    }


def _solve_doubt(
    school_id: str,
    *,
    role_key: str,
    profile_id: str | None,
    user_email: str | None,
    input_type: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    target_student_id = _normalize(payload.get("target_student_id")) or None
    normalized_role = _student_tool_role_key(role_key)
    student = _resolve_student_context(
        school_id,
        role_key=normalized_role,
        profile_id=profile_id,
        user_email=user_email,
        target_student_id=target_student_id,
    )
    extracted_text, extraction_meta = _extract_text(payload, input_type)
    source_language = _detect_language(extracted_text, payload.get("source_language"))
    subject, subject_confidence = _detect_subject(extracted_text)
    topic, topic_confidence = _detect_topic(subject, extracted_text)
    equations = _extract_equations(extracted_text)
    numericals = _extract_numericals(extracted_text)
    mcqs = _extract_mcqs(extracted_text)
    diagrams = _extract_diagrams(extracted_text)
    context = _build_context_snapshot(school_id, role_key=normalized_role, topic=topic, student=student)
    confidence = _confidence_score(
        input_type=input_type,
        text=extracted_text,
        subject_confidence=subject_confidence,
        topic_confidence=topic_confidence,
        entity_count=len(equations) + len(numericals) + len(mcqs) + len(diagrams),
    )
    solution = _deterministic_solution(subject, topic, extracted_text)
    if solution is None:
        solution = _ai_solution(subject, topic, extracted_text, context)
    if solution is None:
        solution = _stepwise_solution(subject, topic, extracted_text, equations, numericals, context)
    recommendations = _recommendations_bundle(school_id, student, topic)
    escalate = confidence < 62
    escalation_status = "pending_teacher" if escalate else "not_required"
    escalated_teacher_profile_id = _teacher_escalation_target(school_id) if escalate else None
    session_id = _persist_doubt_session(
        school_id,
        student_id=_normalize((student or {}).get("id")) or None,
        profile_id=profile_id,
        role_key=normalized_role,
        input_type=input_type,
        source_language=source_language,
        detected_subject=subject,
        detected_topic=topic,
        confidence_score=confidence,
        escalation_status=escalation_status,
        escalated_to_profile_id=escalated_teacher_profile_id,
        metadata={
            **_normalize_json_object(payload.get("metadata")),
            "extraction": extraction_meta,
            "teacher_prompt": _normalize(payload.get("teacher_prompt")) or None,
        },
    )
    source_url = (
        _normalize(payload.get("image_url"))
        or _normalize(payload.get("pdf_url"))
        or _normalize(payload.get("screenshot_url"))
        or _normalize(payload.get("handwritten_note_url"))
        or None
    )
    question_id = _persist_doubt_question(
        school_id,
        session_id=session_id,
        source_type=input_type,
        source_url=source_url,
        source_name=_normalize(payload.get("file_name")) or None,
        raw_prompt=_normalize(payload.get("question") or payload.get("prompt")) or None,
        ocr_text=extracted_text,
        normalized_text=extracted_text,
        extracted_equations=equations,
        extracted_diagrams=diagrams,
        extracted_mcqs=mcqs,
        extracted_numericals=numericals,
        metadata=extraction_meta,
    )
    solution_id = _persist_doubt_solution(
        school_id,
        session_id=session_id,
        question_id=question_id,
        solution_title=f"{subject.title()} doubt solution",
        final_answer=solution.get("final_answer"),
        explanation=solution.get("explanation") or "Explanation unavailable.",
        shortcut_method=solution.get("shortcut_method"),
        common_mistakes=list(solution.get("common_mistakes") or []),
        step_by_step=list(solution.get("step_by_step") or []),
        confidence_score=confidence,
        metadata={"topic": topic, "subject": subject},
    )
    if escalate:
        recommendations.insert(
            0,
            {
                "recommendation_type": "teacher_escalation",
                "title": "Teacher review requested",
                "summary": "Confidence dropped below threshold, so this doubt has been escalated for teacher review.",
                "payload": {
                    "session_id": session_id,
                    "teacher_profile_id": escalated_teacher_profile_id,
                },
            },
        )
        create_notification(
            school_id,
            f"Low-confidence doubt needs teacher review for {topic or subject}.",
            "system",
            user_name=_normalize((student or {}).get("full_name")) or None,
            user_role=normalized_role,
            metadata={
                "module": MODULE_KEY,
                "event": "teacher_escalation",
                "session_id": session_id,
                "student_id": _normalize((student or {}).get("id")) or None,
                "teacher_profile_id": escalated_teacher_profile_id,
            },
        )
    persisted_recommendations = _persist_doubt_recommendations(school_id, session_id=session_id, rows=recommendations)
    _log_audit_entry(
        school_id=school_id,
        profile_id=profile_id,
        action=f"doubt_solver.{input_type}.solved",
        payload={
            "session_id": session_id,
            "subject": subject,
            "topic": topic,
            "confidence_score": confidence,
            "escalation_status": escalation_status,
        },
    )
    return {
        "session_id": session_id,
        "question_id": question_id,
        "solution_id": solution_id,
        "input_type": input_type,
        "source_language": source_language,
        "normalized_question": extracted_text,
        "extracted_text": extracted_text,
        "detected_subject": subject,
        "detected_topic": topic,
        "confidence_score": confidence,
        "extracted_equations": equations,
        "extracted_diagrams": diagrams,
        "extracted_mcqs": mcqs,
        "extracted_numericals": numericals,
        "explanation": solution.get("explanation") or "",
        "final_answer": solution.get("final_answer"),
        "shortcut_method": solution.get("shortcut_method"),
        "common_mistakes": list(solution.get("common_mistakes") or []),
        "step_by_step": list(solution.get("step_by_step") or []),
        "personalization": {
            "student_id": _normalize((student or {}).get("id")) or None,
            "student_name": _normalize((student or {}).get("full_name")) or None,
            "class_level": context.get("class_level"),
            "weak_topics": context.get("weak_topic_history"),
            "strong_topics": context.get("strong_topic_history"),
            "analytics_summary": context.get("analytics_summary"),
            "attendance_summary": context.get("attendance_summary"),
            "previous_test_count": context.get("previous_test_count"),
        },
        "recommendations": persisted_recommendations,
        "escalation_status": escalation_status,
        "teacher_resolution_notes": None,
        "generated_at": _utc_now_iso(),
    }


def solve_text_doubt(school_id: str, *, role_key: str, profile_id: str | None, user_email: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    return _solve_doubt(school_id, role_key=role_key, profile_id=profile_id, user_email=user_email, input_type="text", payload=payload)


def solve_image_doubt(school_id: str, *, role_key: str, profile_id: str | None, user_email: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    return _solve_doubt(school_id, role_key=role_key, profile_id=profile_id, user_email=user_email, input_type="image", payload=payload)


def solve_pdf_doubt(school_id: str, *, role_key: str, profile_id: str | None, user_email: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    return _solve_doubt(school_id, role_key=role_key, profile_id=profile_id, user_email=user_email, input_type="pdf", payload=payload)


def list_doubt_history(school_id: str, *, role_key: str, profile_id: str | None, user_email: str | None, target_student_id: str | None = None, limit: int = 25) -> list[dict[str, Any]]:
    return _history_rows(
        school_id,
        role_key=role_key,
        profile_id=profile_id,
        user_email=user_email,
        target_student_id=target_student_id,
        limit=limit,
    )
