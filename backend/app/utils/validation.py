"""
Validation utilities
"""
from typing import List, Dict, Tuple


class ValidationError:
    """Validation error information"""
    
    def __init__(self, field: str, message: str, code: str = "invalid"):
        self.field = field
        self.message = message
        self.code = code
    
    def to_dict(self) -> Dict:
        return {
            "field": self.field,
            "message": self.message,
            "code": self.code,
        }


def validate_room_config(room_data: Dict) -> Tuple[bool, List[ValidationError]]:
    """
    Validate room configuration data.
    
    Returns:
        (is_valid, errors)
    """
    errors = []
    
    # Check required fields
    if not room_data.get('name'):
        errors.append(ValidationError('name', 'Room name is required'))
    
    # Check dimensions
    if not room_data.get('length_feet') or room_data['length_feet'] <= 0:
        errors.append(ValidationError('length_feet', 'Room length must be positive'))
    
    if not room_data.get('width_feet') or room_data['width_feet'] <= 0:
        errors.append(ValidationError('width_feet', 'Room width must be positive'))
    
    # Check desks
    if not room_data.get('num_benches') or room_data['num_benches'] <= 0:
        errors.append(ValidationError('num_benches', 'Number of benches must be positive'))
    
    # Check clearances
    if room_data.get('teaching_zone_clearance_feet', 0) < 0:
        errors.append(ValidationError('teaching_zone_clearance_feet', 'Teaching zone clearance must be non-negative'))
    
    if room_data.get('aisle_width_feet', 0) < 0:
        errors.append(ValidationError('aisle_width_feet', 'Aisle width must be non-negative'))
    
    return len(errors) == 0, errors


def validate_student_data(student_data: Dict) -> Tuple[bool, List[ValidationError]]:
    """
    Validate student data.
    
    Returns:
        (is_valid, errors)
    """
    errors = []
    
    # Required fields
    if not student_data.get('name'):
        errors.append(ValidationError('name', 'Student name is required'))
    
    if not student_data.get('roll_number'):
        errors.append(ValidationError('roll_number', 'Roll number is required'))
    
    if not student_data.get('batch'):
        errors.append(ValidationError('batch', 'Batch is required'))
    
    # Email validation (optional but if provided, should be valid)
    if student_data.get('email'):
        if '@' not in student_data['email']:
            errors.append(ValidationError('email', 'Invalid email format'))
    
    return len(errors) == 0, errors


def validate_exam_data(exam_data: Dict) -> Tuple[bool, List[ValidationError]]:
    """
    Validate exam data.
    
    Returns:
        (is_valid, errors)
    """
    errors = []
    
    if not exam_data.get('name'):
        errors.append(ValidationError('name', 'Exam name is required'))
    
    if exam_data.get('total_students', 0) < 0:
        errors.append(ValidationError('total_students', 'Total students cannot be negative'))
    
    return len(errors) == 0, errors
