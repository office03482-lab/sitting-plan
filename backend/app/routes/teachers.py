"""
Teacher management routes
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models import Teacher, School, User, UserRole
from app.schemas import TeacherCreate, TeacherResponse, TeacherUpdate

router = APIRouter()


@router.post("", response_model=TeacherResponse)
async def create_teacher(
    teacher: TeacherCreate,
    school_id: int = 1,  # TODO: Get from authenticated user
    db: Session = Depends(get_db),
):
    """
    Create a new teacher
    """
    # Ensure default school exists
    school = db.query(School).filter(School.id == school_id).first()
    if not school:
        # Create default school and admin user if they don't exist
        admin_user = db.query(User).filter(User.id == 1).first()
        if not admin_user:
            admin_user = User(
                email="admin@school.edu",
                full_name="School Admin",
                password_hash="default",  # TODO: Use proper hashing in production
                role=UserRole.ADMIN,
                is_active=True,
            )
            db.add(admin_user)
            db.commit()
            db.refresh(admin_user)
        
        school = School(
            id=school_id,
            name="Default School",
            admin_id=admin_user.id,
            is_active=True,
        )
        db.add(school)
        db.commit()
        db.refresh(school)
    
    # Check if teacher with same name and subject already exists
    existing = db.query(Teacher).filter(
        Teacher.name == teacher.name,
        Teacher.subject == teacher.subject,
        Teacher.school_id == school_id,
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Teacher with this name and subject already exists"
        )

    # Create teacher
    db_teacher = Teacher(
        name=teacher.name,
        subject=teacher.subject,
        email=teacher.email,
        phone=teacher.phone,
        school_id=school_id,
    )
    db.add(db_teacher)
    db.commit()
    db.refresh(db_teacher)

    return TeacherResponse(
        id=db_teacher.id,
        name=db_teacher.name,
        subject=db_teacher.subject,
        email=db_teacher.email,
        phone=db_teacher.phone,
        school_id=db_teacher.school_id,
        is_active=db_teacher.is_active,
        created_at=db_teacher.created_at,
        updated_at=db_teacher.updated_at,
    )


@router.get("", response_model=List[TeacherResponse])
async def list_teachers(
    school_id: int = 1,  # TODO: Get from authenticated user
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    """
    List all teachers
    """
    teachers = db.query(Teacher).filter(
        Teacher.school_id == school_id,
        Teacher.is_active == True,
    ).offset(skip).limit(limit).all()

    return [
        TeacherResponse(
            id=teacher.id,
            name=teacher.name,
            subject=teacher.subject,
            email=teacher.email,
            phone=teacher.phone,
            school_id=teacher.school_id,
            is_active=teacher.is_active,
            created_at=teacher.created_at,
            updated_at=teacher.updated_at,
        )
        for teacher in teachers
    ]


@router.get("/{teacher_id}", response_model=TeacherResponse)
async def get_teacher(
    teacher_id: int,
    school_id: int = 1,  # TODO: Get from authenticated user
    db: Session = Depends(get_db),
):
    """
    Get a specific teacher
    """
    teacher = db.query(Teacher).filter(
        Teacher.id == teacher_id,
        Teacher.school_id == school_id,
    ).first()

    if not teacher:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Teacher not found"
        )

    return TeacherResponse(
        id=teacher.id,
        name=teacher.name,
        subject=teacher.subject,
        email=teacher.email,
        phone=teacher.phone,
        school_id=teacher.school_id,
        is_active=teacher.is_active,
        created_at=teacher.created_at,
        updated_at=teacher.updated_at,
    )


@router.put("/{teacher_id}", response_model=TeacherResponse)
async def update_teacher(
    teacher_id: int,
    teacher_update: TeacherUpdate,
    school_id: int = 1,  # TODO: Get from authenticated user
    db: Session = Depends(get_db),
):
    """
    Update a teacher
    """
    teacher = db.query(Teacher).filter(
        Teacher.id == teacher_id,
        Teacher.school_id == school_id,
    ).first()

    if not teacher:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Teacher not found"
        )

    # Update fields
    update_data = teacher_update.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(teacher, field, value)

    db.commit()
    db.refresh(teacher)

    return TeacherResponse(
        id=teacher.id,
        name=teacher.name,
        subject=teacher.subject,
        email=teacher.email,
        phone=teacher.phone,
        school_id=teacher.school_id,
        is_active=teacher.is_active,
        created_at=teacher.created_at,
        updated_at=teacher.updated_at,
    )


@router.delete("/{teacher_id}")
async def delete_teacher(
    teacher_id: int,
    school_id: int = 1,  # TODO: Get from authenticated user
    db: Session = Depends(get_db),
):
    """
    Delete a teacher (soft delete)
    """
    teacher = db.query(Teacher).filter(
        Teacher.id == teacher_id,
        Teacher.school_id == school_id,
    ).first()

    if not teacher:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Teacher not found"
        )

    teacher.is_active = False
    db.commit()

    return {"message": "Teacher deleted successfully"}