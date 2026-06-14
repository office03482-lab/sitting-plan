import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/widgets/app_section.dart';
import '../../../core/widgets/async_state_view.dart';
import '../../../core/widgets/stat_tile.dart';
import '../../portal/application/mobile_portal_providers.dart';
import '../../portal/presentation/portal_ui.dart';

class TeacherAnalyticsPage extends ConsumerWidget {
  const TeacherAnalyticsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final analytics = ref.watch(teacherAnalyticsProvider);
    return analytics.when(
      data: (Map<String, dynamic> data) {
        final testAnalytics = (data['test_analytics'] as Map<String, dynamic>? ?? const <String, dynamic>{});
        final schoolAnalytics = (data['school_analytics'] as Map<String, dynamic>? ?? const <String, dynamic>{});
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
                StatTile(label: 'Tests', value: displayValue(testAnalytics['total_tests'])),
                StatTile(
                  label: 'Attempts',
                  value: displayValue(testAnalytics['total_attempts']),
                  color: const Color(0xFF0F766E),
                ),
                StatTile(
                  label: 'Average',
                  value: displayPercent(testAnalytics['average_percentage']),
                  color: const Color(0xFF7C3AED),
                ),
                StatTile(
                  label: 'Published',
                  value: displayValue(testAnalytics['published_results']),
                  color: const Color(0xFF9A3412),
                ),
              ],
            ),
            const SizedBox(height: 16),
            AppSection(
              title: 'School-Level View',
              subtitle: 'Visible for school and platform leadership roles using the same app shell.',
              child: schoolAnalytics.isEmpty
                  ? const Text('School analytics are not available for this login.')
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: schoolAnalytics.entries.take(8).map<Widget>((MapEntry<String, dynamic> entry) {
                        return KeyValueRow(label: entry.key, value: displayValue(entry.value));
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
        onRetry: () => ref.invalidate(teacherAnalyticsProvider),
        child: const SizedBox.shrink(),
      ),
    );
  }
}
