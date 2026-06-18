"""Centralized AI provider layer for Aspire ERP."""

from __future__ import annotations

import json
import logging
import threading
from typing import Any

from app.config import settings

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-2.5-flash"
_provider_lock = threading.Lock()
_gemini_module: Any | None = None
_gemini_model: Any | None = None


class AIProviderError(RuntimeError):
    """Raised when the configured AI provider is unavailable."""


def get_provider_name() -> str:
    return str(settings.ai_provider or "gemini").strip().lower() or "gemini"


def provider_is_configured() -> bool:
    return bool(settings.gemini_api_key) if get_provider_name() == "gemini" else False


def _load_gemini_module():
    global _gemini_module
    if _gemini_module is not None:
        return _gemini_module
    try:
        import google.generativeai as genai  # type: ignore
    except Exception as exc:  # pragma: no cover - import path depends on runtime
        raise AIProviderError("Gemini SDK is not installed") from exc
    _gemini_module = genai
    return genai


def _build_gemini_model(model_name: str = DEFAULT_MODEL):
    if get_provider_name() != "gemini":
        raise AIProviderError("Unsupported AI provider configured")
    api_key = str(settings.gemini_api_key or "").strip()
    if not api_key:
        raise AIProviderError("Gemini API key is not configured")

    global _gemini_model
    if _gemini_model is not None:
        return _gemini_model

    with _provider_lock:
        if _gemini_model is None:
            genai = _load_gemini_module()
            genai.configure(api_key=api_key)
            _gemini_model = genai.GenerativeModel(model_name)
    return _gemini_model


def _stringify_content(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                parts.append(str(item.get("text") or item.get("content") or "").strip())
            else:
                parts.append(str(item or "").strip())
        return "\n".join(part for part in parts if part).strip()
    return str(content or "").strip()


def _extract_text(response: Any) -> str:
    text = str(getattr(response, "text", "") or "").strip()
    if text:
        return text

    candidates = getattr(response, "candidates", None) or []
    for candidate in candidates:
        content = getattr(candidate, "content", None)
        parts = getattr(content, "parts", None) or []
        joined = "\n".join(str(getattr(part, "text", "") or "").strip() for part in parts if getattr(part, "text", None))
        if joined.strip():
            return joined.strip()
    raise AIProviderError("Gemini returned an empty response")


def generate_text(prompt: str) -> str:
    try:
        model = _build_gemini_model()
        response = model.generate_content(prompt)
        return _extract_text(response)
    except AIProviderError:
        raise
    except Exception as exc:
        logger.exception("Gemini text generation failed")
        raise AIProviderError("AI service temporarily unavailable") from exc


def generate_json(prompt: str) -> dict[str, Any]:
    try:
        model = _build_gemini_model()
        response = model.generate_content(
            prompt,
            generation_config={
                "response_mime_type": "application/json",
                "temperature": 0.3,
            },
        )
        text = _extract_text(response)
        payload = json.loads(text)
        if not isinstance(payload, dict):
            raise AIProviderError("Gemini JSON response was not an object")
        return payload
    except AIProviderError:
        raise
    except Exception as exc:
        logger.exception("Gemini JSON generation failed")
        raise AIProviderError("AI service temporarily unavailable") from exc


def chat(messages: list[dict[str, Any]]) -> str:
    if not messages:
        raise AIProviderError("At least one chat message is required")

    try:
        model = _build_gemini_model()
        history: list[dict[str, str]] = []
        for message in messages[:-1]:
            role = str(message.get("role") or "user").strip().lower()
            history.append(
                {
                    "role": "model" if role in {"assistant", "model"} else "user",
                    "parts": [_stringify_content(message.get("content"))],
                }
            )

        session = model.start_chat(history=history)
        response = session.send_message(_stringify_content(messages[-1].get("content")))
        return _extract_text(response)
    except AIProviderError:
        raise
    except Exception as exc:
        logger.exception("Gemini chat failed")
        raise AIProviderError("AI service temporarily unavailable") from exc
