import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';

final classesApiProvider = Provider<ClassesApi>((Ref ref) {
  return ClassesApi(ref.watch(apiClientProvider));
});

class ClassesApi {
  ClassesApi(this._dio);

  final Dio _dio;

  Future<List<dynamic>> listTimetableEntries() async {
    final response = await _dio.get<List<dynamic>>('/timetable');
    return response.data ?? const <dynamic>[];
  }

  Future<Map<String, dynamic>> getTeacherContext() async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/attendance/teacher-current-class',
      queryParameters: <String, dynamic>{
        'target_date': DateTime.now().toIso8601String().split('T').first,
      },
    );
    return response.data ?? <String, dynamic>{};
  }
}
