"""
FastAPI main application setup
"""
from fastapi import FastAPI, File, UploadFile, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import logging
import traceback
from app.config import settings
from app.database import get_db
from app.middleware.auth import get_authenticated_user, require_permissions

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
    logger.info("Application startup complete. Run Alembic migrations before serving traffic.")
    
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

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Health check endpoint
@app.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint"""
    return {
        "status": "ok",
        "service": "Dr. GIRISH APP",
        "version": settings.api_version,
    }


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
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "detail": exc.detail,
            "error": exc.detail,
            "status_code": exc.status_code,
        }
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc):
    """Expose useful error details in local development."""
    logger.exception("Unhandled exception while processing request")
    content = {
        "detail": str(exc) or exc.__class__.__name__,
        "error": str(exc) or exc.__class__.__name__,
        "status_code": 500,
    }
    if settings.debug:
        content["traceback"] = traceback.format_exc()
    return JSONResponse(status_code=500, content=content)


# Import routes after app creation
from app.routes import auth, students, rooms, seating, reports, exams, teachers, timetable, settings as settings_router, batches, invigilators, inventory, edupay, attendance

# Include routers
app.include_router(auth.router, prefix=f"{settings.api_prefix}/auth", tags=["Authentication"])
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
        Depends(require_permissions("admin_office.reports", "admin_office.seating_plans")),
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
    attendance.router,
    dependencies=[Depends(get_authenticated_user), Depends(require_permissions("attendance"))],
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
