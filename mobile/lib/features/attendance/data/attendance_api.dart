import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';

final attendanceApiProvider = Provider<AttendanceApi>((Ref ref) {
  return AttendanceApi(ref.watch(apiClientProvider));
});

class AttendanceApi {
  AttendanceApi(this._dio);

  final Dio _dio;

  Future<Map<String, dynamic>> getOverview() async {
    final response = await _dio.get<Map<String, dynamic>>('/attendance/overview');
    return response.data ?? <String, dynamic>{};
  }

  Future<List<dynamic>> getStudentRecords() async {
    final response = await _dio.get<List<dynamic>>('/attendance/student-records');
    return response.data ?? const <dynamic>[];
  }

  Future<List<dynamic>> getStaffRecords() async {
    final response = await _dio.get<List<dynamic>>('/attendance/staff-records');
    return response.data ?? const <dynamic>[];
  }
}
