"""
EduPay fee management routes
"""
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import get_authenticated_actor_context
from app.models import (
    EduPayFeeAssignment,
    EduPayFeeStructure,
    EduPayParent,
    EduPayPayment,
    EduPayStudent,
    FeeAssignmentStatus,
    FeeInstallmentPlan,
    PaymentMethod,
    PaymentVerificationStatus,
    School,
    User,
    UserRole,
)
from app.schemas import (
    EduPayDashboardResponse,
    EduPayFeeAssignmentResponse,
    EduPayFeeStructureCreate,
    EduPayFeeStructureResponse,
    EduPayMethodSplit,
    EduPayParentChildSummary,
    EduPayParentPortalResponse,
    EduPayParentResponse,
    EduPayPaymentCreate,
    EduPayPaymentResponse,
    EduPayReminderItem,
    EduPayStudentCreate,
    EduPayStudentResponse,
    EduPayTrendPoint,
)

router = APIRouter(prefix="/api/edupay", tags=["EduPay"])

WRITE_ROLES = {
    UserRole.ADMIN.value,
    UserRole.STORE_MANAGER.value,
    "accountant",
    "staff",
}


def ensure_school_context(db: Session, school_id: int = 1) -> School:
    school = db.query(School).filter(School.id == school_id).first()
    if school:
        return school

    admin = db.query(User).filter(User.id == 1).first()
    if not admin:
        admin = User(
            id=1,
            email="admin@school.edu",
            full_name="System Administrator",
            password_hash="dummy_hash",
            role=UserRole.ADMIN,
            is_active=True,
            is_verified=True,
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)

    school = School(
        id=school_id,
        name="Default School",
        admin_id=admin.id,
        is_active=True,
    )
    db.add(school)
    db.commit()
    db.refresh(school)
    return school


def require_write_access(actor: Dict[str, str] = Depends(get_authenticated_actor_context)) -> Dict[str, str]:
    if actor["role"] not in WRITE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Admin, Accountant, or Staff can modify EduPay records",
        )
    return actor


def installment_count(plan: FeeInstallmentPlan) -> int:
    if plan == FeeInstallmentPlan.YEARLY:
        return 1
    if plan == FeeInstallmentPlan.QUARTERLY:
        return 4
    return 4


def installment_gap_days(plan: FeeInstallmentPlan) -> int:
    if plan == FeeInstallmentPlan.YEARLY:
        return 365
    if plan == FeeInstallmentPlan.QUARTERLY:
        return 90
    return 30


def next_receipt_number(db: Session, school_id: int) -> str:
    last_payment = (
        db.query(EduPayPayment)
        .filter(EduPayPayment.school_id == school_id)
        .order_by(EduPayPayment.id.desc())
        .first()
    )
    next_id = (last_payment.id + 1) if last_payment else 1
    return f"EDU-{school_id:02d}-{next_id:05d}"


def refresh_assignment_status(assignment: EduPayFeeAssignment, now: Optional[datetime] = None) -> None:
    current_time = now or datetime.now()
    outstanding = max(float(assignment.amount_due + assignment.late_fee_applied - assignment.amount_paid), 0.0)
    if outstanding <= 0.01:
        assignment.status = FeeAssignmentStatus.PAID
    elif assignment.due_date < current_time:
        assignment.status = FeeAssignmentStatus.OVERDUE
    else:
        assignment.status = FeeAssignmentStatus.PENDING


def serialize_parent(parent: EduPayParent) -> EduPayParentResponse:
    return EduPayParentResponse.model_validate(parent, from_attributes=True)


def serialize_payment(payment: EduPayPayment) -> EduPayPaymentResponse:
    return EduPayPaymentResponse(
        id=payment.id,
        assignment_id=payment.assignment_id,
        student_id=payment.student_id,
        student_name=payment.student.full_name if payment.student else "",
        amount=payment.amount,
        method=payment.method,
        payment_date=payment.payment_date,
        transaction_reference=payment.transaction_reference,
        receipt_number=payment.receipt_number,
        verification_status=payment.verification_status,
        school_id=payment.school_id,
        created_at=payment.created_at,
    )


