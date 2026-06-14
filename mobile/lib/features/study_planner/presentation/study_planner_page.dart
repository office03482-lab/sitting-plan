import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/widgets/app_section.dart';
import '../../../core/widgets/async_state_view.dart';
import '../../../core/widgets/stat_tile.dart';
import '../../portal/application/mobile_portal_providers.dart';
import '../../portal/presentation/portal_ui.dart';

class StudyPlannerPage extends ConsumerWidget {
  const StudyPlannerPage({
    this.title = 'Study Planner',
    this.subtitle = 'AI-powered daily planning, weak-topic detection, and recommendations.',
    super.key,
  });

  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final todayAsync = ref.watch(studyPlannerTodayProvider);
    final weekAsync = ref.watch(studyPlannerWeekProvider);
    final recommendationsAsync = ref.watch(studyPlannerRecommendationsProvider);

    if (todayAsync.isLoading || weekAsync.isLoading || recommendationsAsync.isLoading) {
      return const AsyncStateView(loading: true, child: SizedBox.shrink());
    }

    if (todayAsync.hasError) {
      return AsyncStateView(
        loading: false,
        error: todayAsync.error.toString(),
        onRetry: () => ref.invalidate(studyPlannerTodayProvider),
        child: const SizedBox.shrink(),
      );
    }

    if (weekAsync.hasError) {
      return AsyncStateView(
        loading: false,
        error: weekAsync.error.toString(),
        onRetry: () => ref.invalidate(studyPlannerWeekProvider),
        child: const SizedBox.shrink(),
      );
    }

    if (recommendationsAsync.hasError) {
      return AsyncStateView(
        loading: false,
        error: recommendationsAsync.error.toString(),
        onRetry: () => ref.invalidate(studyPlannerRecommendationsProvider),
        child: const SizedBox.shrink(),
      );
    }

    final todayData = todayAsync.value ?? const <String, dynamic>{};
    final weekData = weekAsync.value ?? const <String, dynamic>{};
    final recommendationsData = recommendationsAsync.value ?? const <String, dynamic>{};
    final role = displayValue(todayData['role']).toLowerCase();

    if (role == 'parent') {
      return _ParentPlannerPage(
        title: title,
        subtitle: subtitle,
        payload: todayData,
      );
    }

    if (role == 'teacher' || role == 'school_admin' || role == 'platform_admin' || role == 'admin') {
      return _TeacherPlannerPage(
        title: title,
        subtitle: subtitle,
        payload: todayData,
        recommendations: recommendationsData,
      );
    }

    final tasks = (todayData['tasks'] as List<dynamic>? ?? const <dynamic>[]);
    final recommendationItems = (recommendationsData['recommendations'] as List<dynamic>? ?? const <dynamic>[]);
    final weeklyFocus = _toStringList((weekData['weekly_plan'] as Map<String, dynamic>? ?? const <String, dynamic>{})['weekly_focus']);
    final monthlyFocus = _toStringList((weekData['monthly_plan'] as Map<String, dynamic>? ?? const <String, dynamic>{})['monthly_focus']);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: <Widget>[
        AppSection(
          title: title,
          subtitle: subtitle,
          child: const SizedBox.shrink(),
        ),
        const SizedBox(height: 16),
        GridView.count(
          crossAxisCount: MediaQuery.of(context).size.width > 720 ? 4 : 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          crossAxisSpacing: 12,
          mainAxisSpacing: 12,
          childAspectRatio: 1.35,
          children: <Widget>[
            StatTile(
              label: 'Study Time',
              value: '${displayValue(todayData['total_estimated_minutes'])} min',
              helper: 'Expected today',
            ),
            StatTile(
              label: 'Completion',
              value: displayPercent(todayData['completion_percentage']),
              helper: 'Planner completion',
              color: const Color(0xFF0F766E),
            ),
            StatTile(
              label: 'Streak',
              value: '${displayValue(todayData['streak_count'])} days',
              helper: 'Consistency tracker',
              color: const Color(0xFFB45309),
            ),
            StatTile(
              label: 'Risk',
              value: displayValue(todayData['risk_level']).toUpperCase(),
              helper: displayValue(todayData['achievement_level']),
              color: const Color(0xFFBE123C),
            ),
          ],
        ),
        const SizedBox(height: 16),
        AppSection(
          title: 'Today\'s Tasks',
          subtitle: 'Generated from attendance, LMS progress, tests, assignments, and live classes.',
          child: tasks.isEmpty
              ? const Text('No pending study tasks right now.')
              : Column(
                  children: tasks.take(6).map<Widget>((dynamic item) {
                    final row = item as Map<String, dynamic>;
                    return ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: const CircleAvatar(child: Icon(Icons.auto_awesome_outlined)),
                      title: Text(displayValue(row['title'])),
                      subtitle: Text(
                        '${displayValue(row['description'])}\n${displayValue(row['estimated_minutes'])} min  |  ${displayValue(row['subject_name'], fallback: 'General')}',
                      ),
                      isThreeLine: true,
                    );
                  }).toList(),
                ),
        ),
        const SizedBox(height: 16),
        AppSection(
          title: 'Focus Areas',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              KeyValueRow(
                label: 'Weak topics',
                value: _joinItems(recommendationsData['weak_topics']),
              ),
              KeyValueRow(
                label: 'Weak subjects',
                value: _joinItems(recommendationsData['weak_subjects']),
              ),
              KeyValueRow(
                label: 'Recurring mistakes',
                value: _joinItems(recommendationsData['recurring_mistakes']),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        AppSection(
          title: 'Weekly and Monthly Plan',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              KeyValueRow(
                label: 'Weekly focus',
                value: weeklyFocus.isEmpty ? 'No weekly focus yet' : weeklyFocus.join(', '),
              ),
              KeyValueRow(
                label: 'Monthly focus',
                value: monthlyFocus.isEmpty ? 'No monthly focus yet' : monthlyFocus.join(', '),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        AppSection(
          title: 'Recommendations',
          child: recommendationItems.isEmpty
              ? const Text('No recommendations available.')
              : Column(
                  children: recommendationItems.take(5).map<Widget>((dynamic item) {
                    final row = item as Map<String, dynamic>;
                    return ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: const CircleAvatar(child: Icon(Icons.tips_and_updates_outlined)),
                      title: Text(displayValue(row['title'])),
                      subtitle: Text(displayValue(row['summary'])),
                    );
                  }).toList(),
                ),
        ),
      ],
    );
  }
}

