import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/notifications/push_notification_service.dart';
import 'app.dart';

Future<void> bootstrap() async {
  try {
    await Firebase.initializeApp();
  } catch (_) {
    // Firebase is optional during local scaffolding.
  }

  runApp(
    const ProviderScope(
      child: Bootstrapper(),
    ),
  );
}

class Bootstrapper extends ConsumerStatefulWidget {
  const Bootstrapper({super.key});

  @override
  ConsumerState<Bootstrapper> createState() => _BootstrapperState();
}

class _BootstrapperState extends ConsumerState<Bootstrapper> {
  @override
  void initState() {
    super.initState();
    Future<void>.microtask(() => ref.read(pushNotificationServiceProvider).initialize());
  }

  @override
  Widget build(BuildContext context) {
    return const DrGirishMobileApp();
  }
}
