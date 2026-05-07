import pytest

from app.models import DoorLocation
from app.schemas import RoomCreate, normalize_door_location


@pytest.mark.parametrize(
    ("raw_value", "expected"),
    [
        ("front", DoorLocation.top.value),
        ("back", DoorLocation.bottom.value),
        ("Front Left", DoorLocation.top_left.value),
        ("right-front", DoorLocation.top_right.value),
        ("left_back", DoorLocation.bottom_left.value),
        ("bottom right", DoorLocation.bottom_right.value),
        ("left", DoorLocation.left.value),
    ],
)
def test_normalize_door_location_accepts_aliases(raw_value, expected):
    assert normalize_door_location(raw_value, default=DoorLocation.left.value) == expected


def test_normalize_door_location_rejects_unknown_values():
    with pytest.raises(ValueError, match="Invalid door_location"):
        normalize_door_location("middle")


def test_room_create_defaults_door_location_to_left():
    room = RoomCreate(
        name="Room A",
        length_feet=30,
        width_feet=20,
        num_benches=12,
    )

    assert room.door_location == DoorLocation.left.value
