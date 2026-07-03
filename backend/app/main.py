"""FastAPI main application setup."""
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import logging
import traceback
import uuid
from sqlalchemy import text
from app.attendance.guards import ensure_native_attendance_mode
from app.attendance.schema_checks import verify_attendance_schema
from app.config import settings
from app.database import SessionLocal, get_db
from app.middleware.auth import get_authenticated_user, require_permissions
from app.middleware.observability import SystemObservabilityEngine

from app.services.timetable_schema_checks import verify_timetable_schema

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Manage application lifecycle
    """
    # Startup
    logger.info(
        "Application startup complete. environment=%s debug=%s reload=%s",
        settings.environment,
        settings.debug,
        settings.reload,
    )
    if settings.is_production:
        ensure_native_attendance_mode()
        verify_attendance_schema()
        verify_timetable_schema()
    
    yield
    
    # Shutdown
    logger.info("Application shutting down...")


# Create FastAPI app
app = FastAPI(
    title=settings.api_title,
    description="Dr. Girish App - Professional Examination Seating System API",
    version=settings.api_version,
    lifespan=lifespan,
)

app.add_middleware(SystemObservabilityEngine)

# Add CORS middleware (strict configuration)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=settings.cors_allow_methods,
    allow_headers=settings.cors_allow_headers,
    expose_headers=settings.cors_expose_headers,
    max_age=86400,
)


# Health check endpoint
@app.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint"""
    return {
        "status": "ok",
        "service": "Dr. GIRISH APP",
        "version": settings.api_version,
        "environment": settings.environment,
    }


@app.get("/readyz", tags=["Health"])
async def readiness_check():
    """Readiness probe that verifies database connectivity."""
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        if settings.is_production:
            verify_attendance_schema()
            verify_timetable_schema()
        return {
            "status": "ready",
            "service": "Dr. GIRISH APP",
            "version": settings.api_version,
        }
    finally:
        db.close()


# Root endpoint
@app.get("/", tags=["Root"])
async def root():
    """Root endpoint with API documentation"""
    return {
        "message": "Welcome to Dr. GIRISH APP",
        "version": settings.api_version,
        "docs": "/docs",
        "redoc": "/redoc",
    }


# Error handler
@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    """Custom HTTP exception handler"""
    origins = settings.cors_origins
    origin = request.headers.get("origin", "")
    allowed = origin if origin in origins else (origins[0] if origins else "*")
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "detail": exc.detail,
            "error": exc.detail,
            "status_code": exc.status_code,
        },
        headers={
            "Access-Control-Allow-Origin": allowed,
            "Access-Control-Allow-Credentials": "true",
        },
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc):
    """Handle unhandled exceptions without leaking stack traces."""
    logger.exception("Unhandled exception while processing request")
    error_id = str(uuid.uuid4())[:8]
    logger.error(
        "Unhandled exception id=%s path=%s method=%s",
        error_id,
        str(request.url.path),
        request.method,
        exc_info=True,
    )
    content = {
        "detail": "An unexpected error occurred",
        "error": "internal_server_error",
        "status_code": 500,
        "error_id": error_id,
    }
    if settings.debug:
        content["detail"] = str(exc) or exc.__class__.__name__
    origins = settings.cors_origins
    origin = request.headers.get("origin", "")
    allowed = origin if origin in origins else (origins[0] if origins else "*")
    return JSONResponse(
        status_code=500,
        content=content,
        headers={
            "Access-Control-Allow-Origin": allowed,
            "Access-Control-Allow-Credentials": "true",
        },
    )


# Import routes after app creation
from app.routes import attendance, auth, students, rooms, seating, reports, exams, teachers, timetable, settings as settings_router, batches, invigilators, inventory, edupay, hostels, dashboard, staff, admin_office, bulk_action_requests, platform, entitlement, credits, online_tests, analytics, lms, live_classes, study_planner, parent_portal, parent_links, ai_tutor, doubts, teacher_ai, monetization, bi, predictions, ai_agents, ai_assistants, ai_provider, uploads, account_security, billing, school_self_service

