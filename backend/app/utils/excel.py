"""
Excel import/export utilities
"""
from typing import List, Dict, Tuple
import openpyxl
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
from io import BytesIO
from datetime import datetime


def default_academic_session() -> str:
    now = datetime.now()
    start_year = now.year if now.month >= 4 else now.year - 1
    end_year = start_year + 1
    return f"Apr {start_year} - Mar {end_year}"


def parse_student_excel(file_content: bytes) -> Tuple[List[Dict], List[Dict]]:
    """
    Parse student data from Excel file.

    Expected columns in row 1:
    Flexible student-form style headers such as ADMISSION ID, COURSE, PROGRAM,
    ACADEMIC SESSION, BATCH, ROLL NO, FIRST NAME, LAST NAME, CANDIDATE NAME, FATHER NAME,
    EMAIL, PHONE, SPECIAL NEEDS, ROOM NO

    Args:
        file_content: Binary content of Excel file

    Returns:
        (valid_students, errors)
    """
    valid_students = []
    errors = []

    def normalize_header(value: str) -> str:
        import re
        normalized = re.sub(r'[^a-z0-9]', '', value.strip().lower())
        return normalized

    supported_headers = [
        'SR. NO',
        'ADMISSION ID',
        'COURSE',
        'PROGRAM',
        'ACADEMIC SESSION',
        'BATCH',
        'ROLL NO',
        'FIRST NAME',
        'LAST NAME',
        'CANDIDATE NAME',
        'FATHER NAME',
        'EMAIL',
        'PHONE',
        'SPECIAL NEEDS',
        'ROOM NO',
    ]

    header_aliases = {
        'SR. NO': ['srno', 'sno', 's.no', 'serialno', 'serial', 'serial number', 'sr'],
        'ADMISSION ID': ['admissionid', 'admission id', 'admission no', 'admission number', 'admission'],
        'COURSE': ['course', 'exam course', 'program course'],
        'PROGRAM': ['program', 'stream', 'category', 'medical non medical'],
        'ACADEMIC SESSION': ['academicsession', 'academic session', 'session', 'session name', 'academic year', 'year session'],
        'BATCH': ['batch', 'class', 'standard', 'grade', 'year', 'managed batch', 'admission batch'],
        'ROLL NO': ['rollno', 'rollnumber', 'roll number', 'roll', 'registration no', 'registration number', 'roll #', 'rollno.'],
        'FIRST NAME': ['firstname', 'first name', 'student first name', 'candidate first name'],
        'LAST NAME': ['lastname', 'last name', 'last name optional', 'student last name', 'candidate last name'],
        'CANDIDATE NAME': ['candidatename', 'studentname', 'student name', 'name', 'candidate', 'full name'],
        'FATHER NAME': ['fathername', 'father name', 'father', 'parentname', 'parent name', 'guardianname', 'guardian name', 'guardian'],
        'EMAIL': ['email', 'email id', 'mail', 'student email'],
        'PHONE': ['phone', 'mobile', 'contact', 'phone number', 'student phone', 'student mobile'],
        'SPECIAL NEEDS': ['specialneeds', 'special needs', 'other info', 'remarks'],
        'ROOM NO': ['roomno', 'room number', 'room', 'classroom', 'room #', 'class room', 'roomno.'],
    }

    alias_to_header = {}
    for canonical, aliases in header_aliases.items():
        alias_to_header[normalize_header(canonical)] = canonical
        for alias in aliases:
            alias_to_header[normalize_header(alias)] = canonical

    try:
        workbook = openpyxl.load_workbook(BytesIO(file_content))
        worksheet = workbook.active

        # Check if we have at least one row
        if worksheet.max_row < 2:
            errors.append({
                'row': 0,
                'error': 'Excel file appears to be empty.'
            })
            return valid_students, errors

        # Read header row 1 only
        actual_headers = []
        for col_idx in range(1, max(worksheet.max_column, len(supported_headers)) + 1):
            cell_value = worksheet.cell(row=1, column=col_idx).value
            actual_headers.append(str(cell_value).strip() if cell_value is not None else '')

        # Normalize actual headers for comparison
        normalized_headers = [normalize_header(value) for value in actual_headers]

        # Map actual headers to expected canonical headers
        header_map = {}
        for col_idx, normalized_actual in enumerate(normalized_headers, start=1):
            matched_header = None
            if normalized_actual in alias_to_header:
                matched_header = alias_to_header[normalized_actual]
            else:
                for alias_norm, canonical in alias_to_header.items():
                    if alias_norm in normalized_actual or normalized_actual in alias_norm:
                        matched_header = canonical
                        break

            if matched_header and matched_header not in header_map:
                header_map[matched_header] = col_idx

        missing_headers = [header for header in ['ROLL NO', 'BATCH'] if header not in header_map]
        if missing_headers:
            errors.append({
                'row': 1,
                'error': f'Missing column(s): {", ".join(missing_headers)}. Found headers: {actual_headers}. Required headers: ROLL NO, BATCH, and either CANDIDATE NAME or FIRST NAME. ACADEMIC SESSION optional hai; blank hua to default fill hoga.'
            })
            return valid_students, errors

        if 'CANDIDATE NAME' not in header_map and 'FIRST NAME' not in header_map:
            errors.append({
                'row': 1,
                'error': f'Missing student name column. Found headers: {actual_headers}. Use either CANDIDATE NAME or FIRST NAME. LAST NAME optional hai.'
            })
            return valid_students, errors

        # Track roll numbers to check for duplicates
        roll_numbers_seen = set()

        # Parse data rows
        for row_idx in range(2, worksheet.max_row + 1):
            try:
                row_values = {
                    header: worksheet.cell(row=row_idx, column=col_idx).value
                    for header, col_idx in header_map.items()
                }

                roll_no = row_values['ROLL NO']
                batch = row_values['BATCH']
                sr_no = row_values.get('SR. NO')
                admission_id = row_values.get('ADMISSION ID')
                course = row_values.get('COURSE')
                program = row_values.get('PROGRAM')
                academic_session = row_values.get('ACADEMIC SESSION')
                first_name = row_values.get('FIRST NAME')
                last_name = row_values.get('LAST NAME')
                candidate_name = row_values.get('CANDIDATE NAME')
                father_name = row_values.get('FATHER NAME')
                email = row_values.get('EMAIL')
                phone = row_values.get('PHONE')
                special_needs = row_values.get('SPECIAL NEEDS')
                room_no = row_values.get('ROOM NO')

                full_name = str(candidate_name).strip() if candidate_name else ' '.join(
                    [str(first_name).strip() if first_name else '', str(last_name).strip() if last_name else '']
                ).strip()

                if not roll_no and not full_name and not batch and not academic_session:
                    # Skip non-data rows such as worksheet instructions or blanks.
                    instruction_text = False
                    if sr_no is not None and isinstance(sr_no, str) and not sr_no.strip().isdigit():
                        instruction_text = True
                    if instruction_text and not father_name and not room_no:
                        continue
                    if sr_no is None and father_name is None and room_no is None:
                        continue

                if not roll_no or not full_name or not batch:
                    errors.append({
                        'row': row_idx,
                        'error': 'Missing required data in row. Required columns: ROLL NO, BATCH, and student name.'
                    })
                    continue

                academic_session_str = str(academic_session).strip() if academic_session else default_academic_session()
                if not academic_session_str:
                    academic_session_str = default_academic_session()

                roll_no_str = str(roll_no).strip()
                if not roll_no_str:
                    errors.append({
                        'row': row_idx,
                        'error': 'ROLL NO cannot be empty.'
                    })
                    continue

                if roll_no_str in roll_numbers_seen:
                    errors.append({
                        'row': row_idx,
                        'error': f'Duplicate ROLL NO: {roll_no_str}.'
                    })
                    continue

                roll_numbers_seen.add(roll_no_str)

                batch_str = str(batch).strip()
                if not batch_str:
                    errors.append({
                        'row': row_idx,
                        'error': 'BATCH cannot be empty.'
                    })
                    continue

                student = {
                    'sr_no': sr_no,
                    'admission_id': str(admission_id).strip() if admission_id else '',
                    'course': str(course).strip() if course else '',
                    'program': str(program).strip() if program else '',
                    'academic_session': academic_session_str,
                    'roll_no': roll_no_str,
                    'candidate_name': full_name,
                    'father_name': str(father_name).strip() if father_name else '',
                    'batch': batch_str,
                    'email': str(email).strip() if email else '',
                    'phone': str(phone).strip() if phone else '',
                    'special_needs': str(special_needs).strip() if special_needs else '',
                    'room_no': str(room_no).strip() if room_no else '',
                }

                valid_students.append(student)
            except Exception as e:
                errors.append({
                    'row': row_idx,
                    'error': f'Error parsing row: {str(e)}'
                })
    except Exception as e:
        import zipfile
        from openpyxl.utils.exceptions import InvalidFileException
        if isinstance(e, (zipfile.BadZipFile, InvalidFileException)):
            errors.append({
                'row': 0,
                'error': 'Invalid Excel format. The uploaded file is not a valid .xlsx file.'
            })
        else:
            errors.append({
                'row': 0,
                'error': f'Error reading Excel file: {str(e)}'
            })

    return valid_students, errors


