import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/widgets/app_section.dart';
import '../../../core/widgets/async_state_view.dart';
import '../../portal/application/mobile_portal_providers.dart';
import '../../portal/presentation/portal_ui.dart';

class ParentAttendancePage extends ConsumerWidget {
  const ParentAttendancePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final attendance = ref.watch(parentAttendanceProvider);
    return attendance.when(
      data: (Map<String, dynamic> data) {
        final portal = (data['portal'] as Map<String, dynamic>? ?? const <String, dynamic>{});
        final children = (portal['children'] as List<dynamic>? ?? const <dynamic>[]);
        return ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            AppSection(
              title: 'Attendance Overview',
              subtitle: 'This role currently reuses the parent portal until a dedicated parent attendance endpoint is exposed.',
              child: children.isEmpty
                  ? const Text('No linked child records found.')
                  : Column(
                      children: children.map<Widget>((dynamic item) {
                        final child = item as Map<String, dynamic>;
                        return ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const CircleAvatar(child: Icon(Icons.fact_check_outlined)),
                          title: Text(displayValue(child['student_name'])),
                          subtitle: Text(displayValue(child['class_name'])),
                          trailing: Text(displayValue(child['status']).toUpperCase()),
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
        onRetry: () => ref.invalidate(parentAttendanceProvider),
        child: const SizedBox.shrink(),
      ),
    );
  }
}
