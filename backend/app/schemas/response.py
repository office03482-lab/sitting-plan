"""
Standardized API response schemas.

All API endpoints must return responses in the format:
{
    "success": true,
    "data": { ... },
    "message": "Success message",
    "error": null
}
"""
from __future__ import annotations

from typing import Any, Generic, Optional, TypeVar
from pydantic import BaseModel

T = TypeVar("T")


class APIResponse(BaseModel, Generic[T]):
    """Standardized API response wrapper."""
    success: bool = True
    data: Optional[T] = None
    message: str = ""
    error: Optional[str] = None


class ErrorResponse(BaseModel):
    """Standardized error response."""
    success: bool = False
    data: Optional[Any] = None
    message: str = ""
    error: str = ""


def success_response(
    data: Any = None,
    message: str = "Operation completed successfully",
) -> APIResponse:
    """Create a success response."""
    return APIResponse(success=True, data=data, message=message, error=None)


def error_response(
    error: str,
    message: str = "",
    data: Any = None,
) -> APIResponse:
    """Create an error response."""
    return APIResponse(success=False, data=data, message=message or error, error=error)


def paginated_response(
    items: list,
    total: int,
    skip: int = 0,
    limit: int = 100,
    message: str = "Data retrieved successfully",
) -> APIResponse:
    """Create a paginated success response."""
    return APIResponse(
        success=True,
        data={
            "items": items,
            "total": total,
            "skip": skip,
            "limit": limit,
        },
        message=message,
        error=None,
    )