def create_student_excel_template() -> BytesIO:
    """
    Create downloadable Excel template for student data upload.

    Returns:
        BytesIO object with Excel template
    """
    workbook = openpyxl.Workbook()
    worksheet = workbook.active
    worksheet.title = "Student Data Template"

    # Header styling
    header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF")
    required_font = Font(color="FF0000")

    # Instructions
    worksheet['A1'] = "ASPIRE IIT & MEDICAL - Student Data Upload Template"
    worksheet['A1'].font = Font(bold=True, size=14)

    worksheet['A2'] = "IMPORTANT: Fill data starting from row 2. Do not modify column headers in row 1."
    worksheet['A2'].font = Font(bold=True, color="FF6600")

    worksheet['A3'] = "Required fields are marked with *"
    worksheet['A3'].font = Font(italic=True)

    # Column headers (row 1)
    headers = ['SR. NO', 'ADMISSION ID', 'COURSE', 'PROGRAM', 'ACADEMIC SESSION', 'BATCH', 'ROLL NO', 'FIRST NAME', 'LAST NAME (OPTIONAL)', 'FATHER NAME', 'EMAIL', 'PHONE', 'SPECIAL NEEDS', 'ROOM NO']
    for col_idx, header in enumerate(headers, 1):
        cell = worksheet.cell(row=1, column=col_idx)
        cell.value = header
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal='center')

    # Sample data (row 2)
    sample_data = [
        1,
        'ADM-101',
        'NEET',
        'Medical',
        'Apr 2026 - Mar 2027',
        'Dropper Medical Alpha',
        '101',
        'Rahul',
        'Sharma',
        'Rakesh Sharma',
        'rahul@example.com',
        '9876543210',
        '',
        'Room 1'
    ]
    for col_idx, value in enumerate(sample_data, 1):
        cell = worksheet.cell(row=2, column=col_idx)
        cell.value = value
        cell.alignment = Alignment(horizontal='center')

    # Additional sample rows
    sample_rows = [
        [2, 'ADM-102', 'JEE-MAIN', 'Non Medical', 'Apr 2026 - Mar 2027', 'Dropper Non Medical Prime', '102', 'Priya', 'Patel', 'Rajesh Patel', 'priya@example.com', '9988776655', '', 'Room 1'],
        [3, 'ADM-103', 'ADVANCE', 'Non Medical', 'Apr 2026 - Mar 2027', '11th Non Medical Advance', '103', 'Amit', 'Kumar', 'Suresh Kumar', 'amit@example.com', '9123456780', 'Near exit seat', 'Room 2'],
        [4, 'ADM-104', 'S.S.B', 'Medical', 'Apr 2026 - Mar 2027', '12th Medical SSB', '104', 'Sneha', 'Singh', 'Vikram Singh', 'sneha@example.com', '9012345678', '', 'Room 2'],
    ]

    for row_idx, row_data in enumerate(sample_rows, 6):
        for col_idx, value in enumerate(row_data, 1):
            cell = worksheet.cell(row=row_idx, column=col_idx)
            cell.value = value
            cell.alignment = Alignment(horizontal='center')

    # Instructions box (starting row 8)
    instructions_start_row = 8
    worksheet.cell(row=instructions_start_row, column=1).value = "INSTRUCTIONS:"
    worksheet.cell(row=instructions_start_row, column=1).font = Font(bold=True)

    instructions = [
        "1. SR. NO: Sequential number (1, 2, 3, ...)",
        "2. ACADEMIC SESSION*: Session like Apr 2026 - Mar 2027 (required)",
        "3. ROLL NO*: Unique student roll number (required)",
        "4. CANDIDATE NAME*: Full name of the student (required)",
        "5. FATHER NAME: Father's name (optional)",
        "6. BATCH*: Any batch name is allowed and will be created automatically during import",
        "7. ROOM NO: Room assignment (optional, can be left blank)",
        "",
        "NOTES:",
        "• ACADEMIC SESSION must be filled for every student",
        "• ROLL NO must be unique across the entire file",
        "• Headers are in row 1, data starts from row 2",
        "• Save file as .xlsx format only",
        "• ROOM NO is optional and can be assigned later",
        "• New batch names from Excel will be auto-added to the system",
    ]

    for idx, instruction in enumerate(instructions):
        worksheet.cell(row=instructions_start_row + 1 + idx, column=1).value = instruction

    # Auto-fit columns
    for col in worksheet.columns:
        max_length = 0
        column = col[0].column_letter
        for cell in col:
            try:
                max_length = max(max_length, len(str(cell.value)))
            except:
                pass
        adjusted_width = min(max_length + 2, 50)
        worksheet.column_dimensions[column].width = adjusted_width

    # Save to BytesIO
    output = BytesIO()
    workbook.save(output)
    output.seek(0)

    return output


