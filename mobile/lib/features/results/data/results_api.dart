import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';

final resultsApiProvider = Provider<ResultsApi>((Ref ref) {
  return ResultsApi(ref.watch(apiClientProvider));
});

class ResultsApi {
  ResultsApi(this._dio);

  final Dio _dio;

  Future<List<dynamic>> listOnlineTestResults() async {
    final response = await _dio.get<List<dynamic>>('/online-tests/results');
    return response.data ?? const <dynamic>[];
  }

  Future<Map<String, dynamic>> getParentPortal() async {
    final response = await _dio.get<Map<String, dynamic>>('/edupay/parent-portal');
    return response.data ?? <String, dynamic>{};
  }
}
