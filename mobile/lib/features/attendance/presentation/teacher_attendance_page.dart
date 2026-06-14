import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/widgets/app_section.dart';
import '../../../core/widgets/async_state_view.dart';
import '../../../core/widgets/stat_tile.dart';
import '../../portal/application/mobile_portal_providers.dart';
import '../../portal/presentation/portal_ui.dart';

class TeacherAttendancePage extends ConsumerWidget {
  const TeacherAttendancePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final attendance = ref.watch(teacherAttendanceProvider);
    return attendance.when(
      data: (Map<String, dynamic> data) {
        final currentClass = (data['current_class'] as Map<String, dynamic>? ?? const <String, dynamic>{});
        final dashboard = (data['staff_dashboard'] as Map<String, dynamic>? ?? const <String, dynamic>{});
        final leaves = (data['leaves'] as List<dynamic>? ?? const <dynamic>[]);

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
                StatTile(label: 'Current Class', value: displayValue(currentClass['class_name'])),
                StatTile(
                  label: 'Monthly Attendance',
                  value: displayPercent(dashboard['monthly_attendance_percentage']),
                  color: const Color(0xFF0F766E),
                ),
                StatTile(
                  label: 'Present Staff',
                  value: displayValue(dashboard['present_count']),
                  color: const Color(0xFF7C3AED),
                ),
                StatTile(
                  label: 'Leave Requests',
                  value: '${leaves.length}',
                  color: const Color(0xFF9A3412),
                ),
              ],
            ),
            const SizedBox(height: 16),
            AppSection(
              title: 'Teacher Context',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  KeyValueRow(label: 'Subject', value: displayValue(currentClass['subject'])),
                  KeyValueRow(label: 'Section', value: displayValue(currentClass['section'])),
                  KeyValueRow(
                    label: 'Time',
                    value: '${displayValue(currentClass['start_time'])} - ${displayValue(currentClass['end_time'])}',
                  ),
                ],
              ),
            ),
          ],
        );
      },
      loading: () => const AsyncStateView(loading: true, child: SizedBox.shrink()),
      error: (Object error, StackTrace stackTrace) => AsyncStateView(
        loading: false,
        error: error.toString(),
        onRetry: () => ref.invalidate(teacherAttendanceProvider),
        child: const SizedBox.shrink(),
      ),
    );
  }
}
