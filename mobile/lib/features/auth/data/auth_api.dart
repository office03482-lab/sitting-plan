import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/auth_session.dart';
import '../../../core/network/api_client.dart';

final authApiProvider = Provider<AuthApi>((Ref ref) {
  return AuthApi(ref.watch(apiClientProvider));
});

class AuthApi {
  AuthApi(this._dio);

  final Dio _dio;

  Future<AuthSession> loginWithPassword({
    required String username,
    required String password,
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/auth/login-password',
      data: <String, dynamic>{
        'username': username,
        'password': password,
      },
    );
    return AuthSession.fromJson(response.data ?? <String, dynamic>{});
  }

  Future<void> sendOtp(String email) async {
    await _dio.post<void>(
      '/auth/send-otp',
      data: <String, dynamic>{'email': email},
    );
  }

  Future<AuthSession> verifyOtp({
    required String email,
    required String otpCode,
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/auth/verify-otp',
      data: <String, dynamic>{
        'email': email,
        'otp_code': otpCode,
      },
    );
    return AuthSession.fromJson(response.data ?? <String, dynamic>{});
  }

  Future<AuthSession> refresh(String refreshToken) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/auth/refresh',
      data: <String, dynamic>{'refresh_token': refreshToken},
      options: Options(extra: <String, Object>{'skipAuthRefresh': true}),
    );
    return AuthSession.fromJson(response.data ?? <String, dynamic>{});
  }

  Future<void> logout(String refreshToken) async {
    await _dio.post<void>(
      '/auth/logout',
      data: <String, dynamic>{'refresh_token': refreshToken},
    );
  }
}
