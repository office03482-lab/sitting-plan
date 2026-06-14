import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/widgets/app_section.dart';
import '../../../core/widgets/async_state_view.dart';
import '../../../core/widgets/stat_tile.dart';
import '../../portal/application/mobile_portal_providers.dart';
import '../../portal/presentation/portal_ui.dart';

class StudentAttendancePage extends ConsumerWidget {
  const StudentAttendancePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final attendance = ref.watch(studentAttendanceProvider);
    return attendance.when(
      data: (Map<String, dynamic> data) {
        final dashboard = (data['dashboard'] as Map<String, dynamic>? ?? const <String, dynamic>{});
        final records = (data['records'] as List<dynamic>? ?? const <dynamic>[]);
        final calendar = (data['calendar'] as List<dynamic>? ?? const <dynamic>[]);

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
                StatTile(label: 'Overall', value: displayPercent(dashboard['attendance_percentage'])),
                StatTile(
                  label: 'Present',
                  value: displayValue(dashboard['present_count']),
                  color: const Color(0xFF0F766E),
                ),
                StatTile(
                  label: 'Absent',
                  value: displayValue(dashboard['absent_count']),
                  color: const Color(0xFFB91C1C),
                ),
                StatTile(
                  label: 'Calendar Events',
                  value: '${calendar.length}',
                  color: const Color(0xFF9A3412),
                ),
              ],
            ),
            const SizedBox(height: 16),
            AppSection(
              title: 'Recent Attendance Records',
              child: Column(
                children: records.take(6).map<Widget>((dynamic item) {
                  final row = item as Map<String, dynamic>;
                  return ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: CircleAvatar(
                      child: Text(displayValue(row['status']).substring(0, 1).toUpperCase()),
                    ),
                    title: Text(displayShortDate(row['date'])),
                    subtitle: Text(displayValue(row['subject_name'] ?? row['class_name'])),
                    trailing: Text(displayValue(row['status']).toUpperCase()),
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
        onRetry: () => ref.invalidate(studentAttendanceProvider),
        child: const SizedBox.shrink(),
      ),
    );
  }
}
