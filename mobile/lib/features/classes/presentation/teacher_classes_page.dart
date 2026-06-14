import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/widgets/app_section.dart';
import '../../../core/widgets/async_state_view.dart';
import '../../portal/application/mobile_portal_providers.dart';
import '../../portal/presentation/portal_ui.dart';

class TeacherClassesPage extends ConsumerWidget {
  const TeacherClassesPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final liveClasses = ref.watch(liveClassesProvider);
    return liveClasses.when(
      data: (List<Map<String, dynamic>> items) {
        return ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            AppSection(
              title: 'Teacher Classes',
              subtitle: 'Live class schedule, recording links, and attendance-aware session history.',
              child: items.isEmpty
                  ? const Text('No live class sessions found.')
                  : Column(
                      children: items.take(12).map<Widget>((Map<String, dynamic> row) {
                        final timetable = row['timetable_entry'] as Map<String, dynamic>? ?? const <String, dynamic>{};
                        return ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const CircleAvatar(child: Icon(Icons.video_camera_front_outlined)),
                          title: Text(
                            '${displayValue(timetable['class_name'])} - ${displayValue(timetable['subject'], fallback: displayValue(row['provider']))}',
                          ),
                          subtitle: Text(
                            '${displayValue(row['status']).toUpperCase()}  ${displayDate(row['scheduled_start_at'])}',
                          ),
                          trailing: Text(displayPercent(row['attendance_rate'])),
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
        onRetry: () => ref.invalidate(liveClassesProvider),
        child: const SizedBox.shrink(),
      ),
    );
  }
}
