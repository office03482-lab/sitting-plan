import 'package:flutter/material.dart';

class AsyncStateView extends StatelessWidget {
  const AsyncStateView({
    required this.loading,
    required this.child,
    this.error,
    this.emptyMessage,
    this.onRetry,
    super.key,
  });

  final bool loading;
  final Widget child;
  final String? error;
  final String? emptyMessage;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (error != null && error!.isNotEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(error!, textAlign: TextAlign.center),
              if (onRetry != null) ...<Widget>[
                const SizedBox(height: 12),
                OutlinedButton(
                  onPressed: onRetry,
                  child: const Text('Retry'),
                ),
              ],
            ],
          ),
        ),
      );
    }
    if (emptyMessage != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(emptyMessage!, textAlign: TextAlign.center),
        ),
      );
    }
    return child;
  }
}
