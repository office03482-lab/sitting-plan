import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/auth/application/auth_controller.dart';
import '../config/app_environment.dart';

final apiClientProvider = Provider<Dio>((Ref ref) {
  final dio = Dio(
    BaseOptions(
      baseUrl: AppEnvironment.apiBaseUrl,
      connectTimeout: const Duration(seconds: 20),
      receiveTimeout: const Duration(seconds: 30),
      sendTimeout: const Duration(seconds: 30),
      headers: <String, Object>{
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    ),
  );

  dio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (RequestOptions options, RequestInterceptorHandler handler) {
        final session = ref.read(authControllerProvider).session;
        if (session != null) {
          options.headers['Authorization'] = 'Bearer ${session.accessToken}';
        }
        handler.next(options);
      },
      onError: (DioException error, ErrorInterceptorHandler handler) async {
        final refreshToken = ref.read(authControllerProvider).session?.refreshToken;
        final request = error.requestOptions;
        final skipRefresh = request.extra['skipAuthRefresh'] == true;
        if (error.response?.statusCode == 401 && refreshToken != null && !skipRefresh) {
          final refreshed = await ref.read(authControllerProvider.notifier).refreshSession();
          if (refreshed != null) {
            request.headers['Authorization'] = 'Bearer ${refreshed.accessToken}';
            final cloned = await dio.fetch<dynamic>(request);
            handler.resolve(cloned);
            return;
          }
        }
        handler.next(error);
      },
    ),
  );

  return dio;
});
