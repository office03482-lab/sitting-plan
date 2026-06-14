import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/widgets/app_section.dart';
import '../../../core/widgets/async_state_view.dart';
import '../../portal/application/mobile_portal_providers.dart';
import '../../portal/presentation/portal_ui.dart';

class NotificationsPage extends ConsumerWidget {
  const NotificationsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notifications = ref.watch(notificationsProvider);
    return notifications.when(
      data: (Map<String, dynamic> data) {
        final items = (data['notifications'] as List<dynamic>? ?? const <dynamic>[]);
        final holidays = (data['holidays'] as List<dynamic>? ?? const <dynamic>[]);
        return ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            AppSection(
              title: 'Notifications',
              subtitle: 'Foreground FCM plus ERP-generated notices and reminders.',
              child: items.isEmpty
                  ? const Text('No notifications right now.')
                  : Column(
                      children: items.take(12).map<Widget>((dynamic item) {
                        final row = item as Map<String, dynamic>;
                        return ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const CircleAvatar(child: Icon(Icons.notifications_outlined)),
                          title: Text(displayValue(row['title'])),
                          subtitle: Text(displayValue(row['message'])),
                          trailing: Text(displayValue(row['notification_type'])),
                        );
                      }).toList(),
                    ),
            ),
            if (holidays.isNotEmpty) ...<Widget>[
              const SizedBox(height: 16),
              AppSection(
                title: 'Upcoming Holidays',
                child: Column(
                  children: holidays.take(4).map<Widget>((dynamic item) {
                    final row = item as Map<String, dynamic>;
                    return ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: const CircleAvatar(child: Icon(Icons.event_available_outlined)),
                      title: Text(displayValue(row['title'])),
                      trailing: Text(displayShortDate(row['holiday_date'])),
                    );
                  }).toList(),
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
        onRetry: () => ref.invalidate(notificationsProvider),
        child: const SizedBox.shrink(),
      ),
    );
  }
}
