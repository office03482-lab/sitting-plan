import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/attendance/presentation/student_attendance_page.dart';
import '../../features/attendance/presentation/teacher_attendance_page.dart';
import '../../features/analytics/presentation/platform_analytics_page.dart';
import '../../features/analytics/presentation/teacher_analytics_page.dart';
import '../../features/analytics/presentation/executive_bi_page.dart';
import '../../features/ai_doubt_solver/presentation/ai_doubt_solver_page.dart';
import '../../features/teacher_ai/presentation/teacher_ai_page.dart';
import '../../features/commerce/presentation/commerce_page.dart';
import '../../features/ai_tutor/presentation/ai_tutor_page.dart';
import '../../features/assignments/presentation/assignments_page.dart';
import '../../features/auth/application/auth_controller.dart';
import '../../features/auth/presentation/login_page.dart';
import '../../features/classes/presentation/live_classes_page.dart';
import '../../features/classes/presentation/teacher_classes_page.dart';
import '../../features/courses/presentation/courses_page.dart';
import '../../features/dashboard/presentation/student_dashboard_page.dart';
import '../../features/dashboard/presentation/teacher_dashboard_page.dart';
import '../../features/fees/presentation/parent_fee_status_page.dart';
import '../../features/hostel/presentation/student_hostel_page.dart';
import '../../features/notifications/presentation/notifications_page.dart';
import '../../features/online_tests/presentation/student_online_tests_page.dart';
import '../../features/parent/presentation/parent_attendance_page.dart';
import '../../features/parent/presentation/parent_dashboard_page.dart';
import '../../features/profile/presentation/profile_page.dart';
import '../../features/results/presentation/student_results_page.dart';
import '../../features/shell/presentation/role_shell.dart';
import '../../features/study_planner/presentation/study_planner_page.dart';
import '../../features/timetable/presentation/timetable_page.dart';

