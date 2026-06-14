class UserProfile {
  const UserProfile({
    required this.userId,
    required this.email,
    required this.fullName,
    required this.role,
    required this.userType,
    required this.permissions,
    this.username,
    this.roleKey,
    this.schoolId,
  });

  final String userId;
  final String email;
  final String fullName;
  final String role;
  final String userType;
  final List<String> permissions;
  final String? username;
  final String? roleKey;
  final String? schoolId;

  bool get isStudent => role == 'student' || userType == 'student' || roleKey == 'student';
  bool get isTeacher => role == 'teacher' || roleKey == 'teacher';
  bool get isAdmin => role == 'admin' || roleKey == 'school_admin' || roleKey == 'platform_admin';
  bool get isParent => permissions.contains('edupay.parent_portal') || roleKey == 'parent';
  bool get isPlatformAdmin => roleKey == 'platform_admin';
  bool get isSchoolAdmin => roleKey == 'school_admin' || role == 'admin';

  bool hasPermission(String permission) {
    return permissions.contains(permission);
  }

  String get roleLabel {
    if (isPlatformAdmin) {
      return 'Platform Admin';
    }
    if (isSchoolAdmin) {
      return 'School Admin';
    }
    if (isTeacher) {
      return 'Teacher';
    }
    if (isParent) {
      return 'Parent';
    }
    if (isStudent) {
      return 'Student';
    }
    return roleKey ?? role;
  }

  factory UserProfile.fromJson(Map<String, dynamic> json) {
    return UserProfile(
      userId: '${json['user_id'] ?? json['id'] ?? ''}',
      email: '${json['email'] ?? ''}',
      fullName: '${json['full_name'] ?? ''}',
      role: '${json['role'] ?? ''}',
      userType: '${json['user_type'] ?? ''}',
      permissions: (json['permissions'] as List<dynamic>? ?? const <dynamic>[])
          .map((item) => '$item')
          .toList(),
      username: json['username'] as String?,
      roleKey: json['role_key'] as String?,
      schoolId: json['school_id'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'user_id': userId,
      'email': email,
      'full_name': fullName,
      'role': role,
      'user_type': userType,
      'permissions': permissions,
      'username': username,
      'role_key': roleKey,
      'school_id': schoolId,
    };
  }
}
