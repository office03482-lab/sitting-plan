import os
import time
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv(".env")
load_dotenv(".env.local")

from app.services.supabase_edupay import _fetch_students, _fetch_assignments, _fetch_batches

def test_db():
    try:
        from app.services.supabase_admin import get_supabase_admin_client
        client = get_supabase_admin_client()
        res = client.table("students").select("school_id").limit(1).execute()
        if not res.data:
            return
        school_id = str(res.data[0]['school_id'])
        
        start = time.time()
        s = _fetch_students(school_id)
        print(f"_fetch_students: {time.time()-start:.2f}s, Count: {len(s)}")

        start = time.time()
        a = _fetch_assignments(school_id)
        print(f"_fetch_assignments: {time.time()-start:.2f}s, Count: {len(a)}")

        if s:
            batch_ids = [str(item.get("batch_id")) for item in s if item.get("batch_id")]
            start = time.time()
            b = _fetch_batches(batch_ids)
            print(f"_fetch_batches: {time.time()-start:.2f}s, Count: {len(b)}")

    except Exception as e:
        print(f"query failed: {e}")

if __name__ == '__main__':
    test_db()
