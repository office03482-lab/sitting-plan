"""One-time initial admin bootstrap command."""
from app.database import SessionLocal
from app.services.admin_bootstrap import bootstrap_initial_admin


def main():
    db = SessionLocal()
    try:
        user = bootstrap_initial_admin(db)
        print(f"Initial admin ready: {user.username} <{user.email}>")
    finally:
        db.close()


if __name__ == "__main__":
    main()