def serialize_assignment(assignment: EduPayFeeAssignment) -> EduPayFeeAssignmentResponse:
    refresh_assignment_status(assignment)
    return EduPayFeeAssignmentResponse(
        id=assignment.id,
        student_id=assignment.student_id,
        student_name=assignment.student.full_name if assignment.student else "",
        fee_structure_id=assignment.fee_structure_id,
        fee_structure_name=assignment.fee_structure.name if assignment.fee_structure else "",
        installment_label=assignment.installment_label,
        due_date=assignment.due_date,
        amount_due=assignment.amount_due,
        amount_paid=assignment.amount_paid,
        discount_amount=assignment.discount_amount,
        late_fee_applied=assignment.late_fee_applied,
        status=assignment.status,
        school_id=assignment.school_id,
        created_at=assignment.created_at,
        updated_at=assignment.updated_at,
    )


def serialize_student(student: EduPayStudent) -> EduPayStudentResponse:
    assignments = student.assignments or []
    for assignment in assignments:
      refresh_assignment_status(assignment)

    total_due = sum(float(item.amount_due + item.late_fee_applied) for item in assignments)
    total_paid = sum(float(item.amount_paid) for item in assignments)
    next_due = None
    outstanding_status = FeeAssignmentStatus.PAID

    sorted_open = sorted(
        [item for item in assignments if item.status != FeeAssignmentStatus.PAID],
        key=lambda item: item.due_date,
    )
    if sorted_open:
        next_due = sorted_open[0].due_date
        outstanding_status = sorted_open[0].status

    return EduPayStudentResponse(
        id=student.id,
        admission_no=student.admission_no,
        full_name=student.full_name,
        class_name=student.class_name,
        batch_name=student.batch_name,
        email=student.email,
        phone=student.phone,
        school_id=student.school_id,
        parent_id=student.parent_id,
        parent_name=student.parent.full_name if student.parent else "",
        parent_mobile=student.parent.mobile_number if student.parent else "",
        parent_email=student.parent.email if student.parent else None,
        total_due=round(total_due, 2),
        total_paid=round(total_paid, 2),
        status=outstanding_status,
        next_due_date=next_due,
        is_active=student.is_active,
        created_at=student.created_at,
        updated_at=student.updated_at,
    )


def serialize_fee_structure(fee_structure: EduPayFeeStructure) -> EduPayFeeStructureResponse:
    return EduPayFeeStructureResponse(
        id=fee_structure.id,
        name=fee_structure.name,
        fee_type=fee_structure.fee_type,
        class_name=fee_structure.class_name,
        installment_plan=fee_structure.installment_plan,
        total_amount=fee_structure.total_amount,
        discount_amount=fee_structure.discount_amount,
        late_fee_rule=fee_structure.late_fee_rule,
        description=fee_structure.description,
        is_active=fee_structure.is_active,
        school_id=fee_structure.school_id,
        assigned_students=len(fee_structure.assignments or []),
        created_at=fee_structure.created_at,
        updated_at=fee_structure.updated_at,
    )


def assign_fee_structure_to_students(
    db: Session,
    school_id: int,
    fee_structure: EduPayFeeStructure,
    target_students: List[EduPayStudent],
    start_date: Optional[datetime] = None,
) -> None:
    if not target_students:
        return

    count = installment_count(fee_structure.installment_plan)
    gap = installment_gap_days(fee_structure.installment_plan)
    base_date = start_date or datetime.now()
    per_installment = round(max(fee_structure.total_amount - fee_structure.discount_amount, 0.0) / count, 2)
    per_discount = round(fee_structure.discount_amount / count, 2) if fee_structure.discount_amount else 0.0

    for student in target_students:
        existing_count = (
            db.query(EduPayFeeAssignment)
            .filter(
                EduPayFeeAssignment.student_id == student.id,
                EduPayFeeAssignment.fee_structure_id == fee_structure.id,
            )
            .count()
        )
        if existing_count:
            continue

        for index in range(count):
            due_date = base_date + timedelta(days=gap * index)
            assignment = EduPayFeeAssignment(
                student_id=student.id,
                fee_structure_id=fee_structure.id,
                installment_label=f"Installment {index + 1}",
                due_date=due_date,
                amount_due=per_installment,
                amount_paid=0.0,
                discount_amount=per_discount,
                late_fee_applied=0.0,
                status=FeeAssignmentStatus.PENDING,
                school_id=school_id,
            )
            refresh_assignment_status(assignment, now=datetime.now())
            db.add(assignment)


