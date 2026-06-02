from __future__ import annotations

import argparse
from pathlib import Path

import openpyxl

from app.routes.staff import _build_staff_member_row
from app.services.supabase_admin import get_supabase_admin_client
from app.utils.staff_excel import STAFF_TEMPLATE_HEADERS, create_staff_excel_template, parse_staff_excel


def normalize(value) -> str:
    return str(value or "").strip()


def write_import_ready_workbook(path: Path, rows: list[dict]):
    workbook = openpyxl.Workbook()
    worksheet = workbook.active
    worksheet.title = "Staff Upload"
    worksheet.append(STAFF_TEMPLATE_HEADERS)
    for row in rows:
        worksheet.append([
            row.get("staff_type", ""),
            row.get("staff_category", ""),
            row.get("first_name", ""),
            row.get("middle_name", ""),
            row.get("last_name", ""),
            row.get("dob", ""),
            row.get("primary_mobile", ""),
            row.get("whatsapp_number", ""),
            row.get("email", ""),
            row.get("gender", ""),
            row.get("marital_status", ""),
            row.get("employee_id", ""),
            row.get("joining_date", ""),
            row.get("subject", ""),
            row.get("department", ""),
            row.get("designation", ""),
            row.get("shift_timing", ""),
            row.get("school_name", ""),
            row.get("father_name", ""),
            row.get("father_contact", ""),
            row.get("mother_name", ""),
            row.get("mother_contact", ""),
            row.get("spouse_name", ""),
            row.get("address_line_1", ""),
            row.get("address_line_2", ""),
            row.get("city", ""),
            row.get("state", ""),
            row.get("country", ""),
            row.get("pin_code", ""),
            row.get("aadhaar_number", ""),
            row.get("pan_number", ""),
            row.get("blood_group", ""),
            row.get("emergency_contact_name", ""),
            row.get("emergency_contact_number", ""),
            row.get("emergency_relation", ""),
            row.get("monthly_salary", ""),
            row.get("account_number", ""),
            row.get("ifsc_code", ""),
            row.get("bank_name", ""),
            row.get("notes", ""),
            "true" if row.get("is_active", True) else "false",
        ])
    workbook.save(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--school-id", required=True)
    parser.add_argument("--template-output", required=True)
    parser.add_argument("--import-ready-output", required=True)
    parser.add_argument("--summary-output", required=True)
    args = parser.parse_args()

    input_path = Path(args.input)
    template_output = Path(args.template_output)
    import_ready_output = Path(args.import_ready_output)
    summary_output = Path(args.summary_output)

    template_output.parent.mkdir(parents=True, exist_ok=True)
    import_ready_output.parent.mkdir(parents=True, exist_ok=True)
    summary_output.parent.mkdir(parents=True, exist_ok=True)

    template_output.write_bytes(create_staff_excel_template().getvalue())

    valid_rows, parse_errors = parse_staff_excel(input_path.read_bytes())
    write_import_ready_workbook(import_ready_output, valid_rows)

    supabase = get_supabase_admin_client()
    existing_response = (
        supabase.table("staff_members")
        .select("id,employee_code,staff_type")
        .eq("school_id", args.school_id)
        .execute()
    )
    existing_rows = list(existing_response.data or [])
    existing_by_employee_code = {
        normalize(row.get("employee_code")).lower(): row
        for row in existing_rows
        if normalize(row.get("employee_code"))
    }

    imported_count = 0
    updated_count = 0
    skipped_count = 0
    runtime_errors: list[str] = []

    for row in valid_rows:
        employee_id = normalize(row.get("employee_id"))
        existing = existing_by_employee_code.get(employee_id.lower())
        try:
            row_payload = _build_staff_member_row(args.school_id, row)
            expected_type = normalize(row_payload.get("staff_type"))
            if existing:
                if normalize(existing.get("staff_type")) not in {expected_type, "non_teaching"}:
                    skipped_count += 1
                    runtime_errors.append(f"{employee_id}: existing employee ID belongs to different staff type")
                    continue
                (
                    supabase.table("staff_members")
                    .update(row_payload)
                    .eq("school_id", args.school_id)
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
            runtime_errors.append(f"{employee_id}: {exc}")

    summary_lines = [
        f"Input file: {input_path}",
        f"School ID: {args.school_id}",
        f"Parsed valid rows: {len(valid_rows)}",
        f"Parse errors: {len(parse_errors)}",
        f"Imported rows: {imported_count}",
        f"Updated rows: {updated_count}",
        f"Skipped rows: {skipped_count}",
        "",
        "Parse errors:",
    ]
    if parse_errors:
        summary_lines.extend(str(item) for item in parse_errors)
    else:
        summary_lines.append("None")
    summary_lines.extend(["", "Runtime errors:"])
    if runtime_errors:
        summary_lines.extend(runtime_errors)
    else:
        summary_lines.append("None")

    summary_output.write_text("\n".join(summary_lines), encoding="utf-8")
    print("\n".join(summary_lines))


if __name__ == "__main__":
    main()
