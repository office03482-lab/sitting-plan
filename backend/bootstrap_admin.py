"""One-time initial admin bootstrap command (Supabase-native)."""
from app.services.admin_bootstrap import bootstrap_initial_admin


def main():
    result = bootstrap_initial_admin()
    print(f"Initial admin ready: {result['username']} <{result['email']}> (profile_id={result['profile_id']})")


if __name__ == "__main__":
    main()
