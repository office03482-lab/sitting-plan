import 'package:flutter/material.dart';

class StatTile extends StatelessWidget {
  const StatTile({
    required this.label,
    required this.value,
    this.helper,
    this.color = const Color(0xFF1E3A8A),
    super.key,
  });

  final String label;
  final String value;
  final String? helper;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      decoration: BoxDecoration(
        color: color.withOpacity(0.08),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: color.withOpacity(0.16)),
      ),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            label,
            style: theme.textTheme.labelLarge?.copyWith(
              color: const Color(0xFF475569),
            ),
          ),
          const SizedBox(height: 10),
          Text(
            value,
            style: theme.textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.w700,
              color: color,
            ),
          ),
          if (helper != null) ...<Widget>[
            const SizedBox(height: 6),
            Text(
              helper!,
              style: theme.textTheme.bodySmall?.copyWith(
                color: const Color(0xFF64748B),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
