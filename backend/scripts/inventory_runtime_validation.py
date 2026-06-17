from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from fastapi.testclient import TestClient

from app.main import app
from app.utils.auth import create_access_token


SCHOOL_ID = "2a427cb2-4194-43ba-9e4a-f2558c508162"
ADMIN_USER_ID = "1"
ADMIN_EMAIL = "admin@school.edu"


def _now_suffix() -> str:
    return datetime.now(UTC).strftime("%Y%m%d%H%M%S")


def _token() -> str:
    return create_access_token(
        {
            "sub": ADMIN_USER_ID,
            "email": ADMIN_EMAIL,
            "role": "admin",
            "full_name": "Inventory Stabilization Admin",
            "school_id": SCHOOL_ID,
            "profile_id": ADMIN_USER_ID,
        }
    )


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {_token()}"}


def _pick_batch_and_student(api_client: TestClient, headers: dict[str, str]) -> tuple[dict[str, Any], dict[str, Any]]:
    batch_rows = _expect(
        api_client.get("/api/batches", headers=headers),
        200,
        "list_batches_for_setup",
    )
    if not batch_rows:
        raise RuntimeError("No active batches found for inventory validation")

    for batch in batch_rows:
        batch_name = str(batch.get("name") or "")
        student_rows = _expect(
            api_client.get(
                "/api/students",
                headers=headers,
                params={"batch": batch_name, "limit": 20},
            ),
            200,
            f"list_students_for_setup_{batch_name}",
        )
        if student_rows:
            return dict(batch), dict(student_rows[0])

    raise RuntimeError("No active students found in any active batch for inventory validation")


def _expect(response, expected_status: int, label: str) -> Any:
    if response.status_code != expected_status:
        raise AssertionError(
            json.dumps(
                {
                    "label": label,
                    "status_code": response.status_code,
                    "body": response.text,
                },
                indent=2,
            )
        )
    content_type = response.headers.get("content-type", "")
    if "application/json" in content_type:
        return response.json()
    return response.content


