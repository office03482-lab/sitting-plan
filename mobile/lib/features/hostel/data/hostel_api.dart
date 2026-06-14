import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';

final hostelApiProvider = Provider<HostelApi>((Ref ref) {
  return HostelApi(ref.watch(apiClientProvider));
});

class HostelApi {
  HostelApi(this._dio);

  final Dio _dio;

  Future<List<dynamic>> listHostels() async {
    final response = await _dio.get<List<dynamic>>('/hostels');
    return response.data ?? const <dynamic>[];
  }

  Future<List<dynamic>> listHostelRequests() async {
    final response = await _dio.get<List<dynamic>>('/students/hostel-requests');
    return response.data ?? const <dynamic>[];
  }
}