def parse_inventory_material_excel(file_content: bytes) -> Tuple[List[Dict], List[Dict]]:
    """Parse bulk inventory material rows from an Excel file."""
    valid_rows: List[Dict] = []
    errors: List[Dict] = []

    def normalize_header(value: str) -> str:
        import re
        return re.sub(r'[^a-z0-9]', '', value.strip().lower())

    alias_to_header = {
        'subjectname': 'SUBJECT NAME',
        'subject': 'SUBJECT NAME',
        'setname': 'SET NAME',
        'set': 'SET NAME',
        'target': 'SET NAME',
        'volumenumber': 'VOLUME NUMBER',
        'volumeno': 'VOLUME NUMBER',
        'volume': 'VOLUME NUMBER',
        'volumename': 'VOLUME NAME',
        'materialname': 'MATERIAL NAME',
        'material': 'MATERIAL NAME',
        'name': 'MATERIAL NAME',
        'unittype': 'UNIT TYPE',
        'unit': 'UNIT TYPE',
        'price': 'PRICE',
        'lowstockthreshold': 'LOW STOCK THRESHOLD',
        'threshold': 'LOW STOCK THRESHOLD',
        'batchnames': 'BATCH NAMES',
        'batches': 'BATCH NAMES',
        'class': 'BATCH NAMES',
        'description': 'DESCRIPTION',
        'isactive': 'IS ACTIVE',
        'active': 'IS ACTIVE',
        'suppliername': 'SUPPLIER NAME',
        'supplier': 'SUPPLIER NAME',
        'openingstock': 'OPENING STOCK',
        'openingquantity': 'OPENING STOCK',
        'quantity': 'OPENING STOCK',
        'qty': 'OPENING STOCK',
        'openingstockdate': 'STOCK IN DATE',
        'stockindate': 'STOCK IN DATE',
        'date': 'STOCK IN DATE',
    }

    try:
        workbook = openpyxl.load_workbook(BytesIO(file_content))
        worksheet = workbook.active

        if worksheet.max_row < 2:
            return valid_rows, [{'row': 0, 'error': 'Excel file appears to be empty.'}]

        header_map: Dict[str, int] = {}
        for col_idx in range(1, worksheet.max_column + 1):
            raw_header = worksheet.cell(row=1, column=col_idx).value
            if raw_header is None:
                continue
            canonical = alias_to_header.get(normalize_header(str(raw_header)))
            if canonical and canonical not in header_map:
                header_map[canonical] = col_idx

        # Support image-style templates where "Description" is the material title itself.
        if 'MATERIAL NAME' not in header_map and 'DESCRIPTION' in header_map:
            header_map['MATERIAL NAME'] = header_map['DESCRIPTION']

        required_headers = ['SUBJECT NAME', 'SET NAME', 'MATERIAL NAME']
        missing = [header for header in required_headers if header not in header_map]
        if missing:
            return valid_rows, [{
                'row': 1,
                'error': f"Missing column(s): {', '.join(missing)}. Required headers: SUBJECT NAME, SET NAME, MATERIAL NAME.",
            }]

        for row_idx in range(2, worksheet.max_row + 1):
            row_data = {
                header: worksheet.cell(row=row_idx, column=col_idx).value
                for header, col_idx in header_map.items()
            }

            subject_name = str(row_data.get('SUBJECT NAME') or '').strip()
            set_name = str(row_data.get('SET NAME') or '').strip()
            material_name = str(row_data.get('MATERIAL NAME') or '').strip()

            if not subject_name and not set_name and not material_name:
                continue

            if not subject_name or not set_name or not material_name:
                errors.append({
                    'row': row_idx,
                    'error': 'SUBJECT NAME, SET NAME, and MATERIAL NAME are required.',
                })
                continue

            volume_number_raw = row_data.get('VOLUME NUMBER')
            volume_name = str(row_data.get('VOLUME NAME') or '').strip()
            unit_type = str(row_data.get('UNIT TYPE') or 'book').strip().lower()
            description = str(row_data.get('DESCRIPTION') or '').strip()
            batch_names_raw = str(row_data.get('BATCH NAMES') or '').strip()
            price_raw = row_data.get('PRICE')
            threshold_raw = row_data.get('LOW STOCK THRESHOLD')
            is_active_raw = row_data.get('IS ACTIVE')
            supplier_name = str(row_data.get('SUPPLIER NAME') or '').strip()
            stock_in_date_raw = row_data.get('STOCK IN DATE')
            opening_stock_raw = row_data.get('OPENING STOCK')

            volume_number = None
            if volume_number_raw not in (None, ''):
                try:
                    volume_number = int(volume_number_raw)
                except (TypeError, ValueError):
                    errors.append({'row': row_idx, 'error': f'Invalid VOLUME NUMBER: {volume_number_raw}'})
                    continue

            try:
                price = float(price_raw) if price_raw not in (None, '') else 0.0
            except (TypeError, ValueError):
                errors.append({'row': row_idx, 'error': f'Invalid PRICE: {price_raw}'})
                continue

            try:
                low_stock_threshold = int(threshold_raw) if threshold_raw not in (None, '') else 10
            except (TypeError, ValueError):
                errors.append({'row': row_idx, 'error': f'Invalid LOW STOCK THRESHOLD: {threshold_raw}'})
                continue

            try:
                opening_stock = int(opening_stock_raw) if opening_stock_raw not in (None, '') else 0
            except (TypeError, ValueError):
                errors.append({'row': row_idx, 'error': f'Invalid OPENING STOCK: {opening_stock_raw}'})
                continue

            if opening_stock < 0:
                errors.append({'row': row_idx, 'error': 'OPENING STOCK cannot be negative'})
                continue

            if isinstance(is_active_raw, str):
                is_active = is_active_raw.strip().lower() not in {'false', 'no', '0', 'inactive'}
            else:
                is_active = bool(is_active_raw) if is_active_raw is not None else True

            batch_names = [
                part.strip()
                for part in batch_names_raw.replace('|', ',').split(',')
                if part.strip()
            ]

            valid_rows.append({
                'subject_name': subject_name,
                'set_name': set_name,
                'volume_number': volume_number,
                'volume_name': volume_name or (f"Volume {volume_number}" if volume_number else ''),
                'material_name': material_name,
                'unit_type': unit_type or 'book',
                'price': price,
                'low_stock_threshold': low_stock_threshold,
                'batch_names': batch_names,
                'description': description,
                'is_active': is_active,
                'supplier_name': supplier_name,
                'opening_stock': opening_stock,
                'stock_in_date': stock_in_date_raw,
            })
    except Exception as e:
        import zipfile
        from openpyxl.utils.exceptions import InvalidFileException
        if isinstance(e, (zipfile.BadZipFile, InvalidFileException)):
            errors.append({'row': 0, 'error': 'Invalid Excel format. Upload a valid .xlsx file.'})
        else:
            errors.append({'row': 0, 'error': f'Error reading Excel file: {str(e)}'})

    return valid_rows, errors


