import requests


def main() -> None:
    url = "http://localhost:8000/api/students?school_id=1&skip=0&limit=10000&batch=SSB 11TH AIIMS"
    response = requests.get(url)
    print(f"Status Code: {response.status_code}")
    print(f"Data count: {len(response.json())}")
    if len(response.json()) > 0:
        print(f"First student: {response.json()[0]}")


if __name__ == "__main__":
    main()
