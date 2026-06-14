import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/widgets/app_section.dart';
import '../../../core/widgets/async_state_view.dart';
import '../../portal/application/mobile_portal_providers.dart';
import '../../portal/presentation/portal_ui.dart';

class StudentHostelPage extends ConsumerWidget {
  const StudentHostelPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hostel = ref.watch(hostelSnapshotProvider);
    return hostel.when(
      data: (Map<String, dynamic> data) {
        final requests = (data['requests'] as List<dynamic>? ?? const <dynamic>[]);
        return ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            AppSection(
              title: 'Hostel Status',
              subtitle: 'Reuses the current hostel request workflow without introducing new APIs.',
              child: requests.isEmpty
                  ? const Text(
                      'No hostel request records were returned for this session. If this role does not have direct hostel visibility yet, the page will still work once the existing backend exposes student-scoped status.',
                    )
                  : Column(
                      children: requests.take(6).map<Widget>((dynamic item) {
                        final row = item as Map<String, dynamic>;
                        return ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const CircleAvatar(child: Icon(Icons.home_work_outlined)),
                          title: Text(displayValue(row['hostel_name'])),
                          subtitle: Text(displayValue(row['room_number'] ?? row['requested_notes'])),
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
        onRetry: () => ref.invalidate(hostelSnapshotProvider),
        child: const SizedBox.shrink(),
      ),
    );
  }
}