def create_inventory_material_template() -> BytesIO:
    """Create downloadable Excel template for inventory material bulk upload."""
    workbook = openpyxl.Workbook()
    worksheet = workbook.active
    worksheet.title = "Upload"
    instruction_sheet = workbook.create_sheet(title="Instructions")

    header_fill = PatternFill(start_color="1D4ED8", end_color="1D4ED8", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF")

    headers = [
        'TARGET',
        'DESCRIPTION',
        'SUBJECT',
        'CLASS',
        'QTY',
        'SUPPLIER NAME',
        'STOCK IN DATE',
        'LOW STOCK THRESHOLD',
        'UNIT TYPE',
        'IS ACTIVE',
    ]

    for col_idx, header in enumerate(headers, 1):
        cell = worksheet.cell(row=1, column=col_idx)
        cell.value = header
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal='center')

    sample_rows = [
        ['JEE (Adv)', 'Periodic Table & Periodicity', 'Chemistry', 'CLASS-XI', 50, 'ABC Supplier', '2026-04-30', 10, 'book', 'TRUE'],
        ['JEE (Adv)', 'Introduction to Chemistry', 'Chemistry', 'CLASS-XI', 50, 'ABC Supplier', '2026-04-30', 10, 'book', 'TRUE'],
        ['JEE (Adv)', 'Mole Concept', 'Chemistry', 'CLASS-XI', 50, 'ABC Supplier', '2026-04-30', 10, 'book', 'TRUE'],
        ['JEE (Adv)', 'Mathematical Tools', 'Physics', 'CLASS-XI', 50, 'ABC Supplier', '2026-04-30', 10, 'book', 'TRUE'],
        ['JEE (Adv)', 'Rectilinear Motion', 'Physics', 'CLASS-XI', 50, 'ABC Supplier', '2026-04-30', 10, 'book', 'TRUE'],
        ['JEE (Adv)', 'Trigonometry', 'Mathematics', 'CLASS-XI', 50, 'ABC Supplier', '2026-04-30', 10, 'book', 'TRUE'],
    ]
    for row_idx, row_data in enumerate(sample_rows, start=2):
        for col_idx, value in enumerate(row_data, start=1):
            worksheet.cell(row=row_idx, column=col_idx).value = value

    for col_letter, width in {
        'A': 18, 'B': 34, 'C': 18, 'D': 16, 'E': 10,
        'F': 22, 'G': 16, 'H': 20, 'I': 14, 'J': 12,
    }.items():
        worksheet.column_dimensions[col_letter].width = width

    instruction_sheet['A1'] = "Inventory Material Bulk Upload Template"
    instruction_sheet['A1'].font = Font(bold=True, size=14)
    instruction_sheet['A3'] = "Use this exact format: TARGET | DESCRIPTION | SUBJECT | CLASS | QTY"
    instruction_sheet['A4'] = "Mapping: TARGET -> Set Name, DESCRIPTION -> Material Name, SUBJECT -> Subject, CLASS -> Batch/Class, QTY -> Opening Stock"
    instruction_sheet['A5'] = "Optional extra columns: SUPPLIER NAME, STOCK IN DATE, LOW STOCK THRESHOLD, UNIT TYPE, IS ACTIVE"
    instruction_sheet['A6'] = "Each row is one separate inventory item. Different descriptions will stay separate."
    instruction_sheet['A7'] = "If SUPPLIER NAME and QTY diye honge, import ke time stock-in entry automatically create ho jayegi."
    instruction_sheet['A8'] = "Example image logic: JEE (Adv) + Periodic Table & Periodicity + Chemistry + CLASS-XI + 50"
    instruction_sheet['A9'] = "Aise multiple rows upload karne par supplier summary aur stock total row-wise sum hoga."
    instruction_sheet.column_dimensions['A'].width = 120

    output = BytesIO()
    workbook.save(output)
    output.seek(0)
    return output


