import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/widgets/app_section.dart';
import '../../../core/widgets/async_state_view.dart';
import '../../portal/application/mobile_portal_providers.dart';
import '../../portal/presentation/portal_ui.dart';

class CoursesPage extends ConsumerWidget {
  const CoursesPage({
    this.title = 'Courses',
    this.subtitle = 'Recorded courses, lesson progress, and AI guidance.',
    super.key,
  });

  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final courses = ref.watch(coursesProvider);
    return courses.when(
      data: (Map<String, dynamic> data) {
        final courseList = (data['courses'] as List<dynamic>? ?? const <dynamic>[]);
        final progress = (data['progress'] as Map<String, dynamic>? ?? const <String, dynamic>{});
        final progressItems = (progress['progress_items'] as List<dynamic>? ?? const <dynamic>[]);
        final aiInsights = (progress['ai_insights'] as Map<String, dynamic>? ?? const <String, dynamic>{});
        return ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            AppSection(
              title: title,
              subtitle: subtitle,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  KeyValueRow(label: 'Enrolled courses', value: '${courseList.length}'),
                  KeyValueRow(label: 'Tracked lessons', value: '${progressItems.length}'),
                  KeyValueRow(label: 'Weak chapters', value: _joinList(aiInsights['weak_chapters'])),
                ],
              ),
            ),
            const SizedBox(height: 16),
            AppSection(
              title: 'Course Library',
              child: courseList.isEmpty
                  ? const Text('No courses available.')
                  : Column(
                      children: courseList.take(10).map<Widget>((dynamic item) {
                        final course = item as Map<String, dynamic>;
                        return ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const CircleAvatar(child: Icon(Icons.play_lesson_outlined)),
                          title: Text(displayValue(course['title'])),
                          subtitle: Text(displayValue(course['description'])),
                          trailing: Text(displayValue(course['status'], fallback: 'active')),
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
        onRetry: () => ref.invalidate(coursesProvider),
        child: const SizedBox.shrink(),
      ),
    );
  }
}

String _joinList(Object? raw) {
  if (raw is! List || raw.isEmpty) {
    return 'No insights yet';
  }
  return raw.take(3).map((dynamic item) => '$item').join(', ');
}