class _ParentPlannerPage extends StatelessWidget {
  const _ParentPlannerPage({
    required this.title,
    required this.subtitle,
    required this.payload,
  });

  final String title;
  final String subtitle;
  final Map<String, dynamic> payload;

  @override
  Widget build(BuildContext context) {
    final children = (payload['children'] as List<dynamic>? ?? const <dynamic>[]);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: <Widget>[
        AppSection(title: title, subtitle: subtitle, child: const SizedBox.shrink()),
        const SizedBox(height: 16),
        AppSection(
          title: 'Child Study View',
          subtitle: 'Consistency, completion, and risk alerts for linked students.',
          child: children.isEmpty
              ? const Text('No linked child planner data available.')
              : Column(
                  children: children.map<Widget>((dynamic item) {
                    final row = item as Map<String, dynamic>;
                    return Card(
                      margin: const EdgeInsets.only(bottom: 12),
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Text(
                              displayValue(row['student_name']),
                              style: Theme.of(context).textTheme.titleMedium,
                            ),
                            const SizedBox(height: 12),
                            KeyValueRow(label: 'Study consistency', value: '${displayValue(row['study_consistency'])} days'),
                            KeyValueRow(label: 'Completion', value: '${displayValue(row['completion_percentage'])}%'),
                            KeyValueRow(label: 'Missed tasks', value: displayValue(row['missed_tasks'])),
                            KeyValueRow(label: 'Risk alert', value: displayValue(row['risk_alert']).toUpperCase()),
                            KeyValueRow(label: 'Weak topics', value: _joinItems(row['weak_topics'])),
                          ],
                        ),
                      ),
                    );
                  }).toList(),
                ),
        ),
      ],
    );
  }
}

class _TeacherPlannerPage extends StatelessWidget {
  const _TeacherPlannerPage({
    required this.title,
    required this.subtitle,
    required this.payload,
    required this.recommendations,
  });

  final String title;
  final String subtitle;
  final Map<String, dynamic> payload;
  final Map<String, dynamic> recommendations;

  @override
  Widget build(BuildContext context) {
    final atRisk = (payload['at_risk_students'] as List<dynamic>? ?? const <dynamic>[]);
    final lowEngagement = (payload['low_engagement_students'] as List<dynamic>? ?? const <dynamic>[]);
    final weakClusters = (payload['weak_topic_clusters'] as List<dynamic>? ?? const <dynamic>[]);
    final schoolView = recommendations['school_view'] as Map<String, dynamic>? ?? const <String, dynamic>{};
    final platformView = recommendations['platform_view'] as Map<String, dynamic>? ?? const <String, dynamic>{};

    return ListView(
      padding: const EdgeInsets.all(16),
      children: <Widget>[
        AppSection(title: title, subtitle: subtitle, child: const SizedBox.shrink()),
        const SizedBox(height: 16),
        AppSection(
          title: 'At-Risk Students',
          child: atRisk.isEmpty
              ? const Text('No at-risk students flagged.')
              : Column(
                  children: atRisk.take(6).map<Widget>((dynamic item) {
                    final row = item as Map<String, dynamic>;
                    return ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: const CircleAvatar(child: Icon(Icons.warning_amber_outlined)),
                      title: Text(displayValue(row['student_name'])),
                      subtitle: Text(
                        'Risk: ${displayValue(row['risk_level'])}  |  Completion: ${displayValue(row['completion_percentage'])}%  |  Streak: ${displayValue(row['streak_count'])}',
                      ),
                    );
                  }).toList(),
                ),
        ),
        const SizedBox(height: 16),
        AppSection(
          title: 'Low Engagement and Topic Clusters',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              KeyValueRow(label: 'Low engagement count', value: '${lowEngagement.length} students'),
              KeyValueRow(label: 'Weak topic clusters', value: _joinItems(weakClusters.map((dynamic item) => (item as Map<String, dynamic>)['topic_name']).toList())),
            ],
          ),
        ),
        const SizedBox(height: 16),
        AppSection(
          title: 'Analytics Snapshots',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              KeyValueRow(label: 'School snapshot', value: schoolView.isEmpty ? 'Not available' : '${schoolView.keys.length} metrics loaded'),
              KeyValueRow(label: 'Platform snapshot', value: platformView.isEmpty ? 'Not available' : '${platformView.keys.length} metrics loaded'),
            ],
          ),
        ),
      ],
    );
  }
}

List<String> _toStringList(Object? raw) {
  if (raw is! List) {
    return const <String>[];
  }
  return raw.map((dynamic item) => displayValue(item)).where((String item) => item != '--').toList();
}

String _joinItems(Object? raw) {
  final items = _toStringList(raw);
  if (items.isEmpty) {
    return 'No recommendations yet';
  }
  return items.take(4).join(', ');
}
