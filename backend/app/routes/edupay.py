"""
EduPay fee management routes
"""
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
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
logger = logging.getLogger(__name__)

WRITE_ROLES = {
    UserRole.ADMIN.value,
    UserRole.STORE_MANAGER.value,
    "accountant",
    "staff",
}


def get_school_id_from_context(
    school_id: str = Query(None),
    actor: dict = Depends(get_authenticated_actor_context),
    db: Session = Depends(get_db),
) -> str:
    user_id = actor.get("user_id") or actor.get("id")
    resolved_id = str(school_id) if school_id and str(school_id) != "1" else None
    if not resolved_id:
        try:
            from app.models import Profile, SchoolMembership

            profile = db.query(Profile).filter(Profile.user_id == user_id).first()
            if profile:
                membership = db.query(SchoolMembership).filter(SchoolMembership.profile_id == profile.id).first()
                if membership:
                    resolved_id = str(membership.school_id)
        except Exception:
            pass
        resolved_id = resolved_id or actor.get("school_id")

    if not resolved_id or resolved_id == "1":
        raise HTTPException(status_code=403, detail="Valid UUID school_id missing from context")
    return str(resolved_id)


def ensure_school_context(db: Session, school_id: str) -> School:
    school = db.query(School).filter(School.id == school_id).first()
    if school:
        return school
    raise HTTPException(status_code=404, detail="School not found")


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


def next_receipt_number(db: Session, school_id: str) -> str:
    last_payment = (
        db.query(EduPayPayment)
        .filter(EduPayPayment.school_id == school_id)
        .order_by(EduPayPayment.id.desc())
        .first()
    )
    next_id = (last_payment.id + 1) if last_payment else 1
    school_token = str(school_id).replace("-", "").upper()[:8]
    return f"EDU-{school_token}-{next_id:05d}"


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
    school_id: str,
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

@router.get("/dashboard", response_model=EduPayDashboardResponse)
def get_dashboard(
    school_id: str = Depends(get_school_id_from_context),
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
    db: Session = Depends(get_db),
):
    ensure_school_context(db, school_id)
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
    logger.info(
        "EduPay dashboard loaded - User ID: %s, School ID: %s, Row count: assignments=%s,payments=%s,students=%s",
        actor.get("user_id") or actor.get("id"),
        school_id,
        len(assignments),
        len(payments),
        students_count,
    )
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
    school_id: str = Depends(get_school_id_from_context),
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
    db: Session = Depends(get_db),
):
    ensure_school_context(db, school_id)
    students = (
        db.query(EduPayStudent)
        .filter(EduPayStudent.school_id == school_id)
        .order_by(EduPayStudent.created_at.desc(), EduPayStudent.id.desc())
        .all()
    )
    payload = [serialize_student(student) for student in students]
    db.commit()
    logger.info(
        "EduPay students listed - User ID: %s, School ID: %s, Row count: %s",
        actor.get("user_id") or actor.get("id"),
        school_id,
        len(payload),
    )
    return payload


@router.post("/students", response_model=EduPayStudentResponse)
def create_student(
    payload: EduPayStudentCreate,
    school_id: str = Depends(get_school_id_from_context),
    actor: Dict[str, str] = Depends(require_write_access),
    db: Session = Depends(get_db),
):
    ensure_school_context(db, school_id)
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
    logger.info(
        "EduPay student created - User ID: %s, School ID: %s, Row count: 1",
        actor.get("user_id") or actor.get("id"),
        school_id,
    )
    return serialize_student(student)


@router.get("/fee-structures", response_model=List[EduPayFeeStructureResponse])
def list_fee_structures(
    school_id: str = Depends(get_school_id_from_context),
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
    db: Session = Depends(get_db),
):
    ensure_school_context(db, school_id)
    structures = (
        db.query(EduPayFeeStructure)
        .filter(EduPayFeeStructure.school_id == school_id)
        .order_by(EduPayFeeStructure.created_at.desc(), EduPayFeeStructure.id.desc())
        .all()
    )
    payload = [serialize_fee_structure(item) for item in structures]
    logger.info(
        "EduPay fee structures listed - User ID: %s, School ID: %s, Row count: %s",
        actor.get("user_id") or actor.get("id"),
        school_id,
        len(payload),
    )
    return payload


@router.post("/fee-structures", response_model=EduPayFeeStructureResponse)
def create_fee_structure(
    payload: EduPayFeeStructureCreate,
    school_id: str = Depends(get_school_id_from_context),
    actor: Dict[str, str] = Depends(require_write_access),
    db: Session = Depends(get_db),
):
    ensure_school_context(db, school_id)
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
    logger.info(
        "EduPay fee structure created - User ID: %s, School ID: %s, Row count: 1",
        actor.get("user_id") or actor.get("id"),
        school_id,
    )
    return serialize_fee_structure(structure)


@router.get("/assignments", response_model=List[EduPayFeeAssignmentResponse])
def list_assignments(
    school_id: str = Depends(get_school_id_from_context),
    status_filter: Optional[FeeAssignmentStatus] = Query(default=None, alias="status"),
    student_id: Optional[int] = Query(default=None),
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
    db: Session = Depends(get_db),
):
    ensure_school_context(db, school_id)
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
    logger.info(
        "EduPay assignments listed - User ID: %s, School ID: %s, Row count: %s",
        actor.get("user_id") or actor.get("id"),
        school_id,
        len(payload),
    )
    return payload


@router.get("/payments", response_model=List[EduPayPaymentResponse])
def list_payments(
    school_id: str = Depends(get_school_id_from_context),
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
    db: Session = Depends(get_db),
):
    ensure_school_context(db, school_id)
    payments = (
        db.query(EduPayPayment)
        .filter(EduPayPayment.school_id == school_id)
        .order_by(EduPayPayment.payment_date.desc(), EduPayPayment.id.desc())
        .all()
    )
    payload = [serialize_payment(payment) for payment in payments]
    logger.info(
        "EduPay payments listed - User ID: %s, School ID: %s, Row count: %s",
        actor.get("user_id") or actor.get("id"),
        school_id,
        len(payload),
    )
    return payload


@router.post("/payments", response_model=EduPayPaymentResponse)
def create_payment(
    payload: EduPayPaymentCreate,
    school_id: str = Depends(get_school_id_from_context),
    actor: Dict[str, str] = Depends(require_write_access),
    db: Session = Depends(get_db),
):
    ensure_school_context(db, school_id)
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
    logger.info(
        "EduPay payment created - User ID: %s, School ID: %s, Row count: 1",
        actor.get("user_id") or actor.get("id"),
        school_id,
    )
    return serialize_payment(payment)


@router.get("/parent-portal", response_model=EduPayParentPortalResponse)
def get_parent_portal(
    school_id: str = Depends(get_school_id_from_context),
    parent_id: Optional[int] = Query(default=None),
    actor: Dict[str, str] = Depends(get_authenticated_actor_context),
    db: Session = Depends(get_db),
):
    ensure_school_context(db, school_id)
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
    logger.info(
        "EduPay parent portal loaded - User ID: %s, School ID: %s, Row count: children=%s,payments=%s",
        actor.get("user_id") or actor.get("id"),
        school_id,
        len(children_payload),
        len(payments[:8]),
    )
    return EduPayParentPortalResponse(
        parent=serialize_parent(parent),
        children=children_payload,
        payment_history=[serialize_payment(payment) for payment in payments[:8]],
    )
