import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/cache/app_cache_store.dart';
import '../../../core/models/user_profile.dart';
import '../../../core/network/api_client.dart';

final mobilePortalRepositoryProvider = Provider<MobilePortalRepository>((Ref ref) {
  return MobilePortalRepository(
    ref.watch(apiClientProvider),
    ref.watch(appCacheStoreProvider),
  );
});

class MobilePortalRepository {
  MobilePortalRepository(this._dio, this._cache);

  final Dio _dio;
  final AppCacheStore _cache;

  static const Duration _standardTtl = Duration(minutes: 15);
  static const Duration _offlineTtl = Duration(hours: 12);

  Future<Map<String, dynamic>> loadStudentDashboard(UserProfile profile) async {
    return _cachedMap(
      'student_dashboard_${profile.userId}',
      () async {
        final responses = await Future.wait<Object>(<Future<Object>>[
          _getMap('/attendance/dashboard'),
          _getList('/online-tests/tests'),
          _getList('/online-tests/results'),
          _getMap('/lms/progress'),
          _getList('/timetable'),
          _getList('/lms/assignments'),
          _getList('/live-classes'),
        ]);
        return <String, dynamic>{
          'attendance': responses[0],
          'tests': responses[1],
          'results': responses[2],
          'progress': responses[3],
          'timetable': responses[4],
          'assignments': responses[5],
          'live_classes': responses[6],
        };
      },
    );
  }

  Future<Map<String, dynamic>> loadTeacherDashboard(UserProfile profile) async {
    return _cachedMap(
      'teacher_dashboard_${profile.userId}',
      () async {
        final responses = await Future.wait<Object>(<Future<Object>>[
          _getList('/online-tests/tests'),
          _getMap('/online-tests/results/analytics'),
          _getMap('/attendance/teacher-current-class'),
          _getList('/timetable'),
          _getList('/lms/assignments'),
          _getList('/lms/courses'),
          _getList('/live-classes'),
        ]);
        return <String, dynamic>{
          'tests': responses[0],
          'analytics': responses[1],
          'current_class': responses[2],
          'timetable': responses[3],
          'assignments': responses[4],
          'courses': responses[5],
          'live_classes': responses[6],
        };
      },
    );
  }

  Future<Map<String, dynamic>> loadParentDashboard(UserProfile profile) async {
    return _cachedMap(
      'parent_dashboard_${profile.userId}',
      () async {
        final responses = await Future.wait<Object>(<Future<Object>>[
          _getMap('/parent/dashboard'),
          _getMap('/parent/insights'),
          _getMap('/parent/risk-score'),
          _getMap('/parent/alerts'),
          _getMap('/edupay/parent-portal'),
          _getList('/online-tests/results'),
          _getMap('/lms/progress'),
          _getList('/live-classes'),
        ]);
        return <String, dynamic>{
          'parent_dashboard': responses[0],
          'parent_insights': responses[1],
          'parent_risk_score': responses[2],
          'parent_alerts': responses[3],
          'portal': responses[4],
          'results': responses[5],
          'progress': responses[6],
          'live_classes': responses[7],
        };
      },
    );
  }

  Future<Map<String, dynamic>> loadStudentAttendance(UserProfile profile) async {
    return _cachedMap(
      'student_attendance_${profile.userId}',
      () async {
        final responses = await Future.wait<Object>(<Future<Object>>[
          _getMap('/attendance/dashboard'),
          _getList('/attendance/student-records'),
          _getList('/attendance/calendar'),
        ]);
        return <String, dynamic>{
          'dashboard': responses[0],
          'records': responses[1],
          'calendar': responses[2],
        };
      },
    );
  }

  Future<Map<String, dynamic>> loadTeacherAttendance(UserProfile profile) async {
    return _cachedMap(
      'teacher_attendance_${profile.userId}',
      () async {
        final responses = await Future.wait<Object>(<Future<Object>>[
          _getMap('/attendance/teacher-current-class'),
          _getMap('/attendance/staff-dashboard'),
          _getList('/attendance/leaves'),
        ]);
        return <String, dynamic>{
          'current_class': responses[0],
          'staff_dashboard': responses[1],
          'leaves': responses[2],
        };
      },
    );
  }

  Future<Map<String, dynamic>> loadParentAttendance(UserProfile profile) async {
    return _cachedMap(
      'parent_attendance_${profile.userId}',
      () async {
        return <String, dynamic>{
          'portal': await _getMap('/edupay/parent-portal'),
        };
      },
    );
  }

