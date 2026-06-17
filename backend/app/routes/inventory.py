"""
Inventory management routes
"""
import csv
from datetime import date, datetime
from io import BytesIO, StringIO
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from app.services.supabase_context import resolve_school_id_from_actor
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.utils.pdf_base import fmt_date_iso
from app.middleware.auth import get_authenticated_actor_context
from app.schemas import (
    InventoryCatalogSet,
    InventoryCatalogSubject,
    InventoryCatalogVolume,
    InventoryDashboardResponse,
    InventoryHistoryEntry,
    InventoryMaterialImportResponse,
    InventoryReportResponse,
    InventoryReportRow,
    InventorySetCreate,
    InventorySetResponse,
    InventorySetUpdate,
    InventorySubjectCreate,
    InventorySubjectResponse,
    InventorySubjectUpdate,
    InventoryVolumeCreate,
    InventoryVolumeResponse,
    InventoryVolumeUpdate,
    MaterialCreate,
    MaterialResponse,
    MaterialUpdate,
    StockInCreate,
    StockInResponse,
    StockOutCreate,
    StockOutResponse,
    StudentIssueCreate,
    StudentIssueResponse,
    SupplierCreate,
    SupplierResponse,
    SupplierUpdate,
)
from app.services.supabase_admin import fetch_all, get_supabase_admin_client, insert_rows
from app.services.supabase_inventory import (
    create_material as svc_create_material,
    create_set as svc_create_set,
    create_stock_in as svc_create_stock_in,
    create_stock_out as svc_create_stock_out,
    create_student_issue as svc_create_student_issue,
    create_subject as svc_create_subject,
    create_supplier as svc_create_supplier,
    create_volume as svc_create_volume,
    delete_material as svc_delete_material,
    delete_set as svc_delete_set,
    delete_stock_in as svc_delete_stock_in,
    delete_stock_out as svc_delete_stock_out,
    delete_student_issue as svc_delete_student_issue,
    delete_subject as svc_delete_subject,
    delete_supplier as svc_delete_supplier,
    delete_volume as svc_delete_volume,
    get_catalog as svc_get_catalog,
    get_dashboard as svc_get_dashboard,
    get_material_history as svc_get_material_history,
    get_report_data as svc_get_report_data,
    list_materials as svc_list_materials,
    list_sets as svc_list_sets,
    list_stock_in as svc_list_stock_in,
    list_stock_out as svc_list_stock_out,
    list_student_issues as svc_list_student_issues,
    list_subjects as svc_list_subjects,
    list_suppliers as svc_list_suppliers,
    list_volumes as svc_list_volumes,
    update_material as svc_update_material,
    update_set as svc_update_set,
    update_subject as svc_update_subject,
    update_supplier as svc_update_supplier,
    update_volume as svc_update_volume,
)
from app.utils.excel import (
    create_inventory_material_template,
    parse_inventory_material_excel,
)

router = APIRouter(
    prefix="/api/inventory",
    tags=["inventory"],
)

WRITE_ROLES = {"admin", "store_manager", "school_admin", "platform_admin"}


def normalize_batch_names(batch_names: Optional[List[str]]) -> List[str]:
    normalized: List[str] = []
    for raw_name in batch_names or []:
        name = (raw_name or "").strip()
        if name and name not in normalized:
            normalized.append(name)
    return normalized


def normalize_material_unit_type(value: Optional[str]) -> str:
    normalized = (value or "book").strip().lower().replace(" ", "_")
    mapping = {
        "book": "book",
        "copy": "copy",
        "notebook": "notebook",
        "sheet": "sheet",
        "kit": "kit",
        "piece": "piece",
        "set": "set",
        "box": "box",
        "unit": "unit",
        "material": "material",
        "other": "other",
    }
    return mapping.get(normalized, normalized or "book")


