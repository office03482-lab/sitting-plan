"""Hostel management routes using Supabase-native backend."""
from __future__ import annotations
import csv
from datetime import datetime
from io import BytesIO, StringIO
import logging
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from app.middleware.auth import get_authenticated_actor_context
from app.services.supabase_context import resolve_school_id_from_actor
from app.services.supabase_hostels import (
    get_hostel as supabase_get_hostel,
    list_hostel_rooms as supabase_list_hostel_rooms,
    list_hostels as supabase_list_hostels,
    create_hostel as supabase_create_hostel,
    update_hostel as supabase_update_hostel,
    delete_hostel as supabase_delete_hostel,
    add_room as supabase_add_room,
    update_room as supabase_update_room,
    delete_room as supabase_delete_room,
    get_occupancy_report_data as supabase_get_occupancy_report_data,
    get_allocation_report_data as supabase_get_allocation_report_data,
    get_vacancy_report_data as supabase_get_vacancy_report_data,
)
from app.schemas import HostelCreate, HostelReportResponse, HostelReportRow, HostelResponse, HostelUpdate, HostelRoomCreate, HostelRoomResponse, HostelRoomUpdate

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/hostels", tags=["Hostels"])


@router.get("", response_model=list[HostelResponse])
async def list_hostels(
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
):
    try:
        hostels = supabase_list_hostels(school_id)
        logger.info(
            f"Action completed - User ID: {actor.get('user_id')}, "
            f"School ID: {school_id}, Returned row count: {len(hostels)}"
        )
        return hostels
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load hostels: {exc}") from exc


@router.get("/{hostel_id}", response_model=HostelResponse)
async def get_hostel(
    hostel_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
):
    try:
        hostel = supabase_get_hostel(school_id, hostel_id)
        logger.info(
            f"Action completed - User ID: {actor.get('user_id')}, "
            f"School ID: {school_id}, Hostel ID: {hostel_id}"
        )
        return hostel
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to get hostel: {exc}") from exc


@router.get("/{hostel_id}/rooms", response_model=list[HostelRoomResponse])
async def list_hostel_rooms(
    hostel_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
):
    try:
        rooms = supabase_list_hostel_rooms(school_id, hostel_id)
        logger.info(
            f"Action completed - User ID: {actor.get('user_id')}, "
            f"School ID: {school_id}, Hostel ID: {hostel_id}, Returned row count: {len(rooms)}"
        )
        return rooms
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to list hostel rooms: {exc}") from exc


@router.post("", response_model=HostelResponse)
async def create_hostel(
    payload: HostelCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
):
    try:
        hostel = supabase_create_hostel(school_id, payload.model_dump())
        logger.info(
            f"Action completed - User ID: {actor.get('user_id')}, "
            f"School ID: {school_id}, Returned row count: 1"
        )
        return hostel
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to create hostel: {exc}") from exc


@router.put("/{hostel_id}", response_model=HostelResponse)
async def update_hostel(
    hostel_id: str,
    payload: HostelUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
):
    try:
        hostel = supabase_update_hostel(school_id, hostel_id, payload.model_dump(exclude_unset=True))
        logger.info(
            f"Action completed - User ID: {actor.get('user_id')}, "
            f"School ID: {school_id}, Returned row count: 1"
        )
        return hostel
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to update hostel: {exc}") from exc


@router.delete("/{hostel_id}")
async def delete_hostel(
    hostel_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
):
    try:
        result = supabase_delete_hostel(school_id, hostel_id)
        logger.info(
            f"Action completed - User ID: {actor.get('user_id')}, "
            f"School ID: {school_id}, Returned row count: 1"
        )
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to delete hostel: {exc}") from exc


@router.post("/{hostel_id}/rooms", response_model=HostelRoomResponse)
async def add_hostel_room(
    hostel_id: str,
    payload: HostelRoomCreate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
):
    try:
        room = supabase_add_room(school_id, hostel_id, payload.model_dump())
        logger.info(
            f"Action completed - User ID: {actor.get('user_id')}, "
            f"School ID: {school_id}, Returned row count: 1"
        )
        return room
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to add room: {exc}") from exc


@router.put("/{hostel_id}/rooms/{room_id}", response_model=HostelRoomResponse)
async def update_hostel_room(
    hostel_id: str,
    room_id: str,
    payload: HostelRoomUpdate,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
):
    try:
        room = supabase_update_room(school_id, hostel_id, room_id, payload.model_dump(exclude_unset=True))
        logger.info(
            f"Action completed - User ID: {actor.get('user_id')}, "
            f"School ID: {school_id}, Hostel ID: {hostel_id}, Room ID: {room_id}"
        )
        return room
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to update room: {exc}") from exc


