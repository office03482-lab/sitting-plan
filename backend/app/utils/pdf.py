"""
PDF Report generation utilities
"""
import json
import logging
from datetime import datetime
from io import BytesIO
from xml.sax.saxutils import escape

from reportlab.lib.pagesizes import letter, A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib import colors

logger = logging.getLogger(__name__)


def _safe_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        try:
            return json.dumps(value, ensure_ascii=False)
        except (TypeError, ValueError):
            return str(value)
    return str(value)


def _escape_paragraph_text(value) -> str:
    return escape(_safe_text(value))


def _safe_paragraph(elements: list, value, style, context: str) -> None:
    try:
        elements.append(Paragraph(_escape_paragraph_text(value), style))
    except Exception:
        logger.exception(
            "reports.pdf.paragraph_failure",
            extra={
                "context": context,
                "raw_type": type(value).__name__,
                "raw_preview": _safe_text(value)[:500],
            },
        )
        raise


def create_seating_report_pdf(plan_data: dict, room_data: dict) -> BytesIO:
    """
    Generate a PDF report for a seating plan.
    
    Args:
        plan_data: Seating plan information
        room_data: Room configuration details
    
    Returns:
        BytesIO object containing PDF
    """
    # Create PDF buffer
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter)
    
    # Container for elements
    elements = []
    
    # Styles
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=24,
        textColor=colors.HexColor('#003366'),
        spaceAfter=30,
        alignment='center'
    )
    
    heading_style = ParagraphStyle(
        'CustomHeading',
        parent=styles['Heading2'],
        fontSize=14,
        textColor=colors.HexColor('#003366'),
        spaceAfter=12,
        spaceBefore=12
    )
    
    # Title
    _safe_paragraph(elements, "Exam Seating Plan Report", title_style, "report_title")
    _safe_paragraph(
        elements,
        f"Generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        styles['Normal'],
        "report_generated_at",
    )
    elements.append(Spacer(1, 0.3*inch))
    
    # Room Information
    _safe_paragraph(elements, "Exam and Room Details", heading_style, "exam_room_heading")
    batches = plan_data.get('batches') or []
    if not batches:
        batches = sorted({
            student.get('batch')
            for desk_students in plan_data.get('assignment', {}).values()
            for student in desk_students
            if student.get('batch')
        })

    room_info = [
        [_safe_text('Exam'), _safe_text(room_data.get('exam_name') or plan_data.get('exam', {}).get('name') or 'N/A')],
        [_safe_text('Exam Type/Subject'), _safe_text(room_data.get('exam_subject') or plan_data.get('exam', {}).get('subject') or 'N/A')],
        [_safe_text('Plan Type'), _safe_text(str(room_data.get('plan_type') or plan_data.get('plan_type') or 'N/A').title())],
        [_safe_text('Batches'), _safe_text(', '.join(_safe_text(batch) for batch in batches) if batches else 'N/A')],
        [_safe_text('Room Name'), _safe_text(room_data.get('name', 'N/A'))],
        [_safe_text('Capacity'), _safe_text(room_data.get('capacity', 'N/A'))],
        [_safe_text('Dimensions'), _safe_text(f"{room_data.get('length_feet', 0)} ft x {room_data.get('width_feet', 0)} ft")],
        [_safe_text('Total Desks'), _safe_text(room_data.get('num_benches', 'N/A'))],
    ]
    
    # Add invigilator information if available
    invigilator_data = room_data.get('invigilator')
    if invigilator_data:
        room_info.extend([
            [_safe_text('Invigilator'), _safe_text(invigilator_data.get('name', 'Not Assigned'))],
            [_safe_text('Staff ID'), _safe_text(invigilator_data.get('staff_id', ''))],
            [_safe_text('Phone'), _safe_text(invigilator_data.get('phone', ''))],
            [_safe_text('Email'), _safe_text(invigilator_data.get('email', ''))],
        ])
    
    room_table = Table(room_info, colWidths=[2*inch, 4*inch])
    room_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#e6f2ff')),
        ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 1, colors.grey),
    ]))
    elements.append(room_table)
    elements.append(Spacer(1, 0.3*inch))
    
    # Seating Details
    _safe_paragraph(elements, "Seating Assignment", heading_style, "seating_assignment_heading")
    
    # Build seating table
    seating_data = [[
        _safe_text('Desk'),
        _safe_text('Seat 1 (Name/Roll)'),
        _safe_text('Batch'),
        _safe_text('Seat 2 (Name/Roll)'),
        _safe_text('Batch'),
    ]]
    
    for i, (desk_id, students) in enumerate(plan_data.get('assignment', {}).items(), 1):
        if len(students) >= 1:
            seat1_name = f"{students[0].get('name', '')} / {students[0].get('roll_number', '')}"
            seat1_batch = students[0].get('batch', '')
        else:
            seat1_name = '-'
            seat1_batch = '-'

        if len(students) >= 2:
            seat2_name = f"{students[1].get('name', '')} / {students[1].get('roll_number', '')}"
            seat2_batch = students[1].get('batch', '')
        else:
            seat2_name = '-'
            seat2_batch = '-'

        seating_data.append([
            _safe_text(f"Desk {i}"),
            _safe_text(seat1_name[:25]),  # Truncate for space
            _safe_text(seat1_batch),
            _safe_text(seat2_name[:25]),
            _safe_text(seat2_batch),
        ])    
    # Create table - limited to 50 rows per page
    if len(seating_data) > 50:
        # Multi-page table
        pages = (len(seating_data) - 1) // 50 + 1
        for page in range(pages):
            start = page * 50
            end = min(start + 50, len(seating_data))
            
            if page == 0:
                page_data = seating_data[start:end]
            else:
                page_data = seating_data[0:1] + seating_data[start:end]  # Keep header
            
            table = Table(page_data, colWidths=[0.8*inch, 2*inch, 0.8*inch, 2*inch, 0.8*inch])
            table.setStyle(_get_seating_table_style())
            elements.append(table)
            
            if page < pages - 1:
                elements.append(PageBreak())
    else:
        table = Table(seating_data, colWidths=[0.8*inch, 2*inch, 0.8*inch, 2*inch, 0.8*inch])
        table.setStyle(_get_seating_table_style())
        elements.append(table)
    
    # Build PDF
    logger.info(
        "reports.pdf.element_debug",
        extra={
            "element_count": len(elements),
            "plan_id": _safe_text(plan_data.get("id") or room_data.get("plan_id")),
            "room_id": _safe_text(room_data.get("id") or plan_data.get("room_id")),
        },
    )
    doc.build(elements)
    buffer.seek(0)
    
    return buffer


def _get_seating_table_style():
    """Get TableStyle for seating table"""
    return TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#003366')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 9),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
        ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.black),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f0f0f0')]),
    ])
