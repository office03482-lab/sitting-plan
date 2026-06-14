import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/user_profile.dart';
import '../../auth/application/auth_controller.dart';
import '../data/mobile_portal_repository.dart';

final currentProfileProvider = Provider<UserProfile?>((Ref ref) {
  return ref.watch(authControllerProvider).session?.profile;
});

final currentRoleLabelProvider = Provider<String>((Ref ref) {
  final profile = ref.watch(currentProfileProvider);
  if (profile == null) {
    return 'guest';
  }
  if (profile.isStudent) {
    return 'student';
  }
  if (profile.isParent) {
    return 'parent';
  }
  if (profile.isTeacher) {
    return 'teacher';
  }
  return 'admin';
});

final studentDashboardProvider = FutureProvider<Map<String, dynamic>>((Ref ref) async {
  final profile = _requireProfile(ref);
  return ref.watch(mobilePortalRepositoryProvider).loadStudentDashboard(profile);
});

final teacherDashboardProvider = FutureProvider<Map<String, dynamic>>((Ref ref) async {
  final profile = _requireProfile(ref);
  return ref.watch(mobilePortalRepositoryProvider).loadTeacherDashboard(profile);
});

final parentDashboardProvider = FutureProvider<Map<String, dynamic>>((Ref ref) async {
  final profile = _requireProfile(ref);
  return ref.watch(mobilePortalRepositoryProvider).loadParentDashboard(profile);
});

final studentAttendanceProvider = FutureProvider<Map<String, dynamic>>((Ref ref) async {
  final profile = _requireProfile(ref);
  return ref.watch(mobilePortalRepositoryProvider).loadStudentAttendance(profile);
});

final teacherAttendanceProvider = FutureProvider<Map<String, dynamic>>((Ref ref) async {
  final profile = _requireProfile(ref);
  return ref.watch(mobilePortalRepositoryProvider).loadTeacherAttendance(profile);
});

final parentAttendanceProvider = FutureProvider<Map<String, dynamic>>((Ref ref) async {
  final profile = _requireProfile(ref);
  return ref.watch(mobilePortalRepositoryProvider).loadParentAttendance(profile);
});

final hostelSnapshotProvider = FutureProvider<Map<String, dynamic>>((Ref ref) async {
  final profile = _requireProfile(ref);
  return ref.watch(mobilePortalRepositoryProvider).loadHostelSnapshot(profile);
});

final testsProvider = FutureProvider<List<Map<String, dynamic>>>((Ref ref) async {
  final profile = _requireProfile(ref);
  return ref.watch(mobilePortalRepositoryProvider).loadTests(profile);
});

final resultsProvider = FutureProvider<List<Map<String, dynamic>>>((Ref ref) async {
  final profile = _requireProfile(ref);
  return ref.watch(mobilePortalRepositoryProvider).loadResults(profile);
});

final coursesProvider = FutureProvider<Map<String, dynamic>>((Ref ref) async {
  final profile = _requireProfile(ref);
  return ref.watch(mobilePortalRepositoryProvider).loadCourses(profile);
});

final assignmentsProvider = FutureProvider<List<Map<String, dynamic>>>((Ref ref) async {
  final profile = _requireProfile(ref);
  return ref.watch(mobilePortalRepositoryProvider).loadAssignments(profile);
});

final timetableProvider = FutureProvider<List<Map<String, dynamic>>>((Ref ref) async {
  final profile = _requireProfile(ref);
  return ref.watch(mobilePortalRepositoryProvider).loadTimetable(profile);
});

final liveClassesProvider = FutureProvider<List<Map<String, dynamic>>>((Ref ref) async {
  final profile = _requireProfile(ref);
  return ref.watch(mobilePortalRepositoryProvider).loadLiveClasses(profile);
});

final notificationsProvider = FutureProvider<Map<String, dynamic>>((Ref ref) async {
  final profile = _requireProfile(ref);
  return ref.watch(mobilePortalRepositoryProvider).loadNotifications(profile);
});

final profileSnapshotProvider = FutureProvider<Map<String, dynamic>>((Ref ref) async {
  final profile = _requireProfile(ref);
  return ref.watch(mobilePortalRepositoryProvider).loadProfileSnapshot(profile);
});

final teacherAnalyticsProvider = FutureProvider<Map<String, dynamic>>((Ref ref) async {
  final profile = _requireProfile(ref);
  return ref.watch(mobilePortalRepositoryProvider).loadTeacherAnalytics(profile);
});

final parentFeesProvider = FutureProvider<Map<String, dynamic>>((Ref ref) async {
  final profile = _requireProfile(ref);
  return ref.watch(mobilePortalRepositoryProvider).loadParentFees(profile);
});

final platformAnalyticsProvider = FutureProvider<Map<String, dynamic>>((Ref ref) async {
  final profile = _requireProfile(ref);
  return ref.watch(mobilePortalRepositoryProvider).loadPlatformAnalytics(profile);
});

final studyPlannerTodayProvider = FutureProvider<Map<String, dynamic>>((Ref ref) async {
  final profile = _requireProfile(ref);
  return ref.watch(mobilePortalRepositoryProvider).loadStudyPlannerToday(profile);
});

final studyPlannerWeekProvider = FutureProvider<Map<String, dynamic>>((Ref ref) async {
  final profile = _requireProfile(ref);
  return ref.watch(mobilePortalRepositoryProvider).loadStudyPlannerWeek(profile);
});

final studyPlannerRecommendationsProvider = FutureProvider<Map<String, dynamic>>((Ref ref) async {
  final profile = _requireProfile(ref);
  return ref.watch(mobilePortalRepositoryProvider).loadStudyPlannerRecommendations(profile);
});

UserProfile _requireProfile(Ref ref) {
  final profile = ref.watch(currentProfileProvider);
  if (profile == null) {
    throw StateError('Profile not available');
  }
  return profile;
}
