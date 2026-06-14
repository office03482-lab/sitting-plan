import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../application/auth_controller.dart';

class LoginPage extends ConsumerStatefulWidget {
  const LoginPage({super.key});

  @override
  ConsumerState<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends ConsumerState<LoginPage> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _otpController = TextEditingController();
  bool _useOtp = false;
  bool _otpRequested = false;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _otpController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authControllerProvider);
    final authController = ref.read(authControllerProvider.notifier);
    final theme = Theme.of(context);

    return Scaffold(
      body: SafeArea(
        child: Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              colors: <Color>[Color(0xFFF8FAFC), Color(0xFFE0E7FF)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
          ),
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 920),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: <Widget>[
                    if (MediaQuery.of(context).size.width > 780)
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.only(right: 24),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                                decoration: BoxDecoration(
                                  color: const Color(0xFF1E3A8A).withOpacity(0.08),
                                  borderRadius: BorderRadius.circular(999),
                                ),
                                child: const Text('Single mobile app for student, parent, teacher'),
                              ),
                              const SizedBox(height: 20),
                              Text(
                                'School ERP, optimized for daily execution.',
                                style: theme.textTheme.displaySmall?.copyWith(
                                  fontWeight: FontWeight.w700,
                                  color: const Color(0xFF0F172A),
                                ),
                              ),
                              const SizedBox(height: 16),
                              Text(
                                'Attendance, online tests, LMS, hostel updates, notifications, and analytics are routed through the existing ERP APIs and role permissions.',
                                style: theme.textTheme.titleMedium?.copyWith(
                                  color: const Color(0xFF334155),
                                ),
                              ),
                              const SizedBox(height: 24),
                              Wrap(
                                spacing: 12,
                                runSpacing: 12,
                                children: const <Widget>[
                                  _FeatureChip(label: 'Supabase auth'),
                                  _FeatureChip(label: 'Offline cache'),
                                  _FeatureChip(label: 'FCM alerts'),
                                  _FeatureChip(label: 'Role dashboards'),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),
                    Expanded(
                      child: Card(
                        child: Padding(
                          padding: const EdgeInsets.all(24),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Text(
                                'Dr. Girish ERP',
                                style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
                              ),
                              const SizedBox(height: 8),
                              Text(
                                _useOtp ? 'Sign in with OTP' : 'Sign in with password',
                                style: theme.textTheme.bodyMedium,
                              ),
                              const SizedBox(height: 24),
                              TextField(
                                controller: _emailController,
                                decoration: const InputDecoration(
                                  labelText: 'Email or username',
                                ),
                              ),
                              const SizedBox(height: 16),
                              if (_useOtp) ...<Widget>[
                                TextField(
                                  controller: _otpController,
                                  decoration: const InputDecoration(labelText: 'OTP code'),
                                ),
                                const SizedBox(height: 16),
                              ] else ...<Widget>[
                                TextField(
                                  controller: _passwordController,
                                  obscureText: true,
                                  decoration: const InputDecoration(labelText: 'Password'),
                                ),
                                const SizedBox(height: 16),
                              ],
                              if (authState.error != null) ...<Widget>[
                                Text(
                                  authState.error!,
                                  style: const TextStyle(color: Colors.red),
                                ),
                                const SizedBox(height: 12),
                              ],
                              SizedBox(
                                width: double.infinity,
                                child: FilledButton(
                                  onPressed: authState.loading
                                      ? null
                                      : () async {
                                          if (_useOtp) {
                                            if (!_otpRequested) {
                                              await authController.requestOtp(_emailController.text.trim());
                                              setState(() => _otpRequested = true);
                                              return;
                                            }
                                            await authController.verifyOtp(
                                              _emailController.text.trim(),
                                              _otpController.text.trim(),
                                            );
                                            return;
                                          }
                                          await authController.loginWithPassword(
                                            _emailController.text.trim(),
                                            _passwordController.text,
                                          );
                                        },
                                  child: Text(
                                    authState.loading
                                        ? 'Please wait...'
                                        : _useOtp
                                            ? (_otpRequested ? 'Verify OTP' : 'Send OTP')
                                            : 'Login',
                                  ),
                                ),
                              ),
                              const SizedBox(height: 12),
                              TextButton(
                                onPressed: authState.loading
                                    ? null
                                    : () {
                                        setState(() {
                                          _useOtp = !_useOtp;
                                          _otpRequested = false;
                                        });
                                      },
                                child: Text(
                                  _useOtp ? 'Use password login instead' : 'Use OTP instead',
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _FeatureChip extends StatelessWidget {
  const _FeatureChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Chip(
      label: Text(label),
      side: const BorderSide(color: Color(0xFFC7D2FE)),
      backgroundColor: Colors.white,
      visualDensity: VisualDensity.compact,
    );
  }
}