def normalize_supabase_inventory_unit_type(value: Optional[str]) -> str:
    normalized = normalize_material_unit_type(value)
    if normalized == "notebook":
        return "copy"
    if normalized in {"book", "copy", "set"}:
        return normalized
    return "unit"


def build_inventory_code(prefix: str, *parts: Optional[str]) -> str:
    from uuid import uuid4

    base = "-".join(
        "".join(char.lower() if char.isalnum() else "-" for char in (part or "").strip()).strip("-")
        for part in parts
        if part and str(part).strip()
    )
    base = "-".join(segment for segment in base.split("-") if segment)[:24]
    return f"{prefix}-{base or prefix.lower()}-{uuid4().hex[:8]}"


def require_inventory_write(actor: Dict[str, str] = Depends(get_authenticated_actor_context)) -> Dict[str, str]:
    if actor["role"] not in WRITE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Admin or Store Manager can modify inventory records",
        )
    return actor


def build_excel_report(report_type: str, rows: List[Dict[str, object]]) -> BytesIO:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = report_type.replace("_", " ").title()[:31]

    if rows:
        headers = list(rows[0].keys())
        worksheet.append(headers)
        for row in rows:
            worksheet.append([row.get(header, "") for header in headers])
    else:
        worksheet.append(["message"])
        worksheet.append(["No records found"])

    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return buffer


def build_csv_report(rows: List[Dict[str, object]]) -> BytesIO:
    text_buffer = StringIO()
    if rows:
        headers = list(rows[0].keys())
        writer = csv.DictWriter(text_buffer, fieldnames=headers, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({header: row.get(header, "") for header in headers})
    else:
        writer = csv.writer(text_buffer)
        writer.writerow(["message"])
        writer.writerow(["No records found"])

    binary_buffer = BytesIO(text_buffer.getvalue().encode("utf-8"))
    binary_buffer.seek(0)
    return binary_buffer


def build_pdf_report(report_type: str, rows: List[Dict[str, object]]) -> BytesIO:
    from reportlab.lib.pagesizes import landscape, A4
    from reportlab.lib.units import inch
    from reportlab.platypus import Paragraph, Table, TableStyle
    from reportlab.lib import colors
    from app.utils.pdf_base import (
        ReportPdfBuilder,
        build_shared_styles,
        NAVY, SLATE_700, SLATE_500, SLATE_300, SLATE_200, SLATE_50,
        WHITE, DARK_TEXT,
        make_paragraph, safe_pdf_text, fmt_timestamp, fmt_date_iso,
    )

    # Wide reports (>5 columns) use landscape; compact reports use portrait
    has_sample = bool(rows)
    sample = rows[0] if has_sample else {}
    num_cols = len(sample)
    use_landscape = num_cols > 5
    pw = landscape(A4) if use_landscape else A4
    cm = 0.4 * inch

    buffer = BytesIO()
    builder = ReportPdfBuilder(
        buffer,
        pagesize=pw,
        left_margin=cm, right_margin=cm,
        top_margin=1.2 * inch,
        bottom_margin=0.7 * inch,
        title=report_type.replace("_", " ").title(),
        author="Sitting Plan System",
    )

    # ── Column width definitions per report type ──
    COLUMN_WIDTHS: dict[str, list] = {
        "current_inventory": [2.2*inch, 1.2*inch, 0.8*inch, 0.7*inch, 1.0*inch, 1.0*inch, 1.5*inch],
        "stock_in":          [2.0*inch, 1.5*inch, 0.8*inch, 1.2*inch, 1.0*inch, 1.0*inch],
        "stock_out":         [2.0*inch, 1.5*inch, 0.8*inch, 1.2*inch, 1.0*inch],
        "low_stock":         [2.5*inch, 1.5*inch, 0.8*inch, 0.8*inch, 1.0*inch],
        "distribution":      [2.0*inch, 1.2*inch, 1.2*inch, 1.0*inch, 0.8*inch, 0.8*inch],
    }
    col_widths = COLUMN_WIDTHS.get(report_type, [1.5*inch] * num_cols)

    # ── Header drawer ──
    pw_pt, ph_pt = pw

    def _inventory_header(canv, ctx):
        canv.setFillColor(NAVY)
        canv.setFont("Helvetica-Bold", 14)
        canv.drawString(cm, ph_pt - 22, "INVENTORY REPORT")
        canv.setFillColor(SLATE_700)
        canv.setFont("Helvetica", 9)
        canv.drawString(cm, ph_pt - 38, safe_pdf_text(ctx.get("title", "")))
        canv.setFillColor(SLATE_500)
        canv.setFont("Helvetica", 7.5)
        canv.drawString(cm, ph_pt - 50, f"Generated: {fmt_timestamp()}")
        canv.setStrokeColor(SLATE_300)
        canv.setLineWidth(0.5)
        canv.line(cm, ph_pt - 56, pw_pt - cm, ph_pt - 56)

    styles = build_shared_styles()

    # ── Empty state ──
    if not rows:
        builder.add_title(report_type.replace("_", " ").title())
        builder.add_small_note("No records found for the selected criteria.")
        return builder.build(header_context={"title": report_type.replace("_", " ").title()})

    # ── Build table ──
    headers = list(sample.keys())
    col_count = len(headers)
    if len(col_widths) < col_count:
        col_widths = col_widths + [1.0*inch] * (col_count - len(col_widths))
    elif len(col_widths) > col_count:
        col_widths = col_widths[:col_count]

    header_paras = [make_paragraph(h.replace("_", " ").title(), styles["table_header"]) for h in headers]
    table_data = [header_paras]
    for row in rows:
        cells = [Paragraph(safe_pdf_text(str(row.get(h, ""))), styles["table_body_center"]) for h in headers]
        table_data.append(cells)

    table = Table(table_data, colWidths=col_widths, repeatRows=1, splitByRow=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("GRID", (0, 1), (-1, -1), 0.4, SLATE_200),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, SLATE_50]),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, 0), 6),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
        ("TOPPADDING", (0, 1), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))

    builder.add_title(report_type.replace("_", " ").title())
    builder.add_table(table)
    builder.add_spacer(0.1 * inch)
    builder.add_small_note(f"Total records: {len(rows)}")

    return builder.build(header_context={"title": report_type.replace("_", " ").title()})


