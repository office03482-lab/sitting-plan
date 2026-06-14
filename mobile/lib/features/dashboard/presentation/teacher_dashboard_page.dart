import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/widgets/app_section.dart';
import '../../../core/widgets/async_state_view.dart';
import '../../../core/widgets/stat_tile.dart';
import '../../portal/application/mobile_portal_providers.dart';
import '../../portal/presentation/portal_ui.dart';

class TeacherDashboardPage extends ConsumerWidget {
  const TeacherDashboardPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final dashboard = ref.watch(teacherDashboardProvider);
    return dashboard.when(
      data: (Map<String, dynamic> data) {
        final tests = (data['tests'] as List<dynamic>? ?? const <dynamic>[]);
        final analytics = (data['analytics'] as Map<String, dynamic>? ?? const <String, dynamic>{});
        final currentClass = (data['current_class'] as Map<String, dynamic>? ?? const <String, dynamic>{});
        final assignments = (data['assignments'] as List<dynamic>? ?? const <dynamic>[]);
        final courses = (data['courses'] as List<dynamic>? ?? const <dynamic>[]);
        final timetable = (data['timetable'] as List<dynamic>? ?? const <dynamic>[]);
        final liveClasses = (data['live_classes'] as List<dynamic>? ?? const <dynamic>[]);

        return ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            GridView.count(
              crossAxisCount: MediaQuery.of(context).size.width > 720 ? 4 : 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              crossAxisSpacing: 12,
              mainAxisSpacing: 12,
              childAspectRatio: 1.35,
              children: <Widget>[
                StatTile(label: 'Tests', value: '${tests.length}', helper: 'Managed by you'),
                StatTile(
                  label: 'Attempts',
                  value: displayValue(analytics['total_attempts']),
                  helper: '${displayValue(analytics['completed_attempts'])} completed',
                  color: const Color(0xFF0F766E),
                ),
                StatTile(
                  label: 'Average Score',
                  value: displayPercent(analytics['average_percentage']),
                  helper: '${displayValue(analytics['published_results'])} published',
                  color: const Color(0xFF9A3412),
                ),
                StatTile(
                  label: 'Assignments',
                  value: '${assignments.length}',
                  helper: '${liveClasses.where((dynamic item) => (item as Map<String, dynamic>)['status'] == 'live').length} live now',
                  color: const Color(0xFF7C3AED),
                ),
              ],
            ),
            const SizedBox(height: 16),
            AppSection(
              title: 'Current Class',
              subtitle: 'Live class context from attendance and timetable services.',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  KeyValueRow(label: 'Class', value: displayValue(currentClass['class_name'])),
                  KeyValueRow(label: 'Section', value: displayValue(currentClass['section'])),
                  KeyValueRow(label: 'Subject', value: displayValue(currentClass['subject'])),
                  KeyValueRow(
                    label: 'Schedule',
                    value: '${displayValue(currentClass['start_time'])} - ${displayValue(currentClass['end_time'])}',
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            AppSection(
              title: 'Upcoming Sessions',
              child: Column(
                children: liveClasses.take(4).map<Widget>((dynamic item) {
                  final row = item as Map<String, dynamic>;
                  final linkedEntry = row['timetable_entry'] as Map<String, dynamic>? ?? const <String, dynamic>{};
                  return ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const CircleAvatar(child: Icon(Icons.class_outlined)),
                    title: Text(displayValue(linkedEntry['class_name'])),
                    subtitle: Text(
                      '${displayValue(linkedEntry['subject'])}  ${displayDate(row['scheduled_start_at'])}',
                    ),
                    trailing: Text(displayValue(row['status'])),
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
        onRetry: () => ref.invalidate(teacherDashboardProvider),
        child: const SizedBox.shrink(),
      ),
    );
  }
}
