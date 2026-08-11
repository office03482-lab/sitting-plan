"""Centralized AI provider layer for Aspire ERP."""

from __future__ import annotations

import json
import logging
import threading
from typing import Any

from app.config import settings

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-2.5-flash"
# Hard cap for a single provider call (including internal retries). The
# google-generativeai SDK has no default request timeout, so a stalled or
# slow provider response would otherwise hold the request (and the FastAPI
# worker thread) open indefinitely.
PROVIDER_CALL_TIMEOUT_SECONDS = 45.0
_provider_lock = threading.Lock()
_gemini_module: Any | None = None
_gemini_model: Any | None = None


class AIProviderError(RuntimeError):
    """Raised when the configured AI provider is unavailable."""


class AIQuotaError(AIProviderError):
    """Raised when the AI provider rejects the request due to a rate/daily quota."""


def get_provider_name() -> str:
    return str(settings.ai_provider or "gemini").strip().lower() or "gemini"


def provider_is_configured() -> bool:
    return bool(settings.gemini_api_key) if get_provider_name() == "gemini" else False


def _is_quota_exhaustion(exc: BaseException) -> bool:
    """True when the provider rejected the call because of a quota/rate limit."""
    try:
        from google.api_core import exceptions as google_exceptions

        if isinstance(exc, google_exceptions.ResourceExhausted):
            return True
        if isinstance(exc, google_exceptions.TooManyRequests):
            return True
        if isinstance(exc, google_exceptions.RetryError) and getattr(exc, "cause", None) is not None:
            return _is_quota_exhaustion(exc.cause)
    except Exception:  # pragma: no cover - detection is best-effort
        pass
    return False


def _provider_request_options() -> dict[str, Any]:
    """Request options that bound every Gemini call (timeout + capped retry).

    `timeout` bounds each individual call. `retry` caps the SDK's internal
    exponential backoff so a flaky provider cannot spin for minutes, and
    never retries quota/rate-limit errors (RESOURCE_EXHAUSTED): those carry
    a 30-60s server retry delay (or are daily quotas), so retrying them only
    hangs the request for the full deadline before the graceful fallback can
    respond.
    """
    options: dict[str, Any] = {"timeout": PROVIDER_CALL_TIMEOUT_SECONDS}
    try:
        from google.api_core import exceptions as google_exceptions
        from google.api_core import retry as google_retry

        options["retry"] = google_retry.Retry(
            initial=0.5,
            maximum=5.0,
            multiplier=1.5,
            deadline=PROVIDER_CALL_TIMEOUT_SECONDS,
            predicate=lambda exc: not isinstance(exc, google_exceptions.ResourceExhausted),
        )
    except Exception:  # pragma: no cover - retry capping is best-effort
        pass
    return options


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
        response = model.generate_content(prompt, request_options=_provider_request_options())
        return _extract_text(response)
    except AIProviderError:
        raise
    except Exception as exc:
        if _is_quota_exhaustion(exc):
            logger.warning("Gemini quota exhausted for text generation: %s", exc)
            raise AIQuotaError("Gemini daily quota exceeded") from exc
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
            request_options=_provider_request_options(),
        )
        text = _extract_text(response)
        payload = json.loads(text)
        if not isinstance(payload, dict):
            raise AIProviderError("Gemini JSON response was not an object")
        return payload
    except AIProviderError:
        raise
    except Exception as exc:
        if _is_quota_exhaustion(exc):
            logger.warning("Gemini quota exhausted for JSON generation: %s", exc)
            raise AIQuotaError("Gemini daily quota exceeded") from exc
        logger.exception("Gemini JSON generation failed")
        raise AIProviderError("AI service temporarily unavailable") from exc


def generate_json_parts(parts: list[Any], *, temperature: float = 0.3) -> dict[str, Any]:
    if not parts:
        raise AIProviderError("At least one content part is required")

    try:
        model = _build_gemini_model()
        response = model.generate_content(
            parts,
            generation_config={
                "response_mime_type": "application/json",
                "temperature": temperature,
            },
            request_options=_provider_request_options(),
        )
        text = _extract_text(response)
        payload = json.loads(text)
        if not isinstance(payload, dict):
            raise AIProviderError("Gemini JSON response was not an object")
        return payload
    except AIProviderError:
        raise
    except Exception as exc:
        if _is_quota_exhaustion(exc):
            logger.warning("Gemini quota exhausted for multimodal JSON generation: %s", exc)
            raise AIQuotaError("Gemini daily quota exceeded") from exc
        logger.exception("Gemini multimodal JSON generation failed")
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
        response = session.send_message(
            _stringify_content(messages[-1].get("content")),
            request_options=_provider_request_options(),
        )
        return _extract_text(response)
    except AIProviderError:
        raise
    except Exception as exc:
        if _is_quota_exhaustion(exc):
            logger.warning("Gemini quota exhausted for chat: %s", exc)
            raise AIQuotaError("Gemini daily quota exceeded") from exc
        logger.exception("Gemini chat failed")
        raise AIProviderError("AI service temporarily unavailable") from exc