def main() -> None:
    suffix = _now_suffix()
    client = TestClient(app)
    headers = _headers()
    batch, student = _pick_batch_and_student(client, headers)

    summary: dict[str, Any] = {
        "school_id": SCHOOL_ID,
        "batch": {"id": batch.get("id"), "name": batch.get("name")},
        "student": {"id": student.get("id"), "name": student.get("full_name")},
        "checks": {},
        "artifacts": {},
    }

    def record(name: str, value: Any) -> None:
        summary["checks"][name] = value

    dashboard_before = _expect(
        client.get("/api/inventory/dashboard", headers=headers),
        200,
        "dashboard_before",
    )
    record("dashboard_before", dashboard_before)

    subject_created = _expect(
        client.post(
            "/api/inventory/subjects",
            headers=headers,
            json={"name": f"Stabilization Subject {suffix}", "is_active": True},
        ),
        200,
        "create_subject",
    )
    record("create_subject", subject_created)

    subject_updated = _expect(
        client.put(
            f"/api/inventory/subjects/{subject_created['id']}",
            headers=headers,
            json={"name": f"Stabilization Subject Updated {suffix}"},
        ),
        200,
        "update_subject",
    )
    record("update_subject", subject_updated)

    set_created = _expect(
        client.post(
            "/api/inventory/sets",
            headers=headers,
            json={
                "subject_id": subject_created["id"],
                "name": f"Set {suffix}",
                "is_active": True,
            },
        ),
        200,
        "create_set",
    )
    record("create_set", set_created)

    volume_created = _expect(
        client.post(
            "/api/inventory/volumes",
            headers=headers,
            json={
                "set_id": set_created["id"],
                "name": f"Volume {suffix}",
                "volume_number": 1,
                "is_active": True,
            },
        ),
        200,
        "create_volume",
    )
    record("create_volume", volume_created)

    supplier_created = _expect(
        client.post(
            "/api/inventory/suppliers",
            headers=headers,
            json={
                "name": f"Supplier {suffix}",
                "contact_person": "QA",
                "phone": "9999999999",
                "email": f"supplier-{suffix}@example.com",
                "address": "Validation Street",
                "is_active": True,
            },
        ),
        200,
        "create_supplier",
    )
    record("create_supplier", supplier_created)

    material_delete_target = _expect(
        client.post(
            "/api/inventory/materials",
            headers=headers,
            json={
                "name": f"Delete Material {suffix}",
                "subject_id": subject_created["id"],
                "set_id": set_created["id"],
                "volume_id": volume_created["id"],
                "batch_names": [str(batch.get("name") or "")],
                "description": "Delete validation target",
                "unit_type": "book",
                "price": 10,
                "low_stock_threshold": 1,
                "is_active": True,
            },
        ),
        200,
        "create_material_delete_target",
    )
    record("create_material_delete_target", material_delete_target)

    material_delete_target_updated = _expect(
        client.put(
            f"/api/inventory/materials/{material_delete_target['id']}",
            headers=headers,
            json={
                "description": "Delete validation target updated",
                "low_stock_threshold": 3,
            },
        ),
        200,
        "update_material_delete_target",
    )
    record("update_material_delete_target", material_delete_target_updated)

    material_delete_result = _expect(
        client.delete(
            f"/api/inventory/materials/{material_delete_target['id']}",
            headers=headers,
        ),
        200,
        "delete_material_delete_target",
    )
    record("delete_material_delete_target", material_delete_result)

    material_main = _expect(
        client.post(
            "/api/inventory/materials",
            headers=headers,
            json={
                "name": f"Flow Material {suffix}",
                "subject_id": subject_created["id"],
                "set_id": set_created["id"],
                "volume_id": volume_created["id"],
                "batch_names": [str(batch.get("name") or "")],
                "description": "Flow validation material",
                "unit_type": "book",
                "price": 25,
                "low_stock_threshold": 2,
                "is_active": True,
            },
        ),
        200,
        "create_material_main",
    )
    record("create_material_main", material_main)

    material_main_updated = _expect(
        client.put(
            f"/api/inventory/materials/{material_main['id']}",
            headers=headers,
            json={"description": "Flow validation material updated"},
        ),
        200,
        "update_material_main",
    )
    record("update_material_main", material_main_updated)

    materials_list = _expect(
        client.get("/api/inventory/materials", headers=headers),
        200,
        "list_materials",
    )
    record("list_materials_count", len(materials_list))

    stock_in_purchase = _expect(
        client.post(
            "/api/inventory/stock-in",
            headers=headers,
            json={
                "date": f"{datetime.now(UTC).date().isoformat()}T00:00:00",
                "supplier_id": supplier_created["id"],
                "material_id": material_main["id"],
                "quantity_received": 5,
                "entry_type": "purchase",
                "added_by": "Inventory Stabilization Admin",
                "notes": "Purchase validation",
            },
        ),
        200,
        "stock_in_purchase",
    )
    record("stock_in_purchase", stock_in_purchase)

    stock_in_return = _expect(
        client.post(
            "/api/inventory/stock-in",
            headers=headers,
            json={
                "date": f"{datetime.now(UTC).date().isoformat()}T00:00:00",
                "supplier_id": supplier_created["id"],
                "material_id": material_main["id"],
                "quantity_received": 1,
                "entry_type": "return",
                "added_by": "Inventory Stabilization Admin",
                "notes": "Return validation",
            },
        ),
        200,
        "stock_in_return",
    )
    record("stock_in_return", stock_in_return)

    stock_out_distribution = _expect(
        client.post(
            "/api/inventory/stock-out",
            headers=headers,
            json={
                "date": f"{datetime.now(UTC).date().isoformat()}T00:00:00",
                "batch_ids": [batch["id"]],
                "batch_name": batch["name"],
                "material_id": material_main["id"],
                "quantity_issued": 1,
                "issued_by": "Inventory Stabilization Admin",
                "remarks": "Distribution validation",
            },
        ),
        200,
        "stock_out_distribution",
    )
    record("stock_out_distribution", stock_out_distribution)

    student_issue = _expect(
        client.post(
            "/api/inventory/student-issues",
            headers=headers,
            json={
                "date": f"{datetime.now(UTC).date().isoformat()}T00:00:00",
                "batch_id": batch["id"],
                "student_ids": [student["id"]],
                "material_id": material_main["id"],
                "quantity_issued": 1,
                "issued_by": "Inventory Stabilization Admin",
                "remarks": "Student issue validation",
            },
        ),
        200,
        "student_issue",
    )
    record("student_issue", student_issue)

    dashboard_after = _expect(
        client.get("/api/inventory/dashboard", headers=headers),
        200,
        "dashboard_after",
    )
    record("dashboard_after", dashboard_after)

    report_types = ["current_inventory", "low_stock", "stock_in", "batch_distribution"]
    report_counts: dict[str, int] = {}
    for report_type in report_types:
        report = _expect(
            client.get(
                "/api/inventory/reports/data",
                headers=headers,
                params={"report_type": report_type},
            ),
            200,
            f"report_{report_type}",
        )
        report_counts[report_type] = int(report.get("total_records") or 0)
    record("report_counts", report_counts)

    pdf_bytes = _expect(
        client.get(
            "/api/inventory/reports/export",
            headers=headers,
            params={"report_type": "current_inventory", "export_format": "pdf"},
        ),
        200,
        "export_pdf",
    )
    summary["artifacts"]["pdf_size"] = len(pdf_bytes)

    excel_bytes = _expect(
        client.get(
            "/api/inventory/reports/export",
            headers=headers,
            params={"report_type": "current_inventory", "export_format": "excel"},
        ),
        200,
        "export_excel",
    )
    summary["artifacts"]["excel_size"] = len(excel_bytes)

    csv_response = client.get(
        "/api/inventory/reports/export",
        headers=headers,
        params={"report_type": "current_inventory", "export_format": "csv"},
    )
    summary["artifacts"]["csv_status_code"] = csv_response.status_code
    summary["artifacts"]["csv_body_preview"] = csv_response.text[:200]

    stock_out_list = _expect(
        client.get("/api/inventory/stock-out", headers=headers),
        200,
        "list_stock_out",
    )
    record("list_stock_out_count", len(stock_out_list))

    student_issue_list = _expect(
        client.get("/api/inventory/student-issues", headers=headers),
        200,
        "list_student_issues",
    )
    record("list_student_issues_count", len(student_issue_list))

    stock_in_list = _expect(
        client.get("/api/inventory/stock-in", headers=headers),
        200,
        "list_stock_in",
    )
    record("list_stock_in_count", len(stock_in_list))

    _expect(
        client.delete(f"/api/inventory/student-issues/{student_issue['id']}", headers=headers),
        200,
        "delete_student_issue",
    )
    _expect(
        client.delete(f"/api/inventory/stock-out/{stock_out_distribution['id']}", headers=headers),
        200,
        "delete_stock_out",
    )
    _expect(
        client.delete(f"/api/inventory/stock-in/{stock_in_return['id']}", headers=headers),
        200,
        "delete_stock_in_return",
    )
    _expect(
        client.delete(f"/api/inventory/stock-in/{stock_in_purchase['id']}", headers=headers),
        200,
        "delete_stock_in_purchase",
    )
    _expect(
        client.delete(f"/api/inventory/materials/{material_main['id']}", headers=headers),
        200,
        "delete_material_main",
    )
    _expect(
        client.delete(f"/api/inventory/volumes/{volume_created['id']}", headers=headers),
        200,
        "delete_volume",
    )
    _expect(
        client.delete(f"/api/inventory/sets/{set_created['id']}", headers=headers),
        200,
        "delete_set",
    )
    _expect(
        client.delete(f"/api/inventory/subjects/{subject_created['id']}", headers=headers),
        200,
        "delete_subject",
    )
    _expect(
        client.delete(f"/api/inventory/suppliers/{supplier_created['id']}", headers=headers),
        200,
        "delete_supplier",
    )

    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
