"""
Inventory management routes
"""
from datetime import date, datetime
from io import BytesIO
import json
from typing import Dict, List, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from app.services.supabase_context import build_legacy_sqlite_route_blocker, resolve_school_id_from_actor
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import get_authenticated_actor_context
from app.models import (
    BatchTable,
    InventorySet,
    InventoryStockInType,
    InventorySubject,
    InventoryVolume,
    MaterialItem,
    MaterialUnitType,
    School,
    StockInEntry,
    StockOutEntry,
    Student,
    StudentIssueEntry,
    Supplier,
    User,
    UserRole,
)
from app.schemas import (
    InventoryCatalogSet,
    InventoryCatalogSubject,
    InventoryCatalogVolume,
    InventoryDashboardResponse,
    InventoryMaterialImportResponse,
    InventoryHistoryEntry,
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
from app.utils.excel import (
    create_inventory_material_template,
    parse_inventory_material_excel,
)

router = APIRouter(
    prefix="/api/inventory",
    tags=["inventory"],
    dependencies=[
        Depends(
            build_legacy_sqlite_route_blocker(
                "Inventory management",
                reason="This module still depends on legacy SQLite inventory and supplier tables.",
            )
        )
    ],
)

WRITE_ROLES = {UserRole.ADMIN.value, UserRole.STORE_MANAGER.value}


def normalize_batch_names(batch_names: Optional[List[str]]) -> List[str]:
    normalized: List[str] = []
    for raw_name in batch_names or []:
        name = (raw_name or "").strip()
        if name and name not in normalized:
            normalized.append(name)
    return normalized


def parse_material_batches(material: MaterialItem) -> List[str]:
    if material.batch_names:
        try:
            parsed = json.loads(material.batch_names)
            if isinstance(parsed, list):
                return normalize_batch_names([str(item) for item in parsed])
        except (TypeError, ValueError):
            pass
    if material.class_name:
        return normalize_batch_names([part.strip() for part in material.class_name.split(",")])
    return []


def write_material_batches(material: MaterialItem, batch_names: Optional[List[str]]) -> None:
    normalized = normalize_batch_names(batch_names)
    material.batch_names = json.dumps(normalized)
    material.class_name = ", ".join(normalized) if normalized else None


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
    base = "-".join(
        "".join(char.lower() if char.isalnum() else "-" for char in (part or "").strip()).strip("-")
        for part in parts
        if part and str(part).strip()
    )
    base = "-".join(segment for segment in base.split("-") if segment)[:24]
    return f"{prefix}-{base or prefix.lower()}-{uuid4().hex[:8]}"


def ensure_school_context(db: Session, school_id: int = 1) -> int:
    """Create a default admin user and school when running in local mode."""
    school_row = db.query(School.id).filter(School.id == school_id).first()
    if school_row:
        return school_id

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
    return school_id


def require_inventory_write(actor: Dict[str, str] = Depends(get_authenticated_actor_context)) -> Dict[str, str]:
    if actor["role"] not in WRITE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Admin or Store Manager can modify inventory records",
        )
    return actor


def recalculate_material_stock(db: Session, material: MaterialItem) -> MaterialItem:
    total_in = db.query(func.coalesce(func.sum(StockInEntry.quantity_received), 0)).filter(
        StockInEntry.material_id == material.id
    ).scalar() or 0
    batch_total_out = db.query(func.coalesce(func.sum(StockOutEntry.quantity_issued), 0)).filter(
        StockOutEntry.material_id == material.id
    ).scalar() or 0
    student_total_out = db.query(func.coalesce(func.sum(StudentIssueEntry.quantity_issued), 0)).filter(
        StudentIssueEntry.material_id == material.id
    ).scalar() or 0
    total_out = int(batch_total_out) + int(student_total_out)
    material.current_stock = max(int(total_in) - total_out, 0)
    material.total_distributed = total_out
    db.flush()
    return material


def sync_inventory_totals(db: Session, school_id: int) -> None:
    materials = db.query(MaterialItem).filter(MaterialItem.school_id == school_id).all()
    for material in materials:
        recalculate_material_stock(db, material)
    db.commit()


def serialize_supplier(supplier: Supplier) -> SupplierResponse:
    return SupplierResponse.model_validate(supplier, from_attributes=True)


def serialize_subject(subject: InventorySubject) -> InventorySubjectResponse:
    return InventorySubjectResponse.model_validate(subject, from_attributes=True)


def serialize_set(inventory_set: InventorySet) -> InventorySetResponse:
    return InventorySetResponse(
        id=inventory_set.id,
        subject_id=inventory_set.subject_id,
        subject_name=inventory_set.subject.name if inventory_set.subject else "",
        name=inventory_set.name,
        school_id=inventory_set.school_id,
        is_active=inventory_set.is_active,
        created_at=inventory_set.created_at,
        updated_at=inventory_set.updated_at,
    )


def serialize_volume(volume: InventoryVolume) -> InventoryVolumeResponse:
    subject = volume.inventory_set.subject if volume.inventory_set and volume.inventory_set.subject else None
    return InventoryVolumeResponse(
        id=volume.id,
        set_id=volume.set_id,
        set_name=volume.inventory_set.name if volume.inventory_set else "",
        subject_id=subject.id if subject else 0,
        subject_name=subject.name if subject else "",
        name=volume.name,
        volume_number=volume.volume_number,
        school_id=volume.school_id,
        is_active=volume.is_active,
        created_at=volume.created_at,
        updated_at=volume.updated_at,
    )


def serialize_material(material: MaterialItem) -> MaterialResponse:
    return MaterialResponse(
        id=material.id,
        name=material.name,
        subject_id=material.subject_id,
        subject=material.subject,
        set_id=material.set_id,
        set_name=material.set_name,
        volume_id=material.volume_id,
        volume_name=material.volume_name,
        volume_number=material.volume_number,
        set_part_name=material.set_part_name,
        batch_names=parse_material_batches(material),
        description=material.description,
        unit_type=material.unit_type,
        price=material.price,
        low_stock_threshold=material.low_stock_threshold,
        school_id=material.school_id,
        current_stock=material.current_stock,
        total_distributed=material.total_distributed,
        is_active=material.is_active,
        created_at=material.created_at,
        updated_at=material.updated_at,
    )


def sync_material_hierarchy_fields(
    db: Session,
    school_id: int,
    subject_id: Optional[int] = None,
    set_id: Optional[int] = None,
    volume_id: Optional[int] = None,
):
    subject = None
    inventory_set = None
    volume = None

    if subject_id:
        subject = db.query(InventorySubject).filter(
            InventorySubject.id == subject_id,
            InventorySubject.school_id == school_id,
        ).first()
        if not subject:
            raise HTTPException(status_code=404, detail="Subject not found")

    if set_id:
        inventory_set = db.query(InventorySet).filter(
            InventorySet.id == set_id,
            InventorySet.school_id == school_id,
        ).first()
        if not inventory_set:
            raise HTTPException(status_code=404, detail="Set not found")
        if subject and inventory_set.subject_id != subject.id:
            raise HTTPException(status_code=400, detail="Selected set does not belong to the chosen subject")
        subject = inventory_set.subject

    if volume_id:
        volume = db.query(InventoryVolume).filter(
            InventoryVolume.id == volume_id,
            InventoryVolume.school_id == school_id,
        ).first()
        if not volume:
            raise HTTPException(status_code=404, detail="Volume not found")
        if inventory_set and volume.set_id != inventory_set.id:
            raise HTTPException(status_code=400, detail="Selected volume does not belong to the chosen set")
        inventory_set = volume.inventory_set
        subject = inventory_set.subject if inventory_set else subject

    return subject, inventory_set, volume


