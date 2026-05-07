import sqlite3
import sys

try:
    conn = sqlite3.connect('seating_planner.db')
    cur = conn.cursor()
    
    cur.execute("SELECT COUNT(*) FROM students WHERE batch='SSB 11TH AIIMS'")
    count = cur.fetchone()[0]
    print(f'Students in SSB 11TH AIIMS by string: {count}')
    
    cur.execute("SELECT COUNT(*) FROM students WHERE batch_id=1")
    count2 = cur.fetchone()[0]
    print(f'Students in batch_id=1: {count2}')
    
    conn.close()
except Exception as e:
    print(f'Error: {e}')
