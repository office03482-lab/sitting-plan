import sqlite3

conn = sqlite3.connect('seating_planner.db')
cur = conn.cursor()

# Get some students and their batch info
cur.execute("SELECT id, roll_number, batch_id, batch FROM students LIMIT 10")
students = cur.fetchall()
print("Students (id, roll, batch_id, batch):")
for s in students:
    print(s)

cur.execute("SELECT id, name FROM batches LIMIT 10")
batches = cur.fetchall()
print("\nBatches (id, name):")
for b in batches:
    print(b)

conn.close()
