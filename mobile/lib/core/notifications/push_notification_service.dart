import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

final pushNotificationServiceProvider = Provider<PushNotificationService>((Ref ref) {
  return PushNotificationService(
    FirebaseMessaging.instance,
    FlutterLocalNotificationsPlugin(),
  );
});

class PushNotificationService {
  PushNotificationService(this._messaging, this._localNotifications);

  final FirebaseMessaging _messaging;
  final FlutterLocalNotificationsPlugin _localNotifications;

  static const AndroidNotificationChannel _generalChannel = AndroidNotificationChannel(
    'erp_general',
    'ERP General',
    description: 'School ERP alerts and reminders',
    importance: Importance.max,
  );

  static const AndroidNotificationChannel _attendanceChannel = AndroidNotificationChannel(
    'erp_attendance',
    'Attendance Alerts',
    description: 'Attendance and leave updates',
    importance: Importance.high,
  );

  static const AndroidNotificationChannel _learningChannel = AndroidNotificationChannel(
    'erp_learning',
    'Learning Alerts',
    description: 'Tests, assignments, and course reminders',
    importance: Importance.high,
  );

  Future<void> initialize() async {
    await _messaging.requestPermission(alert: true, badge: true, sound: true);

    const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
    const initSettings = InitializationSettings(android: androidSettings);
    await _localNotifications.initialize(initSettings);
    await _createChannels();

    FirebaseMessaging.onMessage.listen((RemoteMessage message) async {
      final notification = message.notification;
      if (notification == null) {
        return;
      }
      final channelId = _resolveChannelId(message);
      await _localNotifications.show(
        notification.hashCode,
        notification.title,
        notification.body,
        NotificationDetails(
          android: AndroidNotificationDetails(
            channelId,
            channelId == _attendanceChannel.id ? _attendanceChannel.name : channelId == _learningChannel.id ? _learningChannel.name : _generalChannel.name,
            importance: Importance.max,
            priority: Priority.high,
          ),
        ),
      );
    });

    final token = await _messaging.getToken();
    if (kDebugMode) {
      debugPrint('FCM token: $token');
    }
  }

  Future<void> _createChannels() async {
    final androidPlugin = _localNotifications.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    if (androidPlugin == null) {
      return;
    }
    await androidPlugin.createNotificationChannel(_generalChannel);
    await androidPlugin.createNotificationChannel(_attendanceChannel);
    await androidPlugin.createNotificationChannel(_learningChannel);
  }

  String _resolveChannelId(RemoteMessage message) {
    final type = '${message.data['notification_type'] ?? ''}'.toLowerCase();
    if (type.contains('attendance') || type.contains('leave')) {
      return _attendanceChannel.id;
    }
    if (type.contains('assignment') || type.contains('test') || type.contains('course')) {
      return _learningChannel.id;
    }
    return _generalChannel.id;
  }
}