  Future<Map<String, dynamic>> loadHostelSnapshot(UserProfile profile) async {
    return _cachedMap(
      'hostel_${profile.userId}',
      () async {
        final query = <String, dynamic>{};
        if ((profile.schoolId ?? '').isNotEmpty) {
          query['school_id'] = profile.schoolId;
        }
        final requests = await _getList(
          '/students/hostel-requests',
          queryParameters: query.isEmpty ? null : query,
        );
        return <String, dynamic>{
          'requests': requests,
          'school_id': profile.schoolId,
        };
      },
    );
  }

  Future<List<Map<String, dynamic>>> loadTests(UserProfile profile) async {
    return _cachedList(
      'tests_${profile.userId}',
      () => _getList('/online-tests/tests'),
      ttl: _offlineTtl,
    );
  }

  Future<List<Map<String, dynamic>>> loadResults(UserProfile profile) async {
    return _cachedList(
      'results_${profile.userId}',
      () => _getList('/online-tests/results'),
      ttl: _offlineTtl,
    );
  }

  Future<Map<String, dynamic>> loadCourses(UserProfile profile) async {
    return _cachedMap(
      'courses_${profile.userId}',
      () async {
        final responses = await Future.wait<Object>(<Future<Object>>[
          _getList('/lms/courses'),
          _getMap('/lms/progress'),
        ]);
        return <String, dynamic>{
          'courses': responses[0],
          'progress': responses[1],
        };
      },
      ttl: _offlineTtl,
    );
  }

  Future<List<Map<String, dynamic>>> loadAssignments(UserProfile profile) async {
    return _cachedList(
      'assignments_${profile.userId}',
      () => _getList('/lms/assignments'),
      ttl: _offlineTtl,
    );
  }

  Future<List<Map<String, dynamic>>> loadTimetable(UserProfile profile) async {
    return _cachedList(
      'timetable_${profile.userId}',
      () => _getList('/timetable'),
      ttl: _offlineTtl,
    );
  }

  Future<List<Map<String, dynamic>>> loadLiveClasses(UserProfile profile) async {
    return _cachedList(
      'live_classes_${profile.userId}',
      () => _getList('/live-classes'),
      ttl: _offlineTtl,
    );
  }

  Future<Map<String, dynamic>> loadNotifications(UserProfile profile) async {
    return _cachedMap(
      'notifications_${profile.userId}',
      () async {
        final responses = await Future.wait<Object>(<Future<Object>>[
          _getMap('/attendance/overview'),
          _getList('/online-tests/tests'),
          _getList('/lms/assignments'),
          _getList('/live-classes'),
        ]);
        final overview = _asMap(responses[0]);
        final notifications = _asListOfMaps(overview['notifications']);
        final tests = _asListOfMaps(responses[1]);
        final assignments = _asListOfMaps(responses[2]);
        final liveClasses = _asListOfMaps(responses[3]);

        final derived = <Map<String, dynamic>>[
          ...notifications,
          ...tests.take(3).map(
            (item) => <String, dynamic>{
              'title': item['title'] ?? 'Upcoming test',
              'message': item['description'] ?? item['subject_name'] ?? 'A scheduled online test is available.',
              'notification_type': 'online_tests',
            },
          ),
          ...assignments.take(3).map(
            (item) => <String, dynamic>{
              'title': item['title'] ?? 'Assignment due',
              'message': item['due_at'] != null
                  ? 'Due on ${item['due_at']}'
                  : 'An assignment is ready for review.',
              'notification_type': 'assignments',
            },
          ),
          ...liveClasses.take(3).map(
            (Map<String, dynamic> item) => <String, dynamic>{
              'title': item['status'] == 'live'
                  ? 'Class is live now'
                  : 'Upcoming live class',
              'message': item['timetable_entry'] is Map<String, dynamic>
                  ? '${item['timetable_entry']['class_name'] ?? 'Class'} - ${item['timetable_entry']['subject'] ?? ''}'
                  : (item['session_date'] ?? 'Live class update'),
              'notification_type': 'live_classes',
            },
          ),
        ];

        return <String, dynamic>{
          'notifications': derived,
          'holidays': overview['holidays'] ?? const <dynamic>[],
        };
      },
      ttl: _offlineTtl,
    );
  }

