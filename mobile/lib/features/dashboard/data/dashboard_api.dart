import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';

final dashboardApiProvider = Provider<DashboardApi>((Ref ref) {
  return DashboardApi(ref.watch(apiClientProvider));
});

class DashboardApi {
  DashboardApi(this._dio);

  final Dio _dio;

  Future<Map<String, dynamic>> getDashboardMetrics() async {
    final response = await _dio.get<Map<String, dynamic>>('/dashboard/metrics');
    return response.data ?? <String, dynamic>{};
  }
}
