"""
Utility functions for common operations
"""


def batch_to_priority(batch: str) -> int:
    """
    Convert batch to priority number for distribution.
    Used to balance students across desks.
    """
    batch_priority = {
        '11th': 0,
        '12th': 1,
        'Dropper 1': 2,
        'Dropper 2': 3,
        'Dropper 3': 4,
        'Dropper 4': 5,
        'Dropper 5': 6,
        'Dropper 6': 7,
        'Dropper 7': 8,
        'Dropper 8': 9,
        'Dropper 9': 10,
        'Dropper 10': 11,
    }
    return batch_priority.get(batch, 99)


def calculate_occupancy_rate(occupied: int, total: int) -> float:
    """Calculate occupancy rate as percentage"""
    if total == 0:
        return 0.0
    return round((occupied / total) * 100, 2)


def format_room_dimensions(length: float, width: float) -> str:
    """Format room dimensions for display"""
    return f"{length}ft × {width}ft"