def parse_seating_plan_excel(file_content: bytes) -> Tuple[List[Dict], List[Dict]]:
    """
    Parse seating plan data from Excel file.

    Expected columns (flexible match):
    SR. NO, ROLL NO, CANDIDATE NAME, FATHER NAME, BATCH, ROOM NO

    Args:
        file_content: Binary content of Excel file

    Returns:
        (valid_seating_entries, errors)
    """
    valid_entries = []
    errors = []

    def normalize_header(value: str) -> str:
        import re
        return re.sub(r'[^a-z0-9]', '', value.strip().lower())

    required_headers = ['ROLL NO', 'CANDIDATE NAME', 'BATCH', 'ROOM NO']
    optional_headers = ['SR. NO', 'FATHER NAME']
    header_aliases = {
        'SR. NO': ['srno', 'sno', 's.no', 'serialno', 'serial', 'serialnumber', 'sr'],
        'ROLL NO': ['rollno', 'rollnumber', 'roll number', 'roll', 'registrationno', 'registrationnumber', 'roll#', 'rollno.'],
        'CANDIDATE NAME': ['candidatename', 'studentname', 'student name', 'name', 'candidate', 'fullname', 'full name'],
        'FATHER NAME': ['fathername', 'father name', 'father', 'parentname', 'parent name', 'guardianname', 'guardian name', 'guardian'],
        'BATCH': ['batch', 'class', 'standard', 'grade', 'year'],
        'ROOM NO': ['roomno', 'room number', 'room', 'classroom', 'room#', 'class room', 'roomno.'],
    }

    alias_to_header = {}
    for canonical, aliases in header_aliases.items():
        alias_to_header[normalize_header(canonical)] = canonical
        for alias in aliases:
            alias_to_header[normalize_header(alias)] = canonical

    def find_header_row() -> Tuple[int, Dict[str, int], List[str]]:
        max_scan = min(5, worksheet.max_row)
        max_columns = min(15, worksheet.max_column)

        for row_idx in range(1, max_scan + 1):
            actual_headers = [
                str(worksheet.cell(row=row_idx, column=col_idx).value).strip()
                if worksheet.cell(row=row_idx, column=col_idx).value is not None else ''
                for col_idx in range(1, max_columns + 1)
            ]

            normalized_headers = [normalize_header(value) for value in actual_headers]
            header_map: Dict[str, int] = {}

            for col_idx, normalized_actual in enumerate(normalized_headers, start=1):
                canonical = None
                if normalized_actual in alias_to_header:
                    canonical = alias_to_header[normalized_actual]
                else:
                    for alias_norm, alias_header in alias_to_header.items():
                        if alias_norm in normalized_actual or normalized_actual in alias_norm:
                            canonical = alias_header
                            break
                if canonical and canonical not in header_map:
                    header_map[canonical] = col_idx

            if all(header in header_map for header in required_headers):
                return row_idx, header_map, actual_headers

        return 0, {}, []

    try:
        workbook = openpyxl.load_workbook(BytesIO(file_content))
        worksheet = workbook.active

        if worksheet.max_row < 2:
            errors.append({
                'row': 0,
                'error': 'Excel file appears to be empty.'
            })
            return valid_entries, errors

        header_row, header_map, actual_headers = find_header_row()
        if not header_map:
            errors.append({
                'row': 1,
                'error': f'Invalid Excel format. Missing required columns. Expected headers: {required_headers + optional_headers}. Found headers in first rows.'
            })
            return valid_entries, errors

        # Ensure optional headers can still be accessed safely
        for optional_header in optional_headers:
            if optional_header not in header_map:
                header_map[optional_header] = None

        roll_numbers_seen = set()

        for row_idx in range(header_row + 1, worksheet.max_row + 1):
            try:
                def get_cell_value(header_name: str):
                    col = header_map.get(header_name)
                    if col is None:
                        return None
                    return worksheet.cell(row=row_idx, column=col).value

                sr_no = get_cell_value('SR. NO')
                roll_no = get_cell_value('ROLL NO')
                candidate_name = get_cell_value('CANDIDATE NAME')
                father_name = get_cell_value('FATHER NAME')
                batch = get_cell_value('BATCH')
                room_no = get_cell_value('ROOM NO')

                if not roll_no or not candidate_name or not batch or not room_no:
                    errors.append({
                        'row': row_idx,
                        'error': 'Missing required data (ROLL NO, CANDIDATE NAME, BATCH, ROOM NO).'
                    })
                    continue

                roll_no_str = str(roll_no).strip()
                if not roll_no_str:
                    errors.append({
                        'row': row_idx,
                        'error': 'ROLL NO cannot be empty.'
                    })
                    continue

                if roll_no_str in roll_numbers_seen:
                    errors.append({
                        'row': row_idx,
                        'error': f'Duplicate ROLL NO: {roll_no_str}.'
                    })
                    continue

                roll_numbers_seen.add(roll_no_str)

                batch_str = str(batch).strip()
                if not batch_str:
                    errors.append({
                        'row': row_idx,
                        'error': 'BATCH cannot be empty.'
                    })
                    continue

                entry = {
                    'sr_no': sr_no,
                    'roll_no': roll_no_str,
                    'candidate_name': str(candidate_name).strip(),
                    'father_name': str(father_name).strip() if father_name else '',
                    'batch': batch_str,
                    'room_no': str(room_no).strip(),
                }

                valid_entries.append(entry)

            except Exception as e:
                errors.append({
                    'row': row_idx,
                    'error': f'Error parsing row: {str(e)}'
                })

    except Exception as e:
        import zipfile
        from openpyxl.utils.exceptions import InvalidFileException
        if isinstance(e, (zipfile.BadZipFile, InvalidFileException)):
            errors.append({
                'row': 0,
                'error': 'Invalid Excel format. The uploaded file is not a valid .xlsx file.'
            })
        else:
            errors.append({
                'row': 0,
                'error': f'Error reading Excel file: {str(e)}'
            })

    return valid_entries, errors


