import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/widgets/app_section.dart';
import '../../../core/widgets/async_state_view.dart';
import '../../portal/application/mobile_portal_providers.dart';
import '../../portal/presentation/portal_ui.dart';

class StudentOnlineTestsPage extends ConsumerWidget {
  const StudentOnlineTestsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return _OnlineTestPage(
      title: 'Online Tests',
      subtitle: 'Assigned tests and ready-to-attempt sessions.',
      provider: testsProvider,
      onRetry: () => ref.invalidate(testsProvider),
    );
  }
}

class TeacherTestsPage extends ConsumerWidget {
  const TeacherTestsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return _OnlineTestPage(
      title: 'Manage Tests',
      subtitle: 'Published, draft, and recently updated assessments.',
      provider: testsProvider,
      onRetry: () => ref.invalidate(testsProvider),
    );
  }
}

class _OnlineTestPage extends ConsumerWidget {
  const _OnlineTestPage({
    required this.title,
    required this.subtitle,
    required this.provider,
    required this.onRetry,
  });

  final String title;
  final String subtitle;
  final FutureProvider<List<Map<String, dynamic>>> provider;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tests = ref.watch(provider);
    return tests.when(
      data: (List<Map<String, dynamic>> items) {
        return ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            AppSection(
              title: title,
              subtitle: subtitle,
              child: items.isEmpty
                  ? const Text('No tests available right now.')
                  : Column(
                      children: items.take(10).map<Widget>((Map<String, dynamic> row) {
                        return ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const CircleAvatar(child: Icon(Icons.quiz_outlined)),
                          title: Text(displayValue(row['title'] ?? row['subject_name'])),
                          subtitle: Text(
                            '${displayValue(row['status'])}  ${displayValue(row['duration_minutes'], fallback: '--')} mins',
                          ),
                          trailing: Text(displayShortDate(row['scheduled_at'] ?? row['created_at'])),
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
        onRetry: onRetry,
        child: const SizedBox.shrink(),
      ),
    );
  }
}
