"""Central AI provider utility endpoints."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.services.ai_provider import AIProviderError, generate_text, get_provider_name, provider_is_configured

router = APIRouter(prefix="/api/ai", tags=["AI Provider"])


class AiProviderTestRequest(BaseModel):
    prompt: str


@router.get("/health")
async def ai_health() -> dict[str, str]:
    provider = get_provider_name()
    status = "ok" if provider == "gemini" and provider_is_configured() else "misconfigured"
    return {
        "provider": provider,
        "status": status,
    }


@router.post("/test")
async def ai_test(payload: AiProviderTestRequest):
    try:
        return {"answer": generate_text(payload.prompt)}
    except AIProviderError:
        return JSONResponse(
            status_code=200,
            content={
                "success": False,
                "message": "AI service temporarily unavailable",
            },
        )
