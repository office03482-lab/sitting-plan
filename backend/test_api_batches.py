import requests
import json

url = "http://localhost:8000/api/batches?school_id=1&is_active=true"
response = requests.get(url)
print(f"Status Code: {response.status_code}")
try:
    print(json.dumps(response.json()[:2], indent=2))
except Exception as e:
    print(f"Error parsing JSON: {e}")
    print(response.text)
