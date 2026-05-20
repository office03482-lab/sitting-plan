from fastapi import APIRouter

from app.attendance.guards import reject_legacy_attendance_request

router = APIRouter(prefix="/api/attendance", tags=["Attendance"])


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
def blocked_legacy_attendance(path: str):
    reject_legacy_attendance_request()
    return {"detail": f"Legacy attendance route blocked: {path}"}
