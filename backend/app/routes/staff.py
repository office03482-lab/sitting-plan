from __future__ import annotations

from io import BytesIO
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import JSONResponse, Response

from app.middleware.auth import get_authenticated_actor_context, get_authenticated_user
from app.middleware.tenant_context import TenantContext, get_tenant_context
from app.models import User
from app.schemas import StaffImportResponse
from app.services.bulk_action_requests import (
    create_bulk_action_request,
    execute_staff_directory_bulk_delete,
    is_platform_admin_user,
)
from app.services.supabase_admin import get_supabase_admin_client
from app.utils.staff_excel import STAFF_TEMPLATE_HEADERS, create_staff_excel_template, parse_staff_excel

router = APIRouter()


def _bulk_action_response(request: dict[str, Any], *, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_202_ACCEPTED,
        content={
            "mode": "approval_required",
            "request_id": request.get("id"),
            "status": request.get("status"),
            "message": message,
        },
    )


def _normalize(value: Any) -> str:
    return str(value or "").strip()


def _error_detail(exc: Exception) -> str:
    if isinstance(exc, HTTPException):
        detail = exc.detail
        return detail if isinstance(detail, str) else str(detail)
    return str(exc)


def _build_directory_details(row: dict[str, Any]) -> dict[str, Any]:
    details = {
        "dob": row.get("dob") or None,
        "primaryMobile": row.get("primary_mobile") or None,
        "whatsappNumber": row.get("whatsapp_number") or None,
        "gender": row.get("gender") or None,
        "maritalStatus": row.get("marital_status") or None,
        "schoolName": row.get("school_name") or None,
        "fatherName": row.get("father_name") or None,
        "fatherContact": row.get("father_contact") or None,
        "motherName": row.get("mother_name") or None,
        "motherContact": row.get("mother_contact") or None,
        "spouseName": row.get("spouse_name") or None,
        "addressLine1": row.get("address_line_1") or None,
        "addressLine2": row.get("address_line_2") or None,
        "city": row.get("city") or None,
        "state": row.get("state") or None,
        "country": row.get("country") or None,
        "pinCode": row.get("pin_code") or None,
        "aadhaarNumber": row.get("aadhaar_number") or None,
        "panNumber": row.get("pan_number") or None,
        "bloodGroup": row.get("blood_group") or None,
        "emergencyContactName": row.get("emergency_contact_name") or None,
        "emergencyContactNumber": row.get("emergency_contact_number") or None,
        "emergencyRelation": row.get("emergency_relation") or None,
        "monthlySalary": row.get("monthly_salary") or None,
        "accountNumber": row.get("account_number") or None,
        "ifscCode": row.get("ifsc_code") or None,
        "bankName": row.get("bank_name") or None,
        "notes": row.get("notes") or None,
    }
    source_extras = row.get("source_extras") if isinstance(row.get("source_extras"), dict) else {}
    if source_extras:
        details["sourceExtras"] = source_extras
    return {key: value for key, value in details.items() if value not in (None, "", {}, [])}


def _build_teacher_payload(row: dict[str, Any]) -> dict[str, Any]:
    full_name = " ".join(
        part for part in [row.get("first_name"), row.get("middle_name"), row.get("last_name")] if _normalize(part)
    ).strip()
    return {
        "name": full_name,
        "subject": row.get("subject"),
        "employee_code": row.get("employee_id"),
        "email": row.get("email") or None,
        "phone": row.get("primary_mobile") or None,
        "department": row.get("department") or row.get("subject") or None,
        "designation": row.get("designation") or row.get("staff_category") or "Teacher",
        "joining_date": row.get("joining_date") or None,
        "shift_timing": row.get("shift_timing") or None,
        "is_active": bool(row.get("is_active", True)),
        "metadata": {
            "category": row.get("staff_category") or "Teacher",
            "designation": row.get("designation") or row.get("staff_category") or "Teacher",
            "joining_date": row.get("joining_date") or None,
            "shift_timing": row.get("shift_timing") or None,
            "subject": row.get("subject") or None,
            "directory_details": _build_directory_details(row),
        },
    }


def _build_invigilator_payload(row: dict[str, Any]) -> dict[str, Any]:
    full_name = " ".join(
        part for part in [row.get("first_name"), row.get("middle_name"), row.get("last_name")] if _normalize(part)
    ).strip()
    return {
        "staff_id": row.get("employee_id"),
        "employee_code": row.get("employee_id"),
        "name": full_name,
        "email": row.get("email") or None,
        "phone": row.get("primary_mobile") or None,
        "department": row.get("department") or row.get("staff_category") or None,
        "designation": row.get("designation") or row.get("staff_category") or None,
        "joining_date": row.get("joining_date") or None,
        "shift_timing": row.get("shift_timing") or None,
        "is_active": bool(row.get("is_active", True)),
        "metadata": {
            "category": row.get("staff_category") or row.get("designation") or "Non-Teaching Staff",
            "designation": row.get("designation") or row.get("staff_category") or None,
            "joining_date": row.get("joining_date") or None,
            "shift_timing": row.get("shift_timing") or None,
            "directory_details": _build_directory_details(row),
        },
    }