  Future<Map<String, dynamic>> loadProfileSnapshot(UserProfile profile) async {
    return _cachedMap(
      'profile_${profile.userId}',
      () async {
        Map<String, dynamic> schoolAnalytics = const <String, dynamic>{};
        if ((profile.schoolId ?? '').isNotEmpty && (profile.isAdmin || profile.isTeacher)) {
          schoolAnalytics = await _getMap('/analytics/school/${profile.schoolId}');
        }

        return <String, dynamic>{
          'profile': profile.toJson(),
          'school_analytics': schoolAnalytics,
        };
      },
    );
  }

  Future<Map<String, dynamic>> loadTeacherAnalytics(UserProfile profile) async {
    return _cachedMap(
      'teacher_analytics_${profile.userId}',
      () async {
        final responses = await Future.wait<Object>(<Future<Object>>[
          _getMap('/online-tests/results/analytics'),
          if ((profile.schoolId ?? '').isNotEmpty) _getMap('/analytics/school/${profile.schoolId}'),
        ]);
        return <String, dynamic>{
          'test_analytics': responses.first,
          'school_analytics': responses.length > 1 ? responses[1] : const <String, dynamic>{},
        };
      },
    );
  }

  Future<Map<String, dynamic>> loadParentFees(UserProfile profile) async {
    return _cachedMap(
      'parent_fees_${profile.userId}',
      () => _getMap('/edupay/parent-portal'),
      ttl: _offlineTtl,
    );
  }

  Future<Map<String, dynamic>> loadPlatformAnalytics(UserProfile profile) async {
    return _cachedMap(
      'platform_analytics_${profile.userId}',
      () => _getMap('/analytics/platform'),
    );
  }

  Future<Map<String, dynamic>> loadAcademicBi({String period = 'monthly'}) {
    return _getMap('/bi/academic', queryParameters: <String, dynamic>{'period': period});
  }

  Future<Map<String, dynamic>> loadFinanceBi({String period = 'monthly'}) {
    return _getMap('/bi/finance', queryParameters: <String, dynamic>{'period': period});
  }

  Future<Map<String, dynamic>> loadOperationsBi({String period = 'monthly'}) {
    return _getMap('/bi/operations', queryParameters: <String, dynamic>{'period': period});
  }

  Future<Map<String, dynamic>> loadPlatformBi({String period = 'monthly'}) {
    return _getMap('/bi/platform', queryParameters: <String, dynamic>{'period': period});
  }

  Future<List<Map<String, dynamic>>> loadBiReports() {
    return _getList('/bi/reports');
  }

  Future<Map<String, dynamic>> loadStudyPlannerToday(UserProfile profile) async {
    return _cachedMap(
      'study_planner_today_${profile.userId}',
      () => _getMap('/study-planner/today'),
      ttl: _offlineTtl,
    );
  }

  Future<Map<String, dynamic>> loadStudyPlannerWeek(UserProfile profile) async {
    return _cachedMap(
      'study_planner_week_${profile.userId}',
      () => _getMap('/study-planner/week'),
      ttl: _offlineTtl,
    );
  }

  Future<Map<String, dynamic>> loadStudyPlannerRecommendations(UserProfile profile) async {
    return _cachedMap(
      'study_planner_recommendations_${profile.userId}',
      () => _getMap('/study-planner/recommendations'),
      ttl: _offlineTtl,
    );
  }

  Future<Map<String, dynamic>> aiTutorChat(Map<String, dynamic> payload) {
    return _postMap('/ai/chat', payload);
  }

  Future<Map<String, dynamic>> aiTutorExplain(Map<String, dynamic> payload) {
    return _postMap('/ai/explain', payload);
  }

  Future<Map<String, dynamic>> aiTutorPractice(Map<String, dynamic> payload) {
    return _postMap('/ai/practice', payload);
  }

  Future<Map<String, dynamic>> aiTutorRevision(Map<String, dynamic> payload) {
    return _postMap('/ai/revision', payload);
  }

  Future<Map<String, dynamic>> solveTextDoubt(Map<String, dynamic> payload) {
    return _postMap('/doubts/text', payload);
  }

  Future<Map<String, dynamic>> solveImageDoubt(Map<String, dynamic> payload) {
    return _postMap('/doubts/image', payload);
  }

  Future<Map<String, dynamic>> solvePdfDoubt(Map<String, dynamic> payload) {
    return _postMap('/doubts/pdf', payload);
  }