def create_seating_plan_template() -> BytesIO:
    """
    Create downloadable Excel template for seating plan upload.

    Returns:
        BytesIO object with Excel template
    """
    workbook = openpyxl.Workbook()
    worksheet = workbook.active
    worksheet.title = "Seating Plan Template"

    # Header styling
    header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF")
    required_font = Font(color="FF0000")

    # Instructions
    worksheet['A1'] = "ASPIRE IIT & MEDICAL - Seating Plan Upload Template"
    worksheet['A1'].font = Font(bold=True, size=14)

    worksheet['A2'] = "IMPORTANT: Do not modify column headers. Fill data starting from row 3."
    worksheet['A2'].font = Font(bold=True, color="FF6600")

    worksheet['A3'] = "Required fields are marked with *"
    worksheet['A3'].font = Font(italic=True)

    # Column headers (row 5)
    headers = ['SR. NO*', 'ROLL NO*', 'CANDIDATE NAME*', 'FATHER NAME', 'BATCH*', 'ROOM NO*']
    for col_idx, header in enumerate(headers, 1):
        cell = worksheet.cell(row=5, column=col_idx)
        cell.value = header
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal='center')

    # Sample data (row 6)
    sample_data = [
        1,
        '101',
        'Rahul Sharma',
        'Rakesh Sharma',
        '12th Medical',
        'Room 1'
    ]
    for col_idx, value in enumerate(sample_data, 1):
        cell = worksheet.cell(row=6, column=col_idx)
        cell.value = value
        cell.alignment = Alignment(horizontal='center')

    # Additional sample rows
    sample_rows = [
        [2, '102', 'Priya Patel', 'Rajesh Patel', '12th IIT', 'Room 1'],
        [3, '103', 'Amit Kumar', 'Suresh Kumar', '12th Medical', 'Room 2'],
        [4, '104', 'Sneha Singh', 'Vikram Singh', 'Dropper 1', 'Room 2'],
    ]

    for row_idx, row_data in enumerate(sample_rows, 7):
        for col_idx, value in enumerate(row_data, 1):
            cell = worksheet.cell(row=row_idx, column=col_idx)
            cell.value = value
            cell.alignment = Alignment(horizontal='center')

    # Instructions box (starting row 10)
    instructions_start_row = 10
    worksheet.cell(row=instructions_start_row, column=1).value = "INSTRUCTIONS:"
    worksheet.cell(row=instructions_start_row, column=1).font = Font(bold=True)

    instructions = [
        "1. SR. NO: Sequential number (1, 2, 3, ...)",
        "2. ROLL NO: Unique student roll number (required)",
        "3. CANDIDATE NAME: Full name of the student (required)",
        "4. FATHER NAME: Father's name (optional)",
        "5. BATCH: Any batch name is allowed and will be created automatically during import",
        "6. ROOM NO: Room assignment (e.g., 'Room 1', 'Room 2', etc.)",
        "",
        "NOTES:",
        "• All students with same ROOM NO will be grouped together",
        "• ROLL NO must be unique across the entire file",
        "• Save file as .xlsx format only",
        "• New batch names from Excel will be auto-added to the system",
    ]

    for idx, instruction in enumerate(instructions):
        worksheet.cell(row=instructions_start_row + 1 + idx, column=1).value = instruction

    # Auto-fit columns
    for col in worksheet.columns:
        max_length = 0
        column = col[0].column_letter
        for cell in col:
            try:
                max_length = max(max_length, len(str(cell.value)))
            except:
                pass
        adjusted_width = min(max_length + 2, 50)
        worksheet.column_dimensions[column].width = adjusted_width

    # Save to BytesIO
    output = BytesIO()
    workbook.save(output)
    output.seek(0)

    return output


