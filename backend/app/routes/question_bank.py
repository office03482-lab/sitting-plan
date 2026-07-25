"""
Question Bank Taxonomy Routes — CRUD endpoints for hierarchical taxonomy, questions, and version history.
Does NOT modify any existing online_tests routes.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.middleware.auth import get_authenticated_user
from app.services import supabase_question_bank as qb_service
from app.services.scope_engine import PermissionScopeContext

router = APIRouter(prefix="/api/question-bank", tags=["Question Bank"])


def _school_id(request: Request) -> str:
    ctx: PermissionScopeContext = request.state.permission_scope
    return ctx.school_id


# ─── Exam Types ──────────────────────────────────────────────

@router.get("/exam-types")
def api_list_exam_types(request: Request):
    return qb_service.list_exam_types(_school_id(request))


class ExamTypeCreate(BaseModel):
    name: str
    slug: str
    display_order: int = 0

@router.post("/exam-types")
def api_create_exam_type(body: ExamTypeCreate, request: Request):
    return qb_service.create_exam_type(_school_id(request), body.name, body.slug, body.display_order)


# ─── Taxonomy Nodes ──────────────────────────────────────────

@router.get("/taxonomy")
def api_list_taxonomy(request: Request, exam_type_slug: str | None = None, node_type: str | None = None, parent_id: str | None = None):
    return qb_service.list_taxonomy_nodes(_school_id(request), exam_type_slug, node_type, parent_id)


class TaxonomyNodeCreate(BaseModel):
    name: str
    node_type: str
    exam_type_slug: str = "custom"
    parent_id: str | None = None
    display_order: int = 0

@router.post("/taxonomy")
def api_create_taxonomy_node(body: TaxonomyNodeCreate, request: Request):
    return qb_service.create_taxonomy_node(
        _school_id(request), body.name, body.node_type, body.exam_type_slug, body.parent_id, body.display_order,
    )


@router.delete("/taxonomy/{node_id}")
def api_delete_taxonomy_node(node_id: str, request: Request):
    ok = qb_service.delete_taxonomy_node(node_id, _school_id(request))
    if not ok:
        raise HTTPException(status_code=404, detail="Taxonomy node not found.")
    return {"status": "deleted"}


# ─── Tags ────────────────────────────────────────────────────

@router.get("/tags")
def api_list_tags(request: Request):
    return qb_service.list_tags(_school_id(request))


class TagCreate(BaseModel):
    name: str
    slug: str
    color: str = "#6b7280"
    icon: str | None = None

@router.post("/tags")
def api_create_tag(body: TagCreate, request: Request):
    return qb_service.create_tag(_school_id(request), body.name, body.slug, body.color, body.icon)


# ─── Sources ─────────────────────────────────────────────────

@router.get("/sources")
def api_list_sources(request: Request):
    return qb_service.list_sources(_school_id(request))


class SourceCreate(BaseModel):
    name: str
    source_type: str = "self"

@router.post("/sources")
def api_create_source(body: SourceCreate, request: Request):
    return qb_service.create_source(_school_id(request), body.name, body.source_type)


# ─── Questions ───────────────────────────────────────────────

@router.get("/questions")
def api_list_questions(
    request: Request,
    exam_type_slug: str | None = None,
    subject: str | None = None,
    chapter: str | None = None,
    topic: str | None = None,
    difficulty_level: str | None = None,
    question_type: str | None = None,
    status: str | None = None,
    search: str | None = None,
    skip: int = 0,
    limit: int = 50,
):
    filters = {k: v for k, v in {
        "exam_type_slug": exam_type_slug, "subject": subject, "chapter": chapter,
        "topic": topic, "difficulty_level": difficulty_level, "question_type": question_type,
        "status": status, "search": search,
    }.items() if v}
    return qb_service.list_questions(_school_id(request), filters, skip, limit)


@router.get("/questions/{question_id}")
def api_get_question(question_id: str, request: Request):
    q = qb_service.get_question(question_id, _school_id(request))
    if not q:
        raise HTTPException(status_code=404, detail="Question not found.")
    return q


class QuestionCreate(BaseModel):
    question_code: str | None = None
    exam_type_slug: str = "custom"
    subject: str | None = None
    chapter: str | None = None
    topic: str | None = None
    sub_topic: str | None = None
    subject_id: str | None = None
    chapter_id: str | None = None
    topic_id: str | None = None
    sub_topic_id: str | None = None
    question_type: str = "single_choice"
    difficulty_level: str = "medium"
    prompt_text: str = ""
    prompt_html: str | None = None
    option_items: list[dict[str, Any]] = []
    answer_key: dict[str, Any] = {}
    explanation: str | None = None
    explanation_html: str | None = None
    teacher_notes: str | None = None
    student_notes: str | None = None
    hints: str | None = None
    solution: str | None = None
    solution_html: str | None = None
    marks: float = 1
    negative_marks: float = 0
    estimated_time_seconds: int = 120
    source_id: str | None = None
    source_name: str | None = None
    language: str = "en"
    visibility: str = "private"
    question_owner: str | None = None
    question_image_url: str | None = None
    tags: list[str] = []
    status: str = "draft"
    display_order: int = 0
    metadata: dict[str, Any] = {}

@router.post("/questions")
def api_create_question(body: QuestionCreate, request: Request):
    return qb_service.create_question(_school_id(request), body.model_dump(exclude_unset=True))


class QuestionUpdate(BaseModel):
    question_code: str | None = None
    exam_type_slug: str | None = None
    subject: str | None = None
    chapter: str | None = None
    topic: str | None = None
    sub_topic: str | None = None
    subject_id: str | None = None
    chapter_id: str | None = None
    topic_id: str | None = None
    sub_topic_id: str | None = None
    question_type: str | None = None
    difficulty_level: str | None = None
    prompt_text: str | None = None
    prompt_html: str | None = None
    option_items: list[dict[str, Any]] | None = None
    answer_key: dict[str, Any] | None = None
    explanation: str | None = None
    explanation_html: str | None = None
    teacher_notes: str | None = None
    student_notes: str | None = None
    hints: str | None = None
    solution: str | None = None
    solution_html: str | None = None
    marks: float | None = None
    negative_marks: float | None = None
    estimated_time_seconds: int | None = None
    source_id: str | None = None
    source_name: str | None = None
    language: str | None = None
    visibility: str | None = None
    question_owner: str | None = None
    question_image_url: str | None = None
    tags: list[str] | None = None
    status: str | None = None
    display_order: int | None = None
    metadata: dict[str, Any] | None = None

@router.put("/questions/{question_id}")
def api_update_question(question_id: str, body: QuestionUpdate, request: Request):
    sid = _school_id(request)
    existing = qb_service.get_question(question_id, sid)
    if not existing:
        raise HTTPException(status_code=404, detail="Question not found.")

    update_data = body.model_dump(exclude_unset=True)
    if not update_data:
        return existing

    # Create version snapshot before update
    new_version = (existing.get("version") or 1) + 1
    qb_service.create_version(question_id, sid, existing, new_version, change_summary=f"Auto-saved v{new_version}")
    qb_service.log_history(question_id, sid, "update", performed_by=sid)

    update_data["version"] = new_version
    return qb_service.update_question(question_id, sid, update_data)


@router.delete("/questions/{question_id}")
def api_delete_question(question_id: str, request: Request):
    sid = _school_id(request)
    existing = qb_service.get_question(question_id, sid)
    if not existing:
        raise HTTPException(status_code=404, detail="Question not found.")
    qb_service.log_history(question_id, sid, "delete")
    qb_service.soft_delete_question(question_id, sid)
    return {"status": "deleted"}


# ─── Version History ─────────────────────────────────────────

@router.get("/questions/{question_id}/versions")
def api_list_versions(question_id: str, request: Request, limit: int = 20):
    return qb_service.list_versions(question_id, _school_id(request), limit)


@router.post("/questions/{question_id}/versions/{version_id}/restore")
def api_restore_version(question_id: str, version_id: str, request: Request):
    sid = _school_id(request)
    version = qb_service.get_version(version_id)
    if not version:
        raise HTTPException(status_code=404, detail="Version not found.")
    snapshot = version.get("snapshot", {})
    current = qb_service.get_question(question_id, sid)
    if not current:
        raise HTTPException(status_code=404, detail="Question not found.")
    new_ver = (current.get("version") or 1) + 1
    qb_service.create_version(question_id, sid, current, new_ver, change_summary=f"Restored from v{version.get('version')}")
    restored = qb_service.update_question(question_id, sid, {**snapshot, "version": new_ver})
    qb_service.log_history(question_id, sid, "restore_version", performed_by=sid)
    return restored


# ─── Edit History ────────────────────────────────────────────

@router.get("/questions/{question_id}/history")
def api_list_history(question_id: str, request: Request, limit: int = 50):
    return qb_service.list_history(question_id, _school_id(request), limit)