@router.get("/suppliers", response_model=List[SupplierResponse])
def list_suppliers(
    school_id: str = Depends(resolve_school_id_from_actor),
    search: Optional[str] = Query(default=None),
    is_active: Optional[bool] = Query(default=None),
):
    return svc_list_suppliers(school_id, search=search, is_active=is_active)


@router.post("/suppliers", response_model=SupplierResponse)
def create_supplier(
    payload: SupplierCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
):
    return svc_create_supplier(school_id, payload.model_dump())


@router.put("/suppliers/{supplier_id}", response_model=SupplierResponse)
def update_supplier(
    supplier_id: str,
    payload: SupplierUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
):
    return svc_update_supplier(school_id, supplier_id, payload.model_dump(exclude_unset=True))


@router.delete("/suppliers/{supplier_id}")
def delete_supplier(
    supplier_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
):
    return svc_delete_supplier(school_id, supplier_id)


@router.get("/subjects", response_model=List[InventorySubjectResponse])
def list_subjects(
    school_id: str = Depends(resolve_school_id_from_actor),
    is_active: Optional[bool] = Query(default=None),
):
    return svc_list_subjects(school_id, is_active=is_active)


@router.post("/subjects", response_model=InventorySubjectResponse)
def create_subject(
    payload: InventorySubjectCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
):
    return svc_create_subject(school_id, payload.model_dump())


@router.put("/subjects/{subject_id}", response_model=InventorySubjectResponse)
def update_subject(
    subject_id: str,
    payload: InventorySubjectUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
):
    return svc_update_subject(school_id, subject_id, payload.model_dump(exclude_unset=True))


