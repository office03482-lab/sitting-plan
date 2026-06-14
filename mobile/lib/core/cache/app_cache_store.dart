import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

final appCacheStoreProvider = Provider<AppCacheStore>((Ref ref) {
  return const AppCacheStore();
});

class AppCacheStore {
  const AppCacheStore();

  static const String _prefix = 'erp_mobile_cache_';

  Future<void> write(String key, Object payload) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      '$_prefix$key',
      jsonEncode(
        <String, Object>{
          'saved_at': DateTime.now().toUtc().toIso8601String(),
          'payload': payload,
        },
      ),
    );
  }

  Future<CacheEntry?> read(String key) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString('$_prefix$key');
    if (raw == null || raw.isEmpty) {
      return null;
    }

    final decoded = jsonDecode(raw);
    if (decoded is! Map<String, dynamic>) {
      return null;
    }

    final savedAtRaw = decoded['saved_at'];
    final payload = decoded['payload'];
    if (savedAtRaw is! String) {
      return null;
    }

    final savedAt = DateTime.tryParse(savedAtRaw);
    if (savedAt == null) {
      return null;
    }

    return CacheEntry(
      key: key,
      savedAt: savedAt,
      payload: payload,
    );
  }

  Future<void> clear(String key) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('$_prefix$key');
  }
}

class CacheEntry {
  const CacheEntry({
    required this.key,
    required this.savedAt,
    required this.payload,
  });

  final String key;
  final DateTime savedAt;
  final Object? payload;

  bool isFresh(Duration maxAge) {
    return DateTime.now().toUtc().difference(savedAt.toUtc()) <= maxAge;
  }
}
