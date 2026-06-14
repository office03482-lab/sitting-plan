import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/widgets/app_section.dart';
import '../../../core/widgets/async_state_view.dart';
import '../../portal/application/mobile_portal_providers.dart';
import '../../portal/presentation/portal_ui.dart';

class TimetablePage extends ConsumerWidget {
  const TimetablePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final timetable = ref.watch(timetableProvider);
    return timetable.when(
      data: (List<Map<String, dynamic>> items) {
        return ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            AppSection(
              title: 'Timetable',
              subtitle: 'Cached for offline access and refreshed from the ERP timetable APIs.',
              child: items.isEmpty
                  ? const Text('No timetable entries found.')
                  : Column(
                      children: items.take(20).map<Widget>((Map<String, dynamic> row) {
                        return ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const CircleAvatar(child: Icon(Icons.schedule_outlined)),
                          title: Text(displayValue(row['subject'] ?? row['class_name'])),
                          subtitle: Text(
                            '${displayValue(row['day_of_week'])}  ${displayValue(row['start_time'])}-${displayValue(row['end_time'])}',
                          ),
                          trailing: Text(displayValue(row['room_name'] ?? row['session_mode'])),
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
        onRetry: () => ref.invalidate(timetableProvider),
        child: const SizedBox.shrink(),
      ),
    );
  }
}
