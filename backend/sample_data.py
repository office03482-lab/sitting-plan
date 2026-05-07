"""Sample seed data used by local setup scripts."""

from app.models import DoorLocation


def get_sample_students():
    """Return sample students compatible with current Student schema."""
    return [
        {
            "roll_number": "101",
            "name": "Aarav Kumar",
            "father_name": "Rakesh Kumar",
            "batch": "11th",
            "email": "aarav@school.edu",
            "special_needs": None,
        },
        {
            "roll_number": "102",
            "name": "Bhavna Singh",
            "father_name": "Mohan Singh",
            "batch": "11th",
            "email": "bhavna@school.edu",
            "special_needs": None,
        },
        {
            "roll_number": "201",
            "name": "Chetan Patel",
            "father_name": "Dilip Patel",
            "batch": "12th",
            "email": "chetan@school.edu",
            "special_needs": None,
        },
        {
            "roll_number": "202",
            "name": "Divya Sharma",
            "father_name": "Lokesh Sharma",
            "batch": "12th",
            "email": "divya@school.edu",
            "special_needs": "wheelchair_accessible",
            "requires_near_exit": True,
        },
        {
            "roll_number": "301",
            "name": "Eshan Gupta",
            "father_name": "Suresh Gupta",
            "batch": "Dropper 1",
            "email": "eshan@school.edu",
            "special_needs": None,
        },
        {
            "roll_number": "302",
            "name": "Fiona Raja",
            "father_name": "Vinod Raja",
            "batch": "Dropper 1",
            "email": "fiona@school.edu",
            "special_needs": None,
        },
    ]


def get_sample_rooms():
    """Return sample rooms compatible with current Room schema."""
    return [
        {
            "name": "Main Exam Hall A",
            "length_feet": 50.0,
            "width_feet": 40.0,
            "desk_length_feet": 2.0,
            "desk_width_feet": 3.0,
            "num_benches": 20,
            "capacity": 40,
            "teaching_zone_clearance_feet": 5.0,
            "aisle_width_feet": 3.0,
            "door_location": DoorLocation.left,
            "window_location": "right",
            "glare_mitigation": True,
            "is_accessible": True,
        },
        {
            "name": "Main Exam Hall B",
            "length_feet": 42.0,
            "width_feet": 34.0,
            "desk_length_feet": 2.0,
            "desk_width_feet": 3.0,
            "num_benches": 16,
            "capacity": 32,
            "teaching_zone_clearance_feet": 5.0,
            "aisle_width_feet": 3.0,
            "door_location": DoorLocation.right,
            "window_location": "left",
            "glare_mitigation": False,
            "is_accessible": False,
        },
    ]


def get_sample_teachers():
    """Return sample teachers compatible with current Teacher schema."""
    return [
        {
            "name": "Anita Mehra",
            "subject": "Mathematics",
            "email": "anita@school.edu",
            "phone": "+91-9000000001",
        },
        {
            "name": "Rohit Verma",
            "subject": "Physics",
            "email": "rohit@school.edu",
            "phone": "+91-9000000002",
        },
        {
            "name": "Sonal Jain",
            "subject": "Chemistry",
            "email": "sonal@school.edu",
            "phone": "+91-9000000003",
        },
    ]
