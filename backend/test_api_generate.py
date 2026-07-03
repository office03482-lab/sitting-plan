import json

import requests


def main() -> None:
    url = "http://localhost:8000/api/seating/generate"
    payload = {
      "exam_id": 1,
      "room_ids": [1],
      "batches": ["SSB 11TH AIIMS"],
      "plan_type": "strict"
    }
    response = requests.post(url, json=payload)
    print(f"Status Code: {response.status_code}")
    try:
        print(json.dumps(response.json(), indent=2))
    except Exception:
        print(response.text)


if __name__ == "__main__":
    main()