def seed_edupay_data(db: Session, school_id: int = 1) -> None:
    ensure_school_context(db, school_id)
    if db.query(EduPayStudent).filter(EduPayStudent.school_id == school_id).first():
        return

    parent_payloads = [
        {"full_name": "Neha Mehta", "mobile_number": "9876543210", "email": "neha.mehta@example.com", "relation": "mother"},
        {"full_name": "Rohit Sharma", "mobile_number": "9876543211", "email": "rohit.sharma@example.com", "relation": "father"},
        {"full_name": "Vandana Jain", "mobile_number": "9876543212", "email": "vandana.jain@example.com", "relation": "mother"},
    ]
    parents: List[EduPayParent] = []
    for payload in parent_payloads:
        parent = EduPayParent(school_id=school_id, is_active=True, **payload)
        db.add(parent)
        parents.append(parent)
    db.flush()

    student_payloads = [
        {"admission_no": "EDU001", "full_name": "Aarav Mehta", "class_name": "Class 9 - A", "batch_name": "Batch Alpha", "parent_id": parents[0].id, "email": "aarav@example.com", "phone": "9000000001"},
        {"admission_no": "EDU002", "full_name": "Aahana Mehta", "class_name": "Class 4 - B", "batch_name": "Batch Junior", "parent_id": parents[0].id, "email": "aahana@example.com", "phone": "9000000002"},
        {"admission_no": "EDU003", "full_name": "Siya Sharma", "class_name": "Class 7 - B", "batch_name": "Batch Rise", "parent_id": parents[1].id, "email": "siya@example.com", "phone": "9000000003"},
        {"admission_no": "EDU004", "full_name": "Kabir Jain", "class_name": "Class 11 Commerce", "batch_name": "Batch Commerce", "parent_id": parents[2].id, "email": "kabir@example.com", "phone": "9000000004"},
        {"admission_no": "EDU005", "full_name": "Anaya Verma", "class_name": "Class 5 - C", "batch_name": "Batch Junior", "parent_id": parents[2].id, "email": "anaya@example.com", "phone": "9000000005"},
    ]
    students: List[EduPayStudent] = []
    for payload in student_payloads:
        student = EduPayStudent(school_id=school_id, is_active=True, **payload)
        db.add(student)
        students.append(student)
    db.flush()

    structure_payloads = [
        {
            "name": "Core Tuition Plan",
            "fee_type": "tuition",
            "class_name": None,
            "installment_plan": FeeInstallmentPlan.QUARTERLY,
            "total_amount": 48000,
            "discount_amount": 2000,
            "late_fee_rule": "Rs 75 per day",
            "description": "Main tuition, labs, and activity coverage",
        },
        {
            "name": "Transport Plan",
            "fee_type": "transport",
            "class_name": "Class 9 - A",
            "installment_plan": FeeInstallmentPlan.MONTHLY,
            "total_amount": 12000,
            "discount_amount": 0,
            "late_fee_rule": "2% flat after due date",
            "description": "Route transport coverage",
        },
        {
            "name": "Senior Commerce Bundle",
            "fee_type": "exam",
            "class_name": "Class 11 Commerce",
            "installment_plan": FeeInstallmentPlan.YEARLY,
            "total_amount": 22500,
            "discount_amount": 1500,
            "late_fee_rule": "Rs 150 per day",
            "description": "Senior commerce tuition and exam package",
        },
    ]
    fee_structures: List[EduPayFeeStructure] = []
    for payload in structure_payloads:
        structure = EduPayFeeStructure(school_id=school_id, is_active=True, **payload)
        db.add(structure)
        fee_structures.append(structure)
    db.flush()

    now = datetime.now()
    for structure in fee_structures:
        matched_students = [
            student
            for student in students
            if structure.class_name is None or student.class_name == structure.class_name
        ]
        assign_fee_structure_to_students(db, school_id, structure, matched_students, start_date=now - timedelta(days=45))
    db.flush()

    assignments = (
        db.query(EduPayFeeAssignment)
        .filter(EduPayFeeAssignment.school_id == school_id)
        .order_by(EduPayFeeAssignment.id.asc())
        .all()
    )
    if assignments:
        first = assignments[0]
        first.amount_paid = first.amount_due
        refresh_assignment_status(first, now=now)
        db.add(
            EduPayPayment(
                assignment_id=first.id,
                student_id=first.student_id,
                amount=first.amount_due,
                method=PaymentMethod.UPI,
                payment_date=now - timedelta(days=20),
                transaction_reference="UPI-DEMO-001",
                receipt_number=next_receipt_number(db, school_id),
                verification_status=PaymentVerificationStatus.VERIFIED,
                school_id=school_id,
            )
        )

    if len(assignments) > 1:
        second = assignments[1]
        partial_amount = round(second.amount_due / 2, 2)
        second.amount_paid = partial_amount
        refresh_assignment_status(second, now=now)
        db.add(
            EduPayPayment(
                assignment_id=second.id,
                student_id=second.student_id,
                amount=partial_amount,
                method=PaymentMethod.CARD,
                payment_date=now - timedelta(days=8),
                transaction_reference="CARD-DEMO-002",
                receipt_number=next_receipt_number(db, school_id),
                verification_status=PaymentVerificationStatus.PENDING,
                school_id=school_id,
            )
        )

    db.commit()