@router.delete("/subjects/{subject_id}")
def delete_subject(
    subject_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
):
    return svc_delete_subject(school_id, subject_id)


@router.get("/sets", response_model=List[InventorySetResponse])
def list_sets(
    school_id: str = Depends(resolve_school_id_from_actor),
    subject_id: Optional[str] = Query(default=None),
    is_active: Optional[bool] = Query(default=None),
):
    return svc_list_sets(school_id, subject_id=subject_id, is_active=is_active)


@router.post("/sets", response_model=InventorySetResponse)
def create_set(
    payload: InventorySetCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
):
    return svc_create_set(school_id, payload.model_dump())


@router.put("/sets/{set_id}", response_model=InventorySetResponse)
def update_set(
    set_id: str,
    payload: InventorySetUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
):
    return svc_update_set(school_id, set_id, payload.model_dump(exclude_unset=True))


@router.delete("/sets/{set_id}")
def delete_set(
    set_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
):
    return svc_delete_set(school_id, set_id)


@router.get("/volumes", response_model=List[InventoryVolumeResponse])
def list_volumes(
    school_id: str = Depends(resolve_school_id_from_actor),
    subject_id: Optional[str] = Query(default=None),
    set_id: Optional[str] = Query(default=None),
    is_active: Optional[bool] = Query(default=None),
):
    return svc_list_volumes(school_id, subject_id=subject_id, set_id=set_id, is_active=is_active)


@router.post("/volumes", response_model=InventoryVolumeResponse)
def create_volume(
    payload: InventoryVolumeCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
):
    return svc_create_volume(school_id, payload.model_dump())


@router.put("/volumes/{volume_id}", response_model=InventoryVolumeResponse)
def update_volume(
    volume_id: str,
    payload: InventoryVolumeUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
):
    return svc_update_volume(school_id, volume_id, payload.model_dump(exclude_unset=True))


@router.delete("/volumes/{volume_id}")
def delete_volume(
    volume_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
):
    return svc_delete_volume(school_id, volume_id)


@router.get("/catalog", response_model=List[InventoryCatalogSubject])
def get_inventory_catalog(
    school_id: str = Depends(resolve_school_id_from_actor),
    include_inactive: bool = Query(default=True),
):
    return svc_get_catalog(school_id, include_inactive=include_inactive)


@router.get("/materials", response_model=List[MaterialResponse])
def list_materials(
    school_id: str = Depends(resolve_school_id_from_actor),
    search: Optional[str] = Query(default=None),
    subject: Optional[str] = Query(default=None),
    batch_name: Optional[str] = Query(default=None),
    is_active: Optional[bool] = Query(default=None),
):
    return svc_list_materials(school_id, search=search, subject=subject, batch_name=batch_name, is_active=is_active)


@router.get("/materials/template/download")
def download_material_import_template():
    buffer = create_inventory_material_template()
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="inventory_material_template.xlsx"'},
    )


