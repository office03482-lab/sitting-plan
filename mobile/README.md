# Dr. Girish Mobile Ecosystem

Single Flutter application for student, parent, teacher, school admin, and platform admin journeys on top of the existing ERP APIs. This layer is role-aware and does not introduce backend changes.

## Folder Structure

```text
mobile/
  lib/
    app/
      app.dart
      bootstrap.dart
      router/
    core/
      cache/
      config/
      models/
      network/
      notifications/
      storage/
      theme/
      widgets/
    features/
      analytics/
      assignments/
      attendance/
      auth/
      classes/
      courses/
      dashboard/
      fees/
      hostel/
      notifications/
      online_tests/
      parent/
      portal/
      profile/
      results/
      shell/
      timetable/
```

## State Management Architecture

- `flutter_riverpod` is the primary state boundary.
- `AuthController` owns session restore, login, refresh, and logout.
- `mobile_portal_providers.dart` exposes role-aware `FutureProvider`s for dashboard, attendance, tests, LMS, notifications, and analytics.
- `MobilePortalRepository` is the API aggregation layer and the only place that composes multiple ERP endpoints into one mobile payload.
- `AppCacheStore` persists JSON snapshots in `SharedPreferences` for offline-friendly modules.

## Authentication Flow

1. App opens and restores secure session from `flutter_secure_storage`.
2. If `access_token` exists, `AuthController` restores the cached role, permissions, and school context.
3. If token is expired, `ApiClient` transparently uses the stored `refresh_token` against `/api/auth/refresh`.
4. Login screen supports:
   - Password login via `/api/auth/login-password`
   - OTP fallback via `/api/auth/send-otp` and `/api/auth/verify-otp`
5. Successful auth stores:
   - access token
   - refresh token
   - user role, role key, permissions, school context
6. `go_router` sends the user into the correct role shell:
   - `/student/...`
   - `/teacher/...`
   - `/parent/...`
7. Role detection uses the current `role`, `role_key`, `user_type`, and `permissions`.
8. Logout clears secure storage and returns the app to `/login`.

## Navigation Architecture

- A single `ShellRoute` wraps the authenticated experience.
- `RoleShell` renders:
  - `NavigationBar` for the 5 highest-frequency destinations per role
  - `Drawer` for secondary destinations like profile, hostel, timetable, notifications
- Role route groups:
  - Student: dashboard, attendance, tests, results, courses, assignments, hostel, timetable, notifications, profile
  - Parent: dashboard, attendance, results, fees, courses, hostel, notifications, profile
  - Teacher/Admin: dashboard, tests, attendance, classes, analytics, courses, assignments, timetable, notifications, profile

## Push Notification Design

Mobile push is designed as a thin client layer over server-side messaging events.

### Channels

- `attendance`: attendance marked, leave decision, class reminder
- `hostel`: hostel request approved, room moved, allocation vacated
- `online_tests`: new test published, test starting soon, result published
- `results`: score published, parent digest
- `lms`: assignment due, course update, lesson recommendation

### Device Registration

Recommended production flow:

1. Mobile app obtains FCM token after login.
2. App posts token to a future notification registration endpoint or Supabase-backed token registry.
3. Token is stored with:
   - profile id
   - role key
   - school id
   - platform
   - app version
4. Backend event workers fan out notifications by role and school.

Current repo scope:

- Flutter-side permission prompt and Android notification channels are implemented.
- Foreground notifications are displayed locally.
- No new backend registration endpoint is added, so production should either:
  - reuse an existing device-token surface if one already exists, or
  - add a minimal token registration endpoint later without changing the app architecture

## Offline Strategy

Cached modules:

- timetable
- courses
- assignments
- tests
- results
- notifications

Implementation:

1. `MobilePortalRepository` stores successful JSON payloads in `SharedPreferences`.
2. Time-sensitive screens use a short TTL by default and a longer TTL for offline-heavy learning surfaces.
3. If network calls fail, the app falls back to the latest cached payload instead of hard-failing.
4. Secure auth state remains in `flutter_secure_storage`, separate from offline content cache.

## Build Validation

Expected commands:

- `flutter pub get`
- `flutter analyze`
- `flutter test`
- `flutter build apk --debug`

Run these from the `mobile/` directory once Flutter and Firebase platform files are available on the machine.

## Deployment Plan

### Android

1. Add Firebase Android app and `google-services.json`.
2. Configure package id and signing configs.
3. Point `AppEnvironment.apiBaseUrl` to production API.
4. Build:
   - `flutter build appbundle --release`
5. Distribute via Play Console internal testing, then staged rollout.

### iOS

1. Add Firebase iOS app and `GoogleService-Info.plist`.
2. Enable push notifications and background modes.
3. Configure APNs key in Firebase.
4. Build:
   - `flutter build ipa --release`
5. Distribute through TestFlight, then App Store phased release.

### Environment Strategy

- `dev`: local/LAN API
- `staging`: pre-prod ERP backend
- `prod`: live ERP backend

### Release Gates

- smoke login for all supported roles
- token refresh validation
- notification permission and foreground display validation
- role navigation validation
- API outage fallback validation
- offline cache validation for timetable, tests, assignments, and courses
- parent fee visibility validation
- teacher analytics permission validation

## Notes

- This app assumes the existing ERP auth and module APIs remain the source of truth.
- A few parent and hostel views currently depend on the exact data already exposed by the platform. If richer child-specific or student-specific mobile views are needed later, that can be added without redesigning navigation or state management.