@router.get("/dashboard", response_model=EduPayDashboardResponse)
def get_dashboard(
    school_id: int = Query(default=1),
    db: Session = Depends(get_db),
):
    seed_edupay_data(db, school_id)
    now = datetime.now()
    assignments = db.query(EduPayFeeAssignment).filter(EduPayFeeAssignment.school_id == school_id).all()
    payments = (
        db.query(EduPayPayment)
        .filter(EduPayPayment.school_id == school_id)
        .order_by(EduPayPayment.payment_date.desc(), EduPayPayment.id.desc())
        .all()
    )
    students_count = db.query(EduPayStudent).filter(EduPayStudent.school_id == school_id).count()
    structures_count = db.query(EduPayFeeStructure).filter(
        EduPayFeeStructure.school_id == school_id,
        EduPayFeeStructure.is_active == True,
    ).count()

    pending_amount = 0.0
    overdue_amount = 0.0
    upcoming_dues = 0
    reminders: List[EduPayReminderItem] = []

    for assignment in assignments:
        refresh_assignment_status(assignment, now=now)
        outstanding = max(float(assignment.amount_due + assignment.late_fee_applied - assignment.amount_paid), 0.0)
        if assignment.status == FeeAssignmentStatus.OVERDUE:
            overdue_amount += outstanding
        elif assignment.status == FeeAssignmentStatus.PENDING:
            pending_amount += outstanding
        if assignment.status != FeeAssignmentStatus.PAID and 0 <= (assignment.due_date - now).days <= 15:
            upcoming_dues += 1

    recent_upcoming = (
        db.query(EduPayFeeAssignment)
        .filter(EduPayFeeAssignment.school_id == school_id, EduPayFeeAssignment.status != FeeAssignmentStatus.PAID)
        .order_by(EduPayFeeAssignment.due_date.asc())
        .limit(3)
        .all()
    )
    for item in recent_upcoming:
        reminders.append(
            EduPayReminderItem(
                title=f"{item.installment_label} reminder",
                channel="WhatsApp + Email",
                audience=item.student.parent.full_name if item.student and item.student.parent else item.student.full_name,
                scheduled_for=item.due_date.strftime("%d %b %Y"),
            )
        )

    total_collected = round(sum(float(payment.amount) for payment in payments), 2)
    trend_points: List[EduPayTrendPoint] = []
    for month_offset in range(5, -1, -1):
        target = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        month_anchor = (target - timedelta(days=month_offset * 30))
        label = month_anchor.strftime("%b")
        total = sum(
            float(payment.amount)
            for payment in payments
            if payment.payment_date.strftime("%Y-%m") == month_anchor.strftime("%Y-%m")
        )
        trend_points.append(EduPayTrendPoint(month=label, amount=round(total, 2)))

    total_payment_amount = sum(float(payment.amount) for payment in payments) or 1.0
    method_split: List[EduPayMethodSplit] = []
    for method in PaymentMethod:
        amount = sum(float(payment.amount) for payment in payments if payment.method == method)
        if amount <= 0:
            continue
        method_split.append(
            EduPayMethodSplit(
                method=method.value,
                amount=round(amount, 2),
                percentage=round((amount / total_payment_amount) * 100, 2),
            )
        )

    db.commit()
    return EduPayDashboardResponse(
        total_collected=round(total_collected, 2),
        pending_amount=round(pending_amount, 2),
        overdue_amount=round(overdue_amount, 2),
        upcoming_dues=upcoming_dues,
        total_students=students_count,
        active_fee_structures=structures_count,
        reminders_queued=len(reminders),
        collection_trend=trend_points,
        payment_method_split=method_split,
        reminders=reminders,
        recent_payments=[serialize_payment(payment) for payment in payments[:5]],
    )