def get_or_create_inventory_hierarchy(
    db: Session,
    school_id: int,
    subject_name: str,
    set_name: str,
    volume_number: Optional[int] = None,
    volume_name: Optional[str] = None,
    is_active: bool = True,
):
    subject = db.query(InventorySubject).filter(
        InventorySubject.school_id == school_id,
        InventorySubject.name.ilike(subject_name.strip()),
    ).first()
    if not subject:
        subject = InventorySubject(
            school_id=school_id,
            name=subject_name.strip(),
            is_active=is_active,
        )
        db.add(subject)
        db.flush()

    inventory_set = db.query(InventorySet).filter(
        InventorySet.school_id == school_id,
        InventorySet.subject_id == subject.id,
        InventorySet.name.ilike(set_name.strip()),
    ).first()
    if not inventory_set:
        inventory_set = InventorySet(
            school_id=school_id,
            subject_id=subject.id,
            name=set_name.strip(),
            is_active=is_active,
        )
        db.add(inventory_set)
        db.flush()

    volume = None
    if volume_number:
        resolved_volume_name = (volume_name or f"Volume {volume_number}").strip()
        volume = db.query(InventoryVolume).filter(
            InventoryVolume.school_id == school_id,
            InventoryVolume.set_id == inventory_set.id,
            InventoryVolume.volume_number == volume_number,
        ).first()
        if not volume:
            volume = InventoryVolume(
                school_id=school_id,
                set_id=inventory_set.id,
                name=resolved_volume_name,
                volume_number=volume_number,
                is_active=is_active,
            )
            db.add(volume)
            db.flush()

    return subject, inventory_set, volume


def bootstrap_inventory_hierarchy(db: Session, school_id: int) -> None:
    materials = db.query(MaterialItem).filter(MaterialItem.school_id == school_id).all()
    changed = False

    for material in materials:
        subject = None
        inventory_set = None
        volume = None

        subject_name = (material.subject or "").strip()
        if subject_name:
            subject = db.query(InventorySubject).filter(
                InventorySubject.school_id == school_id,
                InventorySubject.name.ilike(subject_name),
            ).first()
            if not subject:
                subject = InventorySubject(name=subject_name, school_id=school_id, is_active=material.is_active)
                db.add(subject)
                db.flush()
                changed = True

        set_name = (material.set_name or "").strip()
        if subject and set_name:
            inventory_set = db.query(InventorySet).filter(
                InventorySet.school_id == school_id,
                InventorySet.subject_id == subject.id,
                InventorySet.name.ilike(set_name),
            ).first()
            if not inventory_set:
                inventory_set = InventorySet(
                    subject_id=subject.id,
                    name=set_name,
                    school_id=school_id,
                    is_active=material.is_active,
                )
                db.add(inventory_set)
                db.flush()
                changed = True

        volume_name = (material.volume_name or "").strip()
        volume_number = material.volume_number
        if not volume_name and material.set_part_name:
            part_text = material.set_part_name.strip()
            if part_text.lower().startswith("volume ") and " - " in part_text:
                number_text, extracted_name = part_text.split(" - ", 1)
                try:
                    volume_number = int(number_text.replace("Volume", "").strip())
                    volume_name = extracted_name.strip()
                except ValueError:
                    volume_name = part_text
            else:
                volume_name = part_text

        if inventory_set and volume_name:
            if not volume_number:
                volume_number = 1
            volume = db.query(InventoryVolume).filter(
                InventoryVolume.school_id == school_id,
                InventoryVolume.set_id == inventory_set.id,
                InventoryVolume.volume_number == volume_number,
            ).first()
            if not volume:
                volume = InventoryVolume(
                    set_id=inventory_set.id,
                    name=volume_name,
                    volume_number=volume_number,
                    school_id=school_id,
                    is_active=material.is_active,
                )
                db.add(volume)
                db.flush()
                changed = True

        if subject and material.subject_id != subject.id:
            material.subject_id = subject.id
            changed = True
        if inventory_set and material.set_id != inventory_set.id:
            material.set_id = inventory_set.id
            changed = True
        if volume and material.volume_id != volume.id:
            material.volume_id = volume.id
            changed = True
        if volume_name and material.volume_name != volume_name:
            material.volume_name = volume_name
            changed = True
        if volume_number and material.volume_number != volume_number:
            material.volume_number = volume_number
            changed = True
        if volume_name and volume_number:
            set_part_name = f"Volume {volume_number} - {volume_name}"
            if material.set_part_name != set_part_name:
                material.set_part_name = set_part_name
                changed = True

    if changed:
        db.commit()


def serialize_stock_in(entry: StockInEntry) -> StockInResponse:
    return StockInResponse(
        id=entry.id,
        date=entry.date,
        supplier_id=entry.supplier_id,
        supplier_name=entry.supplier.name if entry.supplier else "",
        material_id=entry.material_id,
        material_name=entry.material.name if entry.material else "",
        quantity_received=entry.quantity_received,
        entry_type=entry.entry_type,
        added_by=entry.added_by,
        notes=entry.notes,
        school_id=entry.school_id,
        created_at=entry.created_at,
    )


def serialize_stock_out(entry: StockOutEntry) -> StockOutResponse:
    return StockOutResponse(
        id=entry.id,
        date=entry.date,
        batch_id=entry.batch_id,
        batch_name=entry.batch_name,
        material_id=entry.material_id,
        material_name=entry.material.name if entry.material else "",
        quantity_issued=entry.quantity_issued,
        issued_by=entry.issued_by,
        remarks=entry.remarks,
        school_id=entry.school_id,
        created_at=entry.created_at,
    )


def serialize_student_issue(entry: StudentIssueEntry) -> StudentIssueResponse:
    return StudentIssueResponse(
        id=entry.id,
        date=entry.date,
        batch_id=entry.batch_id,
        batch_name=entry.batch_name,
        student_id=entry.student_id,
        student_name=entry.student_name,
        material_id=entry.material_id,
        material_name=entry.material.name if entry.material else "",
        quantity_issued=entry.quantity_issued,
        issued_by=entry.issued_by,
        remarks=entry.remarks,
        school_id=entry.school_id,
        created_at=entry.created_at,
    )


