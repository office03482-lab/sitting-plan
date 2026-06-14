import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/widgets/app_section.dart';
import '../../../core/widgets/async_state_view.dart';
import '../../portal/application/mobile_portal_providers.dart';
import '../../portal/presentation/portal_ui.dart';

class ParentFeeStatusPage extends ConsumerWidget {
  const ParentFeeStatusPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fees = ref.watch(parentFeesProvider);
    return fees.when(
      data: (Map<String, dynamic> data) {
        final children = (data['children'] as List<dynamic>? ?? const <dynamic>[]);
        final history = (data['payment_history'] as List<dynamic>? ?? const <dynamic>[]);
        return ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            AppSection(
              title: 'Fee Status',
              subtitle: 'Fee visibility is sourced from the existing EduPay parent portal.',
              child: Column(
                children: children.map<Widget>((dynamic item) {
                  final row = item as Map<String, dynamic>;
                  return ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const CircleAvatar(child: Icon(Icons.currency_rupee_outlined)),
                    title: Text(displayValue(row['student_name'])),
                    subtitle: Text(displayValue(row['class_name'])),
                    trailing: Text('Due ${displayValue(row['due_amount'])}'),
                  );
                }).toList(),
              ),
            ),
            const SizedBox(height: 16),
            AppSection(
              title: 'Recent Payments',
              child: history.isEmpty
                  ? const Text('No payment records available.')
                  : Column(
                      children: history.take(8).map<Widget>((dynamic item) {
                        final row = item as Map<String, dynamic>;
                        return ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const CircleAvatar(child: Icon(Icons.receipt_long_outlined)),
                          title: Text(displayValue(row['fee_structure_name'] ?? row['description'])),
                          subtitle: Text(displayShortDate(row['paid_at'] ?? row['created_at'])),
                          trailing: Text(displayValue(row['amount_paid'] ?? row['amount'])),
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
        onRetry: () => ref.invalidate(parentFeesProvider),
        child: const SizedBox.shrink(),
      ),
    );
  }
}