@router.post("/materials/import", response_model=InventoryMaterialImportResponse)
async def import_materials_from_excel(
    file: UploadFile = File(...),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
):
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Only .xlsx Excel files are supported")

    content = await file.read()
    rows, errors = parse_inventory_material_excel(content)
    if not rows and errors:
        raise HTTPException(status_code=400, detail=errors[0].get("error", "Invalid Excel file"))

    imported_count = 0
    updated_count = 0
    skipped_count = 0
    try:
        supabase = get_supabase_admin_client()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    schools = fetch_all(supabase, "schools", select="id,name", filters={"id": school_id})
    if not schools:
        raise HTTPException(status_code=400, detail="Supabase school not found for inventory import.")

    categories = fetch_all(
        supabase,
        "material_categories",
        select="id,school_id,category_code,name,parent_category_id,is_active",
        filters={"school_id": school_id},
        schema="inventory",
    )
    suppliers = fetch_all(
        supabase,
        "suppliers",
        select="id,name",
        filters={"school_id": school_id},
        schema="inventory",
    )
    materials = fetch_all(
        supabase,
        "material_items",
        select="id,category_id,name,metadata,current_stock",
        filters={"school_id": school_id},
        schema="inventory",
    )
    stock_in_entries = fetch_all(
        supabase,
        "stock_in_entries",
        select="id,material_item_id,supplier_id,entry_date,quantity_received,notes",
        filters={"school_id": school_id},
        schema="inventory",
    )
    stock_out_entries = fetch_all(
        supabase,
        "stock_out_entries",
        select="material_item_id,quantity_issued",
        filters={"school_id": school_id},
        schema="inventory",
    )
    student_issue_entries = fetch_all(
        supabase,
        "student_issue_entries",
        select="material_item_id,quantity_issued",
        filters={"school_id": school_id},
        schema="inventory",
    )

    categories_by_parent: Dict[str, List[dict]] = {}
    for category in categories:
        parent_key = str(category.get("parent_category_id") or "")
        categories_by_parent.setdefault(parent_key, []).append(category)

    suppliers_by_name = {
        str(item.get("name") or "").strip().lower(): item
        for item in suppliers
        if item.get("name")
    }

    materials_by_signature = {}
    for material in materials:
        metadata = material.get("metadata") or {}
        signature = (
            str(material.get("name") or "").strip().lower(),
            str(metadata.get("subject_category_id") or ""),
            str(metadata.get("set_category_id") or ""),
            str(metadata.get("volume_category_id") or ""),
        )
        materials_by_signature[signature] = material

    def find_child_category(parent_id: Optional[str], name: str) -> Optional[dict]:
        normalized = name.strip().lower()
        for cat in categories_by_parent.get(str(parent_id or ""), []):
            if str(cat.get("name") or "").strip().lower() == normalized:
                return cat
        return None

    def create_category(parent_id: Optional[str], name: str, prefix: str, is_active: bool) -> dict:
        row = {
            "school_id": school_id,
            "category_code": build_inventory_code(prefix, name),
            "name": name.strip(),
            "parent_category_id": parent_id,
            "is_active": is_active,
        }
        insert_rows(supabase, "material_categories", [row], schema="inventory")
        created = fetch_all(
            supabase,
            "material_categories",
            select="id,school_id,category_code,name,parent_category_id,is_active",
            filters={"school_id": school_id, "category_code": row["category_code"]},
            schema="inventory",
        )[0]
        categories.append(created)
        categories_by_parent.setdefault(str(parent_id or ""), []).append(created)
        return created

    def get_or_create_hierarchy(row: dict) -> tuple[dict, dict, Optional[dict]]:
        subject = find_child_category(None, row["subject_name"])
        if not subject:
            subject = create_category(None, row["subject_name"], "SUB", row.get("is_active", True))

        inventory_set = find_child_category(subject["id"], row["set_name"])
        if not inventory_set:
            inventory_set = create_category(subject["id"], row["set_name"], "SET", row.get("is_active", True))

        volume = None
        volume_number = row.get("volume_number")
        if volume_number:
            volume_name = (row.get("volume_name") or f"Volume {volume_number}").strip()
            volume = find_child_category(inventory_set["id"], volume_name)
            if not volume:
                volume = create_category(inventory_set["id"], volume_name, f"VOL{volume_number}", row.get("is_active", True))

        return subject, inventory_set, volume

    def normalize_import_date(value: object) -> str:
        if value in (None, ""):
            return datetime.utcnow().date().isoformat()
        if isinstance(value, datetime):
            return value.date().isoformat()
        if isinstance(value, date):
            return value.isoformat()
        if isinstance(value, str):
            raw = value.strip()
            try:
                return datetime.fromisoformat(raw).date().isoformat()
            except ValueError:
                try:
                    return datetime.strptime(raw, "%Y-%m-%d").date().isoformat()
                except ValueError as exc:
                    raise ValueError(f"Invalid STOCK IN DATE: {value}") from exc
        raise ValueError(f"Invalid STOCK IN DATE: {value}")

    touched_material_ids: set[str] = set()

    for row_data in rows:
        try:
            subject, inventory_set, volume = get_or_create_hierarchy(row_data)
            signature = (
                str(row_data["material_name"]).strip().lower(),
                str(subject["id"]),
                str(inventory_set["id"]),
                str(volume["id"]) if volume else "",
            )

            material = materials_by_signature.get(signature)
            normalized_unit_type = normalize_supabase_inventory_unit_type(row_data.get("unit_type"))
            metadata = {
                "subject_category_id": subject["id"],
                "set_category_id": inventory_set["id"],
                "volume_category_id": volume["id"] if volume else None,
                "batch_names": normalize_batch_names(row_data.get("batch_names")),
                "original_unit_type": normalize_material_unit_type(row_data.get("unit_type")),
                "source": "inventory_material_import",
            }

            if material:
                supabase.schema("inventory").table("material_items").update({
                    "category_id": volume["id"] if volume else inventory_set["id"],
                    "name": str(row_data["material_name"]).strip(),
                    "unit_type": normalized_unit_type,
                    "class_name": ", ".join(normalize_batch_names(row_data.get("batch_names"))) or None,
                    "description": row_data.get("description") or None,
                    "low_stock_threshold": int(row_data.get("low_stock_threshold", 10) or 10),
                    "metadata": metadata,
                    "is_active": bool(row_data.get("is_active", True)),
                }).eq("id", material["id"]).eq("school_id", school_id).execute()
                updated_count += 1
            else:
                insert_rows(
                    supabase,
                    "material_items",
                    [{
                        "school_id": school_id,
                        "category_id": volume["id"] if volume else inventory_set["id"],
                        "item_code": build_inventory_code("MAT", row_data["subject_name"], row_data["set_name"], row_data["material_name"]),
                        "name": str(row_data["material_name"]).strip(),
                        "unit_type": normalized_unit_type,
                        "class_name": ", ".join(normalize_batch_names(row_data.get("batch_names"))) or None,
                        "description": row_data.get("description") or None,
                        "low_stock_threshold": int(row_data.get("low_stock_threshold", 10) or 10),
                        "current_stock": 0,
                        "unit_price": float(row_data.get("price", 0.0) or 0.0),
                        "metadata": metadata,
                        "is_active": bool(row_data.get("is_active", True)),
                    }],
                    schema="inventory",
                )
                material = fetch_all(
                    supabase,
                    "material_items",
                    select="id,category_id,name,metadata,current_stock",
                    filters={"school_id": school_id, "name": str(row_data["material_name"]).strip()},
                    schema="inventory",
                )[-1]
                materials.append(material)
                materials_by_signature[signature] = material
                imported_count += 1

            touched_material_ids.add(str(material["id"]))

            supplier_name = str(row_data.get("supplier_name") or "").strip()
            opening_stock = int(row_data.get("opening_stock", 0) or 0)
            if supplier_name and opening_stock > 0:
                supplier = suppliers_by_name.get(supplier_name.lower())
                if not supplier:
                    insert_rows(
                        supabase,
                        "suppliers",
                        [{
                            "school_id": school_id,
                            "supplier_code": build_inventory_code("SUP", supplier_name),
                            "name": supplier_name,
                            "is_active": True,
                            "metadata": {"source": "inventory_material_import"},
                        }],
                        schema="inventory",
                    )
                    supplier = fetch_all(
                        supabase,
                        "suppliers",
                        select="id,name",
                        filters={"school_id": school_id, "name": supplier_name},
                        schema="inventory",
                    )[-1]
                    suppliers_by_name[supplier_name.lower()] = supplier

                entry_date = normalize_import_date(row_data.get("stock_in_date"))
                import_note = "Imported from material template"
                already_exists = next(
                    (
                        item for item in stock_in_entries
                        if str(item.get("material_item_id")) == str(material["id"])
                        and str(item.get("supplier_id")) == str(supplier["id"])
                        and str(item.get("entry_date")) == entry_date
                        and int(item.get("quantity_received") or 0) == opening_stock
                        and str(item.get("notes") or "") == import_note
                    ),
                    None,
                )
                if not already_exists:
                    insert_rows(
                        supabase,
                        "stock_in_entries",
                        [{
                            "school_id": school_id,
                            "material_item_id": material["id"],
                            "supplier_id": supplier["id"],
                            "entry_date": entry_date,
                            "quantity_received": opening_stock,
                            "unit_price": float(row_data.get("price", 0.0) or 0.0),
                            "entry_type": "purchase",
                            "notes": import_note,
                        }],
                        schema="inventory",
                    )
                    stock_in_entries.append({
                        "material_item_id": material["id"],
                        "supplier_id": supplier["id"],
                        "entry_date": entry_date,
                        "quantity_received": opening_stock,
                        "notes": import_note,
                    })
        except Exception as exc:
            skipped_count += 1
            errors.append({
                "material_name": row_data.get("material_name", ""),
                "error": str(exc),
            })

    stock_in_totals: Dict[str, int] = {}
    stock_out_totals: Dict[str, int] = {}
    issue_totals: Dict[str, int] = {}
    for entry in stock_in_entries:
        mid = str(entry.get("material_item_id") or "")
        stock_in_totals[mid] = stock_in_totals.get(mid, 0) + int(entry.get("quantity_received") or 0)
    for entry in stock_out_entries:
        mid = str(entry.get("material_item_id") or "")
        stock_out_totals[mid] = stock_out_totals.get(mid, 0) + int(entry.get("quantity_issued") or 0)
    for entry in student_issue_entries:
        mid = str(entry.get("material_item_id") or "")
        issue_totals[mid] = issue_totals.get(mid, 0) + int(entry.get("quantity_issued") or 0)

    for material_id in touched_material_ids:
        current_stock = max(
            stock_in_totals.get(material_id, 0)
            - stock_out_totals.get(material_id, 0)
            - issue_totals.get(material_id, 0),
            0,
        )
        supabase.schema("inventory").table("material_items").update({
            "current_stock": current_stock,
        }).eq("id", material_id).eq("school_id", school_id).execute()

    return InventoryMaterialImportResponse(
        imported_count=imported_count,
        updated_count=updated_count,
        skipped_count=skipped_count,
        errors=errors,
        message=(
            f"Imported {imported_count} material(s), updated {updated_count}, "
            f"skipped {skipped_count}."
        ),
    )


