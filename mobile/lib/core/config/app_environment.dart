class AppEnvironment {
  const AppEnvironment._();

  static const String appName = 'Dr. Girish ERP';
  static const String apiBaseUrl = String.fromEnvironment(
    'ERP_API_BASE_URL',
    defaultValue: 'http://127.0.0.1:8000/api',
  );
  static const String supabaseUrl = String.fromEnvironment('SUPABASE_URL', defaultValue: '');
  static const String supabaseAnonKey = String.fromEnvironment('SUPABASE_ANON_KEY', defaultValue: '');
  static const String firebaseProjectId = String.fromEnvironment('FIREBASE_PROJECT_ID', defaultValue: '');
}
