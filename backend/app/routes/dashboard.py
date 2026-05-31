"""Combined dashboard endpoint — returns all metrics in ONE database call."""

import logging
from fastapi import APIRouter, Depends
from app.middleware.auth import get_authenticated_actor_context
from app.services.supabase_admin import get_supabase_admin_client
from app.services.supabase_context import resolve_school_id_from_actor

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/dashboard/metrics")
def get_dashboard_metrics(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
):
    response = (
        get_supabase_admin_client()
        .rpc("get_dashboard_metrics", {"p_school_id": school_id})
        .execute()
    )
    data = response.data if response else None
    if data is None:
        return {}
    return data
