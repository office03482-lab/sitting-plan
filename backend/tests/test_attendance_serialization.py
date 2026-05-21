from datetime import date, datetime
from pathlib import Path
import sys

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.services.supabase_attendance import _iso_datetime


def test_iso_datetime_normalizes_date_instance():
    assert _iso_datetime(date(2026, 5, 21)) == "2026-05-21T00:00:00"


def test_iso_datetime_preserves_datetime_instance():
    assert _iso_datetime(datetime(2026, 5, 21, 9, 30, 0)) == "2026-05-21T09:30:00"


def test_iso_datetime_normalizes_plain_date_string():
    assert _iso_datetime("2026-05-21") == "2026-05-21T00:00:00"

