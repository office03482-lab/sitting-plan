import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/widgets/app_section.dart';
import '../../../core/widgets/async_state_view.dart';
import '../../../core/widgets/stat_tile.dart';
import '../../portal/application/mobile_portal_providers.dart';
import '../../portal/presentation/portal_ui.dart';

class ParentDashboardPage extends ConsumerWidget {
  const ParentDashboardPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final dashboard = ref.watch(parentDashboardProvider);
    return dashboard.when(
      data: (Map<String, dynamic> data) {
        final parentDashboard = (data['parent_dashboard'] as Map<String, dynamic>? ?? const <String, dynamic>{});
        final parentInsights = (data['parent_insights'] as Map<String, dynamic>? ?? const <String, dynamic>{});
        final parentAlerts = (data['parent_alerts'] as Map<String, dynamic>? ?? const <String, dynamic>{});
        final parentRisk = (data['parent_risk_score'] as Map<String, dynamic>? ?? const <String, dynamic>{});
        final portal = (data['portal'] as Map<String, dynamic>? ?? const <String, dynamic>{});
        final children = (portal['children'] as List<dynamic>? ?? const <dynamic>[]);
        final payments = (portal['payment_history'] as List<dynamic>? ?? const <dynamic>[]);
        final progress = (data['progress'] as Map<String, dynamic>? ?? const <String, dynamic>{});
        final courses = (progress['enrolled_courses'] as List<dynamic>? ?? const <dynamic>[]);
        final liveClasses = (data['live_classes'] as List<dynamic>? ?? const <dynamic>[]);
        final academicChildren = (parentDashboard['children'] as List<dynamic>? ?? const <dynamic>[]);
        final insightItems = (parentInsights['insights'] as List<dynamic>? ?? const <dynamic>[]);
        final alertItems = (parentAlerts['alerts'] as List<dynamic>? ?? const <dynamic>[]);
        final riskChildren = (parentRisk['children'] as List<dynamic>? ?? const <dynamic>[]);

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
                StatTile(label: 'Children', value: '${children.length}'),
                StatTile(
                  label: 'Health Score',
                  value: displayValue(parentDashboard['academic_health_score'] ?? '0'),
                  color: const Color(0xFFBE123C),
                ),
                StatTile(
                  label: 'Risk Level',
                  value: displayValue(parentDashboard['risk_level'] ?? 'low').toUpperCase(),
                  color: const Color(0xFFB45309),
                ),
                StatTile(
                  label: 'Payments',
                  value: '${payments.length}',
                  color: const Color(0xFF0F766E),
                ),
                StatTile(
                  label: 'Alerts',
                  value: '${alertItems.length}',
                  color: const Color(0xFFDC2626),
                ),
                StatTile(
                  label: 'Courses',
                  value: '${courses.length}',
                  color: const Color(0xFF7C3AED),
                ),
                StatTile(
                  label: 'Pending Dues',
                  value: '${children.where((dynamic item) => (item as Map<String, dynamic>)['due_amount'] != null).length}',
                  color: const Color(0xFF9A3412),
                ),
                StatTile(
                  label: 'Class History',
                  value: '${liveClasses.length}',
                  color: const Color(0xFF1D4ED8),
                ),
              ],
            ),
            const SizedBox(height: 16),
            AppSection(
              title: 'Academic Health',
              child: academicChildren.isEmpty
                  ? const Text('No linked academic intelligence found yet.')
                  : Column(
                      children: academicChildren.map<Widget>((dynamic item) {
                        final child = item as Map<String, dynamic>;
                        return ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const CircleAvatar(child: Icon(Icons.insights_outlined)),
                          title: Text(displayValue(child['student_name'])),
                          subtitle: Text('Health ${displayValue(child['academic_health_score'])}  Risk ${displayValue(child['risk_level']).toUpperCase()}'),
                          trailing: Text('Att ${displayValue(child['attendance_score'])}%'),
                        );
                      }).toList(),
                    ),
            ),
            const SizedBox(height: 16),
            AppSection(
              title: 'Child Summary',
              child: Column(
                children: children.map<Widget>((dynamic item) {
                  final child = item as Map<String, dynamic>;
                  return ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const CircleAvatar(child: Icon(Icons.child_care_outlined)),
                    title: Text(displayValue(child['student_name'])),
                    subtitle: Text(displayValue(child['class_name'])),
                    trailing: Text('Due ${displayValue(child['due_amount'])}'),
                  );
                }).toList(),
              ),
            ),
            const SizedBox(height: 16),
            AppSection(
              title: 'AI Insights',
              child: insightItems.isEmpty
                  ? const Text('No parent insights available.')
                  : Column(
                      children: insightItems.take(4).map<Widget>((dynamic item) {
                        final insight = item as Map<String, dynamic>;
                        return ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const CircleAvatar(child: Icon(Icons.auto_awesome_outlined)),
                          title: Text(displayValue(insight['title'])),
                          subtitle: Text(displayValue(insight['summary'])),
                          trailing: Text(displayValue(insight['student_name'])),
                        );
                      }).toList(),
                    ),
            ),
            const SizedBox(height: 16),
            AppSection(
              title: 'Parent Alerts',
              child: alertItems.isEmpty
                  ? const Text('No active alerts right now.')
                  : Column(
                      children: alertItems.take(4).map<Widget>((dynamic item) {
                        final alert = item as Map<String, dynamic>;
                        return ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const CircleAvatar(child: Icon(Icons.warning_amber_outlined)),
                          title: Text(displayValue(alert['title'])),
                          subtitle: Text(displayValue(alert['message'])),
                          trailing: Text(displayValue(alert['severity']).toUpperCase()),
                        );
                      }).toList(),
                    ),
            ),
            const SizedBox(height: 16),
            AppSection(
              title: 'Recent Live Classes',
              child: liveClasses.isEmpty
                  ? const Text('No live class history found.')
                  : Column(
                      children: liveClasses.take(4).map<Widget>((dynamic item) {
                        final row = item as Map<String, dynamic>;
                        final linkedEntry = row['timetable_entry'] as Map<String, dynamic>? ?? const <String, dynamic>{};
                        return ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const CircleAvatar(child: Icon(Icons.history_edu_outlined)),
                          title: Text(displayValue(linkedEntry['class_name'])),
                          subtitle: Text(
                            '${displayValue(linkedEntry['subject'])}  ${displayDate(row['scheduled_start_at'])}',
                          ),
                          trailing: Text(displayValue(row['status'])),
                        );
                      }).toList(),
                    ),
            ),
            const SizedBox(height: 16),
            AppSection(
              title: 'Risk Trend Snapshot',
              child: riskChildren.isEmpty
                  ? const Text('Risk trend snapshot unavailable.')
                  : Column(
                      children: riskChildren.take(3).map<Widget>((dynamic item) {
                        final child = item as Map<String, dynamic>;
                        final trend = child['trend_30d'] as Map<String, dynamic>? ?? const <String, dynamic>{};
                        return ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const CircleAvatar(child: Icon(Icons.show_chart_outlined)),
                          title: Text(displayValue(child['student_name'])),
                          subtitle: Text(
                            'Marks ${displayValue(trend['marks'])}  Attendance ${displayValue(trend['attendance'])}  Engagement ${displayValue(trend['engagement'])}',
                          ),
                          trailing: Text(displayValue(child['risk_level']).toUpperCase()),
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
        onRetry: () => ref.invalidate(parentDashboardProvider),
        child: const SizedBox.shrink(),
      ),
    );
  }
}
