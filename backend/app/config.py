"""
Application configuration
"""
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

from pydantic import field_validator
from pydantic_settings import BaseSettings


BASE_DIR = Path(__file__).resolve().parents[1]


def _coerce_env_bool(value):
    """Accept common env-style boolean strings such as 'release'/'dev'."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on", "dev", "debug"}:
            return True
        if normalized in {"0", "false", "no", "off", "prod", "production", "release"}:
            return False
    return value


class Settings(BaseSettings):
    """Application settings"""
    # API
    api_title: str = "Dr. GIRISH APP"
    api_version: str = "1.0.0"
    api_prefix: str = "/api"
    
    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = True
    reload: bool = True
    
    # Database
    database_url: str = "postgresql://postgres:password@localhost:5432/seating_planner"
    
    # Redis
    redis_url: str = "redis://localhost:6379/0"
    
    # Security
    jwt_secret: str = "your-secret-key-change-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expiration_hours: int = 24
    
    # Email
    smtp_email: str = "noreply@school.edu"
    smtp_password: str = ""
    smtp_server: str = "smtp.gmail.com"
    smtp_port: int = 587
    
    # File Upload
    max_upload_size_mb: int = 50
    upload_directory: str = "uploads"
    
    # CORS
    cors_origins: list = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
    ]

    @field_validator("debug", "reload", mode="before")
    @classmethod
    def parse_bool_flags(cls, value):
        return _coerce_env_bool(value)

    @field_validator("database_url", mode="before")
    @classmethod
    def normalize_database_url(cls, value):
        if not isinstance(value, str):
            return value

        raw_value = value.strip()
        if not raw_value.startswith("sqlite:///"):
            return raw_value

        parsed = urlsplit(raw_value)
        sqlite_path = parsed.path.lstrip("/")

        if not sqlite_path:
            return raw_value

        db_path = Path(sqlite_path)
        if not db_path.is_absolute():
            db_path = (BASE_DIR / db_path).resolve()

        normalized_url = f"sqlite:///{db_path.as_posix()}"
        if parsed.query:
            normalized_url = f"{normalized_url}?{parsed.query}"
        if parsed.fragment:
            normalized_url = f"{normalized_url}#{parsed.fragment}"
        return normalized_url

    @field_validator("upload_directory", mode="before")
    @classmethod
    def normalize_upload_directory(cls, value):
        if not isinstance(value, str):
            return value

        upload_path = Path(value.strip())
        if upload_path.is_absolute():
            return str(upload_path)

        return str((BASE_DIR / upload_path).resolve())
    
    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance"""
    return Settings()


settings = get_settings()