final appRouterProvider = Provider<GoRouter>((Ref ref) {
  final authState = ref.watch(authControllerProvider);

  return GoRouter(
    initialLocation: '/splash',
    refreshListenable: RouterRefreshBridge(ref),
    redirect: (BuildContext context, GoRouterState state) {
      if (!authState.initialized) {
        return '/splash';
      }

      final loggedIn = authState.session != null;
      final atLogin = state.matchedLocation == '/login';
      if (!loggedIn) {
        return atLogin ? null : '/login';
      }

      final profile = authState.session!.profile;
      final defaultPath = profile.isStudent
          ? '/student/dashboard'
          : profile.isParent
              ? '/parent/dashboard'
              : '/teacher/dashboard';

      if (atLogin || state.matchedLocation == '/splash') {
        return defaultPath;
      }

      final location = state.matchedLocation;
      if (profile.isStudent && !location.startsWith('/student/')) {
        return defaultPath;
      }
      if (profile.isParent && !location.startsWith('/parent/')) {
        return defaultPath;
      }
      if (!profile.isStudent && !profile.isParent && !location.startsWith('/teacher/')) {
        return defaultPath;
      }

      return null;
    },
    routes: <RouteBase>[
      GoRoute(
        path: '/splash',
        builder: (BuildContext context, GoRouterState state) => const _SplashPage(),
      ),
      GoRoute(
        path: '/login',
        builder: (BuildContext context, GoRouterState state) => const LoginPage(),
      ),
      ShellRoute(
        builder: (BuildContext context, GoRouterState state, Widget child) {
          return RoleShell(child: child);
        },
        routes: <RouteBase>[
          GoRoute(path: '/student/dashboard', builder: (_, __) => const StudentDashboardPage()),
          GoRoute(path: '/student/attendance', builder: (_, __) => const StudentAttendancePage()),
          GoRoute(path: '/student/tests', builder: (_, __) => const StudentOnlineTestsPage()),
          GoRoute(path: '/student/doubts', builder: (_, __) => const AiDoubtSolverPage()),
          GoRoute(path: '/student/ai-tutor', builder: (_, __) => const AiTutorPage()),
          GoRoute(
            path: '/student/study-planner',
            builder: (_, __) => const StudyPlannerPage(
              title: 'Student Study Planner',
              subtitle: 'Daily study plan, weak-topic detection, and AI recommendations.',
            ),
          ),
          GoRoute(
            path: '/student/classes',
            builder: (_, __) => const LiveClassesPage(
              title: 'Student Live Classes',
              subtitle: 'Join active sessions, review recordings, and download notes.',
            ),
          ),
          GoRoute(path: '/student/results', builder: (_, __) => const StudentResultsPage()),
          GoRoute(path: '/student/courses', builder: (_, __) => const CoursesPage()),
          GoRoute(path: '/student/assignments', builder: (_, __) => const AssignmentsPage()),
          GoRoute(path: '/student/hostel', builder: (_, __) => const StudentHostelPage()),
          GoRoute(path: '/student/commerce', builder: (_, __) => const CommercePage(title: 'Student Store')),
          GoRoute(path: '/student/timetable', builder: (_, __) => const TimetablePage()),
          GoRoute(path: '/student/notifications', builder: (_, __) => const NotificationsPage()),
          GoRoute(path: '/student/profile', builder: (_, __) => const ProfilePage()),
          GoRoute(path: '/teacher/dashboard', builder: (_, __) => const TeacherDashboardPage()),
          GoRoute(path: '/teacher/tests', builder: (_, __) => const TeacherTestsPage()),
          GoRoute(path: '/teacher/doubts', builder: (_, __) => const AiDoubtSolverPage()),
          GoRoute(path: '/teacher/assistant', builder: (_, __) => const TeacherAiPage()),
          GoRoute(path: '/teacher/ai-tutor', builder: (_, __) => const AiTutorPage()),
          GoRoute(
            path: '/teacher/study-planner',
            builder: (_, __) => const StudyPlannerPage(
              title: 'Teacher Study Planner',
              subtitle: 'At-risk students, low engagement, and weak-topic clusters.',
            ),
          ),
          GoRoute(path: '/teacher/attendance', builder: (_, __) => const TeacherAttendancePage()),
          GoRoute(path: '/teacher/classes', builder: (_, __) => const TeacherClassesPage()),
          GoRoute(
            path: '/teacher/courses',
            builder: (_, __) => const CoursesPage(
              title: 'Teacher Courses',
              subtitle: 'Course publishing, lessons, and recorded class material.',
            ),
          ),
          GoRoute(
            path: '/teacher/assignments',
            builder: (_, __) => const AssignmentsPage(
              title: 'Assignment Review',
              subtitle: 'Submission status and grading-ready work.',
            ),
          ),
          GoRoute(path: '/teacher/analytics', builder: (_, __) => const TeacherAnalyticsPage()),
          GoRoute(path: '/teacher/bi', builder: (_, __) => const ExecutiveBiPage()),
          GoRoute(path: '/teacher/platform', builder: (_, __) => const PlatformAnalyticsPage()),
          GoRoute(path: '/teacher/timetable', builder: (_, __) => const TimetablePage()),
          GoRoute(path: '/teacher/notifications', builder: (_, __) => const NotificationsPage()),
          GoRoute(path: '/teacher/commerce', builder: (_, __) => const CommercePage(title: 'Teacher Revenue View')),
          GoRoute(path: '/teacher/profile', builder: (_, __) => const ProfilePage()),
          GoRoute(path: '/parent/dashboard', builder: (_, __) => const ParentDashboardPage()),
          GoRoute(path: '/parent/attendance', builder: (_, __) => const ParentAttendancePage()),
          GoRoute(path: '/parent/results', builder: (_, __) => const ParentResultsPage()),
          GoRoute(
            path: '/parent/study-planner',
            builder: (_, __) => const StudyPlannerPage(
              title: 'Parent Study Planner',
              subtitle: 'Completion, consistency, and child study risk alerts.',
            ),
          ),
          GoRoute(path: '/parent/fees', builder: (_, __) => const ParentFeeStatusPage()),
          GoRoute(
            path: '/parent/classes',
            builder: (_, __) => const LiveClassesPage(
              title: 'Parent Class History',
              subtitle: 'Attendance-aware live class history and recording visibility for linked children.',
            ),
          ),
          GoRoute(
            path: '/parent/courses',
            builder: (_, __) => const CoursesPage(
              title: 'Course Progress',
              subtitle: 'Child course activity and lesson progress.',
            ),
          ),
          GoRoute(path: '/parent/commerce', builder: (_, __) => const CommercePage(title: 'Parent Commerce')),
          GoRoute(path: '/parent/hostel', builder: (_, __) => const StudentHostelPage()),
          GoRoute(path: '/parent/notifications', builder: (_, __) => const NotificationsPage()),
          GoRoute(path: '/parent/profile', builder: (_, __) => const ProfilePage()),
        ],
      ),
    ],
  );
});

class RouterRefreshBridge extends ChangeNotifier {
  RouterRefreshBridge(this.ref) {
    ref.listen<AuthState>(authControllerProvider, (_, __) => notifyListeners());
  }

  final Ref ref;
}

class _SplashPage extends StatelessWidget {
  const _SplashPage();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: CircularProgressIndicator(),
      ),
    );
  }
}
