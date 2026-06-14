import 'user_profile.dart';

class AuthSession {
  const AuthSession({
    required this.accessToken,
    required this.refreshToken,
    required this.profile,
  });

  final String accessToken;
  final String refreshToken;
  final UserProfile profile;

  factory AuthSession.fromJson(Map<String, dynamic> json) {
    return AuthSession(
      accessToken: '${json['access_token'] ?? ''}',
      refreshToken: '${json['refresh_token'] ?? ''}',
      profile: UserProfile.fromJson(json),
    );
  }

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'access_token': accessToken,
      'refresh_token': refreshToken,
      ...profile.toJson(),
    };
  }
}
