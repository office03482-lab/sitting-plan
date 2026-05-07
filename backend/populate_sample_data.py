"""
Populate database with sample data for testing
"""
import logging
import os
import sys
from sqlalchemy import text

# Suppress SQLAlchemy logging
logging.getLogger('sqlalchemy.engine').setLevel(logging.WARNING)
logging.getLogger('sqlalchemy.pool').setLevel(logging.WARNING)

from app.database import SessionLocal
from app.models import (
    School, Student, Room, Teacher, Exam, TimetableEntry, BatchTable, Desk, Seat, DayOfWeek
)
from datetime import datetime

db = SessionLocal()

try:
    db.execute(text("SELECT version_num FROM alembic_version"))
except Exception as exc:
    db.close()
    raise RuntimeError(
        "Database schema is not initialized. Run 'python -m alembic upgrade head' before populating sample data."
    ) from exc

try:
    # Create School
    school = db.query(School).filter(School.id == 1).first()
    if not school:
        school = School(id=1, name="Dr. GIRISH Academy", location="City Center")
        db.add(school)
        db.commit()
        print("✓ School created")

    # Create Batches
    batches = {}
    for batch_name in ["11th", "12th", "12th Medical", "12th IIT"]:
        batch = db.query(BatchTable).filter(
            BatchTable.school_id == 1,
            BatchTable.name == batch_name
        ).first()
        if not batch:
            batch = BatchTable(name=batch_name, school_id=1, is_active=True)
            db.add(batch)
        batches[batch_name] = batch
    db.commit()
    print(f"✓ {len(batches)} Batches created")

    # Create Students
    students_count = 0
    for batch_name in ["11th", "12th"]:
        for i in range(1, 31):  # 30 students per batch
            roll = f"{batch_name.replace(' ', '')}-{i:03d}"
            existing = db.query(Student).filter(Student.roll_number == roll).first()
            if not existing:
                student = Student(
                    roll_number=roll,
                    name=f"Student {i} ({batch_name})",
                    batch_id=batches[batch_name].id,
                    school_id=1,
                    batch=batch_name,  # Legacy field
                    email=f"student{i}@school.edu",
                    is_active=True
                )
                db.add(student)
                students_count += 1
    db.commit()
    print(f"✓ {students_count} Students created")

    # Create Rooms
    rooms_count = 0
    for i in range(1, 11):  # 10 rooms
        room_name = f"Room {i}"
        existing = db.query(Room).filter(
            Room.school_id == 1,
            Room.name == room_name
        ).first()
        if not existing:
            room = Room(
                name=room_name,
                school_id=1,
                length_feet=30.0,
                width_feet=25.0,
                desk_length_feet=2.0,
                desk_width_feet=3.0,
                num_benches=16,  # 8x2 grid
                capacity=32,
                is_active=True
            )
            db.add(room)
            rooms_count += 1
    db.commit()
    print(f"✓ {rooms_count} Rooms created")

    # Create Teachers
    teachers_count = 0
    subjects = ["Mathematics", "Physics", "Chemistry", "English", "History"]
    for i, subject in enumerate(subjects, 1):
        existing = db.query(Teacher).filter(
            Teacher.school_id == 1,
            Teacher.name == f"Teacher {i}"
        ).first()
        if not existing:
            teacher = Teacher(
                name=f"Teacher {i}",
                subject=subject,
                school_id=1,
                email=f"teacher{i}@school.edu",
                is_active=True
            )
            db.add(teacher)
            teachers_count += 1
    db.commit()
    print(f"✓ {teachers_count} Teachers created")

    # Create Exam
    exam = db.query(Exam).filter(Exam.school_id == 1).first()
    if not exam:
        exam = Exam(
            name="Mid-Term Examination",
            school_id=1,
            exam_date=datetime.now(),
            is_active=True
        )
        db.add(exam)
        db.commit()
        print("✓ Exam created")

    # Summary
    print("\n" + "="*50)
    print("Database populated successfully!")
    print("="*50)
    student_count = db.query(Student).filter(Student.school_id == 1).count()
    room_count = db.query(Room).filter(Room.school_id == 1).count()
    teacher_count = db.query(Teacher).filter(Teacher.school_id == 1).count()
    print(f"Total Students: {student_count}")
    print(f"Total Rooms: {room_count}")
    print(f"Total Teachers: {teacher_count}")
    print(f"Total Exams: {db.query(Exam).filter(Exam.school_id == 1).count()}")

except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
finally:
    db.close()
