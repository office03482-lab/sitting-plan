import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/widgets/app_section.dart';
import '../../../core/widgets/async_state_view.dart';
import '../../../core/widgets/stat_tile.dart';
import '../../portal/application/mobile_portal_providers.dart';
import '../../portal/presentation/portal_ui.dart';

class PlatformAnalyticsPage extends ConsumerWidget {
  const PlatformAnalyticsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final analytics = ref.watch(platformAnalyticsProvider);
    return analytics.when(
      data: (Map<String, dynamic> data) {
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
                StatTile(label: 'Schools', value: displayValue(data['school_count'] ?? data['schools_count'])),
                StatTile(
                  label: 'Active Students',
                  value: displayValue(data['active_students']),
                  color: const Color(0xFF0F766E),
                ),
                StatTile(
                  label: 'Active Tests',
                  value: displayValue(data['active_tests']),
                  color: const Color(0xFF7C3AED),
                ),
                StatTile(
                  label: 'Average Score',
                  value: displayPercent(data['average_score']),
                  color: const Color(0xFF9A3412),
                ),
              ],
            ),
            const SizedBox(height: 16),
            AppSection(
              title: 'Usage Metrics',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: data.entries.take(12).map<Widget>((MapEntry<String, dynamic> entry) {
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
        onRetry: () => ref.invalidate(platformAnalyticsProvider),
        child: const SizedBox.shrink(),
      ),
    );
  }
}
