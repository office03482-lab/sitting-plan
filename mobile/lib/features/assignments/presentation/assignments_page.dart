import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/widgets/app_section.dart';
import '../../../core/widgets/async_state_view.dart';
import '../../portal/application/mobile_portal_providers.dart';
import '../../portal/presentation/portal_ui.dart';

class AssignmentsPage extends ConsumerWidget {
  const AssignmentsPage({
    this.title = 'Assignments',
    this.subtitle = 'Due work, submissions, and grading status.',
    super.key,
  });

  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final assignments = ref.watch(assignmentsProvider);
    return assignments.when(
      data: (List<Map<String, dynamic>> items) {
        return ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            AppSection(
              title: title,
              subtitle: subtitle,
              child: items.isEmpty
                  ? const Text('No assignments available.')
                  : Column(
                      children: items.take(12).map<Widget>((Map<String, dynamic> row) {
                        final submission = row['submission'] as Map<String, dynamic>?;
                        return ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const CircleAvatar(child: Icon(Icons.assignment_outlined)),
                          title: Text(displayValue(row['title'])),
                          subtitle: Text(displayValue(row['description'])),
                          trailing: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: <Widget>[
                              Text(displayValue(submission?['status'] ?? row['status'])),
                              Text(
                                displayShortDate(row['due_at']),
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                            ],
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
        onRetry: () => ref.invalidate(assignmentsProvider),
        child: const SizedBox.shrink(),
      ),
    );
  }
}
