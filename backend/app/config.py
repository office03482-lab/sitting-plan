"""Application configuration."""
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings


BASE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DEV_DB_PATH = (BASE_DIR / "seating_planner.db").resolve()
UNSAFE_JWT_SECRETS = {
    "",
    "change-me",
    "replace-me",
    "your-secret-key-change-in-production",
    "secret",
    "supersecret",
}
UNSAFE_DATABASE_URLS = {
    "",
    "postgresql://postgres:password@localhost:5432/seating_planner",
    "postgresql://postgres:password@postgres:5432/seating_planner",
}


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
    """Application settings."""
    # API
    api_title: str = "Dr. GIRISH APP"
    api_version: str = "1.0.0"
    api_prefix: str = "/api"

    # Environment
    environment: str = "development"

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = True
    reload: bool = True

    # Database
    database_url: str | None = None

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # Supabase
    supabase_url: str | None = None
    supabase_service_role_key: str | None = None

    # Security
    jwt_secret: str | None = None
    jwt_algorithm: str = "HS256"
    jwt_expiration_hours: int = 1
    access_token_expiration_minutes: int = 15
    refresh_token_expiration_days: int = 14
    otp_expiration_minutes: int = 10
    login_max_attempts: int = 5
    login_ip_max_attempts: int = 12
    otp_send_max_attempts: int = 5
    otp_verify_max_attempts: int = 5
    auth_lockout_minutes: int = 15
    auth_rate_limit_window_minutes: int = 15

    # Bootstrap
    initial_admin_enabled: bool = False
    initial_admin_email: str | None = None
    initial_admin_username: str | None = None
    initial_admin_password: str | None = None
    initial_admin_full_name: str = "System Administrator"

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

    @field_validator("environment", mode="before")
    @classmethod
    def normalize_environment(cls, value):
        if not isinstance(value, str):
            return "development"
        normalized = value.strip().lower()
        if normalized in {"prod", "production", "release"}:
            return "production"
        if normalized in {"test", "testing"}:
            return "test"
        return normalized or "development"

    @field_validator("database_url", mode="before")
    @classmethod
    def normalize_database_url(cls, value):
        if value is None:
            return value
        if not isinstance(value, str):
            return value

        raw_value = value.strip()
        if not raw_value:
            return None
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

    @model_validator(mode="after")
    def enforce_security_defaults(self):
        if not self.database_url:
            if self.environment == "production":
                raise ValueError("DATABASE_URL must be set in production.")
            self.database_url = f"sqlite:///{DEFAULT_DEV_DB_PATH.as_posix()}"

        if not self.jwt_secret:
            if self.environment == "production":
                raise ValueError("JWT_SECRET must be set in production.")
            self.jwt_secret = f"dev-only-{BASE_DIR.name.lower().replace(' ', '-')}-jwt-secret"

        if self.environment == "production":
            if self.debug:
                raise ValueError("DEBUG must be false in production.")
            if self.reload:
                raise ValueError("RELOAD must be false in production.")
            if self.database_url in UNSAFE_DATABASE_URLS:
                raise ValueError("DATABASE_URL is using an unsafe placeholder value.")
            if self.database_url.startswith("sqlite:///"):
                raise ValueError("SQLite is not allowed for production deployments.")
            if self.jwt_secret.strip().lower() in UNSAFE_JWT_SECRETS or len(self.jwt_secret.strip()) < 32:
                raise ValueError("JWT_SECRET must be explicitly configured and at least 32 characters in production.")

        return self

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    class Config:
        env_file = str(BASE_DIR / ".env")
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance"""
    return Settings()


settings = get_settings()