def get_inventory_report_rows(
    db: Session,
    school_id: int,
    report_type: str,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    supplier_id: Optional[int] = None,
    batch_id: Optional[int] = None,
    material_id: Optional[int] = None,
    student_id: Optional[int] = None,
) -> List[Dict[str, object]]:
    normalized_type = report_type.strip().lower()

    if normalized_type == "stock_in":
        query = db.query(StockInEntry).filter(StockInEntry.school_id == school_id)
        if date_from:
            query = query.filter(StockInEntry.date >= date_from)
        if date_to:
            query = query.filter(StockInEntry.date <= date_to)
        if supplier_id:
            query = query.filter(StockInEntry.supplier_id == supplier_id)
        if material_id:
            query = query.filter(StockInEntry.material_id == material_id)
        entries = query.order_by(StockInEntry.date.desc(), StockInEntry.id.desc()).all()
        return [
            {
                "date": entry.date.strftime("%Y-%m-%d %H:%M"),
                "supplier": entry.supplier.name if entry.supplier else "",
                "material": entry.material.name if entry.material else "",
                "quantity_received": entry.quantity_received,
                "entry_type": entry.entry_type.value if hasattr(entry.entry_type, "value") else entry.entry_type,
                "added_by": entry.added_by,
                "notes": entry.notes or "",
            }
            for entry in entries
        ]

    if normalized_type == "batch_distribution":
        rows: List[Dict[str, object]] = []

        if student_id is None:
            batch_query = db.query(StockOutEntry).filter(StockOutEntry.school_id == school_id)
            if date_from:
                batch_query = batch_query.filter(StockOutEntry.date >= date_from)
            if date_to:
                batch_query = batch_query.filter(StockOutEntry.date <= date_to)
            if batch_id:
                batch_query = batch_query.filter(StockOutEntry.batch_id == batch_id)
            if material_id:
                batch_query = batch_query.filter(StockOutEntry.material_id == material_id)
            batch_entries = batch_query.order_by(StockOutEntry.date.desc(), StockOutEntry.id.desc()).all()
            rows.extend(
                {
                    "date": entry.date.strftime("%Y-%m-%d %H:%M"),
                    "scope": "Batch",
                    "batch": entry.batch_name,
                    "student": "",
                    "material": entry.material.name if entry.material else "",
                    "quantity_issued": entry.quantity_issued,
                    "issued_by": entry.issued_by,
                    "remarks": entry.remarks or "",
                }
                for entry in batch_entries
            )

        student_query = db.query(StudentIssueEntry).filter(StudentIssueEntry.school_id == school_id)
        if date_from:
            student_query = student_query.filter(StudentIssueEntry.date >= date_from)
        if date_to:
            student_query = student_query.filter(StudentIssueEntry.date <= date_to)
        if batch_id:
            student_query = student_query.filter(StudentIssueEntry.batch_id == batch_id)
        if material_id:
            student_query = student_query.filter(StudentIssueEntry.material_id == material_id)
        if student_id:
            student_query = student_query.filter(StudentIssueEntry.student_id == student_id)
        student_entries = student_query.order_by(StudentIssueEntry.date.desc(), StudentIssueEntry.id.desc()).all()
        rows.extend(
            {
                "date": entry.date.strftime("%Y-%m-%d %H:%M"),
                "scope": "Student",
                "batch": entry.batch_name or "",
                "student": entry.student_name,
                "material": entry.material.name if entry.material else "",
                "quantity_issued": entry.quantity_issued,
                "issued_by": entry.issued_by,
                "remarks": entry.remarks or "",
            }
            for entry in student_entries
        )
        rows.sort(key=lambda row: row["date"], reverse=True)
        return rows

    if normalized_type == "current_inventory":
        query = db.query(MaterialItem).filter(MaterialItem.school_id == school_id)
        if material_id:
            query = query.filter(MaterialItem.id == material_id)
        materials = query.order_by(MaterialItem.name.asc()).all()
        return [
            {
                "material": item.name,
                "subject": item.subject or "",
                "set_name": item.set_name or "",
                "set_part_name": item.set_part_name or "",
                "batches": ", ".join(parse_material_batches(item)),
                "unit_type": item.unit_type.value if hasattr(item.unit_type, "value") else item.unit_type,
                "price": item.price,
                "current_stock": item.current_stock,
                "distributed": item.total_distributed,
                "status": "Active" if item.is_active else "Inactive",
            }
            for item in materials
        ]

    if normalized_type == "low_stock":
        query = db.query(MaterialItem).filter(
            MaterialItem.school_id == school_id,
            MaterialItem.is_active == True,
            MaterialItem.current_stock <= MaterialItem.low_stock_threshold,
        )
        if material_id:
            query = query.filter(MaterialItem.id == material_id)
        materials = query.order_by(MaterialItem.current_stock.asc(), MaterialItem.name.asc()).all()
        return [
            {
                "material": item.name,
                "subject": item.subject or "",
                "set_name": item.set_name or "",
                "set_part_name": item.set_part_name or "",
                "batches": ", ".join(parse_material_batches(item)),
                "current_stock": item.current_stock,
                "low_stock_threshold": item.low_stock_threshold,
                "status": "Low Stock" if item.current_stock > 0 else "Out of Stock",
            }
            for item in materials
        ]

    raise HTTPException(status_code=400, detail="Unsupported report type")


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


def build_pdf_report(report_type: str, rows: List[Dict[str, object]]) -> BytesIO:
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=24, leftMargin=24, topMargin=24, bottomMargin=24)
    styles = getSampleStyleSheet()

    elements = [
        Paragraph(report_type.replace("_", " ").title(), styles["Title"]),
        Spacer(1, 12),
        Paragraph(f"Generated on {datetime.now().strftime('%Y-%m-%d %H:%M')}", styles["BodyText"]),
        Spacer(1, 12),
    ]

    if rows:
        headers = list(rows[0].keys())
        table_data = [headers] + [[str(row.get(header, "")) for header in headers] for row in rows]
    else:
        table_data = [["message"], ["No records found"]]

    table = Table(table_data, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1d4ed8")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
            ]
        )
    )
    elements.append(table)
    doc.build(elements)
    buffer.seek(0)
    return buffer


@router.get("/suppliers", response_model=List[SupplierResponse])
def list_suppliers(
    school_id: str = Depends(resolve_school_id_from_actor),
    search: Optional[str] = Query(default=None),
    is_active: Optional[bool] = Query(default=None),
    db: Session = Depends(get_db),
):
    ensure_school_context(db, school_id)
    query = db.query(Supplier).filter(Supplier.school_id == school_id)
    if search:
        pattern = f"%{search.strip()}%"
        query = query.filter(or_(Supplier.name.ilike(pattern), Supplier.contact_person.ilike(pattern)))
    if is_active is not None:
        query = query.filter(Supplier.is_active == is_active)
    return [serialize_supplier(supplier) for supplier in query.order_by(Supplier.name.asc()).all()]