  Future<List<Map<String, dynamic>>> loadDoubtHistory({
    String? targetStudentId,
    int limit = 12,
  }) {
    return _getList(
      '/doubts/history',
      queryParameters: <String, dynamic>{
        if ((targetStudentId ?? '').trim().isNotEmpty) 'target_student_id': targetStudentId,
        'limit': limit,
      },
    );
  }

  Future<Map<String, dynamic>> generateTeacherQuestionPaper(Map<String, dynamic> payload) {
    return _postMap('/teacher-ai/question-paper', payload);
  }

  Future<Map<String, dynamic>> generateTeacherAssignment(Map<String, dynamic> payload) {
    return _postMap('/teacher-ai/assignment', payload);
  }

  Future<Map<String, dynamic>> generateTeacherLessonPlan(Map<String, dynamic> payload) {
    return _postMap('/teacher-ai/lesson-plan', payload);
  }

  Future<Map<String, dynamic>> generateTeacherReportComments(Map<String, dynamic> payload) {
    return _postMap('/teacher-ai/report-comments', payload);
  }

  Future<Map<String, dynamic>> createCommerceOrder(Map<String, dynamic> payload) {
    return _postMap('/payments/create-order', payload);
  }

  Future<Map<String, dynamic>> verifyCommerceOrder(Map<String, dynamic> payload) {
    return _postMap('/payments/verify', payload);
  }

  Future<Map<String, dynamic>> loadCommerceSubscriptions({bool schoolScope = false}) {
    return _getMap('/subscriptions', queryParameters: <String, dynamic>{'school_scope': schoolScope});
  }

  Future<Map<String, dynamic>> applyCommerceCoupon(Map<String, dynamic> payload) {
    return _postMap('/coupons/apply', payload);
  }

  Future<Map<String, dynamic>> loadRevenueDashboard({bool globalView = false}) {
    return _getMap('/revenue/dashboard', queryParameters: <String, dynamic>{'global_view': globalView});
  }

  Future<Map<String, dynamic>> _cachedMap(
    String key,
    Future<Map<String, dynamic>> Function() loader, {
    Duration ttl = _standardTtl,
  }) async {
    final cached = await _cache.read(key);
    if (cached != null && cached.isFresh(ttl)) {
      return _asMap(cached.payload);
    }

    try {
      final fresh = await loader();
      await _cache.write(key, fresh);
      return fresh;
    } on DioException {
      if (cached != null) {
        return _asMap(cached.payload);
      }
      rethrow;
    }
  }

  Future<List<Map<String, dynamic>>> _cachedList(
    String key,
    Future<List<Map<String, dynamic>>> Function() loader, {
    Duration ttl = _standardTtl,
  }) async {
    final cached = await _cache.read(key);
    if (cached != null && cached.isFresh(ttl)) {
      return _asListOfMaps(cached.payload);
    }

    try {
      final fresh = await loader();
      await _cache.write(key, fresh);
      return fresh;
    } on DioException {
      if (cached != null) {
        return _asListOfMaps(cached.payload);
      }
      rethrow;
    }
  }

  Future<Map<String, dynamic>> _getMap(
    String path, {
    Map<String, dynamic>? queryParameters,
  }) async {
    final response = await _dio.get<dynamic>(
      path,
      queryParameters: queryParameters,
    );
    return _asMap(response.data);
  }

  Future<List<Map<String, dynamic>>> _getList(
    String path, {
    Map<String, dynamic>? queryParameters,
  }) async {
    final response = await _dio.get<dynamic>(
      path,
      queryParameters: queryParameters,
    );
    return _asListOfMaps(response.data);
  }

  Future<Map<String, dynamic>> _postMap(
    String path,
    Map<String, dynamic> payload,
  ) async {
    final response = await _dio.post<dynamic>(
      path,
      data: payload,
    );
    return _asMap(response.data);
  }

  Map<String, dynamic> _asMap(Object? payload) {
    if (payload is Map<String, dynamic>) {
      return payload;
    }
    if (payload is Map) {
      return payload.map(
        (Object? key, Object? value) => MapEntry('$key', value),
      );
    }
    return <String, dynamic>{};
  }

  List<Map<String, dynamic>> _asListOfMaps(Object? payload) {
    if (payload is! List) {
      return const <Map<String, dynamic>>[];
    }
    return payload
        .whereType<Object>()
        .map<Map<String, dynamic>>((Object item) => _asMap(item))
        .toList();
  }
}
