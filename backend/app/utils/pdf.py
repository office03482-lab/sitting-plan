"""
PDF Report generation utilities — Seating Plan module.
Uses shared base from pdf_base for header, footer, page numbering.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from io import BytesIO
from math import ceil
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    KeepTogether,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

from app.utils.pdf_base import (
    NAVY,
    SLATE_700,
    SLATE_500,
    SLATE_300,
    SLATE_200,
    SLATE_100,
    SLATE_50,
    WHITE,
    DARK_TEXT,
    MEDIUM_TEXT,
    ReportPdfBuilder,
    build_shared_styles,
    fmt_timestamp,
    make_paragraph,
    safe_pdf_text,
    safe_text,
    DEFAULT_MARGIN,
    DEFAULT_BOTTOM_MARGIN,
)

logger = logging.getLogger(__name__)

SHOW_EMPTY_DESKS = False

# Inherit base geometry but override top margin (reduced from 2.55 to 1.8 in base)
PAGE_SIZE = landscape(A4)
PAGE_WIDTH, PAGE_HEIGHT = PAGE_SIZE
LEFT_MARGIN = DEFAULT_MARGIN
RIGHT_MARGIN = DEFAULT_MARGIN
TOP_MARGIN = 1.5 * inch  # Further reduced – compact header
BOTTOM_MARGIN = DEFAULT_BOTTOM_MARGIN
CONTENT_WIDTH = PAGE_WIDTH - LEFT_MARGIN - RIGHT_MARGIN

HEADER_TITLE = "EXAM SEATING PLAN"


# ── Header drawer ────────────────────────────────────────────────
def _draw_header(canv, header: dict) -> None:
    title_y = PAGE_HEIGHT - 24
    canv.setFillColor(NAVY)
    canv.setFont("Helvetica-Bold", 16)
    canv.drawString(LEFT_MARGIN, title_y, HEADER_TITLE)

    canv.setFillColor(SLATE_700)
    canv.setFont("Helvetica-Bold", 10)
    canv.drawString(LEFT_MARGIN, title_y - 15, safe_text(header.get("institute_name", "")))

    # Single row of 4 compact info badges
    badges = [
        ("Exam", header.get("exam_name", "N/A")),
        ("Room", header.get("room_name", "N/A")),
        ("Plan", header.get("plan_type", "N/A")),
        ("Date", header.get("generated_date", fmt_timestamp())),
    ]

    # Invigilator info as a 5th badge if present
    invigilator = header.get("invigilator")
    if invigilator and invigilator.get("name") and invigilator["name"] != "Not Assigned":
        badges.append(("Invigilator", invigilator["name"]))

    bw = (CONTENT_WIDTH - (len(badges) - 1) * 6) / len(badges)
    bh = 30
    sy = title_y - 52

    for idx, (label, value) in enumerate(badges):
        x = LEFT_MARGIN + idx * (bw + 6)
        canv.setStrokeColor(SLATE_300)
        canv.setFillColor(SLATE_50)
        canv.roundRect(x, sy, bw, bh, 3, fill=1, stroke=1)
        canv.setFillColor(SLATE_500)
        canv.setFont("Helvetica-Bold", 6.5)
        canv.drawString(x + 6, sy + bh - 10, label.upper())
        canv.setFillColor(DARK_TEXT)
        canv.setFont("Helvetica", 7.5)
        canv.drawString(x + 6, sy + 4, safe_text(value)[:60])

    # Divider
    divider_y = sy - 8
    canv.setStrokeColor(SLATE_300)
    canv.setLineWidth(0.5)
    canv.line(LEFT_MARGIN, divider_y, PAGE_WIDTH - RIGHT_MARGIN, divider_y)


# ── Styles ───────────────────────────────────────────────────────
def _build_styles():
    base = build_shared_styles()
    base.update({
        "summary_value": ParagraphStyle(
            "SeatingSummaryValue",
            fontName="Helvetica-Bold",
            fontSize=14,
            leading=16,
            textColor=DARK_TEXT,
            alignment=TA_CENTER,
        ),
        "summary_label": ParagraphStyle(
            "SeatingSummaryLabel",
            fontName="Helvetica",
            fontSize=8.5,
            leading=10.5,
            textColor=MEDIUM_TEXT,
            alignment=TA_CENTER,
        ),
        "table_header": ParagraphStyle(
            "SeatingTableHeader",
            fontName="Helvetica-Bold",
            fontSize=8.5,
            leading=10.5,
            alignment=TA_CENTER,
            textColor=WHITE,
        ),
        "table_name": ParagraphStyle(
            "SeatingTableName",
            fontName="Helvetica",
            fontSize=8.5,
            leading=10.5,
            alignment=TA_LEFT,
            textColor=DARK_TEXT,
        ),
        "table_center": ParagraphStyle(
            "SeatingTableCenter",
            fontName="Helvetica",
            fontSize=8.5,
            leading=10.5,
            alignment=TA_CENTER,
            textColor=DARK_TEXT,
        ),
        "table_batch": ParagraphStyle(
            "SeatingTableBatch",
            fontName="Helvetica",
            fontSize=8,
            leading=10,
            alignment=TA_LEFT,
            textColor=DARK_TEXT,
        ),
        "small_note": ParagraphStyle(
            "SeatingSmallNote",
            fontName="Helvetica",
            fontSize=8.5,
            leading=11,
            textColor=MEDIUM_TEXT,
        ),
    })
    return base


def _safe_paragraph(elements, value, style, context: str) -> None:
    sanitized = safe_pdf_text(value)
    try:
        elements.append(Paragraph(sanitized, style))
    except Exception:
        logger.exception("paragraph_failure context=%s", context)
        raise


def _normalize_assignment(plan_data: dict) -> list[tuple[str, list[dict]]]:
    assignment = plan_data.get("assignment", {})
    if not isinstance(assignment, dict):
        return []
    normalized: list[tuple[str, list[dict]]] = []
    for desk_id, students in assignment.items():
        student_rows = students if isinstance(students, list) else []
        normalized.append((str(desk_id), [item for item in student_rows if isinstance(item, dict)]))

    def _desk_sort_key(item):
        raw = item[0].strip()
        if raw.isdigit():
            return (0, int(raw))
        digits = "".join(ch for ch in raw if ch.isdigit())
        if digits:
            return (0, int(digits))
        return (1, raw.lower())

    normalized.sort(key=_desk_sort_key)
    return normalized


def _batch_distribution(plan_data: dict, assignment_rows: list[tuple[str, list[dict]]]) -> list[tuple[str, int]]:
    distribution = plan_data.get("batch_distribution")
    if isinstance(distribution, list):
        rows = []
        for item in distribution:
            if isinstance(item, dict) and item.get("batch"):
                rows.append((str(item["batch"]), int(item.get("count") or 0)))
        rows = [(batch, count) for batch, count in rows if count > 0]
        if rows:
            return rows
    counts: dict[str, int] = {}
    for _, students in assignment_rows:
        for student in students:
            batch_name = str(student.get("batch_name") or student.get("batch") or "").strip() or "Unspecified"
            counts[batch_name] = counts.get(batch_name, 0) + 1
    return sorted(counts.items(), key=lambda item: (-item[1], item[0].lower()))


def _format_plan_type(value) -> str:
    text = str(value or "N/A").replace("_", " ").strip()
    return text.title() if text else "N/A"


def _format_student_name_cell(student: dict) -> str:
    name = str(student.get("full_name") or student.get("name") or "").strip()
    father_name = str(student.get("father_name") or "").strip()
    if name and father_name:
        return f"{safe_pdf_text(name)}<br/><font size='7.5'>Father: {safe_pdf_text(father_name)}</font>"
    return safe_pdf_text(name) if name else "-"


# ── Builders ─────────────────────────────────────────────────────
def _build_header_context(plan_data: dict, room_data: dict, summary: dict) -> dict:
    exam = plan_data.get("exam", {}) if isinstance(plan_data.get("exam"), dict) else {}
    generated_date = (
        room_data.get("generated_at")
        or room_data.get("created_at")
        or plan_data.get("generated_at")
        or plan_data.get("created_at")
    )
    if isinstance(generated_date, str):
        try:
            dt_val = datetime.fromisoformat(str(generated_date).replace("Z", "+00:00"))
            generated_date = fmt_timestamp(dt_val)
        except ValueError:
            generated_date = fmt_timestamp()
    elif isinstance(generated_date, datetime):
        generated_date = fmt_timestamp(generated_date)
    else:
        generated_date = fmt_timestamp()

    return {
        "institute_name": room_data.get("institute_name") or plan_data.get("institute_name") or "Institute Name Not Available",
        "exam_name": room_data.get("exam_name") or exam.get("name") or "N/A",
        "plan_type": _format_plan_type(room_data.get("plan_type") or plan_data.get("plan_type")),
        "room_name": room_data.get("name") or "N/A",
        "generated_date": generated_date,
        "invigilator": room_data.get("invigilator"),
    }


def _build_summary_table(summary: dict, styles: dict) -> Table:
    cards_data = [
        ("Total Students", str(summary["students_assigned"])),
        ("Occupied Desks", str(summary["occupied_desks"])),
        ("Empty Desks", str(summary["empty_desks"])),
        ("Utilization", f"{summary['utilization_percent']}%"),
    ]
    card_width = (CONTENT_WIDTH - 12) / 4
    row = []
    for label, value in cards_data:
        inner = Table(
            [[
                Paragraph(safe_pdf_text(value), styles["summary_value"]),
                Paragraph(safe_pdf_text(label), styles["summary_label"]),
            ]],
            colWidths=[card_width],
        )
        inner.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), SLATE_50),
            ("BOX", (0, 0), (-1, -1), 0.75, SLATE_300),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 10),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ]))
        row.append(inner)

    summary_table = Table([row], colWidths=[card_width] * 4)
    summary_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return summary_table


def _build_seating_table(assignment_rows: list[tuple[str, list[dict]]], styles: dict) -> Table:
    header_row = [
        make_paragraph("Desk No", styles["table_header"]),
        make_paragraph("Student 1 Name", styles["table_header"]),
        make_paragraph("Roll No", styles["table_header"]),
        make_paragraph("Batch", styles["table_header"]),
        make_paragraph("Student 2 Name", styles["table_header"]),
        make_paragraph("Roll No", styles["table_header"]),
        make_paragraph("Batch", styles["table_header"]),
    ]
    table_rows = [header_row]
    for desk_number, students in assignment_rows:
        seat_1 = students[0] if len(students) >= 1 else {}
        seat_2 = students[1] if len(students) >= 2 else {}
        table_rows.append([
            make_paragraph(desk_number, styles["table_center"]),
            Paragraph(_format_student_name_cell(seat_1), styles["table_name"]),
            make_paragraph(seat_1.get("roll_number") or "-", styles["table_center"]),
            make_paragraph(seat_1.get("batch") or "-", styles["table_batch"]),
            Paragraph(_format_student_name_cell(seat_2), styles["table_name"]),
            make_paragraph(seat_2.get("roll_number") or "-", styles["table_center"]),
            make_paragraph(seat_2.get("batch") or "-", styles["table_batch"]),
        ])

    col_widths = [
        0.60 * inch,
        2.20 * inch,
        0.85 * inch,
        1.20 * inch,
        2.20 * inch,
        0.85 * inch,
        1.20 * inch,
    ]

    table = Table(table_rows, colWidths=col_widths, repeatRows=1, splitByRow=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("ALIGN", (0, 0), (-1, 0), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 8.5),
        ("TOPPADDING", (0, 0), (-1, 0), 7),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 7),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, SLATE_50]),
        ("BOX", (0, 0), (-1, -1), 0.6, SLATE_300),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, SLATE_200),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 1), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 5),
        ("ALIGN", (0, 1), (0, -1), "CENTER"),
        ("ALIGN", (2, 1), (2, -1), "CENTER"),
        ("ALIGN", (5, 1), (5, -1), "CENTER"),
    ]))
    return table


def _build_batch_summary_table(batch_rows: list[tuple[str, int]], styles: dict) -> Table:
    table_rows = [[
        make_paragraph("Batch", styles["table_header"]),
        make_paragraph("Students", styles["table_header"]),
    ]]
    for batch_name, count in batch_rows:
        table_rows.append([
            make_paragraph(batch_name, styles["table_name"]),
            make_paragraph(str(count), styles["table_center"]),
        ])

    table = Table(table_rows, colWidths=[CONTENT_WIDTH - 1.1 * inch, 1.1 * inch], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, SLATE_50]),
        ("BOX", (0, 0), (-1, -1), 0.6, SLATE_300),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, SLATE_200),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("ALIGN", (1, 1), (1, -1), "CENTER"),
    ]))
    return table


# ── Main entry point ─────────────────────────────────────────────
def create_seating_report_pdf(plan_data: dict, room_data: dict) -> BytesIO:
    """Generate a professional PDF report for a seating plan."""
    buffer = BytesIO()
    styles = _build_styles()

    assignment_rows = _normalize_assignment(plan_data)
    total_desks = len(assignment_rows)
    occupied_rows = [(d, s) for d, s in assignment_rows if s]
    printed_rows = occupied_rows if not SHOW_EMPTY_DESKS else assignment_rows
    students_assigned = sum(len(s) for _, s in assignment_rows)
    occupied_desks = len(occupied_rows)
    empty_desks = max(total_desks - occupied_desks, 0)
    room_capacity = int(room_data.get("capacity") or 0)
    utilization_pct = round((students_assigned / room_capacity) * 100) if room_capacity > 0 else 0

    summary = {
        "students_assigned": students_assigned,
        "occupied_desks": occupied_desks,
        "empty_desks": empty_desks,
        "utilization_percent": utilization_pct,
    }
    header_ctx = _build_header_context(plan_data, room_data, summary)
    batch_rows = _batch_distribution(plan_data, assignment_rows)

    builder = ReportPdfBuilder(
        buffer,
        pagesize=PAGE_SIZE,
        left_margin=LEFT_MARGIN,
        right_margin=RIGHT_MARGIN,
        top_margin=TOP_MARGIN,
        bottom_margin=BOTTOM_MARGIN,
        title=f"Seating Plan - {header_ctx['room_name']}",
        author="Sitting Plan System",
        header_drawer=_draw_header,
    )

    # ── Room Summary ──
    builder.add_section_heading("Room Summary")
    builder.add_table(_build_summary_table(summary, styles))
    builder.add_spacer(0.15 * inch)

    # ── Seating Table (wrapped in KeepTogether with heading) ──
    if not printed_rows:
        builder.add_small_note("No occupied desks are available for this seating plan.")
    else:
        heading = Paragraph(safe_pdf_text("Seating Table"), styles["section_heading"])
        seating_table = _build_seating_table(printed_rows, styles)
        builder.add_keep_together([heading, Spacer(1, 4), seating_table])

    # ── Batch Summary ──
    if batch_rows:
        builder.add_spacer(0.12 * inch)
        heading2 = Paragraph(safe_pdf_text("Students by Batch"), styles["section_heading"])
        batch_table = _build_batch_summary_table(batch_rows, styles)
        builder.add_keep_together([heading2, Spacer(1, 4), batch_table])

    logger.info(
        "seating_pdf.layout",
        extra={
            "room": header_ctx["room_name"],
            "students": students_assigned,
            "desks": total_desks,
            "printed": len(printed_rows),
            "pages_est": max(1, ceil(len(printed_rows) / 28)) if printed_rows else 1,
        },
    )

    return builder.build(header_context=header_ctx)
