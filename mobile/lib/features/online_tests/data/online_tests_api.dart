import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';

final onlineTestsApiProvider = Provider<OnlineTestsApi>((Ref ref) {
  return OnlineTestsApi(ref.watch(apiClientProvider));
});

class OnlineTestsApi {
  OnlineTestsApi(this._dio);

  final Dio _dio;

  Future<List<dynamic>> listTests() async {
    final response = await _dio.get<List<dynamic>>('/online-tests/tests');
    return response.data ?? const <dynamic>[];
  }

  Future<List<dynamic>> listAttempts() async {
    final response = await _dio.get<List<dynamic>>('/online-tests/attempts');
    return response.data ?? const <dynamic>[];
  }
}
