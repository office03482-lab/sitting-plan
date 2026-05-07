try:
    from app.main import app
    print("App imported successfully")
except Exception as e:
    print(f"Import error: {e}")