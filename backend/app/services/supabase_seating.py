"""Supabase-native seating plan repository for production-safe routes."""

from __future__ import annotations

import json
from typing import Any, Iterable

from fastapi import HTTPException

from app.services.supabase_admin import get_supabase_admin_client
from app.services.seating_engine import SeatingAlgorithmEngine


def _sanitize_lookup_ids(values: Iterable[str]) -> list[str]:
    normalized = []
    for value in values:
        text = str(value or "").strip()
        if not text or text == "None":
            continue
        normalized.append(text)
    return sorted(set(normalized))


def _fetch_exam_lookup(exam_ids: Iterable[str]) -> dict[str, dict[str, Any]]:
    ids = _sanitize_lookup_ids(exam_ids)
    if not ids:
        return {}
    supabase = get_supabase_admin_client()
    response = (
        supabase
        .schema("exam")
        .table("exams")
        .select("id, name, metadata")
        .in_("id", ids)
        .execute()
    )
    return {str(item["id"]): item for item in list(response.data or [])}


def _fetch_room_lookup(room_ids: Iterable[str]) -> dict[str, dict[str, Any]]:
    ids = _sanitize_lookup_ids(room_ids)
    if not ids:
        return {}
    supabase = get_supabase_admin_client()
    response = supabase.table("rooms").select("id, name, length_feet, width_feet, capacity, exam_capacity").in_("id", ids).execute()
    return {str(item["id"]): item for item in list(response.data or [])}


def _normalize_batch_distribution(batch_distribution: Any) -> tuple[list[str], list[dict[str, Any]]]:
    if isinstance(batch_distribution, dict):
        batches = [str(item) for item in batch_distribution.keys()]
        total = sum(int(value or 0) for value in batch_distribution.values()) or 0
        return batches, [
            {
                "batch": str(batch_name),
                "count": int(count or 0),
                "percentage": round((int(count or 0) / total) * 100, 2) if total else 0.0,
            }
            for batch_name, count in batch_distribution.items()
        ]
    if isinstance(batch_distribution, list):
        batches = []
        normalized = []
        for item in batch_distribution:
            if isinstance(item, dict):
                batch_name = str(item.get("batch") or "").strip()
                if batch_name:
                    batches.append(batch_name)
                normalized.append(item)
        return batches, normalized
    return [], []


def _is_plan_type_constraint_error(error: Exception) -> bool:
    error_text = str(error or "").lower()
    return "seating_plans_plan_type_check" in error_text or "violates check constraint" in error_text