@router.post("/materials", response_model=MaterialResponse)
def create_material(
    payload: MaterialCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
):
    return svc_create_material(school_id, payload.model_dump())


@router.put("/materials/{material_id}", response_model=MaterialResponse)
def update_material(
    material_id: str,
    payload: MaterialUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
):
    return svc_update_material(school_id, material_id, payload.model_dump(exclude_unset=True))


@router.delete("/materials/{material_id}")
def delete_material(
    material_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
):
    return svc_delete_material(school_id, material_id)


@router.get("/stock-in", response_model=List[StockInResponse])
def list_stock_in(
    school_id: str = Depends(resolve_school_id_from_actor),
    supplier_id: Optional[str] = Query(default=None),
    material_id: Optional[str] = Query(default=None),
):
    return svc_list_stock_in(school_id, supplier_id=supplier_id, material_id=material_id)


@router.post("/stock-in", response_model=StockInResponse)
def create_stock_in(
    payload: StockInCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
):
    return svc_create_stock_in(school_id, payload.model_dump())


@router.delete("/stock-in/{entry_id}")
def delete_stock_in(
    entry_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
):
    return svc_delete_stock_in(school_id, entry_id)


@router.get("/stock-out", response_model=List[StockOutResponse])
def list_stock_out(
    school_id: str = Depends(resolve_school_id_from_actor),
    batch_id: Optional[str] = Query(default=None),
    material_id: Optional[str] = Query(default=None),
):
    return svc_list_stock_out(school_id, batch_id=batch_id, material_id=material_id)


