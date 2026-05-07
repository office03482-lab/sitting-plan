import sqlite3

conn = sqlite3.connect('seating_planner.db')
cur = conn.cursor()

# Get all table names
cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = cur.fetchall()
print("Database Tables:")
for table in tables:
    cur.execute(f"SELECT COUNT(*) FROM {table[0]}")
    count = cur.fetchone()[0]
    print(f"  {table[0]}: {count} records")

print("\nBatches table schema:")
cur.execute("PRAGMA table_info(batches)")
columns = cur.fetchall()
for col in columns:
    print(f"  {col[1]}: {col[2]} {'(NOT NULL)' if col[3] else '(NULL)'}")

conn.close()
