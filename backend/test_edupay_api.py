import time
import urllib.request


def main() -> None:
    try:
        print("Testing /api/edupay/dashboard directly via HTTP...")
        req = urllib.request.Request("http://127.0.0.1:8000/api/edupay/dashboard")
        req.add_header('Accept', 'application/json')
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


if __name__ == "__main__":
    main()
