"""Admin Office snapshot routes."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends

from app.services.supabase_context import resolve_school_id_from_actor
from app.services.supabase_exams import list_exams
from app.services.supabase_invigilators import get_room_assignments
from app.services.supabase_metrics import get_school_core_counts_cached
from app.services.supabase_rooms import list_rooms
from app.services.supabase_seating import list_seating_plans_with_lookups

router = APIRouter()


@router.get("/snapshot")
async def get_admin_office_snapshot(
    school_id: str = Depends(resolve_school_id_from_actor),
):
    exams, rooms, counts = await asyncio.gather(
        asyncio.to_thread(list_exams, school_id),
        asyncio.to_thread(list_rooms, school_id, skip=0, limit=1000),
        asyncio.to_thread(get_school_core_counts_cached, school_id),
    )

    exam_lookup = {
        str(exam.get("id")): {
            "id": exam.get("id"),
            "name": exam.get("name"),
            "metadata": {"subject_text": exam.get("subject")},
        }
        for exam in exams
    }
    room_lookup = {
        str(room.get("id")): {
            "id": room.get("id"),
            "name": room.get("name"),
            "length_feet": room.get("length_feet"),
            "width_feet": room.get("width_feet"),
            "capacity": room.get("capacity"),
            "exam_capacity": room.get("capacity"),
        }
        for room in rooms
    }

    plans, assignments = await asyncio.gather(
        asyncio.to_thread(
            list_seating_plans_with_lookups,
            school_id,
            exam_lookup=exam_lookup,
            room_lookup=room_lookup,
        ),
        asyncio.to_thread(
            get_room_assignments,
            school_id,
            room_map=room_lookup,
            skip=0,
            limit=1000,
        ),
    )
    rooms_summary = counts.get("rooms_summary") if isinstance(counts.get("rooms_summary"), dict) else {}

    return {
        "exams": exams,
        "rooms": rooms,
        "plans": plans,
        "assignments": assignments,
        "roomSummary": {
            "count": int(rooms_summary.get("count") or len(rooms)),
            "totalCapacity": int(
                rooms_summary.get("totalCapacity")
                or sum(int(room.get("capacity") or 0) for room in rooms)
            ),
        },
        "totalStudents": int(counts.get("students_count") or 0),
        "sourceStatus": {
            "exams": True,
            "rooms": True,
            "plans": True,
            "assignments": True,
            "roomSummary": True,
            "totalStudents": True,
        },
    }