def create_seating_export_excel(plan_data: Dict, room_data: Dict) -> BytesIO:
    """
    Create Excel export for seating plan.
    
    Args:
        plan_data: Seating plan information
        room_data: Room configuration
    
    Returns:
        BytesIO object with Excel file
    """
    workbook = openpyxl.Workbook()
    worksheet = workbook.active
    worksheet.title = "Seating Plan"

    _build_roomwise_seating_sheet(
        worksheet,
        [{
            "plan_data": plan_data,
            "room_data": room_data,
        }],
        title_override=room_data.get("exam_name") or "SITTING PLAN",
    )

    output = BytesIO()
    workbook.save(output)
    output.seek(0)

    return output


def create_multi_room_seating_export_excel(room_plans: List[Dict]) -> BytesIO:
    """
    Create one workbook that contains a summary sheet and one sheet per room.

    Args:
        room_plans: List of {"plan_data": ..., "room_data": ...} dictionaries

    Returns:
        BytesIO object with Excel file
    """
    workbook = openpyxl.Workbook()
    worksheet = workbook.active
    worksheet.title = "All Rooms Seating"
    summary_sheet = workbook.create_sheet(title="Room Summary")

    title_override = ""
    if room_plans:
        first_room = room_plans[0].get("room_data") or {}
        title_override = first_room.get("exam_name") or "SITTING PLAN"

    _build_roomwise_seating_sheet(worksheet, room_plans, title_override=title_override)
    _build_room_summary_sheet(summary_sheet, room_plans, title_override=title_override)

    output = BytesIO()
    workbook.save(output)
    output.seek(0)
    return output


def _normalize_room_students(plan_data: Dict) -> List[Dict]:
    normalized_rows: List[Dict] = []
    sequence = 1
    for desk_id, students in plan_data.get("assignment", {}).items():
        try:
            desk_sort = int(desk_id)
        except Exception:
            desk_sort = sequence

        for seat_pos, student in enumerate(students, 1):
            normalized_rows.append({
                "sequence": sequence,
                "desk_sort": desk_sort,
                "seat_pos": seat_pos,
                "roll_number": student.get("roll_number", ""),
                "name": student.get("name", ""),
                "father_name": student.get("father_name", ""),
                "batch": student.get("batch", ""),
            })
            sequence += 1

    normalized_rows.sort(key=lambda item: (item["desk_sort"], item["seat_pos"], item["sequence"]))
    for index, row in enumerate(normalized_rows, start=1):
        row["sequence"] = index
    return normalized_rows


