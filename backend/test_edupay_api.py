import urllib.request
import json
import time

try:
    print("Testing /api/edupay/dashboard directly via HTTP...")
    req = urllib.request.Request("http://127.0.0.1:8000/api/edupay/dashboard")
    req.add_header('Accept', 'application/json')
    # we don't have a token, so we expect 401, but we want to see if it hangs
    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            print(f"Success. Time: {time.time()-start:.2f}s")
    except urllib.error.HTTPError as e:
        print(f"HTTP Error: {e.code}. Time: {time.time()-start:.2f}s")
    except urllib.error.URLError as e:
        print(f"URL Error: {e.reason}. Time: {time.time()-start:.2f}s")
except Exception as e:
    print(f"Error: {e}")
