def main() -> None:
    try:
        from app.main import app
        print("App imported successfully", bool(app))
    except Exception as e:
        print(f"Import error: {e}")


if __name__ == "__main__":
    main()