def serialize_seating_plan_row(
    row: dict[str, Any],
    *,
    exam_lookup: dict[str, dict[str, Any]],
    room_lookup: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    exam = exam_lookup.get(str(row.get("exam_id"))) or {}
    room = room_lookup.get(str(row.get("room_id"))) or {}
    metadata = row.get("plan_metadata") or {}
    batches, batch_distribution = _normalize_batch_distribution(row.get("batch_distribution"))
    return {
        "id": row.get("id"),
        "exam_id": row.get("exam_id"),
        "room_id": row.get("room_id"),
        "exam_name": exam.get("name") or metadata.get("exam_name"),
        "exam_subject": (exam.get("metadata") or {}).get("subject_text") if isinstance(exam.get("metadata"), dict) else metadata.get("exam_subject"),
        "room_name": room.get("name") or metadata.get("room_name"),
        "batches": batches,
        "batch_distribution": batch_distribution,
        "name": row.get("plan_name") or metadata.get("plan_name") or "",
        "plan_type": metadata.get("ui_plan_type") or row.get("plan_type") or "strict",
        "status": row.get("status") or "draft",
        "students_assigned": int(row.get("students_assigned") or 0),
        "is_valid": bool(row.get("is_valid", True)),
        "validation_errors": row.get("validation_errors") or None,
        "created_at": row.get("created_at"),
    }


def list_seating_plans(school_id: str, *, exam_id: str | None = None, room_id: str | None = None) -> list[dict[str, Any]]:
    supabase = get_supabase_admin_client()
    query = (
        supabase
        .schema("exam")
        .table("seating_plans")
        .select("*")
        .eq("school_id", school_id)
        .eq("is_active", True)
    )
    if exam_id:
        query = query.eq("exam_id", exam_id)
    if room_id:
        query = query.eq("room_id", room_id)
    response = query.order("created_at", desc=True).execute()
    rows = list(response.data or [])
    exam_lookup = _fetch_exam_lookup([row.get("exam_id") for row in rows])
    room_lookup = _fetch_room_lookup([row.get("room_id") for row in rows])
    return [serialize_seating_plan_row(row, exam_lookup=exam_lookup, room_lookup=room_lookup) for row in rows]


def get_seating_plan_layout(school_id: str, plan_id: str) -> dict[str, Any]:
    supabase = get_supabase_admin_client()
    result = (
        supabase
        .schema("exam")
        .table("seating_plans")
        .select("*")
        .eq("id", plan_id)
        .eq("school_id", school_id)
        .single()
        .execute()
    )
    row = result.data
    if not row:
        raise HTTPException(status_code=404, detail="Plan not found")

    metadata = row.get("plan_metadata") or {}
    layout = metadata.get("layout") if isinstance(metadata, dict) else None
    if isinstance(layout, dict) and isinstance(layout.get("desks"), list):
        room_lookup = _fetch_room_lookup([row.get("room_id")])
        room = room_lookup.get(str(row.get("room_id"))) or {}
        return {
            "room_id": row.get("room_id"),
            "room_name": room.get("name") or metadata.get("room_name") or "Room",
            "desks": layout.get("desks") or [],
            "dimensions": {
                "length_feet": room.get("length_feet") or 0,
                "width_feet": room.get("width_feet") or 0,
            },
            "capacity": int(room.get("exam_capacity") or room.get("capacity") or 0),
            "occupied": int(layout.get("occupied") or 0),
        }

    raise HTTPException(status_code=404, detail="Plan layout metadata not found")


def finalize_seating_plan(school_id: str, plan_id: str) -> dict[str, Any]:
    supabase = get_supabase_admin_client()
    updated = (
        supabase
        .schema("exam")
        .table("seating_plans")
        .update({"status": "finalized"})
        .eq("id", plan_id)
        .eq("school_id", school_id)
        .select("id")
        .execute()
    )
    if not list(updated.data or []):
        raise HTTPException(status_code=404, detail="Plan not found")
    return {"message": "Plan finalized", "plan_id": plan_id}


def delete_seating_plan(school_id: str, plan_id: str) -> dict[str, Any]:
    supabase = get_supabase_admin_client()
    deleted = (
        supabase
        .schema("exam")
        .table("seating_plans")
        .delete()
        .eq("id", plan_id)
        .eq("school_id", school_id)
        .select("id")
        .execute()
    )
    if not list(deleted.data or []):
        raise HTTPException(status_code=404, detail="Plan not found")
    return {"message": "Seating plan deleted successfully"}


def delete_all_seating_plans(school_id: str) -> dict[str, Any]:
    supabase = get_supabase_admin_client()
    existing = (
        supabase
        .schema("exam")
        .table("seating_plans")
        .select("id")
        .eq("school_id", school_id)
        .execute()
    )
    rows = list(existing.data or [])
    if rows:
        supabase.schema("exam").table("seating_plans").delete().eq("school_id", school_id).execute()
    return {
        "message": f"All {len(rows)} seating plans deleted successfully",
        "deleted_count": len(rows),
    }


def _compute_desk_positions(num_benches: int) -> dict[int, tuple[int, int]]:
    return {
        idx: (idx // 3, idx % 3)
        for idx in range(num_benches)
    }


def generate_seating_plans(
    school_id: str,
    exam_id: str,
    room_ids: list[str],
    plan_type: str,
    batches: list[str] | None = None,
    batch_conflict_groups: list[list[str]] | None = None,
    algorithm_version: str = "2.1",
) -> dict[str, Any]:
    from app.services import supabase_exams, supabase_students, supabase_rooms

    supabase = get_supabase_admin_client()

    # Verify exam exists
    exam = supabase_exams.get_exam(school_id, exam_id)

    # Load students
    all_students = supabase_students.list_students(school_id, is_active=True)
    if batches:
        batch_set = set(batches)
        students_data = [
            {
                "id": s.get("id"),
                "name": s.get("full_name") or s.get("name") or "",
                "roll_number": s.get("roll_number") or "",
                "batch": s.get("batch") or s.get("class_name") or "Unassigned",
                "email": s.get("email") or "",
            }
            for s in all_students
            if str(s.get("batch") or s.get("class_name") or "").strip() in batch_set
        ]
    else:
        students_data = [
            {
                "id": s.get("id"),
                "name": s.get("full_name") or s.get("name") or "",
                "roll_number": s.get("roll_number") or "",
                "batch": s.get("batch") or s.get("class_name") or "Unassigned",
                "email": s.get("email") or "",
            }
            for s in all_students
        ]

    if not students_data:
        raise HTTPException(status_code=400, detail="No students found")

    # Build batch distribution
    batch_distribution: dict[str, int] = {}
    for item in students_data:
        batch_name = item.get("batch") or "Unassigned"
        batch_distribution[batch_name] = batch_distribution.get(batch_name, 0) + 1

    batch_label = ", ".join(batches) if batches else ", ".join(batch_distribution.keys())

    # Normalize plan type
    requested_plan_type = (plan_type or "").strip().lower()
    if requested_plan_type not in {"strict", "compact", "all_in_one"}:
        requested_plan_type = "all_in_one"
    requested_plan_types = [requested_plan_type]

    # Allocate students to rooms
    def _interleave_students_by_batch(students: list[dict]) -> list[dict]:
        by_batch: dict[str, list[dict]] = {}
        for s in students:
            bn = str(s.get("batch") or "").strip() or "Unassigned"
            by_batch.setdefault(bn, []).append(s)
        ordered = sorted(by_batch.keys(), key=lambda b: len(by_batch[b]), reverse=True)
        result = []
        forward = True
        while any(by_batch.values()):
            bp = ordered if forward else list(reversed(ordered))
            for b in bp:
                if by_batch[b]:
                    result.append(by_batch[b].pop(0))
            forward = not forward
        return result

    def _select_room_candidates(pending: list[dict], capacity: int) -> list[dict]:
        if capacity <= 0 or not pending:
            return []
        grouped: dict[str, list[dict]] = {}
        for s in _interleave_students_by_batch(pending):
            bn = str(s.get("batch") or "").strip() or "Unassigned"
            grouped.setdefault(bn, []).append(s)
        limit = min(len(pending), capacity + min(max(capacity // 4, 6), 18))
        selected = []
        counts: dict[str, int] = {}
        forward = True
        while len(selected) < limit and any(grouped.values()):
            ob = sorted(grouped.keys(), key=lambda b: (counts.get(b, 0), -len(grouped[b]), b))
            bp = ob if forward else list(reversed(ob))
            for b in bp:
                if grouped[b] and len(selected) < limit:
                    selected.append(grouped[b].pop(0))
                    counts[b] = counts.get(b, 0) + 1
            forward = not forward
        return selected

    # Build room contexts
    room_contexts: list[dict] = []
    for room_id in room_ids:
        room = supabase_rooms.get_room(school_id, room_id)
        num_benches = int(room.get("num_benches") or 0)
        if num_benches == 0:
            continue
        desk_positions = _compute_desk_positions(num_benches)
        room_contexts.append({
            "room_id": room_id,
            "room": room,
            "num_desks": num_benches,
            "seat_capacity": num_benches * 2,
            "desk_positions": desk_positions,
            "sequence": len(room_contexts),
        })

    # Allocate students to rooms
    pending_students = list(students_data)
    room_student_pools: dict[str, list[dict]] = {}
    for context in room_contexts:
        candidates = _select_room_candidates(pending_students, context["seat_capacity"])
        room_student_pools[context["room_id"]] = list(candidates)
        assigned_ids = {s["id"] for s in candidates}
        pending_students = [s for s in pending_students if s["id"] not in assigned_ids]

    engine = SeatingAlgorithmEngine()
    plans = []

    for context in room_contexts:
        room_id = context["room_id"]
        room = context["room"]
        num_desks = context["num_desks"]
        desk_positions = context["desk_positions"]
        room_students = list(room_student_pools.get(room_id, []))

        generated = {"room_id": room_id, "plan_ids": []}

        if not room_students:
            plans.append(generated)
            continue

        plan_type_name_map = {
            "all_in_one": "All-in-One Plan",
            "strict": "Plan A (Strict)",
            "compact": "Plan B (Compact)",
        }

        for pt in requested_plan_types:
            if pt == "all_in_one":
                result = engine.generate_all_in_one_plan(
                    room_students, num_desks,
                    desk_positions=desk_positions,
                    batch_conflict_groups=batch_conflict_groups,
                )
            elif pt == "strict":
                result = engine.generate_strict_plan(
                    room_students, num_desks,
                    desk_positions=desk_positions,
                    batch_conflict_groups=batch_conflict_groups,
                )
            else:
                result = engine.generate_compact_plan(
                    room_students, num_desks,
                    desk_positions=desk_positions,
                    batch_conflict_groups=batch_conflict_groups,
                )

            assigned_set = {
                sid
                for assigned_list in result.get("assignment", {}).values()
                for student in assigned_list
                for sid in [student.get("id")]
            }
            assigned_students = [s for s in room_students if s["id"] in assigned_set]
            plan_batch_dist: dict[str, int] = {}
            for item in assigned_students:
                bn = item.get("batch") or "Unassigned"
                plan_batch_dist[bn] = plan_batch_dist.get(bn, 0) + 1

            layout_desks = [
                {
                    "desk_id": desk_id,
                    "row": pos[0],
                    "col": pos[1],
                    "students": [
                        {"student_id": s.get("id"), "student_name": s.get("name"), "roll_number": s.get("roll_number"), "batch": s.get("batch")}
                        for s in student_group
                    ],
                }
                for desk_id, pos in desk_positions.items()
                for student_group in [result.get("assignment", {}).get(str(desk_id), [])]
            ]

            plan_row = {
                "school_id": school_id,
                "exam_id": exam_id,
                "room_id": room_id,
                "plan_name": f"{room.get('name')} - Batches: {batch_label} - {plan_type_name_map.get(pt, pt)}",
                "plan_type": pt,
                "status": "draft",
                "students_assigned": len(assigned_students),
                "batch_distribution": plan_batch_dist,
                "is_valid": result.get("validity", True),
                "validation_errors": result.get("errors", []),
                "algorithm_version": algorithm_version,
                "plan_metadata": {
                    "layout": {
                        "desks": layout_desks,
                        "occupied": len(assigned_students),
                    },
                    "exam_name": exam.get("name"),
                    "room_name": room.get("name"),
                    "ui_plan_type": pt,
                },
            }

            try:
                insert_resp = (
                    supabase
                    .schema("exam")
                    .table("seating_plans")
                    .insert(plan_row)
                    .select("id")
                    .execute()
                )
            except Exception as error:
                if pt != "all_in_one" or not _is_plan_type_constraint_error(error):
                    raise

                compatibility_row = {
                    **plan_row,
                    "plan_type": "strict",
                }
                insert_resp = (
                    supabase
                    .schema("exam")
                    .table("seating_plans")
                    .insert(compatibility_row)
                    .select("id")
                    .execute()
                )
            inserted = list(insert_resp.data or [])
            if inserted:
                generated["plan_ids"].append(inserted[0].get("id"))

        plans.append(generated)

    all_plan_ids = [pid for g in plans for pid in g.get("plan_ids", [])]
    unique_unassigned = {
        sid
        for g in plans
        for s in room_student_pools.get(str(g.get("room_id")), [])
        for sid in [s.get("id")] if sid
    } if plans else set()

    return {
        "message": f"Generated {len(all_plan_ids)} seating plan(s)",
        "generated_plan_type": requested_plan_type,
        "plan_ids": all_plan_ids,
        "selected_student_count": len(students_data),
        "unassigned_count": len(unique_unassigned),
        "plans": [
            {
                "room_id": g.get("room_id"),
                "plan_ids": g.get("plan_ids", []),
            }
            for g in plans
        ],
    }
