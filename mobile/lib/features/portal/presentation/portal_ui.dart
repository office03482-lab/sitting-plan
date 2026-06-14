import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

String displayValue(Object? value, {String fallback = '--'}) {
  if (value == null) {
    return fallback;
  }
  final text = '$value'.trim();
  return text.isEmpty ? fallback : text;
}

String displayPercent(Object? value) {
  if (value == null) {
    return '--';
  }
  final parsed = double.tryParse('$value');
  if (parsed == null) {
    return displayValue(value);
  }
  return '${parsed.toStringAsFixed(parsed % 1 == 0 ? 0 : 1)}%';
}

String displayDate(Object? value) {
  if (value == null) {
    return '--';
  }
  final parsed = DateTime.tryParse('$value');
  if (parsed == null) {
    return displayValue(value);
  }
  return DateFormat('d MMM, h:mm a').format(parsed.toLocal());
}

String displayShortDate(Object? value) {
  if (value == null) {
    return '--';
  }
  final parsed = DateTime.tryParse('$value');
  if (parsed == null) {
    return displayValue(value);
  }
  return DateFormat('d MMM yyyy').format(parsed.toLocal());
}

class KeyValueRow extends StatelessWidget {
  const KeyValueRow({
    required this.label,
    required this.value,
    super.key,
  });

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Text(
              label,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: const Color(0xFF64748B),
              ),
            ),
          ),
          const SizedBox(width: 12),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: theme.textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