@router.delete("/{hostel_id}/rooms/{room_id}")
async def delete_hostel_room(
    hostel_id: str,
    room_id: str,
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
):
    try:
        result = supabase_delete_room(school_id, hostel_id, room_id)
        logger.info(
            f"Action completed - User ID: {actor.get('user_id')}, "
            f"School ID: {school_id}, Hostel ID: {hostel_id}, Room ID: {room_id}"
        )
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to delete room: {exc}") from exc


# ==================== Report Builders ====================


def _build_hostel_excel(rows: list[dict[str, Any]], sheet_name: str) -> BytesIO:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = sheet_name[:31]
    if rows:
        headers = list(rows[0].keys())
        sheet.append(headers)
        for row in rows:
            sheet.append([row.get(header, "") for header in headers])
    else:
        sheet.append(["message"])
        sheet.append(["No records found"])
    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return buffer


def _build_hostel_csv(rows: list[dict[str, Any]]) -> BytesIO:
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


def _build_hostel_pdf(report_type: str, rows: list[dict[str, Any]]) -> BytesIO:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.units import inch
    from reportlab.platypus import Paragraph, Table, TableStyle
    from app.utils.pdf_base import (
        ReportPdfBuilder,
        build_shared_styles,
        NAVY, SLATE_700, SLATE_500, SLATE_300, SLATE_200, SLATE_50,
        WHITE, DARK_TEXT,
        make_paragraph, safe_pdf_text, fmt_timestamp,
    )

    sample = rows[0] if rows else {}
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

    pw_pt, ph_pt = pw

    def _hostel_header(canv, ctx):
        canv.setFillColor(NAVY)
        canv.setFont("Helvetica-Bold", 14)
        canv.drawString(cm, ph_pt - 22, "HOSTEL REPORT")
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

    if not rows:
        builder.add_title(report_type.replace("_", " ").title())
        builder.add_small_note("No records found for the selected criteria.")
        return builder.build(header_context={"title": report_type.replace("_", " ").title()})

    headers = list(sample.keys())
    col_count = len(headers)

    header_paras = [make_paragraph(h.replace("_", " ").title(), styles["table_header"]) for h in headers]
    table_data = [header_paras]
    for row in rows:
        cells = [Paragraph(safe_pdf_text(str(row.get(h, ""))), styles["table_body_center"]) for h in headers]
        table_data.append(cells)

    col_widths = [1.5 * inch] * col_count
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


# ==================== Report Endpoints ====================


@router.get("/reports/data", response_model=HostelReportResponse)
async def get_hostel_report_data(
    report_type: str = Query(..., pattern="^(occupancy|allocation|vacancy)$"),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
):
    try:
        if report_type == "occupancy":
            rows = supabase_get_occupancy_report_data(school_id)
        elif report_type == "allocation":
            rows = supabase_get_allocation_report_data(school_id)
        elif report_type == "vacancy":
            rows = supabase_get_vacancy_report_data(school_id)
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported report type: {report_type}")
        return HostelReportResponse(
            report_type=report_type,
            generated_at=datetime.now(),
            rows=[HostelReportRow(values=row) for row in rows],
            total_records=len(rows),
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to generate hostel report: {exc}") from exc


@router.get("/reports/export")
async def export_hostel_report(
    report_type: str = Query(..., pattern="^(occupancy|allocation|vacancy)$"),
    export_format: str = Query(..., pattern="^(pdf|excel|csv)$"),
    school_id: str = Depends(resolve_school_id_from_actor),
    actor: dict = Depends(get_authenticated_actor_context),
):
    try:
        if report_type == "occupancy":
            rows = supabase_get_occupancy_report_data(school_id)
        elif report_type == "allocation":
            rows = supabase_get_allocation_report_data(school_id)
        elif report_type == "vacancy":
            rows = supabase_get_vacancy_report_data(school_id)
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported report type: {report_type}")

        suffix = datetime.now().strftime("%Y%m%d_%H%M%S")

        if export_format == "csv":
            buffer = _build_hostel_csv(rows)
            return StreamingResponse(
                buffer,
                media_type="text/csv; charset=utf-8",
                headers={"Content-Disposition": f'attachment; filename="hostel-{report_type}-{suffix}.csv"'},
            )

        if export_format == "excel":
            buffer = _build_hostel_excel(rows, report_type.replace("_", " ").title())
            return StreamingResponse(
                buffer,
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": f'attachment; filename="hostel-{report_type}-{suffix}.xlsx"'},
            )

        if export_format == "pdf":
            buffer = _build_hostel_pdf(report_type, rows)
            return StreamingResponse(
                buffer,
                media_type="application/pdf",
                headers={"Content-Disposition": f'attachment; filename="hostel-{report_type}-{suffix}.pdf"'},
            )

        raise HTTPException(status_code=400, detail=f"Unsupported export format: {export_format}")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to export hostel report: {exc}") from exc
