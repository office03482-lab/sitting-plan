#!/usr/bin/env python3
"""
Supabase migration runner for 20260601_026_student_issue_entries_fix.sql.

Fixes student_issue_entries column mismatches:
  - Adds student_name, batch_name columns
  - (code-side fixes: entry_date->issue_date, issued_by->issued_by_profile_id)

Usage:
    python backend/scripts/supabase_migrate_026.py --print
    python backend/scripts/supabase_migrate_026.py
"""

import argparse
import os
import sys

_MIGRATION_SQL = """
begin;

alter table inventory.student_issue_entries
  add column if not exists student_name text not null default '',
  add column if not exists batch_name text not null default '';

commit;
"""


def main():
    parser = argparse.ArgumentParser(description="Apply Supabase migration 026 (student_issue_entries fix)")
    parser.add_argument("--print", action="store_true", help="Only print SQL to stdout, don't execute")
    parser.add_argument("--database-url", help="PostgreSQL connection URL (default: from DATABASE_URL env)")
    args = parser.parse_args()

    if args.print:
        print("-- Supabase Migration: 20260601_026_student_issue_entries_fix")
        print("-- Copy and paste this into Supabase Dashboard SQL Editor")
        print(_MIGRATION_SQL)
        return 0

    database_url = args.database_url or os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DATABASE_URL")
    if not database_url:
        print("ERROR: No database URL provided. Set DATABASE_URL or SUPABASE_DATABASE_URL env var.")
        print("")
        print("Alternatively, run with --print to output SQL for manual execution.")
        return 1

    try:
        import psycopg2
    except ImportError:
        print("ERROR: psycopg2 is required for direct execution. Install with: pip install psycopg2-binary")
        return 1

    print("Connecting to database...")
    conn = psycopg2.connect(database_url, connect_timeout=10)
    conn.autocommit = True
    cur = conn.cursor()

    print("Applying migration...")
    cur.execute(_MIGRATION_SQL)
    print("Migration applied successfully!")

    cur.close()
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