@router.post("/stock-out", response_model=StockOutResponse)
def create_stock_out(
    payload: StockOutCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
):
    return svc_create_stock_out(school_id, payload.model_dump())


@router.delete("/stock-out/{entry_id}")
def delete_stock_out(
    entry_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
):
    return svc_delete_stock_out(school_id, entry_id)


@router.get("/student-issues", response_model=List[StudentIssueResponse])
def list_student_issues(
    school_id: str = Depends(resolve_school_id_from_actor),
    batch_id: Optional[str] = Query(default=None),
    student_id: Optional[str] = Query(default=None),
    material_id: Optional[str] = Query(default=None),
):
    return svc_list_student_issues(school_id, batch_id=batch_id, student_id=student_id, material_id=material_id)


@router.post("/student-issues", response_model=StudentIssueResponse)
def create_student_issues(
    payload: StudentIssueCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
):
    return svc_create_student_issue(school_id, payload.model_dump())


@router.delete("/student-issues/{entry_id}")
def delete_student_issue(
    entry_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
):
    return svc_delete_student_issue(school_id, entry_id)


@router.get("/dashboard", response_model=InventoryDashboardResponse)
def get_inventory_dashboard(
    school_id: str = Depends(resolve_school_id_from_actor),
):
    return svc_get_dashboard(school_id)


