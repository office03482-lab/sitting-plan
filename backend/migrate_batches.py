#!/usr/bin/env python
"""
Database migration script for batch management system
Updates the schema to add batches table and batch_id foreign key to students
"""
import sys
sys.path.insert(0, '/c/Users/GIRISH/Desktop/SITTING PLAN/backend')

from sqlalchemy import inspect, text, Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.database import engine, Base
from app.models import BatchTable, Student

def migrate_database():
    """Apply schema updates for batch management"""
    
    with engine.begin() as connection:
        inspector = inspect(engine)
        
        # Check if batches table exists
        if 'batches' not in inspector.get_table_names():
            print("Creating batches table...")
            Base.metadata.create_all(engine, tables=[BatchTable.__table__])
            print("✓ Batches table created")
        else:
            print("✓ Batches table already exists")
        
        # Check if students table has batch_id column
        if 'students' in inspector.get_table_names():
            students_columns = {col['name'] for col in inspector.get_columns('students')}
            
            if 'batch_id' not in students_columns:
                print("Adding batch_id column to students table...")
                connection.execute(text("""
                    ALTER TABLE students ADD COLUMN batch_id INTEGER
                """))
                print("✓ batch_id column added")
            else:
                print("✓ batch_id column already exists")
            
            # Add foreign key constraint if not exists
            try:
                # Check if constraint exists
                constraints = inspector.get_foreign_keys('students')
                fk_exists = any(fk['constrained_columns'] == ['batch_id'] for fk in constraints)
                
                if not fk_exists:
                    print("Adding foreign key constraint...")
                    connection.execute(text("""
                        ALTER TABLE students ADD CONSTRAINT fk_students_batch_id
                        FOREIGN KEY (batch_id) REFERENCES batches(id)
                    """))
                    print("✓ Foreign key constraint added")
                else:
                    print("✓ Foreign key constraint already exists")
            except Exception as e:
                print(f"Note: {str(e)}")
        
        print("\n✓ Database migration completed successfully!")

if __name__ == '__main__':
    try:
        migrate_database()
    except Exception as e:
        print(f"✗ Migration failed: {str(e)}")
        sys.exit(1)
