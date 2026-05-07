"""
Run a quick test to verify system setup.
"""
import sys
from importlib import import_module


def check_imports():
    """Check if all required packages can be imported."""
    required_packages = [
        "fastapi",
        "sqlalchemy",
        "pydantic",
        "psycopg2",
        "openpyxl",
        "reportlab",
    ]

    missing = []
    for package in required_packages:
        try:
            __import__(package)
            print(f"[OK] {package}")
        except ImportError:
            print(f"[FAIL] {package}")
            missing.append(package)

    return len(missing) == 0


def check_database():
    """Check database connectivity."""
    try:
        from app.database import engine

        with engine.connect():
            print("[OK] Database connection successful")
            return True
    except Exception as exc:
        print(f"[FAIL] Database connection failed: {exc}")
        return False


def check_app_startup():
    """Check whether the FastAPI app module imports cleanly."""
    try:
        import_module("app.main")
        print("[OK] FastAPI app imports successfully")
        return True
    except Exception as exc:
        print(f"[FAIL] FastAPI app import failed: {exc}")
        return False


def main():
    print("Exam Seating Planner - System Check")
    print("=" * 50)

    print("\nChecking Python packages...")
    packages_ok = check_imports()

    print("\nChecking database...")
    database_ok = check_database()

    print("\nChecking application startup...")
    app_ok = check_app_startup()

    print("\n" + "=" * 50)
    if packages_ok and database_ok and app_ok:
        print("[OK] All checks passed! System is ready.")
        return 0

    print("[FAIL] Some checks failed. Please verify setup.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