@router.get("/history/material/{material_id}", response_model=List[InventoryHistoryEntry])
def get_material_history(
    material_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
):
    return svc_get_material_history(school_id, material_id)


@router.get("/reports/data", response_model=InventoryReportResponse)
def get_inventory_report(
    report_type: str = Query(...),
    school_id: str = Depends(resolve_school_id_from_actor),
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
    supplier_id: Optional[str] = Query(default=None),
    batch_id: Optional[str] = Query(default=None),
    material_id: Optional[str] = Query(default=None),
    student_id: Optional[str] = Query(default=None),
):
    rows = svc_get_report_data(
        school_id, report_type,
        date_from=date_from, date_to=date_to,
        supplier_id=supplier_id, batch_id=batch_id,
        material_id=material_id, student_id=student_id,
    )
    return InventoryReportResponse(
        report_type=report_type,
        generated_at=datetime.now(),
        rows=[InventoryReportRow(values=row) for row in rows],
        total_records=len(rows),
    )


@router.get("/reports/export")
def export_inventory_report(
    report_type: str = Query(...),
    export_format: str = Query(..., pattern="^(excel|pdf|csv)$"),
    school_id: str = Depends(resolve_school_id_from_actor),
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
    supplier_id: Optional[str] = Query(default=None),
    batch_id: Optional[str] = Query(default=None),
    material_id: Optional[str] = Query(default=None),
    student_id: Optional[str] = Query(default=None),
):
    rows = svc_get_report_data(
        school_id, report_type,
        date_from=date_from, date_to=date_to,
        supplier_id=supplier_id, batch_id=batch_id,
        material_id=material_id, student_id=student_id,
    )

    suffix = fmt_date_iso()

    if export_format == "csv":
        buffer = build_csv_report(rows)
        return StreamingResponse(
            buffer,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="inventory-{report_type}-{suffix}.csv"'},
        )

    if export_format == "excel":
        buffer = build_excel_report(report_type, rows)
        return StreamingResponse(
            buffer,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="inventory-{report_type}-{suffix}.xlsx"'},
        )

    buffer = build_pdf_report(report_type, rows)
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="inventory-{report_type}-{suffix}.pdf"'},
    )