def _build_staff_member_row(school_id: str, row: dict[str, Any]) -> dict[str, Any]:
    full_name = " ".join(
        part for part in [row.get("first_name"), row.get("middle_name"), row.get("last_name")] if _normalize(part)
    ).strip()
    is_teaching = _normalize(row.get("staff_type")) == "teaching"
    metadata = {
        "category": row.get("staff_category") or ("Teacher" if is_teaching else "Non-Teaching Staff"),
        "designation": row.get("designation") or row.get("staff_category") or ("Teacher" if is_teaching else "Non-Teaching Staff"),
        "joining_date": row.get("joining_date") or None,
        "shift_timing": row.get("shift_timing") or None,
        "directory_details": _build_directory_details(row),
    }
    if is_teaching:
        metadata["subject"] = row.get("subject") or row.get("department") or None

    return {
        "school_id": school_id,
        "employee_code": row.get("employee_id"),
        "full_name": full_name,
        "email": row.get("email") or None,
        "phone": row.get("primary_mobile") or None,
        "staff_type": "teaching" if is_teaching else "invigilator",
        "department": row.get("department") or (row.get("subject") if is_teaching else None) or None,
        "designation": row.get("designation") or row.get("staff_category") or None,
        "joining_date": row.get("joining_date") or None,
        "metadata": metadata,
        "is_active": bool(row.get("is_active", True)),
    }


@router.get(
    "/template/download",
    responses={200: {"content": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {}}}},
)
def download_staff_template():
    excel_file = create_staff_excel_template()
    headers = {
        "Content-Disposition": "attachment; filename=staff_data_template.xlsx",
        "Cache-Control": "no-cache",
    }
    return Response(
        content=excel_file.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


@router.post("/import", response_model=StaffImportResponse)
async def import_staff(
    file: UploadFile = File(...),
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
):
    school_id = tenant.school_id
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Only .xlsx files are supported for staff import.")

    content = await file.read()
    valid_rows, errors = parse_staff_excel(content)
    if not valid_rows and errors:
        return StaffImportResponse(
            imported_count=0,
            updated_count=0,
            skipped_count=len(errors),
            errors=errors,
            message="No valid staff rows found.",
        )

    supabase = get_supabase_admin_client()
    existing_response = (
        supabase.table("staff_members")
        .select("id,employee_code,staff_type")
        .eq("school_id", school_id)
        .execute()
    )
    existing_rows = list(existing_response.data or [])
    existing_by_employee_code = {
        _normalize(row.get("employee_code")).lower(): row
        for row in existing_rows
        if _normalize(row.get("employee_code"))
    }

    imported_count = 0
    updated_count = 0
    skipped_count = 0

    for row in valid_rows:
        employee_id = _normalize(row.get("employee_id"))
        staff_type = _normalize(row.get("staff_type"))
        existing = existing_by_employee_code.get(employee_id.lower())
        row_payload = _build_staff_member_row(school_id, row)
        expected_type = row_payload["staff_type"]
        try:
            if existing:
                if _normalize(existing.get("staff_type")) not in {expected_type, "non_teaching"}:
                    skipped_count += 1
                    errors.append({"employee_id": employee_id, "error": "Existing employee ID belongs to a different staff type."})
                    continue
                (
                    supabase.table("staff_members")
                    .update(row_payload)
                    .eq("school_id", school_id)
                    .eq("id", existing.get("id"))
                    .execute()
                )
                updated_count += 1
            else:
                response = supabase.table("staff_members").insert(row_payload).execute()
                created_rows = list(response.data or [])
                created_id = created_rows[0].get("id") if created_rows else None
                existing_by_employee_code[employee_id.lower()] = {
                    "id": created_id,
                    "employee_code": employee_id,
                    "staff_type": expected_type,
                }
                imported_count += 1
        except Exception as exc:
            skipped_count += 1
            errors.append(
                {
                    "employee_id": employee_id,
                    "staff_type": staff_type,
                    "error": _error_detail(exc),
                }
            )

    return StaffImportResponse(
        imported_count=imported_count,
        updated_count=updated_count,
        skipped_count=skipped_count,
        errors=errors,
        message=f"Imported {imported_count} staff, updated {updated_count}, skipped {skipped_count}",
    )


@router.delete("")
def delete_all_staff_directory_records(
    tenant: TenantContext = Depends(get_tenant_context),
    actor: dict = Depends(get_authenticated_actor_context),
    user: User = Depends(get_authenticated_user),
    staff_type: str | None = Query(default=None),
    search: str | None = Query(default=None),
    category: str | None = Query(default=None),
):
    school_id = tenant.school_id
    if is_platform_admin_user(user):
        return execute_staff_directory_bulk_delete(
            school_id,
            search=search,
            staff_type=staff_type,
            category=category,
        )

    profile_id = str(actor.get("profile_id") or "").strip()
    if not profile_id:
        raise HTTPException(status_code=400, detail="Authenticated profile is required")
    request = create_bulk_action_request(
        school_id=school_id,
        module_name="staff",
        action_type="delete_all",
        requested_by_profile_id=profile_id,
        requested_role=str(actor.get("role") or "viewer"),
        reason="Delete all staff directory records requires Super Admin approval.",
        payload_json={
            "operation": "staff.delete_all_staff",
            "staff_type": staff_type,
            "search": search,
            "category": category,
        },
    )
    return _bulk_action_response(request, message="Bulk action request created and sent for Super Admin approval.")