@router.post("/suppliers", response_model=SupplierResponse)
def create_supplier(
    payload: SupplierCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
    db: Session = Depends(get_db),
):
    ensure_school_context(db, school_id)
    existing = db.query(Supplier).filter(
        Supplier.school_id == school_id,
        Supplier.name.ilike(payload.name.strip()),
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Supplier already exists")

    supplier = Supplier(
        name=payload.name.strip(),
        contact_person=payload.contact_person,
        phone=payload.phone,
        email=payload.email,
        address=payload.address,
        school_id=school_id,
        is_active=payload.is_active,
    )
    db.add(supplier)
    db.commit()
    db.refresh(supplier)
    return serialize_supplier(supplier)


@router.put("/suppliers/{supplier_id}", response_model=SupplierResponse)
def update_supplier(
    supplier_id: int,
    payload: SupplierUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
    db: Session = Depends(get_db),
):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id, Supplier.school_id == school_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    updates = payload.model_dump(exclude_unset=True)
    if "name" in updates and updates["name"]:
        duplicate = db.query(Supplier).filter(
            Supplier.school_id == school_id,
            Supplier.id != supplier_id,
            Supplier.name.ilike(updates["name"].strip()),
        ).first()
        if duplicate:
            raise HTTPException(status_code=400, detail="Supplier with this name already exists")
        updates["name"] = updates["name"].strip()

    for field, value in updates.items():
        setattr(supplier, field, value)

    db.commit()
    db.refresh(supplier)
    return serialize_supplier(supplier)


@router.delete("/suppliers/{supplier_id}")
def delete_supplier(
    supplier_id: int,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
    db: Session = Depends(get_db),
):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id, Supplier.school_id == school_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    usage_count = db.query(StockInEntry).filter(StockInEntry.supplier_id == supplier_id).count()
    if usage_count > 0:
        raise HTTPException(status_code=400, detail="Supplier cannot be deleted because stock history exists")

    db.delete(supplier)
    db.commit()
    return {"message": "Supplier deleted successfully"}


@router.get("/subjects", response_model=List[InventorySubjectResponse])
def list_subjects(
    school_id: str = Depends(resolve_school_id_from_actor),
    is_active: Optional[bool] = Query(default=None),
    db: Session = Depends(get_db),
):
    ensure_school_context(db, school_id)
    bootstrap_inventory_hierarchy(db, school_id)
    query = db.query(InventorySubject).filter(InventorySubject.school_id == school_id)
    if is_active is not None:
        query = query.filter(InventorySubject.is_active == is_active)
    return [serialize_subject(item) for item in query.order_by(InventorySubject.name.asc()).all()]


@router.post("/subjects", response_model=InventorySubjectResponse)
def create_subject(
    payload: InventorySubjectCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
    db: Session = Depends(get_db),
):
    ensure_school_context(db, school_id)
    existing = db.query(InventorySubject).filter(
        InventorySubject.school_id == school_id,
        InventorySubject.name.ilike(payload.name.strip()),
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Subject already exists")

    subject = InventorySubject(name=payload.name.strip(), school_id=school_id, is_active=payload.is_active)
    db.add(subject)
    db.commit()
    db.refresh(subject)
    return serialize_subject(subject)


@router.put("/subjects/{subject_id}", response_model=InventorySubjectResponse)
def update_subject(
    subject_id: int,
    payload: InventorySubjectUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
    db: Session = Depends(get_db),
):
    subject = db.query(InventorySubject).filter(
        InventorySubject.id == subject_id,
        InventorySubject.school_id == school_id,
    ).first()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    updates = payload.model_dump(exclude_unset=True)
    if "name" in updates and updates["name"]:
        updated_name = updates["name"].strip()
        duplicate = db.query(InventorySubject).filter(
            InventorySubject.school_id == school_id,
            InventorySubject.id != subject_id,
            InventorySubject.name.ilike(updated_name),
        ).first()
        if duplicate:
            raise HTTPException(status_code=400, detail="Another subject with this name already exists")
        subject.name = updated_name

    if "is_active" in updates:
        subject.is_active = updates["is_active"]

    if "name" in updates:
        linked_materials = db.query(MaterialItem).filter(MaterialItem.subject_id == subject_id).all()
        for item in linked_materials:
            item.subject = subject.name

    db.commit()
    db.refresh(subject)
    return serialize_subject(subject)


@router.delete("/subjects/{subject_id}")
def delete_subject(
    subject_id: int,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
    db: Session = Depends(get_db),
):
    subject = db.query(InventorySubject).filter(
        InventorySubject.id == subject_id,
        InventorySubject.school_id == school_id,
    ).first()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    if db.query(InventorySet).filter(InventorySet.subject_id == subject_id).count() > 0:
        raise HTTPException(status_code=400, detail="Delete linked sets first")
    if db.query(MaterialItem).filter(MaterialItem.subject_id == subject_id).count() > 0:
        raise HTTPException(status_code=400, detail="Delete linked materials first")

    db.delete(subject)
    db.commit()
    return {"message": "Subject deleted successfully"}


@router.get("/sets", response_model=List[InventorySetResponse])
def list_sets(
    school_id: str = Depends(resolve_school_id_from_actor),
    subject_id: Optional[int] = Query(default=None),
    is_active: Optional[bool] = Query(default=None),
    db: Session = Depends(get_db),
):
    ensure_school_context(db, school_id)
    bootstrap_inventory_hierarchy(db, school_id)
    query = db.query(InventorySet).filter(InventorySet.school_id == school_id)
    if subject_id:
        query = query.filter(InventorySet.subject_id == subject_id)
    if is_active is not None:
        query = query.filter(InventorySet.is_active == is_active)
    return [serialize_set(item) for item in query.order_by(InventorySet.name.asc()).all()]


@router.post("/sets", response_model=InventorySetResponse)
def create_set(
    payload: InventorySetCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
    db: Session = Depends(get_db),
):
    ensure_school_context(db, school_id)
    subject = db.query(InventorySubject).filter(
        InventorySubject.id == payload.subject_id,
        InventorySubject.school_id == school_id,
    ).first()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    existing = db.query(InventorySet).filter(
        InventorySet.school_id == school_id,
        InventorySet.subject_id == payload.subject_id,
        InventorySet.name.ilike(payload.name.strip()),
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Set already exists for this subject")

    inventory_set = InventorySet(
        subject_id=payload.subject_id,
        name=payload.name.strip(),
        school_id=school_id,
        is_active=payload.is_active,
    )
    db.add(inventory_set)
    db.commit()
    db.refresh(inventory_set)
    return serialize_set(inventory_set)


@router.put("/sets/{set_id}", response_model=InventorySetResponse)
def update_set(
    set_id: int,
    payload: InventorySetUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
    db: Session = Depends(get_db),
):
    inventory_set = db.query(InventorySet).filter(
        InventorySet.id == set_id,
        InventorySet.school_id == school_id,
    ).first()
    if not inventory_set:
        raise HTTPException(status_code=404, detail="Set not found")

    updates = payload.model_dump(exclude_unset=True)
    next_subject_id = updates.get("subject_id", inventory_set.subject_id)
    next_name = updates.get("name", inventory_set.name)
    if next_name:
        next_name = next_name.strip()

    if "subject_id" in updates:
        subject = db.query(InventorySubject).filter(
            InventorySubject.id == next_subject_id,
            InventorySubject.school_id == school_id,
        ).first()
        if not subject:
            raise HTTPException(status_code=404, detail="Subject not found")

    duplicate = db.query(InventorySet).filter(
        InventorySet.school_id == school_id,
        InventorySet.subject_id == next_subject_id,
        InventorySet.id != set_id,
        InventorySet.name.ilike(next_name),
    ).first()
    if duplicate:
        raise HTTPException(status_code=400, detail="Another set with this name already exists for the selected subject")

    inventory_set.subject_id = next_subject_id
    inventory_set.name = next_name
    if "is_active" in updates:
        inventory_set.is_active = updates["is_active"]

    linked_materials = db.query(MaterialItem).filter(MaterialItem.set_id == set_id).all()
    for item in linked_materials:
        item.subject_id = inventory_set.subject_id
        item.subject = inventory_set.subject.name if inventory_set.subject else item.subject
        item.set_name = inventory_set.name

    db.commit()
    db.refresh(inventory_set)
    return serialize_set(inventory_set)


@router.delete("/sets/{set_id}")
def delete_set(
    set_id: int,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
    db: Session = Depends(get_db),
):
    inventory_set = db.query(InventorySet).filter(
        InventorySet.id == set_id,
        InventorySet.school_id == school_id,
    ).first()
    if not inventory_set:
        raise HTTPException(status_code=404, detail="Set not found")

    linked_volumes = db.query(InventoryVolume).filter(
        InventoryVolume.set_id == set_id,
        InventoryVolume.school_id == school_id,
    ).all()
    linked_volume_ids = [volume.id for volume in linked_volumes]

    material_filters = [MaterialItem.set_id == set_id]
    if linked_volume_ids:
        material_filters.append(MaterialItem.volume_id.in_(linked_volume_ids))

    linked_materials = db.query(MaterialItem).filter(
        MaterialItem.school_id == school_id,
        or_(*material_filters),
    ).all()
    for item in linked_materials:
        item.set_id = None
        item.set_name = None
        item.volume_id = None
        item.volume_name = None
        item.volume_number = None
        item.set_part_name = None

    for volume in linked_volumes:
        db.delete(volume)

    db.delete(inventory_set)
    db.commit()
    return {"message": "Set deleted successfully"}


@router.get("/volumes", response_model=List[InventoryVolumeResponse])
def list_volumes(
    school_id: str = Depends(resolve_school_id_from_actor),
    subject_id: Optional[int] = Query(default=None),
    set_id: Optional[int] = Query(default=None),
    is_active: Optional[bool] = Query(default=None),
    db: Session = Depends(get_db),
):
    ensure_school_context(db, school_id)
    bootstrap_inventory_hierarchy(db, school_id)
    query = db.query(InventoryVolume).join(InventorySet).filter(InventoryVolume.school_id == school_id)
    if subject_id:
        query = query.filter(InventorySet.subject_id == subject_id)
    if set_id:
        query = query.filter(InventoryVolume.set_id == set_id)
    if is_active is not None:
        query = query.filter(InventoryVolume.is_active == is_active)
    return [serialize_volume(item) for item in query.order_by(InventoryVolume.volume_number.asc(), InventoryVolume.name.asc()).all()]


@router.post("/volumes", response_model=InventoryVolumeResponse)
def create_volume(
    payload: InventoryVolumeCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
    db: Session = Depends(get_db),
):
    ensure_school_context(db, school_id)
    inventory_set = db.query(InventorySet).filter(
        InventorySet.id == payload.set_id,
        InventorySet.school_id == school_id,
    ).first()
    if not inventory_set:
        raise HTTPException(status_code=404, detail="Set not found")

    existing = db.query(InventoryVolume).filter(
        InventoryVolume.school_id == school_id,
        InventoryVolume.set_id == payload.set_id,
        InventoryVolume.volume_number == payload.volume_number,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Volume number already exists for this set")

    volume = InventoryVolume(
        set_id=payload.set_id,
        name=payload.name.strip(),
        volume_number=payload.volume_number,
        school_id=school_id,
        is_active=payload.is_active,
    )
    db.add(volume)
    db.commit()
    db.refresh(volume)
    return serialize_volume(volume)


@router.put("/volumes/{volume_id}", response_model=InventoryVolumeResponse)
def update_volume(
    volume_id: int,
    payload: InventoryVolumeUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
    db: Session = Depends(get_db),
):
    volume = db.query(InventoryVolume).filter(
        InventoryVolume.id == volume_id,
        InventoryVolume.school_id == school_id,
    ).first()
    if not volume:
        raise HTTPException(status_code=404, detail="Volume not found")

    updates = payload.model_dump(exclude_unset=True)
    next_set_id = updates.get("set_id", volume.set_id)
    next_volume_number = updates.get("volume_number", volume.volume_number)
    next_name = (updates.get("name", volume.name) or "").strip()

    if "set_id" in updates:
        inventory_set = db.query(InventorySet).filter(
            InventorySet.id == next_set_id,
            InventorySet.school_id == school_id,
        ).first()
        if not inventory_set:
            raise HTTPException(status_code=404, detail="Set not found")

    duplicate = db.query(InventoryVolume).filter(
        InventoryVolume.school_id == school_id,
        InventoryVolume.set_id == next_set_id,
        InventoryVolume.volume_number == next_volume_number,
        InventoryVolume.id != volume_id,
    ).first()
    if duplicate:
        raise HTTPException(status_code=400, detail="Another volume with this number already exists for the selected set")

    volume.set_id = next_set_id
    volume.name = next_name
    volume.volume_number = next_volume_number
    if "is_active" in updates:
        volume.is_active = updates["is_active"]

    linked_materials = db.query(MaterialItem).filter(MaterialItem.volume_id == volume_id).all()
    for item in linked_materials:
        item.volume_name = volume.name
        item.volume_number = volume.volume_number
        item.set_id = volume.set_id
        item.set_name = volume.inventory_set.name if volume.inventory_set else item.set_name
        if volume.inventory_set and volume.inventory_set.subject:
            item.subject_id = volume.inventory_set.subject.id
            item.subject = volume.inventory_set.subject.name
        item.set_part_name = f"Volume {volume.volume_number} - {volume.name}"

    db.commit()
    db.refresh(volume)
    return serialize_volume(volume)


@router.delete("/volumes/{volume_id}")
def delete_volume(
    volume_id: int,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
    db: Session = Depends(get_db),
):
    volume = db.query(InventoryVolume).filter(
        InventoryVolume.id == volume_id,
        InventoryVolume.school_id == school_id,
    ).first()
    if not volume:
        raise HTTPException(status_code=404, detail="Volume not found")

    linked_materials = db.query(MaterialItem).filter(
        MaterialItem.volume_id == volume_id,
        MaterialItem.school_id == school_id,
    ).all()
    for item in linked_materials:
        item.volume_id = None
        item.volume_name = None
        item.volume_number = None
        item.set_part_name = None

    db.delete(volume)
    db.commit()
    return {"message": "Volume deleted successfully"}


@router.get("/catalog", response_model=List[InventoryCatalogSubject])
def get_inventory_catalog(
    school_id: str = Depends(resolve_school_id_from_actor),
    include_inactive: bool = Query(default=True),
    db: Session = Depends(get_db),
):
    ensure_school_context(db, school_id)
    bootstrap_inventory_hierarchy(db, school_id)
    subjects_query = db.query(InventorySubject).filter(InventorySubject.school_id == school_id)
    if not include_inactive:
        subjects_query = subjects_query.filter(InventorySubject.is_active == True)  # noqa: E712
    subjects = subjects_query.order_by(InventorySubject.name.asc()).all()

    items = db.query(MaterialItem).filter(MaterialItem.school_id == school_id).all()
    material_map: Dict[int, List[MaterialResponse]] = {}
    for item in items:
        if item.volume_id is None:
            continue
        material_map.setdefault(item.volume_id, []).append(serialize_material(item))

    payload: List[InventoryCatalogSubject] = []
    for subject in subjects:
        set_nodes: List[InventoryCatalogSet] = []
        subject_sets = sorted(subject.sets, key=lambda item: item.name.lower())
        for inventory_set in subject_sets:
            if not include_inactive and not inventory_set.is_active:
                continue
            volume_nodes: List[InventoryCatalogVolume] = []
            ordered_volumes = sorted(inventory_set.volumes, key=lambda item: (item.volume_number, item.name.lower()))
            for volume in ordered_volumes:
                if not include_inactive and not volume.is_active:
                    continue
                volume_nodes.append(
                    InventoryCatalogVolume(
                        id=volume.id,
                        name=volume.name,
                        volume_number=volume.volume_number,
                        is_active=volume.is_active,
                        materials=sorted(material_map.get(volume.id, []), key=lambda item: item.name.lower()),
                    )
                )
            set_nodes.append(
                InventoryCatalogSet(
                    id=inventory_set.id,
                    name=inventory_set.name,
                    is_active=inventory_set.is_active,
                    volumes=volume_nodes,
                )
            )
        payload.append(
            InventoryCatalogSubject(
                id=subject.id,
                name=subject.name,
                is_active=subject.is_active,
                sets=set_nodes,
            )
        )
    return payload


@router.get("/materials", response_model=List[MaterialResponse])
def list_materials(
    school_id: str = Depends(resolve_school_id_from_actor),
    search: Optional[str] = Query(default=None),
    subject: Optional[str] = Query(default=None),
    batch_name: Optional[str] = Query(default=None),
    is_active: Optional[bool] = Query(default=None),
    db: Session = Depends(get_db),
):
    ensure_school_context(db, school_id)
    sync_inventory_totals(db, school_id)
    bootstrap_inventory_hierarchy(db, school_id)
    query = db.query(MaterialItem).filter(MaterialItem.school_id == school_id)
    if search:
        pattern = f"%{search.strip()}%"
        query = query.filter(
            or_(
                MaterialItem.name.ilike(pattern),
                MaterialItem.subject.ilike(pattern),
                MaterialItem.set_name.ilike(pattern),
                MaterialItem.volume_name.ilike(pattern),
                MaterialItem.set_part_name.ilike(pattern),
                MaterialItem.class_name.ilike(pattern),
                MaterialItem.batch_names.ilike(pattern),
            )
        )
    if subject:
        query = query.filter(MaterialItem.subject.ilike(subject.strip()))
    if batch_name:
        pattern = f"%{batch_name.strip()}%"
        query = query.filter(or_(MaterialItem.batch_names.ilike(pattern), MaterialItem.class_name.ilike(pattern)))
    if is_active is not None:
        query = query.filter(MaterialItem.is_active == is_active)
    return [serialize_material(item) for item in query.order_by(MaterialItem.name.asc()).all()]


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
    db: Session = Depends(get_db),
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
        for category in categories_by_parent.get(str(parent_id or ""), []):
            if str(category.get("name") or "").strip().lower() == normalized:
                return category
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

    for row in rows:
        try:
            subject, inventory_set, volume = get_or_create_hierarchy(row)
            signature = (
                str(row["material_name"]).strip().lower(),
                str(subject["id"]),
                str(inventory_set["id"]),
                str(volume["id"]) if volume else "",
            )

            material = materials_by_signature.get(signature)
            normalized_unit_type = normalize_supabase_inventory_unit_type(row.get("unit_type"))
            metadata = {
                "subject_category_id": subject["id"],
                "set_category_id": inventory_set["id"],
                "volume_category_id": volume["id"] if volume else None,
                "batch_names": normalize_batch_names(row.get("batch_names")),
                "original_unit_type": normalize_material_unit_type(row.get("unit_type")),
                "source": "inventory_material_import",
            }

            if material:
                supabase.schema("inventory").table("material_items").update({
                    "category_id": volume["id"] if volume else inventory_set["id"],
                    "name": str(row["material_name"]).strip(),
                    "unit_type": normalized_unit_type,
                    "class_name": ", ".join(normalize_batch_names(row.get("batch_names"))) or None,
                    "description": row.get("description") or None,
                    "low_stock_threshold": int(row.get("low_stock_threshold", 10) or 10),
                    "metadata": metadata,
                    "is_active": bool(row.get("is_active", True)),
                }).eq("id", material["id"]).eq("school_id", school_id).execute()
                updated_count += 1
            else:
                insert_rows(
                    supabase,
                    "material_items",
                    [{
                        "school_id": school_id,
                        "category_id": volume["id"] if volume else inventory_set["id"],
                        "item_code": build_inventory_code("MAT", row["subject_name"], row["set_name"], row["material_name"]),
                        "name": str(row["material_name"]).strip(),
                        "unit_type": normalized_unit_type,
                        "class_name": ", ".join(normalize_batch_names(row.get("batch_names"))) or None,
                        "description": row.get("description") or None,
                        "low_stock_threshold": int(row.get("low_stock_threshold", 10) or 10),
                        "current_stock": 0,
                        "unit_price": float(row.get("price", 0.0) or 0.0),
                        "metadata": metadata,
                        "is_active": bool(row.get("is_active", True)),
                    }],
                    schema="inventory",
                )
                material = fetch_all(
                    supabase,
                    "material_items",
                    select="id,category_id,name,metadata,current_stock",
                    filters={"school_id": school_id, "name": str(row["material_name"]).strip()},
                    schema="inventory",
                )[-1]
                materials.append(material)
                materials_by_signature[signature] = material
                imported_count += 1

            touched_material_ids.add(str(material["id"]))

            supplier_name = str(row.get("supplier_name") or "").strip()
            opening_stock = int(row.get("opening_stock", 0) or 0)
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

                entry_date = normalize_import_date(row.get("stock_in_date"))
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
                            "unit_price": float(row.get("price", 0.0) or 0.0),
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
                "material_name": row.get("material_name", ""),
                "error": str(exc),
            })

    stock_in_totals: Dict[str, int] = {}
    stock_out_totals: Dict[str, int] = {}
    issue_totals: Dict[str, int] = {}
    for entry in stock_in_entries:
        material_id = str(entry.get("material_item_id") or "")
        stock_in_totals[material_id] = stock_in_totals.get(material_id, 0) + int(entry.get("quantity_received") or 0)
    for entry in stock_out_entries:
        material_id = str(entry.get("material_item_id") or "")
        stock_out_totals[material_id] = stock_out_totals.get(material_id, 0) + int(entry.get("quantity_issued") or 0)
    for entry in student_issue_entries:
        material_id = str(entry.get("material_item_id") or "")
        issue_totals[material_id] = issue_totals.get(material_id, 0) + int(entry.get("quantity_issued") or 0)

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
    db: Session = Depends(get_db),
):
    ensure_school_context(db, school_id)
    existing = db.query(MaterialItem).filter(
        MaterialItem.school_id == school_id,
        MaterialItem.name.ilike(payload.name.strip()),
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Material already exists")

    material = MaterialItem(
        name=payload.name.strip(),
        description=payload.description,
        unit_type=payload.unit_type,
        price=payload.price,
        low_stock_threshold=payload.low_stock_threshold,
        school_id=school_id,
        is_active=payload.is_active,
    )
    subject, inventory_set, volume = sync_material_hierarchy_fields(
        db,
        school_id,
        payload.subject_id,
        payload.set_id,
        payload.volume_id,
    )
    material.subject_id = subject.id if subject else None
    material.subject = subject.name if subject else ((payload.subject or "").strip() or None)
    material.set_id = inventory_set.id if inventory_set else None
    material.set_name = inventory_set.name if inventory_set else ((payload.set_name or "").strip() or None)
    material.volume_id = volume.id if volume else None
    material.volume_name = volume.name if volume else ((payload.volume_name or "").strip() or None)
    material.volume_number = volume.volume_number if volume else payload.volume_number
    material.set_part_name = (
        f"Volume {material.volume_number} - {material.volume_name}"
        if material.volume_name and material.volume_number
        else ((payload.set_part_name or "").strip() or None)
    )
    write_material_batches(material, payload.batch_names)
    db.add(material)
    db.commit()
    db.refresh(material)
    return serialize_material(material)


@router.put("/materials/{material_id}", response_model=MaterialResponse)
def update_material(
    material_id: int,
    payload: MaterialUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
    db: Session = Depends(get_db),
):
    material = db.query(MaterialItem).filter(MaterialItem.id == material_id, MaterialItem.school_id == school_id).first()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    updates = payload.model_dump(exclude_unset=True)
    if "name" in updates and updates["name"]:
        duplicate = db.query(MaterialItem).filter(
            MaterialItem.school_id == school_id,
            MaterialItem.id != material_id,
            MaterialItem.name.ilike(updates["name"].strip()),
        ).first()
        if duplicate:
            raise HTTPException(status_code=400, detail="Another material with this name already exists")
        updates["name"] = updates["name"].strip()
    if "set_name" in updates:
        updates["set_name"] = (updates["set_name"] or "").strip() or None
    if "volume_name" in updates:
        updates["volume_name"] = (updates["volume_name"] or "").strip() or None
    if "set_part_name" in updates:
        updates["set_part_name"] = (updates["set_part_name"] or "").strip() or None

    if "batch_names" in updates:
        write_material_batches(material, updates.pop("batch_names"))

    hierarchy_fields = {"subject_id", "set_id", "volume_id", "subject", "set_name", "volume_name", "volume_number", "set_part_name"}
    if hierarchy_fields.intersection(updates.keys()):
        subject, inventory_set, volume = sync_material_hierarchy_fields(
            db,
            school_id,
            updates.get("subject_id", material.subject_id),
            updates.get("set_id", material.set_id),
            updates.get("volume_id", material.volume_id),
        )
        updates["subject_id"] = subject.id if subject else updates.get("subject_id")
        updates["subject"] = subject.name if subject else updates.get("subject")
        updates["set_id"] = inventory_set.id if inventory_set else updates.get("set_id")
        updates["set_name"] = inventory_set.name if inventory_set else updates.get("set_name")
        updates["volume_id"] = volume.id if volume else updates.get("volume_id")
        updates["volume_name"] = volume.name if volume else updates.get("volume_name")
        updates["volume_number"] = volume.volume_number if volume else updates.get("volume_number")
        updates["set_part_name"] = (
            f"Volume {updates['volume_number']} - {updates['volume_name']}"
            if updates.get("volume_name") and updates.get("volume_number")
            else updates.get("set_part_name")
        )
        if "volume_id" in updates and not updates.get("volume_id"):
            updates["volume_id"] = None
            updates["volume_name"] = None
            updates["volume_number"] = None
            updates["set_part_name"] = None

    for field, value in updates.items():
        setattr(material, field, value)

    db.commit()
    db.refresh(material)
    return serialize_material(material)


@router.delete("/materials/{material_id}")
def delete_material(
    material_id: int,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
    db: Session = Depends(get_db),
):
    material = db.query(MaterialItem).filter(MaterialItem.id == material_id, MaterialItem.school_id == school_id).first()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    if db.query(StockInEntry).filter(StockInEntry.material_id == material_id).count() > 0 or db.query(StockOutEntry).filter(
        StockOutEntry.material_id == material_id
    ).count() > 0:
        raise HTTPException(status_code=400, detail="Material cannot be deleted because stock history exists")

    db.delete(material)
    db.commit()
    return {"message": "Material deleted successfully"}


@router.get("/stock-in", response_model=List[StockInResponse])
def list_stock_in(
    school_id: str = Depends(resolve_school_id_from_actor),
    supplier_id: Optional[int] = Query(default=None),
    material_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
):
    query = db.query(StockInEntry).filter(StockInEntry.school_id == school_id)
    if supplier_id:
        query = query.filter(StockInEntry.supplier_id == supplier_id)
    if material_id:
        query = query.filter(StockInEntry.material_id == material_id)
    return [serialize_stock_in(entry) for entry in query.order_by(StockInEntry.date.desc(), StockInEntry.id.desc()).all()]


@router.post("/stock-in", response_model=StockInResponse)
def create_stock_in(
    payload: StockInCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
    db: Session = Depends(get_db),
):
    ensure_school_context(db, school_id)
    supplier = db.query(Supplier).filter(Supplier.id == payload.supplier_id, Supplier.school_id == school_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    material = db.query(MaterialItem).filter(MaterialItem.id == payload.material_id, MaterialItem.school_id == school_id).first()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    entry = StockInEntry(
        date=payload.date,
        supplier_id=payload.supplier_id,
        material_id=payload.material_id,
        quantity_received=payload.quantity_received,
        entry_type=payload.entry_type,
        added_by=(payload.added_by or actor["name"]).strip(),
        notes=payload.notes,
        school_id=school_id,
    )
    db.add(entry)
    db.flush()
    recalculate_material_stock(db, material)
    db.commit()
    db.refresh(entry)
    return serialize_stock_in(entry)


@router.delete("/stock-in/{entry_id}")
def delete_stock_in(
    entry_id: int,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
    db: Session = Depends(get_db),
):
    entry = db.query(StockInEntry).filter(StockInEntry.id == entry_id, StockInEntry.school_id == school_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Stock-in entry not found")

    material = db.query(MaterialItem).filter(MaterialItem.id == entry.material_id, MaterialItem.school_id == school_id).first()
    if material and material.current_stock < entry.quantity_received:
        raise HTTPException(
            status_code=400,
            detail="This stock-in entry cannot be deleted because later distributions depend on it",
        )

    db.delete(entry)
    db.flush()
    if material:
        recalculate_material_stock(db, material)
    db.commit()
    return {"message": "Stock-in entry deleted successfully"}


@router.get("/stock-out", response_model=List[StockOutResponse])
def list_stock_out(
    school_id: str = Depends(resolve_school_id_from_actor),
    batch_id: Optional[int] = Query(default=None),
    material_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
):
    query = db.query(StockOutEntry).filter(StockOutEntry.school_id == school_id)
    if batch_id:
        query = query.filter(StockOutEntry.batch_id == batch_id)
    if material_id:
        query = query.filter(StockOutEntry.material_id == material_id)
    return [serialize_stock_out(entry) for entry in query.order_by(StockOutEntry.date.desc(), StockOutEntry.id.desc()).all()]


@router.get("/student-issues", response_model=List[StudentIssueResponse])
def list_student_issues(
    school_id: str = Depends(resolve_school_id_from_actor),
    batch_id: Optional[int] = Query(default=None),
    student_id: Optional[int] = Query(default=None),
    material_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
):
    query = db.query(StudentIssueEntry).filter(StudentIssueEntry.school_id == school_id)
    if batch_id:
        query = query.filter(StudentIssueEntry.batch_id == batch_id)
    if student_id:
        query = query.filter(StudentIssueEntry.student_id == student_id)
    if material_id:
        query = query.filter(StudentIssueEntry.material_id == material_id)
    return [serialize_student_issue(entry) for entry in query.order_by(StudentIssueEntry.date.desc(), StudentIssueEntry.id.desc()).all()]


@router.post("/stock-out", response_model=StockOutResponse)
def create_stock_out(
    payload: StockOutCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
    db: Session = Depends(get_db),
):
    ensure_school_context(db, school_id)
    material = db.query(MaterialItem).filter(MaterialItem.id == payload.material_id, MaterialItem.school_id == school_id).first()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    selected_batches: List[BatchTable] = []
    if payload.batch_ids:
        selected_batches = (
            db.query(BatchTable)
            .filter(BatchTable.school_id == school_id, BatchTable.id.in_(payload.batch_ids))
            .order_by(BatchTable.name.asc())
            .all()
        )
        if len(selected_batches) != len(set(payload.batch_ids)):
            raise HTTPException(status_code=404, detail="One or more selected batches were not found")
    else:
        batch = None
        if payload.batch_id:
            batch = db.query(BatchTable).filter(BatchTable.id == payload.batch_id, BatchTable.school_id == school_id).first()
        else:
            batch = db.query(BatchTable).filter(
                BatchTable.school_id == school_id,
                BatchTable.name.ilike(payload.batch_name.strip()),
            ).first()
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found")
        selected_batches = [batch]

    total_required = payload.quantity_issued * len(selected_batches)
    if material.current_stock < total_required:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot issue {payload.quantity_issued} item(s) each to {len(selected_batches)} batch(es). Only {material.current_stock} in stock.",
        )

    created_entries: List[StockOutEntry] = []
    for batch in selected_batches:
        entry = StockOutEntry(
            date=payload.date,
            batch_id=batch.id,
            batch_name=batch.name,
            material_id=payload.material_id,
            quantity_issued=payload.quantity_issued,
            issued_by=(payload.issued_by or actor["name"]).strip(),
            remarks=payload.remarks,
            school_id=school_id,
        )
        db.add(entry)
        created_entries.append(entry)
    db.flush()
    recalculate_material_stock(db, material)
    db.commit()
    db.refresh(created_entries[0])
    return serialize_stock_out(created_entries[0])


@router.post("/student-issues", response_model=StudentIssueResponse)
def create_student_issues(
    payload: StudentIssueCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
    db: Session = Depends(get_db),
):
    ensure_school_context(db, school_id)
    material = db.query(MaterialItem).filter(MaterialItem.id == payload.material_id, MaterialItem.school_id == school_id).first()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    if not payload.student_ids:
        raise HTTPException(status_code=400, detail="Please select at least one student")

    students = (
        db.query(Student)
        .filter(Student.school_id == school_id, Student.id.in_(payload.student_ids))
        .order_by(Student.name.asc())
        .all()
    )
    if len(students) != len(set(payload.student_ids)):
        raise HTTPException(status_code=404, detail="One or more selected students were not found")

    batch_names = {((student.batch or "").strip() or "Unassigned Batch") for student in students}
    if len(batch_names) > 1:
        raise HTTPException(status_code=400, detail="Selected students must belong to the same batch")

    selected_batch = None
    batch_name = next(iter(batch_names))
    if payload.batch_id:
        selected_batch = db.query(BatchTable).filter(BatchTable.id == payload.batch_id, BatchTable.school_id == school_id).first()
        if not selected_batch:
            raise HTTPException(status_code=404, detail="Batch not found")
        if selected_batch.name != batch_name:
            raise HTTPException(status_code=400, detail="Selected students do not belong to the chosen batch")
    else:
        selected_batch = db.query(BatchTable).filter(BatchTable.school_id == school_id, BatchTable.name.ilike(batch_name)).first()

    total_required = payload.quantity_issued * len(students)
    if material.current_stock < total_required:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot issue {payload.quantity_issued} item(s) each to {len(students)} student(s). Only {material.current_stock} in stock.",
        )

    created_entries: List[StudentIssueEntry] = []
    for student in students:
        entry = StudentIssueEntry(
            date=payload.date,
            batch_id=selected_batch.id if selected_batch else student.batch_id,
            batch_name=batch_name,
            student_id=student.id,
            student_name=student.name,
            material_id=payload.material_id,
            quantity_issued=payload.quantity_issued,
            issued_by=(payload.issued_by or actor["name"]).strip(),
            remarks=payload.remarks,
            school_id=school_id,
        )
        db.add(entry)
        created_entries.append(entry)
    db.flush()
    recalculate_material_stock(db, material)
    db.commit()
    db.refresh(created_entries[0])
    return serialize_student_issue(created_entries[0])


@router.delete("/stock-out/{entry_id}")
def delete_stock_out(
    entry_id: int,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
    db: Session = Depends(get_db),
):
    entry = db.query(StockOutEntry).filter(StockOutEntry.id == entry_id, StockOutEntry.school_id == school_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Stock-out entry not found")

    material = db.query(MaterialItem).filter(MaterialItem.id == entry.material_id, MaterialItem.school_id == school_id).first()
    db.delete(entry)
    db.flush()
    if material:
        recalculate_material_stock(db, material)
    db.commit()
    return {"message": "Stock-out entry deleted successfully"}


@router.delete("/student-issues/{entry_id}")
def delete_student_issue(
    entry_id: int,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: Dict[str, str] = Depends(require_inventory_write),
    db: Session = Depends(get_db),
):
    entry = db.query(StudentIssueEntry).filter(StudentIssueEntry.id == entry_id, StudentIssueEntry.school_id == school_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Student issue entry not found")

    material = db.query(MaterialItem).filter(MaterialItem.id == entry.material_id, MaterialItem.school_id == school_id).first()
    db.delete(entry)
    db.flush()
    if material:
        recalculate_material_stock(db, material)
    db.commit()
    return {"message": "Student issue entry deleted successfully"}


@router.get("/dashboard", response_model=InventoryDashboardResponse)
def get_inventory_dashboard(
    school_id: str = Depends(resolve_school_id_from_actor),
    db: Session = Depends(get_db),
):
    ensure_school_context(db, school_id)
    sync_inventory_totals(db, school_id)
    materials = db.query(MaterialItem).filter(MaterialItem.school_id == school_id).all()
    total_in = db.query(func.coalesce(func.sum(StockInEntry.quantity_received), 0)).filter(StockInEntry.school_id == school_id).scalar() or 0
    batch_total_out = db.query(func.coalesce(func.sum(StockOutEntry.quantity_issued), 0)).filter(StockOutEntry.school_id == school_id).scalar() or 0
    student_total_out = db.query(func.coalesce(func.sum(StudentIssueEntry.quantity_issued), 0)).filter(StudentIssueEntry.school_id == school_id).scalar() or 0
    total_out = int(batch_total_out) + int(student_total_out)
    low_stock_items = [
        item for item in materials if item.is_active and item.current_stock <= item.low_stock_threshold
    ]
    return InventoryDashboardResponse(
        total_materials_registered=len(materials),
        total_books_in_inventory=int(total_in),
        total_books_distributed=int(total_out),
        current_stock_available=sum(item.current_stock for item in materials),
        low_stock_alert_count=len(low_stock_items),
        low_stock_items=[serialize_material(item) for item in low_stock_items],
    )


@router.get("/history/material/{material_id}", response_model=List[InventoryHistoryEntry])
def get_material_history(
    material_id: int,
    school_id: str = Depends(resolve_school_id_from_actor),
    db: Session = Depends(get_db),
):
    material = db.query(MaterialItem).filter(MaterialItem.id == material_id, MaterialItem.school_id == school_id).first()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    history: List[InventoryHistoryEntry] = []
    stock_in_entries = db.query(StockInEntry).filter(
        StockInEntry.material_id == material.id,
        StockInEntry.school_id == school_id,
    ).all()
    for entry in stock_in_entries:
        history.append(
            InventoryHistoryEntry(
                entry_id=entry.id,
                entry_kind="stock_in",
                date=entry.date,
                material_id=material.id,
                material_name=material.name,
                quantity=entry.quantity_received,
                counterparty=entry.supplier.name if entry.supplier else "",
                performed_by=entry.added_by,
                notes=entry.notes,
            )
        )
    stock_out_entries = db.query(StockOutEntry).filter(
        StockOutEntry.material_id == material.id,
        StockOutEntry.school_id == school_id,
    ).all()
    for entry in stock_out_entries:
        history.append(
            InventoryHistoryEntry(
                entry_id=entry.id,
                entry_kind="stock_out",
                date=entry.date,
                material_id=material.id,
                material_name=material.name,
                quantity=entry.quantity_issued,
                counterparty=entry.batch_name,
                performed_by=entry.issued_by,
                notes=entry.remarks,
            )
        )
    student_issue_entries = db.query(StudentIssueEntry).filter(
        StudentIssueEntry.material_id == material.id,
        StudentIssueEntry.school_id == school_id,
    ).all()
    for entry in student_issue_entries:
        history.append(
            InventoryHistoryEntry(
                entry_id=entry.id,
                entry_kind="student_issue",
                date=entry.date,
                material_id=material.id,
                material_name=material.name,
                quantity=entry.quantity_issued,
                counterparty=f"{entry.student_name} ({entry.batch_name or 'No Batch'})",
                performed_by=entry.issued_by,
                notes=entry.remarks,
            )
        )
    history.sort(key=lambda item: item.date or datetime.min, reverse=True)
    return history


@router.get("/reports/data", response_model=InventoryReportResponse)
def get_inventory_report(
    report_type: str = Query(...),
    school_id: str = Depends(resolve_school_id_from_actor),
    date_from: Optional[datetime] = Query(default=None),
    date_to: Optional[datetime] = Query(default=None),
    supplier_id: Optional[int] = Query(default=None),
    batch_id: Optional[int] = Query(default=None),
    material_id: Optional[int] = Query(default=None),
    student_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
):
    rows = get_inventory_report_rows(db, school_id, report_type, date_from, date_to, supplier_id, batch_id, material_id, student_id)
    return InventoryReportResponse(
        report_type=report_type,
        generated_at=datetime.now(),
        rows=[InventoryReportRow(values=row) for row in rows],
        total_records=len(rows),
    )


@router.get("/reports/export")
def export_inventory_report(
    report_type: str = Query(...),
    export_format: str = Query(..., pattern="^(excel|pdf)$"),
    school_id: str = Depends(resolve_school_id_from_actor),
    date_from: Optional[datetime] = Query(default=None),
    date_to: Optional[datetime] = Query(default=None),
    supplier_id: Optional[int] = Query(default=None),
    batch_id: Optional[int] = Query(default=None),
    material_id: Optional[int] = Query(default=None),
    student_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
):
    rows = get_inventory_report_rows(db, school_id, report_type, date_from, date_to, supplier_id, batch_id, material_id, student_id)

    if export_format == "excel":
        buffer = build_excel_report(report_type, rows)
        return StreamingResponse(
            buffer,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{report_type}.xlsx"'},
        )

    buffer = build_pdf_report(report_type, rows)
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{report_type}.pdf"'},
    )
