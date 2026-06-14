import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/user_profile.dart';
import '../../auth/application/auth_controller.dart';
import '../../portal/data/mobile_portal_repository.dart';

class ExecutiveBiPage extends ConsumerStatefulWidget {
  const ExecutiveBiPage({super.key});

  @override
  ConsumerState<ExecutiveBiPage> createState() => _ExecutiveBiPageState();
}

class _ExecutiveBiPageState extends ConsumerState<ExecutiveBiPage> {
  bool _loading = true;
  String? _error;
  Map<String, dynamic> _academic = const <String, dynamic>{};
  Map<String, dynamic> _finance = const <String, dynamic>{};
  Map<String, dynamic> _operations = const <String, dynamic>{};
  Map<String, dynamic> _platform = const <String, dynamic>{};

  @override
  void initState() {
    super.initState();
    Future<void>.microtask(_load);
  }

  Future<void> _load() async {
    final UserProfile? profile = ref.read(authControllerProvider).session?.profile;
    if (profile == null) {
      setState(() {
        _loading = false;
        _error = 'Profile missing';
      });
      return;
    }
    final repository = ref.read(mobilePortalRepositoryProvider);
    try {
      setState(() {
        _loading = true;
        _error = null;
      });
      final academic = await repository.loadAcademicBi();
      final finance = await repository.loadFinanceBi();
      final operations = await repository.loadOperationsBi();
      final platform = profile.isPlatformAdmin ? await repository.loadPlatformBi() : const <String, dynamic>{};
      if (!mounted) return;
      setState(() {
        _academic = academic;
        _finance = finance;
        _operations = operations;
        _platform = platform;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final UserProfile? profile = ref.watch(authControllerProvider).session?.profile;
    return Scaffold(
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            Text(
              'Executive BI',
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Text(
              'Warehouse-backed academic, finance, operations, and platform metrics.',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: const Color(0xFF64748B)),
            ),
            const SizedBox(height: 16),
            if (_loading) const Center(child: Padding(
              padding: EdgeInsets.all(32),
              child: CircularProgressIndicator(),
            )),
            if (_error != null)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(_error!, style: const TextStyle(color: Colors.red)),
                ),
              ),
            if (!_loading) ...<Widget>[
              _MetricCard(title: 'Students', value: '${_academic['student_count'] ?? 0}'),
              _MetricCard(title: 'MRR', value: '₹${_finance['mrr'] ?? 0}'),
              _MetricCard(title: 'Hostel Utilization', value: '${_operations['hostel_utilization'] ?? 0}%'),
              if (profile?.isPlatformAdmin ?? false)
                _MetricCard(title: 'Active Users', value: '${_platform['active_users'] ?? 0}'),
              const SizedBox(height: 16),
              _SectionList(
                title: 'Academic Trends',
                items: (_academic['attendance_trends'] as List<dynamic>? ?? const <dynamic>[]).map((dynamic item) {
                  final map = item as Map<String, dynamic>? ?? const <String, dynamic>{};
                  return '${map['period'] ?? '-'}  ${map['value'] ?? 0}';
                }).toList(),
              ),
              _SectionList(
                title: 'Finance Trends',
                items: (_finance['revenue_trends'] as List<dynamic>? ?? const <dynamic>[]).map((dynamic item) {
                  final map = item as Map<String, dynamic>? ?? const <String, dynamic>{};
                  return '${map['period'] ?? '-'}  ₹${map['value'] ?? 0}';
                }).toList(),
              ),
              _SectionList(
                title: 'Operations',
                items: <String>[
                  'Inventory Utilization: ${_operations['inventory_utilization'] ?? 0}',
                  'Staff Workload: ${_operations['staff_workload'] ?? 0}',
                ],
              ),
              if (profile?.isPlatformAdmin ?? false)
                _SectionList(
                  title: 'Platform',
                  items: <String>[
                    'Tenant Growth: ${_platform['tenant_growth'] ?? 0}',
                    'AI Usage: ${_platform['ai_usage'] ?? 0}',
                    'Churn Risk: ${_platform['churn_risk'] ?? 0}%',
                  ],
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({required this.title, required this.value});

  final String title;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: <Widget>[
            Text(title, style: Theme.of(context).textTheme.titleMedium),
            Text(value, style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold)),
          ],
        ),
      ),
    );
  }
}

class _SectionList extends StatelessWidget {
  const _SectionList({required this.title, required this.items});

  final String title;
  final List<String> items;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(title, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            if (items.isEmpty)
              const Text('No data available')
            else
              ...items.map((String item) => Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text(item),
                  )),
          ],
        ),
      ),
    );
  }
}
