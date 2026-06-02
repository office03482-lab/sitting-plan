"""Supabase-native EduPay repository for production-safe fee and payment routes."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import HTTPException

from app.services.supabase_admin import get_supabase_admin_client
from app.services.supabase_metrics import get_edupay_dashboard_summary_rpc


def _iso(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time()).isoformat()
    return value


def _to_decimal(value: Any) -> Decimal:
    try:
        return Decimal(str(value or 0))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0")


def _to_float(value: Any) -> float:
    return float(_to_decimal(value))


def _normalize_payment_method_for_db(value: Any) -> str:
    method = str(value or "upi").strip().lower()
    if method == "net_banking":
        return "bank_transfer"
    return method or "upi"


def _normalize_payment_method_for_client(value: Any) -> str:
    method = str(value or "upi").strip().lower()
    if method == "bank_transfer":
        return "net_banking"
    return method or "upi"


def _parse_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str) and value.strip():
        raw = value.strip()
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
        except ValueError:
            try:
                return date.fromisoformat(raw[:10])
            except ValueError:
                return None
    return None


def _looks_like_uuid(value: Any) -> bool:
    text = str(value or "").strip()
    return len(text) == 36 and text.count("-") == 4


def _sanitize_lookup_ids(values: list[Any]) -> list[str]:
    normalized = []
    for value in values:
        text = str(value or "").strip()
        if not text or text == "None":
            continue
        normalized.append(text)
    return sorted(set(normalized))


def _month_anchor(now: datetime, month_offset: int) -> datetime:
    year = now.year
    month = now.month - month_offset
    while month <= 0:
        month += 12
        year -= 1
    return datetime(year, month, 1)


def _calculate_assignment_status(assignment: dict[str, Any], *, now: datetime | None = None) -> str:
    current_time = now or datetime.utcnow()
    due_date = _parse_date(assignment.get("due_date"))
    amount_due = _to_decimal(assignment.get("amount_due"))
    amount_paid = _to_decimal(assignment.get("amount_paid"))
    late_fee = _to_decimal(assignment.get("late_fee_applied"))
    outstanding = amount_due + late_fee - amount_paid
    if outstanding <= Decimal("0.01"):
        return "paid"
    if due_date and due_date < current_time.date():
        return "overdue"
    return "pending"


def _outstanding_amount(assignment: dict[str, Any]) -> Decimal:
    return max(
        _to_decimal(assignment.get("amount_due"))
        + _to_decimal(assignment.get("late_fee_applied"))
        - _to_decimal(assignment.get("amount_paid")),
        Decimal("0"),
    )


def _fetch_students(school_id: str) -> list[dict[str, Any]]:
    response = (
        get_supabase_admin_client()
        .table("students")
        .select("id, school_id, batch_id, admission_no, roll_number, full_name, father_name, email, phone, guardian_name, guardian_phone, class_name, section, is_active, created_at, updated_at")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .order("created_at", desc=True)
        .execute()
    )
    return list(response.data or [])


def _count_students(school_id: str) -> int:
    response = (
        get_supabase_admin_client()
        .table("students")
        .select("id", count="exact")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
    )
    return int(getattr(response, "count", 0) or 0)


def _fetch_student_lookup(school_id: str, student_ids: list[str]) -> list[dict[str, Any]]:
    ids = _sanitize_lookup_ids(student_ids)
    if not ids:
        return []
    response = (
        get_supabase_admin_client()
        .table("students")
        .select("id, full_name")
        .eq("school_id", school_id)
        .eq("is_active", True)
        .in_("id", ids)
        .execute()
    )
    return list(response.data or [])


def _fetch_batches(batch_ids: list[str]) -> dict[str, dict[str, Any]]:
    ids = _sanitize_lookup_ids(batch_ids)
    if not ids:
        return {}
    response = (
        get_supabase_admin_client()
        .table("batches")
        .select("id, name")
        .in_("id", ids)
        .execute()
    )
    return {str(item["id"]): item for item in list(response.data or [])}


def _fetch_fee_structures(school_id: str) -> list[dict[str, Any]]:
    response = (
        get_supabase_admin_client()
        .schema("finance")
        .table("fee_structures")
        .select("*")
        .eq("school_id", school_id)
        .order("created_at", desc=True)
        .execute()
    )
    return list(response.data or [])


def _fetch_assignments(
    school_id: str,
    *,
    student_id: str | None = None,
    status_filter: str | None = None,
) -> list[dict[str, Any]]:
    query = (
        get_supabase_admin_client()
        .schema("finance")
        .table("fee_assignments")
        .select("*")
        .eq("school_id", school_id)
    )
    if student_id:
        query = query.eq("student_id", student_id)
    response = query.order("due_date", desc=False).execute()
    assignments = list(response.data or [])
    if not status_filter:
        return assignments
    normalized = status_filter.strip().lower()
    return [item for item in assignments if _calculate_assignment_status(item) == normalized]


def _fetch_payments(school_id: str) -> list[dict[str, Any]]:
    response = (
        get_supabase_admin_client()
        .schema("finance")
        .table("payments")
        .select("*")
        .eq("school_id", school_id)
        .order("payment_date", desc=True)
        .order("created_at", desc=True)
        .execute()
    )
    return list(response.data or [])


def _student_name_lookup(students: list[dict[str, Any]]) -> dict[str, str]:
    return {str(item.get("id")): str(item.get("full_name") or "").strip() for item in students}


def serialize_payment_row(payment: dict[str, Any], *, student_names: dict[str, str]) -> dict[str, Any]:
    return {
        "id": payment.get("id"),
        "assignment_id": payment.get("fee_assignment_id"),
        "student_id": payment.get("student_id"),
        "student_name": student_names.get(str(payment.get("student_id")), ""),
        "amount": round(_to_float(payment.get("amount")), 2),
        "method": _normalize_payment_method_for_client(payment.get("payment_method")),
        "payment_date": _iso(payment.get("payment_date")),
        "transaction_reference": payment.get("transaction_reference"),
        "receipt_number": payment.get("receipt_number") or "",
        "verification_status": str(payment.get("verification_status") or "pending"),
        "school_id": payment.get("school_id"),
        "created_at": _iso(payment.get("created_at")),
    }


def serialize_assignment_row(
    assignment: dict[str, Any],
    *,
    student_names: dict[str, str],
    fee_structure_lookup: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    return {
        "id": assignment.get("id"),
        "student_id": assignment.get("student_id"),
        "student_name": student_names.get(str(assignment.get("student_id")), ""),
        "fee_structure_id": assignment.get("fee_structure_id"),
        "fee_structure_name": str(
            (fee_structure_lookup.get(str(assignment.get("fee_structure_id"))) or {}).get("name") or ""
        ),
        "installment_label": assignment.get("installment_label") or "",
        "due_date": _iso(assignment.get("due_date")),
        "amount_due": round(_to_float(assignment.get("amount_due")), 2),
        "amount_paid": round(_to_float(assignment.get("amount_paid")), 2),
        "discount_amount": round(_to_float(assignment.get("discount_amount")), 2),
        "late_fee_applied": round(_to_float(assignment.get("late_fee_applied")), 2),
        "status": _calculate_assignment_status(assignment),
        "school_id": assignment.get("school_id"),
        "created_at": _iso(assignment.get("created_at")),
        "updated_at": _iso(assignment.get("updated_at")),
    }


def serialize_student_row(
    student: dict[str, Any],
    *,
    batch_lookup: dict[str, dict[str, Any]],
    student_assignments: list[dict[str, Any]],
) -> dict[str, Any]:
    total_due = sum(_to_float(_outstanding_amount(item)) for item in student_assignments)
    total_paid = sum(_to_float(item.get("amount_paid")) for item in student_assignments)
    open_assignments = sorted(
        [item for item in student_assignments if _calculate_assignment_status(item) != "paid"],
        key=lambda item: (_parse_date(item.get("due_date")) or date.max),
    )
    next_due = _iso(open_assignments[0].get("due_date")) if open_assignments else None
    status_value = _calculate_assignment_status(open_assignments[0]) if open_assignments else "paid"
    batch = batch_lookup.get(str(student.get("batch_id")) or "")
    parent_name = (
        str(student.get("guardian_name") or "").strip()
        or str(student.get("father_name") or "").strip()
        or "Parent"
    )
    parent_mobile = str(student.get("guardian_phone") or student.get("phone") or "").strip()
    return {
        "id": student.get("id"),
        "admission_no": student.get("admission_no") or "",
        "full_name": student.get("full_name") or "",
        "class_name": student.get("class_name") or "",
        "batch_name": batch.get("name") if batch else None,
        "email": student.get("email"),
        "phone": student.get("phone"),
        "school_id": student.get("school_id"),
        "parent_id": student.get("id"),
        "parent_name": parent_name,
        "parent_mobile": parent_mobile,
        "parent_email": student.get("email"),
        "total_due": round(total_due, 2),
        "total_paid": round(total_paid, 2),
        "status": status_value,
        "next_due_date": next_due,
        "is_active": bool(student.get("is_active", True)),
        "created_at": _iso(student.get("created_at")),
        "updated_at": _iso(student.get("updated_at")),
    }


def serialize_fee_structure_row(fee_structure: dict[str, Any], *, assigned_students: int) -> dict[str, Any]:
    return {
        "id": fee_structure.get("id"),
        "name": fee_structure.get("name") or "",
        "fee_type": fee_structure.get("fee_type") or "",
        "class_name": fee_structure.get("class_name"),
        "installment_plan": fee_structure.get("installment_plan") or "monthly",
        "total_amount": round(_to_float(fee_structure.get("total_amount")), 2),
        "discount_amount": round(_to_float(fee_structure.get("discount_amount")), 2),
        "late_fee_rule": fee_structure.get("late_fee_rule"),
        "description": fee_structure.get("description"),
        "is_active": bool(fee_structure.get("is_active", True)),
        "school_id": fee_structure.get("school_id"),
        "assigned_students": int(assigned_students),
        "created_at": _iso(fee_structure.get("created_at")),
        "updated_at": _iso(fee_structure.get("updated_at")),
    }


def list_students(school_id: str) -> list[dict[str, Any]]:
    students = _fetch_students(school_id)
    assignments = _fetch_assignments(school_id)
    batch_lookup = _fetch_batches([str(item.get("batch_id")) for item in students if item.get("batch_id")])
    assignments_by_student: dict[str, list[dict[str, Any]]] = {}
    for item in assignments:
        assignments_by_student.setdefault(str(item.get("student_id")), []).append(item)
    return [
        serialize_student_row(
            student,
            batch_lookup=batch_lookup,
            student_assignments=assignments_by_student.get(str(student.get("id")), []),
        )
        for student in students
    ]


def list_fee_structures(school_id: str) -> list[dict[str, Any]]:
    fee_structures = _fetch_fee_structures(school_id)
    assignments = _fetch_assignments(school_id)
    counts: dict[str, set[str]] = {}
    for item in assignments:
        key = str(item.get("fee_structure_id"))
        counts.setdefault(key, set()).add(str(item.get("student_id")))
    return [
        serialize_fee_structure_row(item, assigned_students=len(counts.get(str(item.get("id")), set())))
        for item in fee_structures
    ]


def list_assignments(
    school_id: str,
    *,
    status_filter: str | None = None,
    student_id: str | None = None,
) -> list[dict[str, Any]]:
    assignments = _fetch_assignments(school_id, student_id=student_id, status_filter=status_filter)
    students = _fetch_students(school_id)
    fee_structures = _fetch_fee_structures(school_id)
    student_names = _student_name_lookup(students)
    fee_structure_lookup = {str(item.get("id")): item for item in fee_structures}
    return [
        serialize_assignment_row(item, student_names=student_names, fee_structure_lookup=fee_structure_lookup)
        for item in assignments
    ]


list_fee_assignments = list_assignments


def list_payments(school_id: str) -> list[dict[str, Any]]:
    payments = _fetch_payments(school_id)
    students = _fetch_students(school_id)
    student_names = _student_name_lookup(students)
    return [serialize_payment_row(item, student_names=student_names) for item in payments]


def get_dashboard(school_id: str) -> dict[str, Any]:
    try:
        payload = get_edupay_dashboard_summary_rpc(school_id)
        if payload:
            return {
                "total_collected": round(_to_float(payload.get("total_collected")), 2),
                "pending_amount": round(_to_float(payload.get("pending_amount")), 2),
                "overdue_amount": round(_to_float(payload.get("overdue_amount")), 2),
                "upcoming_dues": int(payload.get("upcoming_dues") or 0),
                "total_students": int(payload.get("total_students") or 0),
                "active_fee_structures": int(payload.get("active_fee_structures") or 0),
                "reminders_queued": int(payload.get("reminders_queued") or 0),
                "collection_trend": list(payload.get("collection_trend") or []),
                "payment_method_split": list(payload.get("payment_method_split") or []),
                "reminders": list(payload.get("reminders") or []),
                "recent_payments": list(payload.get("recent_payments") or []),
            }
    except Exception:
        pass

    now = datetime.utcnow()
    fee_structures = _fetch_fee_structures(school_id)
    assignments = _fetch_assignments(school_id)
    payments = _fetch_payments(school_id)
    relevant_student_ids = _sanitize_lookup_ids(
        [
            *[item.get("student_id") for item in assignments[:100]],
            *[item.get("student_id") for item in payments[:50]],
        ]
    )
    student_names = _student_name_lookup(_fetch_student_lookup(school_id, relevant_student_ids))
    total_students = _count_students(school_id)

    pending_amount = 0.0
    overdue_amount = 0.0
    upcoming_dues = 0
    reminders: list[dict[str, Any]] = []

    for assignment in assignments:
        status_value = _calculate_assignment_status(assignment, now=now)
        outstanding = _to_float(_outstanding_amount(assignment))
        if status_value == "overdue":
            overdue_amount += outstanding
        elif status_value in {"pending", "partial"}:
            pending_amount += outstanding
        due_date = _parse_date(assignment.get("due_date"))
        if status_value != "paid" and due_date is not None:
            days_until_due = (due_date - now.date()).days
            if 0 <= days_until_due <= 15:
                upcoming_dues += 1

    upcoming = sorted(
        [item for item in assignments if _calculate_assignment_status(item, now=now) != "paid"],
        key=lambda item: (_parse_date(item.get("due_date")) or date.max),
    )[:3]
    for item in upcoming:
        due_date = _parse_date(item.get("due_date"))
        reminders.append(
            {
                "title": f"{item.get('installment_label') or 'Installment'} reminder",
                "channel": "WhatsApp + Email",
                "audience": student_names.get(str(item.get("student_id")), "Student"),
                "scheduled_for": due_date.strftime("%d %b %Y") if due_date else "",
            }
        )

    total_collected = round(sum(_to_float(payment.get("amount")) for payment in payments), 2)
    trend_points: list[dict[str, Any]] = []
    for month_offset in range(5, -1, -1):
        anchor = _month_anchor(now, month_offset)
        label = anchor.strftime("%b")
        month_key = anchor.strftime("%Y-%m")
        total = sum(
            _to_float(payment.get("amount"))
            for payment in payments
            if str(_iso(payment.get("payment_date")) or "")[:7] == month_key
        )
        trend_points.append({"month": label, "amount": round(total, 2)})

    total_payment_amount = sum(_to_float(payment.get("amount")) for payment in payments) or 1.0
    method_split: list[dict[str, Any]] = []
    for method in ("upi", "cash", "card", "bank_transfer", "wallet"):
        amount = sum(
            _to_float(payment.get("amount"))
            for payment in payments
            if str(payment.get("payment_method") or "").strip().lower() == method
        )
        if amount <= 0:
            continue
        method_split.append(
            {
                "method": _normalize_payment_method_for_client(method),
                "amount": round(amount, 2),
                "percentage": round((amount / total_payment_amount) * 100, 2),
            }
        )

    recent_payments = [serialize_payment_row(item, student_names=student_names) for item in payments[:5]]
    active_fee_structures = len([item for item in fee_structures if item.get("is_active", True)])
    return {
        "total_collected": total_collected,
        "pending_amount": round(pending_amount, 2),
        "overdue_amount": round(overdue_amount, 2),
        "upcoming_dues": upcoming_dues,
        "total_students": total_students,
        "active_fee_structures": active_fee_structures,
        "reminders_queued": len(reminders),
        "collection_trend": trend_points,
        "payment_method_split": method_split,
        "reminders": reminders,
        "recent_payments": recent_payments,
    }


def _next_receipt_number(school_id: str) -> str:
    response = (
        get_supabase_admin_client()
        .schema("finance")
        .table("payments")
        .select("receipt_number")
        .eq("school_id", school_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = list(response.data or [])
    next_id = 1
    if rows:
        current = str(rows[0].get("receipt_number") or "")
        try:
            next_id = int(current.rsplit("-", 1)[-1]) + 1
        except (TypeError, ValueError):
            next_id = len(_fetch_payments(school_id)) + 1
    school_token = school_id.replace("-", "").upper()[:8]
    return f"EDU-{school_token}-{next_id:05d}"


def create_payment(school_id: str, payment_data: dict[str, Any], actor: dict[str, Any]) -> dict[str, Any]:
    assignment_id = str(payment_data.get("assignment_id") or "").strip()
    if not assignment_id:
        raise HTTPException(status_code=400, detail="Assignment is required")

    assignments = _fetch_assignments(school_id)
    assignment = next((item for item in assignments if str(item.get("id")) == assignment_id), None)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    amount = _to_decimal(payment_data.get("amount"))
    if amount <= Decimal("0"):
        raise HTTPException(status_code=400, detail="Payment amount must be greater than zero")

    outstanding = _outstanding_amount(assignment)
    if amount - outstanding > Decimal("0.01"):
        raise HTTPException(status_code=400, detail="Payment amount cannot exceed outstanding balance")

    payment_date = _parse_date(payment_data.get("payment_date")) or datetime.utcnow().date()
    payload = {
        "school_id": school_id,
        "fee_assignment_id": assignment_id,
        "student_id": assignment.get("student_id"),
        "received_by_profile_id": (
            str(actor.get("user_id") or actor.get("id"))
            if _looks_like_uuid(actor.get("user_id") or actor.get("id"))
            else None
        ),
        "amount": float(amount),
        "payment_method": _normalize_payment_method_for_db(payment_data.get("method")),
        "payment_date": payment_date.isoformat(),
        "transaction_reference": str(payment_data.get("transaction_reference") or "").strip() or None,
        "receipt_number": _next_receipt_number(school_id),
        "verification_status": "verified",
    }
    created = (
        get_supabase_admin_client()
        .schema("finance")
        .table("payments")
        .insert(payload)
        .select("*")
        .single()
        .execute()
    )
    if not created.data:
        raise HTTPException(status_code=500, detail="Payment save returned no row")

    updated_amount_paid = round(_to_float(assignment.get("amount_paid")) + float(amount), 2)
    updated_assignment = dict(assignment)
    updated_assignment["amount_paid"] = updated_amount_paid
    updated_assignment["status"] = _calculate_assignment_status(updated_assignment)
    (
        get_supabase_admin_client()
        .schema("finance")
        .table("fee_assignments")
        .update(
            {
                "amount_paid": updated_amount_paid,
                "status": updated_assignment["status"],
            }
        )
        .eq("id", assignment_id)
        .eq("school_id", school_id)
        .execute()
    )

    students = _fetch_students(school_id)
    return serialize_payment_row(dict(created.data), student_names=_student_name_lookup(students))


def _installment_count(plan: str) -> int:
    p = plan.strip().lower() if plan else "monthly"
    if p == "yearly":
        return 1
    if p == "quarterly":
        return 4
    return 4


def _installment_gap_days(plan: str) -> int:
    p = plan.strip().lower() if plan else "monthly"
    if p == "yearly":
        return 365
    if p == "quarterly":
        return 90
    return 30


def _create_assignments_for_student(
    school_id: str,
    student_id: str,
    fee_structure_id: str,
    *,
    total_amount: float,
    discount_amount: float,
    installment_plan: str,
    start_date: datetime | None = None,
) -> None:
    count = _installment_count(installment_plan)
    gap = _installment_gap_days(installment_plan)
    base_date = start_date or datetime.utcnow()
    per_installment = round(max(total_amount - discount_amount, 0.0) / count, 2)
    per_discount = round(discount_amount / count, 2) if discount_amount else 0.0

    existing = (
        get_supabase_admin_client()
        .schema("finance")
        .table("fee_assignments")
        .select("id")
        .eq("school_id", school_id)
        .eq("student_id", student_id)
        .eq("fee_structure_id", fee_structure_id)
        .limit(1)
        .execute()
    )
    if existing.data:
        return

    for index in range(count):
        due = base_date + timedelta(days=gap * index)
        assignment_payload = {
            "school_id": school_id,
            "student_id": student_id,
            "fee_structure_id": fee_structure_id,
            "installment_label": f"Installment {index + 1}",
            "due_date": due.isoformat(),
            "amount_due": per_installment,
            "amount_paid": 0.0,
            "discount_amount": per_discount,
            "late_fee_applied": 0.0,
            "status": "pending",
        }
        due_date_only = _parse_date(due.isoformat())
        if due_date_only and due_date_only < datetime.utcnow().date():
            assignment_payload["status"] = "overdue"
        (
            get_supabase_admin_client()
            .schema("finance")
            .table("fee_assignments")
            .insert(assignment_payload)
            .execute()
        )


def create_student(school_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    admission_no = str(payload.get("admission_no") or "").strip()
    if not admission_no:
        raise HTTPException(status_code=400, detail="Admission number is required")

    existing = (
        get_supabase_admin_client()
        .table("students")
        .select("id")
        .eq("school_id", school_id)
        .eq("admission_no", admission_no)
        .limit(1)
        .execute()
    )
    if existing.data:
        raise HTTPException(status_code=400, detail="Admission number already exists")

    guardian_phone = str(payload.get("parent_mobile") or "").strip()
    guardian_name = str(payload.get("parent_name") or payload.get("guardian_name") or "").strip()
    father_name = str(payload.get("father_name") or "").strip() or guardian_name

    student_payload = {
        "school_id": school_id,
        "admission_no": admission_no,
        "full_name": str(payload.get("full_name") or "").strip(),
        "class_name": str(payload.get("class_name") or "").strip(),
        "email": str(payload.get("email") or "").strip() or None,
        "phone": str(payload.get("phone") or "").strip() or None,
        "guardian_name": guardian_name or None,
        "guardian_phone": guardian_phone or None,
        "father_name": father_name or None,
        "is_active": True,
    }
    batch_name = str(payload.get("batch_name") or "").strip()
    if batch_name and batch_name.lower() != "none":
        student_payload["batch_name"] = batch_name

    created = (
        get_supabase_admin_client()
        .table("students")
        .insert(student_payload)
        .select("*")
        .single()
        .execute()
    )
    if not created.data:
        raise HTTPException(status_code=500, detail="Student save returned no row")

    student = dict(created.data)
    student_id = str(student["id"])

    fee_structures = _fetch_fee_structures(school_id)
    class_name = str(payload.get("class_name") or "").strip()
    matched = [
        fs for fs in fee_structures
        if fs.get("is_active", True)
        and (not fs.get("class_name") or str(fs.get("class_name") or "").strip() == class_name)
    ]
    for fs in matched:
        _create_assignments_for_student(
            school_id,
            student_id,
            str(fs["id"]),
            total_amount=_to_float(fs.get("total_amount")),
            discount_amount=_to_float(fs.get("discount_amount")),
            installment_plan=str(fs.get("installment_plan") or "monthly"),
        )

    all_assignments = _fetch_assignments(school_id, student_id=student_id)
    batch_lookup = _fetch_batches([str(student.get("batch_id"))] if student.get("batch_id") else [])
    return serialize_student_row(student, batch_lookup=batch_lookup, student_assignments=all_assignments)


def create_fee_structure(school_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    insert_payload = {
        "school_id": school_id,
        "name": str(payload.get("name") or "").strip(),
        "fee_type": str(payload.get("fee_type") or "").strip(),
        "class_name": str(payload.get("class_name") or "").strip() or None,
        "installment_plan": str(payload.get("installment_plan") or "monthly").strip().lower(),
        "total_amount": _to_float(payload.get("total_amount")),
        "discount_amount": _to_float(payload.get("discount_amount")),
        "late_fee_rule": str(payload.get("late_fee_rule") or "").strip() or None,
        "description": payload.get("description"),
        "is_active": bool(payload.get("is_active", True)),
    }

    created = (
        get_supabase_admin_client()
        .schema("finance")
        .table("fee_structures")
        .insert(insert_payload)
        .select("*")
        .single()
        .execute()
    )
    if not created.data:
        raise HTTPException(status_code=500, detail="Fee structure save returned no row")

    fee_structure = dict(created.data)
    fee_structure_id = str(fee_structure["id"])
    class_name_filter = fee_structure.get("class_name")

    response = (
        get_supabase_admin_client()
        .table("students")
        .select("id")
        .eq("school_id", school_id)
        .eq("is_active", True)
    )
    if class_name_filter:
        response = response.eq("class_name", class_name_filter)
    students_data = list((response.execute()).data or [])

    for student_row in students_data:
        _create_assignments_for_student(
            school_id,
            str(student_row["id"]),
            fee_structure_id,
            total_amount=_to_float(fee_structure.get("total_amount")),
            discount_amount=_to_float(fee_structure.get("discount_amount")),
            installment_plan=str(fee_structure.get("installment_plan") or "monthly"),
        )

    assignments = _fetch_assignments(school_id)
    assigned_count = len({str(a.get("student_id")) for a in assignments if str(a.get("fee_structure_id")) == fee_structure_id})
    return serialize_fee_structure_row(fee_structure, assigned_students=assigned_count)


def get_parent_portal(school_id: str, parent_id: str) -> dict[str, Any]:
    response = (
        get_supabase_admin_client()
        .table("students")
        .select("*")
        .eq("school_id", school_id)
        .eq("is_active", True)
    )
    if _looks_like_uuid(parent_id):
        response = response.eq("id", parent_id)
    else:
        response = response.eq("guardian_phone", parent_id)
    students_data = list((response.execute()).data or [])
    if not students_data:
        raise HTTPException(status_code=404, detail="Parent not found")

    student_ids = [str(s["id"]) for s in students_data]
    first = students_data[0]
    parent_info = {
        "id": first.get("id"),
        "full_name": str(first.get("guardian_name") or first.get("father_name") or "").strip() or "Parent",
        "mobile_number": str(first.get("guardian_phone") or first.get("phone") or "").strip(),
        "email": first.get("email"),
        "relation": "parent",
        "school_id": school_id,
        "is_active": True,
        "created_at": _iso(first.get("created_at")),
        "updated_at": _iso(first.get("updated_at")),
    }

    children: list[dict[str, Any]] = []
    all_assignments: list[dict[str, Any]] = []
    all_payments: list[dict[str, Any]] = []

    for student in students_data:
        sid = str(student["id"])
        s_assignments = _fetch_assignments(school_id, student_id=sid)
        all_assignments.extend(s_assignments)

        s_payments_resp = (
            get_supabase_admin_client()
            .schema("finance")
            .table("payments")
            .select("*")
            .eq("school_id", school_id)
            .eq("student_id", sid)
            .order("payment_date", desc=True)
            .order("created_at", desc=True)
            .execute()
        )
        s_payments = list(s_payments_resp.data or [])
        all_payments.extend(s_payments)

        open_assignments = sorted(
            [a for a in s_assignments if _calculate_assignment_status(a) != "paid"],
            key=lambda a: (_parse_date(a.get("due_date")) or date.max),
        )
        due_amount = sum(_to_float(_outstanding_amount(a)) for a in s_assignments)
        next_due = _iso(open_assignments[0].get("due_date")) if open_assignments else None
        status_value = _calculate_assignment_status(open_assignments[0]) if open_assignments else "paid"

        children.append({
            "student_id": sid,
            "student_name": str(student.get("full_name") or ""),
            "class_name": str(student.get("class_name") or ""),
            "due_amount": round(due_amount, 2),
            "next_due_date": next_due,
            "status": status_value,
        })

    student_names = {str(s["id"]): str(s.get("full_name") or "") for s in students_data}
    payment_history = [serialize_payment_row(p, student_names=student_names) for p in all_payments]

    return {
        "parent": parent_info,
        "children": children,
        "payment_history": payment_history,
    }
