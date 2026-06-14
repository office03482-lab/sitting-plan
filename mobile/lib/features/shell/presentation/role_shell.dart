import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/models/user_profile.dart';
import '../../auth/application/auth_controller.dart';

class RoleShell extends ConsumerWidget {
  const RoleShell({
    required this.child,
    super.key,
  });

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(authControllerProvider).session?.profile;
    final currentPath = GoRouterState.of(context).uri.path;
    final destinations = _destinationsForProfile(profile);
    final primaryDestinations = destinations.where((AppDestination item) => item.primary).toList();
    final selectedIndex = primaryDestinations.indexWhere((AppDestination item) => currentPath.startsWith(item.path));

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(_titleForPath(currentPath, destinations)),
            if (profile != null)
              Text(
                profile.roleLabel,
                style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: const Color(0xFF64748B),
                ),
              ),
          ],
        ),
      ),
      drawer: Drawer(
        child: SafeArea(
          child: Column(
            children: <Widget>[
              ListTile(
                leading: const CircleAvatar(child: Icon(Icons.account_circle_outlined)),
                title: Text(profile?.fullName ?? 'ERP User'),
                subtitle: Text(profile?.email ?? ''),
              ),
              const Divider(),
              Expanded(
                child: ListView(
                  children: destinations.map((AppDestination item) {
                    final selected = currentPath.startsWith(item.path);
                    return ListTile(
                      selected: selected,
                      leading: Icon(item.icon),
                      title: Text(item.label),
                      onTap: () {
                        Navigator.of(context).pop();
                        context.go(item.path);
                      },
                    );
                  }).toList(),
                ),
              ),
              const Divider(height: 1),
              ListTile(
                leading: const Icon(Icons.logout),
                title: const Text('Logout'),
                onTap: () async {
                  Navigator.of(context).pop();
                  await ref.read(authControllerProvider.notifier).signOut();
                },
              ),
            ],
          ),
        ),
      ),
      body: child,
      bottomNavigationBar: primaryDestinations.isEmpty
          ? null
          : NavigationBar(
              selectedIndex: selectedIndex < 0 ? 0 : selectedIndex,
              onDestinationSelected: (int index) => context.go(primaryDestinations[index].path),
              destinations: primaryDestinations
                  .map(
                    (AppDestination item) => NavigationDestination(
                      icon: Icon(item.icon),
                      label: item.label,
                    ),
                  )
                  .toList(),
            ),
    );
  }

  List<AppDestination> _destinationsForProfile(UserProfile? profile) {
    if (profile == null) {
      return const <AppDestination>[];
    }
    if (profile.isStudent) {
      return const <AppDestination>[
        AppDestination(label: 'Dashboard', path: '/student/dashboard', icon: Icons.dashboard_outlined, primary: true),
        AppDestination(label: 'Attendance', path: '/student/attendance', icon: Icons.fact_check_outlined, primary: true),
        AppDestination(label: 'Tests', path: '/student/tests', icon: Icons.quiz_outlined, primary: true),
        AppDestination(label: 'Doubts', path: '/student/doubts', icon: Icons.document_scanner_outlined),
        AppDestination(label: 'AI Tutor', path: '/student/ai-tutor', icon: Icons.psychology_alt_outlined),
        AppDestination(label: 'Planner', path: '/student/study-planner', icon: Icons.auto_awesome_outlined, primary: true),
        AppDestination(label: 'Classes', path: '/student/classes', icon: Icons.video_camera_front_outlined),
        AppDestination(label: 'Courses', path: '/student/courses', icon: Icons.play_lesson_outlined, primary: true),
        AppDestination(label: 'Results', path: '/student/results', icon: Icons.emoji_events_outlined, primary: true),
        AppDestination(label: 'Assignments', path: '/student/assignments', icon: Icons.assignment_outlined),
        AppDestination(label: 'Hostel', path: '/student/hostel', icon: Icons.home_work_outlined),
        AppDestination(label: 'Store', path: '/student/commerce', icon: Icons.shopping_bag_outlined),
        AppDestination(label: 'Timetable', path: '/student/timetable', icon: Icons.schedule_outlined),
        AppDestination(label: 'Notifications', path: '/student/notifications', icon: Icons.notifications_outlined),
        AppDestination(label: 'Profile', path: '/student/profile', icon: Icons.person_outline),
      ];
    }
    if (profile.isParent) {
      return const <AppDestination>[
        AppDestination(label: 'Dashboard', path: '/parent/dashboard', icon: Icons.child_care_outlined, primary: true),
        AppDestination(label: 'Attendance', path: '/parent/attendance', icon: Icons.fact_check_outlined, primary: true),
        AppDestination(label: 'Results', path: '/parent/results', icon: Icons.emoji_events_outlined, primary: true),
        AppDestination(label: 'Planner', path: '/parent/study-planner', icon: Icons.auto_awesome_outlined, primary: true),
        AppDestination(label: 'Fees', path: '/parent/fees', icon: Icons.currency_rupee_outlined, primary: true),
        AppDestination(label: 'Classes', path: '/parent/classes', icon: Icons.video_camera_front_outlined),
        AppDestination(label: 'Courses', path: '/parent/courses', icon: Icons.play_lesson_outlined, primary: true),
        AppDestination(label: 'Store', path: '/parent/commerce', icon: Icons.shopping_bag_outlined),
        AppDestination(label: 'Hostel', path: '/parent/hostel', icon: Icons.home_work_outlined),
        AppDestination(label: 'Notifications', path: '/parent/notifications', icon: Icons.notifications_outlined),
        AppDestination(label: 'Profile', path: '/parent/profile', icon: Icons.person_outline),
      ];
    }
    final items = <AppDestination>[
      const AppDestination(label: 'Dashboard', path: '/teacher/dashboard', icon: Icons.dashboard_outlined, primary: true),
      const AppDestination(label: 'Tests', path: '/teacher/tests', icon: Icons.quiz_outlined, primary: true),
      const AppDestination(label: 'Doubts', path: '/teacher/doubts', icon: Icons.document_scanner_outlined),
      const AppDestination(label: 'Assistant', path: '/teacher/assistant', icon: Icons.auto_awesome_outlined),
      const AppDestination(label: 'AI Tutor', path: '/teacher/ai-tutor', icon: Icons.psychology_alt_outlined),
      const AppDestination(label: 'Planner', path: '/teacher/study-planner', icon: Icons.auto_awesome_outlined, primary: true),
      const AppDestination(label: 'Attendance', path: '/teacher/attendance', icon: Icons.fact_check_outlined, primary: true),
      const AppDestination(label: 'Classes', path: '/teacher/classes', icon: Icons.video_camera_front_outlined, primary: true),
      const AppDestination(label: 'Analytics', path: '/teacher/analytics', icon: Icons.insights_outlined, primary: true),
      const AppDestination(label: 'BI', path: '/teacher/bi', icon: Icons.bar_chart_outlined),
      const AppDestination(label: 'Courses', path: '/teacher/courses', icon: Icons.play_lesson_outlined),
      const AppDestination(label: 'Assignments', path: '/teacher/assignments', icon: Icons.assignment_outlined),
      const AppDestination(label: 'Commerce', path: '/teacher/commerce', icon: Icons.shopping_bag_outlined),
      const AppDestination(label: 'Timetable', path: '/teacher/timetable', icon: Icons.schedule_outlined),
      const AppDestination(label: 'Notifications', path: '/teacher/notifications', icon: Icons.notifications_outlined),
      const AppDestination(label: 'Profile', path: '/teacher/profile', icon: Icons.person_outline),
    ];
    if (profile.isPlatformAdmin) {
      items.insert(
        5,
        const AppDestination(
          label: 'Platform',
          path: '/teacher/platform',
          icon: Icons.public_outlined,
        ),
      );
    }
    return items;
  }

  String _titleForPath(String currentPath, List<AppDestination> destinations) {
    for (final item in destinations) {
      if (currentPath.startsWith(item.path)) {
        return item.label;
      }
    }
    return 'Dr. Girish ERP';
  }
}

class AppDestination {
  const AppDestination({
    required this.label,
    required this.path,
    required this.icon,
    this.primary = false,
  });

  final String label;
  final String path;
  final IconData icon;
  final bool primary;
}
