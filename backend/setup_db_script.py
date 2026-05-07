"""Local database bootstrap for development and demos."""

from datetime import datetime
import logging

from sqlalchemy import text

from app.database import SessionLocal
from app.models import BatchTable, Exam, Room, School, Student, Teacher, User, UserRole
from app.utils.auth import hash_password
from sample_data import get_sample_rooms, get_sample_students, get_sample_teachers


logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
logging.getLogger("sqlalchemy.pool").setLevel(logging.WARNING)


def ensure_schema_is_migrated(db):
    """Fail fast if Alembic migrations have not been applied yet."""
    try:
        db.execute(text("SELECT version_num FROM alembic_version"))
    except Exception as exc:
        raise RuntimeError(
            "Database schema is not initialized. Run 'python -m alembic upgrade head' before seeding data."
        ) from exc


def ensure_admin(db):
    admin = (
        db.query(User)
        .filter((User.username == "admin") | (User.email == "admin@school.edu"))
        .first()
    )
    if admin:
        return admin

    admin = User(
        username="admin",
        email="admin@school.edu",
        full_name="System Administrator",
        password_hash=hash_password("admin123"),
        role=UserRole.ADMIN,
        user_type="non_teaching",
        permissions="admin_office,timetable,attendance,inventory,edupay,settings",
        is_active=True,
        is_verified=True,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    print("Created default admin user")
    return admin


def ensure_school(db, admin):
    school = db.query(School).filter(School.email == "admin@demoschool.edu").first()
    if school:
        return school

    school = School(
        name="Demo School",
        address="123 Education Street, Learning City",
        phone="+91-9876543210",
        email="admin@demoschool.edu",
        admin_id=admin.id,
        is_active=True,
    )
    db.add(school)
    db.commit()
    db.refresh(school)
    print("Created default school")
    return school


def ensure_batch(db, school_id: int, batch_name: str):
    batch = (
        db.query(BatchTable)
        .filter(BatchTable.school_id == school_id, BatchTable.name == batch_name)
        .first()
    )
    if batch:
        return batch

    batch = BatchTable(name=batch_name, school_id=school_id, is_active=True)
    db.add(batch)
    db.commit()
    db.refresh(batch)
    return batch


def seed_students(db, school):
    created = 0
    for student_data in get_sample_students():
        existing = db.query(Student).filter(Student.roll_number == student_data["roll_number"]).first()
        if existing:
            continue
        batch = ensure_batch(db, school.id, student_data["batch"])
        student = Student(
            roll_number=student_data["roll_number"],
            name=student_data["name"],
            father_name=student_data.get("father_name"),
            batch_id=batch.id,
            batch=student_data["batch"],
            school_id=school.id,
            email=student_data.get("email"),
            special_needs=student_data.get("special_needs"),
            requires_near_exit=student_data.get("requires_near_exit", False),
            requires_extra_time=student_data.get("requires_extra_time", False),
            is_active=True,
        )
        db.add(student)
        created += 1
    if created:
        db.commit()
    print(f"Students seeded: {created}")


def seed_rooms(db, school):
    created = 0
    for room_data in get_sample_rooms():
        existing = (
            db.query(Room)
            .filter(Room.school_id == school.id, Room.name == room_data["name"])
            .first()
        )
        if existing:
            continue
        room = Room(school_id=school.id, is_active=True, **room_data)
        db.add(room)
        created += 1
    if created:
        db.commit()
    print(f"Rooms seeded: {created}")


def seed_teachers(db, school):
    created = 0
    for teacher_data in get_sample_teachers():
        existing = (
            db.query(Teacher)
            .filter(Teacher.school_id == school.id, Teacher.email == teacher_data["email"])
            .first()
        )
        if existing:
            continue
        teacher = Teacher(school_id=school.id, is_active=True, **teacher_data)
        db.add(teacher)
        created += 1
    if created:
        db.commit()
    print(f"Teachers seeded: {created}")


def seed_exam(db, school):
    exam = db.query(Exam).filter(Exam.school_id == school.id).first()
    if exam:
        print("Exam already exists")
        return

    exam = Exam(
        name="Mathematics Final Exam",
        subject="Mathematics",
        exam_date=datetime(2026, 12, 15, 10, 0, 0),
        duration_minutes=180,
        school_id=school.id,
        is_active=True,
    )
    db.add(exam)
    db.commit()
    print("Created sample exam")


def main():
    db = SessionLocal()
    try:
        ensure_schema_is_migrated(db)
        admin = ensure_admin(db)
        school = ensure_school(db, admin)
        seed_students(db, school)
        seed_rooms(db, school)
        seed_teachers(db, school)
        seed_exam(db, school)
        print("Database setup and sample data addition complete!")
    except Exception as exc:
        db.rollback()
        print(f"Error: {exc}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
