import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/widgets/app_section.dart';
import '../../../core/widgets/async_state_view.dart';
import '../../auth/application/auth_controller.dart';
import '../../portal/application/mobile_portal_providers.dart';
import '../../portal/presentation/portal_ui.dart';

class ProfilePage extends ConsumerWidget {
  const ProfilePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(currentProfileProvider);
    final snapshot = ref.watch(profileSnapshotProvider);
    if (profile == null) {
      return const SizedBox.shrink();
    }
    return snapshot.when(
      data: (Map<String, dynamic> data) {
        final schoolAnalytics = (data['school_analytics'] as Map<String, dynamic>? ?? const <String, dynamic>{});
        return ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            AppSection(
              title: profile.fullName,
              subtitle: '${profile.roleLabel} • ${displayValue(profile.email)}',
              action: FilledButton.tonalIcon(
                onPressed: () => ref.read(authControllerProvider.notifier).signOut(),
                icon: const Icon(Icons.logout),
                label: const Text('Logout'),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  KeyValueRow(label: 'User ID', value: displayValue(profile.userId)),
                  KeyValueRow(label: 'School ID', value: displayValue(profile.schoolId)),
                  KeyValueRow(label: 'Role Key', value: displayValue(profile.roleKey)),
                  KeyValueRow(label: 'Permissions', value: profile.permissions.isEmpty ? 'None' : profile.permissions.join(', ')),
                ],
              ),
            ),
            if (schoolAnalytics.isNotEmpty) ...<Widget>[
              const SizedBox(height: 16),
              AppSection(
                title: 'School Snapshot',
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    KeyValueRow(label: 'Average score', value: displayPercent(schoolAnalytics['average_score'])),
                    KeyValueRow(label: 'Active students', value: displayValue(schoolAnalytics['active_students'])),
                    KeyValueRow(label: 'Usage metrics', value: displayValue(schoolAnalytics['usage_metrics'])),
                  ],
                ),
              ),
            ],
          ],
        );
      },
      loading: () => const AsyncStateView(loading: true, child: SizedBox.shrink()),
      error: (Object error, StackTrace stackTrace) => AsyncStateView(
        loading: false,
        error: error.toString(),
        onRetry: () => ref.invalidate(profileSnapshotProvider),
        child: const SizedBox.shrink(),
      ),
    );
  }
}
