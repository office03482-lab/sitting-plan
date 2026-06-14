import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/widgets/app_section.dart';
import '../../../core/widgets/async_state_view.dart';
import '../../portal/application/mobile_portal_providers.dart';
import '../../portal/presentation/portal_ui.dart';

class StudentResultsPage extends ConsumerWidget {
  const StudentResultsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return _ResultsPage(
      title: 'Results',
      subtitle: 'Recent scores, rank, and performance summary.',
      provider: resultsProvider,
      onRetry: () => ref.invalidate(resultsProvider),
    );
  }
}

class ParentResultsPage extends ConsumerWidget {
  const ParentResultsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return _ResultsPage(
      title: 'Child Results',
      subtitle: 'Academic performance shared through the current ERP result stack.',
      provider: resultsProvider,
      onRetry: () => ref.invalidate(resultsProvider),
    );
  }
}

class _ResultsPage extends ConsumerWidget {
  const _ResultsPage({
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
    final results = ref.watch(provider);
    return results.when(
      data: (List<Map<String, dynamic>> items) {
        return ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            AppSection(
              title: title,
              subtitle: subtitle,
              child: items.isEmpty
                  ? const Text('No published results found.')
                  : Column(
                      children: items.take(10).map<Widget>((Map<String, dynamic> row) {
                        return ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const CircleAvatar(child: Icon(Icons.emoji_events_outlined)),
                          title: Text(displayValue(row['test_title'] ?? row['test_id'])),
                          subtitle: Text(
                            'Score ${displayValue(row['score_obtained'])}/${displayValue(row['max_score'])}',
                          ),
                          trailing: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: <Widget>[
                              Text(displayPercent(row['percentage'])),
                              Text(
                                'Rank ${displayValue(row['rank_in_batch'])}',
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
        onRetry: onRetry,
        child: const SizedBox.shrink(),
      ),
    );
  }
}
