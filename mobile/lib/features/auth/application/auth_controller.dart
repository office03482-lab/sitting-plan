import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../../core/models/auth_session.dart';
import '../../../core/storage/secure_store.dart';
import '../data/auth_api.dart';

final secureStoreProvider = Provider<SecureStore>((Ref ref) {
  return SecureStore(const FlutterSecureStorage());
});

final authControllerProvider = StateNotifierProvider<AuthController, AuthState>((Ref ref) {
  return AuthController(ref);
});

class AuthState {
  const AuthState({
    this.session,
    this.loading = false,
    this.initialized = false,
    this.error,
  });

  final AuthSession? session;
  final bool loading;
  final bool initialized;
  final String? error;

  AuthState copyWith({
    AuthSession? session,
    bool? loading,
    bool? initialized,
    String? error,
    bool clearError = false,
  }) {
    return AuthState(
      session: session ?? this.session,
      loading: loading ?? this.loading,
      initialized: initialized ?? this.initialized,
      error: clearError ? null : error ?? this.error,
    );
  }
}

class AuthController extends StateNotifier<AuthState> {
  AuthController(this._ref) : super(const AuthState()) {
    restoreSession();
  }

  final Ref _ref;

  AuthApi get _api => _ref.read(authApiProvider);
  SecureStore get _store => _ref.read(secureStoreProvider);

  Future<void> restoreSession() async {
    state = state.copyWith(loading: true, clearError: true);
    final session = await _store.readSession();
    state = state.copyWith(
      session: session,
      loading: false,
      initialized: true,
    );
  }

  Future<bool> loginWithPassword(String username, String password) async {
    try {
      state = state.copyWith(loading: true, clearError: true);
      final session = await _api.loginWithPassword(username: username, password: password);
      await _store.saveSession(session);
      state = state.copyWith(session: session, loading: false, initialized: true);
      return true;
    } catch (error) {
      state = state.copyWith(
        loading: false,
        initialized: true,
        error: _extractError(error),
      );
      return false;
    }
  }

  Future<void> requestOtp(String email) async {
    state = state.copyWith(loading: true, clearError: true);
    try {
      await _api.sendOtp(email);
      state = state.copyWith(loading: false);
    } catch (error) {
      state = state.copyWith(loading: false, error: _extractError(error));
    }
  }

  Future<bool> verifyOtp(String email, String otpCode) async {
    try {
      state = state.copyWith(loading: true, clearError: true);
      final session = await _api.verifyOtp(email: email, otpCode: otpCode);
      await _store.saveSession(session);
      state = state.copyWith(session: session, loading: false, initialized: true);
      return true;
    } catch (error) {
      state = state.copyWith(
        loading: false,
        initialized: true,
        error: _extractError(error),
      );
      return false;
    }
  }

  Future<AuthSession?> refreshSession() async {
    final current = state.session;
    if (current == null) {
      return null;
    }
    try {
      final refreshed = await _api.refresh(current.refreshToken);
      await _store.saveSession(refreshed);
      state = state.copyWith(session: refreshed);
      return refreshed;
    } catch (_) {
      await signOut();
      return null;
    }
  }

  Future<void> signOut() async {
    final refreshToken = state.session?.refreshToken;
    if (refreshToken != null && refreshToken.isNotEmpty) {
      try {
        await _api.logout(refreshToken);
      } catch (_) {
        // Logout must still clear the device session.
      }
    }
    await _store.clearSession();
    state = const AuthState(initialized: true);
  }

  String _extractError(Object error) {
    final text = error.toString();
    return text.replaceFirst('Exception: ', '');
  }
}