# Include routers
app.include_router(auth.router, prefix=f"{settings.api_prefix}/auth", tags=["Authentication"])
app.include_router(ai_provider.router)
app.include_router(
    batches.router,
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("admin_office.batches"))],
)
app.include_router(
    students.router,
    prefix=f"{settings.api_prefix}/students",
    tags=["Students"],
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("admin_office.students"))],
)
app.include_router(
    rooms.router,
    prefix=f"{settings.api_prefix}/rooms",
    tags=["Rooms"],
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("admin_office.rooms"))],
)
app.include_router(
    seating.router,
    prefix=f"{settings.api_prefix}/seating",
    tags=["Seating"],
    dependencies=[
        Depends(get_authenticated_user),
        Depends(require_permissions("admin_office.seating_generation", "admin_office.seating_plans")),
    ],
)
app.include_router(
    reports.router,
    prefix=f"{settings.api_prefix}/reports",
    tags=["Reports"],
    dependencies=[
        Depends(get_authenticated_user),
        Depends(require_permissions("admin_office.reports", "admin_office.seating_generation", "admin_office.seating_plans")),
    ],
)
app.include_router(
    exams.router,
    prefix=f"{settings.api_prefix}/exams",
    tags=["Exams"],
    dependencies=[
        Depends(get_authenticated_user),
        Depends(require_permissions("admin_office.seating_generation", "admin_office.seating_plans")),
    ],
)
app.include_router(
    teachers.router,
    prefix=f"{settings.api_prefix}/teachers",
    tags=["Teachers"],
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("admin_office.teachers"))],
)
app.include_router(
    staff.router,
    prefix=f"{settings.api_prefix}/staff",
    tags=["Staff"],
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("admin_office.teachers", "admin_office.invigilators"))],
)
app.include_router(
    timetable.utility_router,
    prefix=f"{settings.api_prefix}/timetable",
    tags=["Timetable"],
    dependencies=[Depends(get_authenticated_user)],
)
app.include_router(
    timetable.router,
    prefix=f"{settings.api_prefix}/timetable",
    tags=["Timetable"],
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("timetable"))],
)
app.include_router(
    settings_router.router,
    prefix=f"{settings.api_prefix}/settings",
    tags=["Settings"],
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("settings"))],
)
app.include_router(school_self_service.router)
app.include_router(
    invigilators.router,
    tags=["Invigilators"],
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("admin_office.invigilators"))],
)
app.include_router(
    inventory.router,
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("inventory"))],
)
app.include_router(
    edupay.router,
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("edupay"))],
)
app.include_router(
    hostels.router,
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("admin_office.hostels"))],
)

app.include_router(
    attendance.router,
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("attendance"))],
)

app.include_router(
    bulk_action_requests.router,
    dependencies=[Depends(get_authenticated_user)],
)

app.include_router(
    platform.router,
    dependencies=[Depends(get_authenticated_user)],
)

app.include_router(
    entitlement.router,
    dependencies=[Depends(get_authenticated_user)],
)

app.include_router(
    credits.router,
    dependencies=[Depends(get_authenticated_user)],
)

app.include_router(
    online_tests.router,
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("online_tests", "edupay.parent_portal"))],
)

app.include_router(
    analytics.router,
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("online_tests"))],
)

app.include_router(
    lms.router,
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("lms", "edupay.parent_portal"))],
)

app.include_router(
    live_classes.router,
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("live_classes", "edupay.parent_portal"))],
)

app.include_router(
    uploads.router,
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("lms", "online_tests", "live_classes"))],
)

app.include_router(
    study_planner.router,
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("study_planner", "edupay.parent_portal"))],
)
app.include_router(
    study_planner.alias_router,
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("study_planner", "edupay.parent_portal"))],
)

app.include_router(
    parent_portal.router,
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("parent_intelligence", "edupay.parent_portal"))],
)
app.include_router(
    parent_links.router,
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("admin_office.students", "admin_office.access_control"))],
)
app.include_router(account_security.router)

app.include_router(
    ai_tutor.router,
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("ai_tutor"))],
)

app.include_router(
    doubts.router,
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("doubt_solver"))],
)
app.include_router(
    doubts.alias_router,
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("doubt_solver"))],
)

app.include_router(
    teacher_ai.router,
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("teacher_ai"))],
)
app.include_router(
    teacher_ai.alias_router,
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("teacher_ai"))],
)

app.include_router(
    monetization.router,
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("edupay"))],
)

app.include_router(billing.router)

app.include_router(
    bi.router,
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("bi"))],
)

app.include_router(
    predictions.router,
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("predictions", "edupay.parent_portal"))],
)

app.include_router(
    ai_agents.router,
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("ai_agents"))],
)
app.include_router(
    ai_agents.alias_router,
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("ai_agents"))],
)
app.include_router(
    ai_assistants.router,
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("ai_agents", "predictions", "bi"))],
)

app.include_router(
    dashboard.router,
    prefix=f"{settings.api_prefix}",
    tags=["Dashboard"],
    dependencies=[Depends(get_authenticated_user)],
)
app.include_router(
    admin_office.router,
    prefix=f"{settings.api_prefix}/admin-office",
    tags=["Admin Office"],
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("admin_office"))],
)

if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.reload,
        log_level="info",
    )
