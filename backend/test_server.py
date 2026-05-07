import os
os.environ['DATABASE_URL'] = 'sqlite:///test.db'

from fastapi import FastAPI, File, UploadFile, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import logging
from app.config import settings
from app.database import Base, engine, get_db

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
    logger.info("Creating database tables...")
    Base.metadata.create_all(bind=engine)
    logger.info("Application startup complete")
    
    yield


# Create FastAPI app
app = FastAPI(
    title=settings.api_title,
    description="Professional Exam Seating Planner API",
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
        "service": "Exam Seating Planner API",
        "version": settings.api_version,
    }


# Root endpoint
@app.get("/", tags=["Root"])
async def root():
    """Root endpoint with API documentation"""
    return {
        "message": "Welcome to Exam Seating Planner API",
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
            "error": exc.detail,
            "status_code": exc.status_code,
        }
    )


# Import routes after app creation
from app.routes import auth, students, rooms, seating, reports, exams

# Include routers
app.include_router(auth.router, prefix=f"{settings.api_prefix}/auth", tags=["Authentication"])
app.include_router(students.router, prefix=f"{settings.api_prefix}/students", tags=["Students"])
app.include_router(rooms.router, prefix=f"{settings.api_prefix}/rooms", tags=["Rooms"])
app.include_router(seating.router, prefix=f"{settings.api_prefix}/seating", tags=["Seating"])
app.include_router(reports.router, prefix=f"{settings.api_prefix}/reports", tags=["Reports"])
app.include_router(exams.router, prefix=f"{settings.api_prefix}/exams", tags=["Exams"])

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=8000, log_level='info')
<parameter name="filePath">c:\Users\GIRISH\Desktop\SITTING PLAN\backend\test_server.py