def _build_roomwise_seating_sheet(worksheet, room_plans: List[Dict], title_override: str = "") -> None:
    title_fill = PatternFill(start_color="F4B4A8", end_color="F4B4A8", fill_type="solid")
    room_fill = PatternFill(start_color="F4B4A8", end_color="F4B4A8", fill_type="solid")
    header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
    white_bold_font = Font(bold=True, color="FFFFFF")
    title_font = Font(bold=True, size=14)
    room_font = Font(bold=True, size=13)
    thin_border = Border(
        left=Side(style="thin", color="000000"),
        right=Side(style="thin", color="000000"),
        top=Side(style="thin", color="000000"),
        bottom=Side(style="thin", color="000000"),
    )

    headers = ["Sr.No.", "Roll Number", "Student Name", "Father name", "Batch", "Room"]
    title_text = f"SITTING PLAN FOR {str(title_override or 'EXAM').upper()}"
    if room_plans and (room_plans[0].get("room_data") or {}).get("exam_subject"):
        exam_subject = str((room_plans[0].get("room_data") or {}).get("exam_subject") or "").strip()
        if exam_subject:
            title_text = f"SITTING PLAN FOR {exam_subject.upper()}"

    worksheet.merge_cells("A1:F1")
    title_cell = worksheet["A1"]
    title_cell.value = title_text
    title_cell.font = title_font
    title_cell.alignment = Alignment(horizontal="center", vertical="center")
    title_cell.fill = title_fill

    current_row = 2
    for room_plan in room_plans:
        plan_data = room_plan.get("plan_data") or {}
        room_data = room_plan.get("room_data") or {}
        room_name = str(room_data.get("name") or "").strip() or "ROOM"

        worksheet.merge_cells(start_row=current_row, start_column=1, end_row=current_row, end_column=6)
        room_cell = worksheet.cell(row=current_row, column=1)
        room_cell.value = f"ROOM NO. - {room_name}"
        room_cell.font = room_font
        room_cell.alignment = Alignment(horizontal="center", vertical="center")
        room_cell.fill = room_fill

        current_row += 1
        for col_idx, header in enumerate(headers, start=1):
            cell = worksheet.cell(row=current_row, column=col_idx)
            cell.value = header
            cell.fill = header_fill
            cell.font = white_bold_font
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.border = thin_border

        current_row += 1
        room_students = _normalize_room_students(plan_data)
        for row in room_students:
            values = [
                row["sequence"],
                row["roll_number"],
                row["name"],
                row["father_name"],
                row["batch"],
                room_name,
            ]
            for col_idx, value in enumerate(values, start=1):
                cell = worksheet.cell(row=current_row, column=col_idx)
                cell.value = value
                cell.alignment = Alignment(horizontal="center", vertical="center")
                cell.border = thin_border
            current_row += 1

        current_row += 1

    for merge_range in list(worksheet.merged_cells.ranges):
        min_col, min_row, max_col, max_row = merge_range.bounds
        for row in worksheet.iter_rows(min_row=min_row, max_row=max_row, min_col=min_col, max_col=max_col):
            for cell in row:
                cell.border = thin_border

    widths = {
        "A": 10,
        "B": 26,
        "C": 30,
        "D": 26,
        "E": 30,
        "F": 14,
    }
    for column, width in widths.items():
        worksheet.column_dimensions[column].width = width


def _build_room_summary_sheet(worksheet, room_plans: List[Dict], title_override: str = "") -> None:
    title_fill = PatternFill(start_color="D9EAF7", end_color="D9EAF7", fill_type="solid")
    header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
    section_fill = PatternFill(start_color="EAF3FF", end_color="EAF3FF", fill_type="solid")
    white_bold_font = Font(bold=True, color="FFFFFF")
    title_font = Font(bold=True, size=14)
    room_font = Font(bold=True, size=12)
    thin_border = Border(
        left=Side(style="thin", color="000000"),
        right=Side(style="thin", color="000000"),
        top=Side(style="thin", color="000000"),
        bottom=Side(style="thin", color="000000"),
    )

    worksheet.merge_cells("A1:E1")
    title_cell = worksheet["A1"]
    title_cell.value = f"ROOM-WISE SUMMARY FOR {str(title_override or 'EXAM').upper()}"
    title_cell.font = title_font
    title_cell.alignment = Alignment(horizontal="center", vertical="center")
    title_cell.fill = title_fill
    title_cell.border = thin_border

    current_row = 3
    for room_plan in room_plans:
        room_data = room_plan.get("room_data") or {}
        plan_data = room_plan.get("plan_data") or {}
        room_name = str(room_data.get("name") or "").strip() or "ROOM"
        room_students = _normalize_room_students(plan_data)

        batch_counts: Dict[str, int] = {}
        for student in room_students:
            batch_name = str(student.get("batch") or "").strip() or "Unassigned"
            batch_counts[batch_name] = batch_counts.get(batch_name, 0) + 1

        sorted_batches = sorted(batch_counts.items(), key=lambda item: (-item[1], item[0].lower()))

        worksheet.merge_cells(start_row=current_row, start_column=1, end_row=current_row, end_column=5)
        room_cell = worksheet.cell(row=current_row, column=1)
        room_cell.value = f"ROOM NO. - {room_name} | TOTAL STUDENTS: {len(room_students)} | TOTAL BATCHES: {len(sorted_batches)}"
        room_cell.font = room_font
        room_cell.alignment = Alignment(horizontal="left", vertical="center")
        room_cell.fill = section_fill
        room_cell.border = thin_border
        current_row += 1

        headers = ["Sr.No.", "Batch Name", "Student Count", "Share %", "Room"]
        for col_idx, header in enumerate(headers, start=1):
            cell = worksheet.cell(row=current_row, column=col_idx)
            cell.value = header
            cell.fill = header_fill
            cell.font = white_bold_font
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.border = thin_border
        current_row += 1

        total_students = len(room_students)
        for index, (batch_name, count) in enumerate(sorted_batches, start=1):
            share = round((count / total_students) * 100, 2) if total_students else 0
            values = [index, batch_name, count, share, room_name]
            for col_idx, value in enumerate(values, start=1):
                cell = worksheet.cell(row=current_row, column=col_idx)
                cell.value = value
                cell.alignment = Alignment(horizontal="center", vertical="center")
                cell.border = thin_border
            current_row += 1

        current_row += 1

    for merge_range in list(worksheet.merged_cells.ranges):
        min_col, min_row, max_col, max_row = merge_range.bounds
        for row in worksheet.iter_rows(min_row=min_row, max_row=max_row, min_col=min_col, max_col=max_col):
            for cell in row:
                cell.border = thin_border

    widths = {
        "A": 10,
        "B": 32,
        "C": 16,
        "D": 12,
        "E": 18,
    }
    for column, width in widths.items():
        worksheet.column_dimensions[column].width = width
