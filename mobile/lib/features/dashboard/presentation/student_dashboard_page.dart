import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/widgets/app_section.dart';
import '../../../core/widgets/async_state_view.dart';
import '../../../core/widgets/stat_tile.dart';
import '../../portal/application/mobile_portal_providers.dart';
import '../../portal/presentation/portal_ui.dart';

class StudentDashboardPage extends ConsumerWidget {
  const StudentDashboardPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final dashboard = ref.watch(studentDashboardProvider);
    return dashboard.when(
      data: (Map<String, dynamic> data) {
        final attendance = (data['attendance'] as Map<String, dynamic>? ?? const <String, dynamic>{});
        final tests = (data['tests'] as List<dynamic>? ?? const <dynamic>[]);
        final results = (data['results'] as List<dynamic>? ?? const <dynamic>[]);
        final progress = (data['progress'] as Map<String, dynamic>? ?? const <String, dynamic>{});
        final progressItems = (progress['progress_items'] as List<dynamic>? ?? const <dynamic>[]);
        final enrolledCourses = (progress['enrolled_courses'] as List<dynamic>? ?? const <dynamic>[]);
        final aiInsights = (progress['ai_insights'] as Map<String, dynamic>? ?? const <String, dynamic>{});
        final timetable = (data['timetable'] as List<dynamic>? ?? const <dynamic>[]);
        final liveClasses = (data['live_classes'] as List<dynamic>? ?? const <dynamic>[]);

        return ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            const AppSection(
              title: 'Student Dashboard',
              subtitle: 'Attendance, tests, LMS progress, and timetable at a glance.',
              child: SizedBox.shrink(),
            ),
            const SizedBox(height: 16),
            GridView.count(
              crossAxisCount: MediaQuery.of(context).size.width > 720 ? 4 : 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              crossAxisSpacing: 12,
              mainAxisSpacing: 12,
              childAspectRatio: 1.35,
              children: <Widget>[
                StatTile(
                  label: 'Attendance',
                  value: displayPercent(attendance['attendance_percentage']),
                  helper: '${displayValue(attendance['present_count'])} present days',
                ),
                StatTile(
                  label: 'Assigned Tests',
                  value: '${tests.length}',
                  helper: '${results.length} results published',
                  color: const Color(0xFF0F766E),
                ),
                StatTile(
                  label: 'Courses',
                  value: '${enrolledCourses.length}',
                  helper: '${progressItems.length} lessons tracked',
                  color: const Color(0xFF9A3412),
                ),
                StatTile(
                  label: 'Classes Today',
                  value: '${liveClasses.where((dynamic item) => (item as Map<String, dynamic>)['status'] == 'live').length}',
                  helper: '${timetable.take(5).length} timetable entries cached',
                  color: const Color(0xFF7C3AED),
                ),
              ],
            ),
            const SizedBox(height: 16),
            AppSection(
              title: 'AI Learning Guidance',
              subtitle: 'Personalized suggestions sourced from the LMS analytics layer.',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  KeyValueRow(
                    label: 'Weak chapters',
                    value: _joinItems(aiInsights['weak_chapters']),
                  ),
                  KeyValueRow(
                    label: 'Recommended lessons',
                    value: _joinItems(aiInsights['recommended_lessons']),
                  ),
                  KeyValueRow(
                    label: 'Recommended tests',
                    value: _joinItems(aiInsights['recommended_tests']),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            AppSection(
              title: 'Upcoming Classes',
              child: Column(
                children: liveClasses.take(4).map<Widget>((dynamic item) {
                  final row = item as Map<String, dynamic>;
                  final linkedEntry = row['timetable_entry'] as Map<String, dynamic>? ?? const <String, dynamic>{};
                  return ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const CircleAvatar(child: Icon(Icons.schedule_outlined)),
                    title: Text(displayValue(linkedEntry['subject'] ?? linkedEntry['class_name'])),
                    subtitle: Text(
                      '${displayValue(row['status']).toUpperCase()}  ${displayDate(row['scheduled_start_at'])}',
                    ),
                  );
                }).toList(),
              ),
            ),
          ],
        );
      },
      loading: () => const AsyncStateView(loading: true, child: SizedBox.shrink()),
      error: (Object error, StackTrace stackTrace) => AsyncStateView(
        loading: false,
        error: error.toString(),
        onRetry: () => ref.invalidate(studentDashboardProvider),
        child: const SizedBox.shrink(),
      ),
    );
  }
}

String _joinItems(Object? raw) {
  if (raw is! List || raw.isEmpty) {
    return 'No recommendations yet';
  }
  return raw.take(3).map((dynamic item) => '$item').join(', ');
}