@router.get("/students", response_model=List[EduPayStudentResponse])
def list_students(
    school_id: int = Query(default=1),
    db: Session = Depends(get_db),
):
    seed_edupay_data(db, school_id)
    students = (
        db.query(EduPayStudent)
        .filter(EduPayStudent.school_id == school_id)
        .order_by(EduPayStudent.created_at.desc(), EduPayStudent.id.desc())
        .all()
    )
    payload = [serialize_student(student) for student in students]
    db.commit()
    return payload


@router.post("/students", response_model=EduPayStudentResponse)
def create_student(
    payload: EduPayStudentCreate,
    school_id: int = Query(default=1),
    actor: Dict[str, str] = Depends(require_write_access),
    db: Session = Depends(get_db),
):
    seed_edupay_data(db, school_id)
    existing = (
        db.query(EduPayStudent)
        .filter(
            EduPayStudent.school_id == school_id,
            EduPayStudent.admission_no.ilike(payload.admission_no.strip()),
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="Admission number already exists")

    parent = (
        db.query(EduPayParent)
        .filter(
            EduPayParent.school_id == school_id,
            EduPayParent.mobile_number == payload.parent_mobile.strip(),
        )
        .first()
    )
    if not parent:
        parent = EduPayParent(
            full_name=payload.parent_name.strip(),
            mobile_number=payload.parent_mobile.strip(),
            email=payload.parent_email,
            relation=payload.parent_relation.strip(),
            school_id=school_id,
            is_active=True,
        )
        db.add(parent)
        db.flush()

    student = EduPayStudent(
        admission_no=payload.admission_no.strip(),
        full_name=payload.full_name.strip(),
        class_name=payload.class_name.strip(),
        batch_name=(payload.batch_name or "").strip() or None,
        parent_id=parent.id,
        school_id=school_id,
        email=payload.email,
        phone=payload.phone,
        is_active=True,
    )
    db.add(student)
    db.flush()

    structures = (
        db.query(EduPayFeeStructure)
        .filter(
            EduPayFeeStructure.school_id == school_id,
            EduPayFeeStructure.is_active == True,
        )
        .all()
    )
    for structure in structures:
        if structure.class_name and structure.class_name != student.class_name:
            continue
        assign_fee_structure_to_students(db, school_id, structure, [student])

    db.commit()
    db.refresh(student)
    return serialize_student(student)


@router.get("/fee-structures", response_model=List[EduPayFeeStructureResponse])
def list_fee_structures(
    school_id: int = Query(default=1),
    db: Session = Depends(get_db),
):
    seed_edupay_data(db, school_id)
    structures = (
        db.query(EduPayFeeStructure)
        .filter(EduPayFeeStructure.school_id == school_id)
        .order_by(EduPayFeeStructure.created_at.desc(), EduPayFeeStructure.id.desc())
        .all()
    )
    return [serialize_fee_structure(item) for item in structures]


@router.post("/fee-structures", response_model=EduPayFeeStructureResponse)
def create_fee_structure(
    payload: EduPayFeeStructureCreate,
    school_id: int = Query(default=1),
    actor: Dict[str, str] = Depends(require_write_access),
    db: Session = Depends(get_db),
):
    seed_edupay_data(db, school_id)
    structure = EduPayFeeStructure(
        name=payload.name.strip(),
        fee_type=payload.fee_type.strip(),
        class_name=(payload.class_name or "").strip() or None,
        installment_plan=payload.installment_plan,
        total_amount=payload.total_amount,
        discount_amount=payload.discount_amount,
        late_fee_rule=(payload.late_fee_rule or "").strip() or None,
        description=payload.description,
        school_id=school_id,
        is_active=payload.is_active,
    )
    db.add(structure)
    db.flush()

    query = db.query(EduPayStudent).filter(EduPayStudent.school_id == school_id, EduPayStudent.is_active == True)
    if structure.class_name:
        query = query.filter(EduPayStudent.class_name == structure.class_name)
    matched_students = query.all()
    assign_fee_structure_to_students(db, school_id, structure, matched_students)

    db.commit()
    db.refresh(structure)
    return serialize_fee_structure(structure)


@router.get("/assignments", response_model=List[EduPayFeeAssignmentResponse])
def list_assignments(
    school_id: int = Query(default=1),
    status_filter: Optional[FeeAssignmentStatus] = Query(default=None, alias="status"),
    student_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
):
    seed_edupay_data(db, school_id)
    query = db.query(EduPayFeeAssignment).filter(EduPayFeeAssignment.school_id == school_id)
    if student_id:
        query = query.filter(EduPayFeeAssignment.student_id == student_id)
    assignments = query.order_by(EduPayFeeAssignment.due_date.asc(), EduPayFeeAssignment.id.asc()).all()

    payload: List[EduPayFeeAssignmentResponse] = []
    for assignment in assignments:
        refresh_assignment_status(assignment)
        if status_filter and assignment.status != status_filter:
            continue
        payload.append(serialize_assignment(assignment))
    db.commit()
    return payload


@router.get("/payments", response_model=List[EduPayPaymentResponse])
def list_payments(
    school_id: int = Query(default=1),
    db: Session = Depends(get_db),
):
    seed_edupay_data(db, school_id)
    payments = (
        db.query(EduPayPayment)
        .filter(EduPayPayment.school_id == school_id)
        .order_by(EduPayPayment.payment_date.desc(), EduPayPayment.id.desc())
        .all()
    )
    return [serialize_payment(payment) for payment in payments]


@router.post("/payments", response_model=EduPayPaymentResponse)
def create_payment(
    payload: EduPayPaymentCreate,
    school_id: int = Query(default=1),
    actor: Dict[str, str] = Depends(require_write_access),
    db: Session = Depends(get_db),
):
    seed_edupay_data(db, school_id)
    assignment = (
        db.query(EduPayFeeAssignment)
        .filter(
            EduPayFeeAssignment.id == payload.assignment_id,
            EduPayFeeAssignment.school_id == school_id,
        )
        .first()
    )
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    outstanding = max(float(assignment.amount_due + assignment.late_fee_applied - assignment.amount_paid), 0.0)
    if payload.amount - outstanding > 0.01:
        raise HTTPException(status_code=400, detail="Payment amount cannot exceed outstanding balance")

    payment = EduPayPayment(
        assignment_id=assignment.id,
        student_id=assignment.student_id,
        amount=payload.amount,
        method=payload.method,
        payment_date=payload.payment_date or datetime.now(),
        transaction_reference=(payload.transaction_reference or "").strip() or None,
        receipt_number=next_receipt_number(db, school_id),
        verification_status=PaymentVerificationStatus.VERIFIED,
        school_id=school_id,
    )
    assignment.amount_paid = round(float(assignment.amount_paid) + float(payload.amount), 2)
    refresh_assignment_status(assignment)
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return serialize_payment(payment)


@router.get("/parent-portal", response_model=EduPayParentPortalResponse)
def get_parent_portal(
    school_id: int = Query(default=1),
    parent_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
):
    seed_edupay_data(db, school_id)
    query = db.query(EduPayParent).filter(EduPayParent.school_id == school_id, EduPayParent.is_active == True)
    parent = query.filter(EduPayParent.id == parent_id).first() if parent_id else query.order_by(EduPayParent.id.asc()).first()
    if not parent:
        raise HTTPException(status_code=404, detail="Parent not found")

    children_payload: List[EduPayParentChildSummary] = []
    student_ids: List[int] = []
    for student in parent.students:
        for assignment in student.assignments:
            refresh_assignment_status(assignment)
        open_assignments = sorted(
            [assignment for assignment in student.assignments if assignment.status != FeeAssignmentStatus.PAID],
            key=lambda assignment: assignment.due_date,
        )
        due_amount = sum(
            max(float(item.amount_due + item.late_fee_applied - item.amount_paid), 0.0)
            for item in student.assignments
        )
        next_due = open_assignments[0].due_date if open_assignments else None
        status_value = open_assignments[0].status if open_assignments else FeeAssignmentStatus.PAID
        children_payload.append(
            EduPayParentChildSummary(
                student_id=student.id,
                student_name=student.full_name,
                class_name=student.class_name,
                due_amount=round(due_amount, 2),
                next_due_date=next_due,
                status=status_value,
            )
        )
        student_ids.append(student.id)

    payments = (
        db.query(EduPayPayment)
        .filter(EduPayPayment.student_id.in_(student_ids))
        .order_by(EduPayPayment.payment_date.desc(), EduPayPayment.id.desc())
        .all()
        if student_ids
        else []
    )
    db.commit()
    return EduPayParentPortalResponse(
        parent=serialize_parent(parent),
        children=children_payload,
        payment_history=[serialize_payment(payment) for payment in payments[:8]],
    )
