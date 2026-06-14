import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/widgets/app_section.dart';
import '../../../core/widgets/async_state_view.dart';
import '../../../core/widgets/stat_tile.dart';
import '../../portal/application/mobile_portal_providers.dart';
import '../../portal/data/mobile_portal_repository.dart';
import '../../portal/presentation/portal_ui.dart';

enum AiTutorMode { chat, explain, practice, revision }

class AiTutorPage extends ConsumerStatefulWidget {
  const AiTutorPage({super.key});

  @override
  ConsumerState<AiTutorPage> createState() => _AiTutorPageState();
}

class _AiTutorPageState extends ConsumerState<AiTutorPage> {
  final TextEditingController _topicController = TextEditingController();
  final TextEditingController _questionController = TextEditingController();
  final TextEditingController _problemController = TextEditingController();
  final TextEditingController _imageController = TextEditingController();
  final TextEditingController _voiceController = TextEditingController();
  final TextEditingController _teacherPromptController = TextEditingController();
  final TextEditingController _targetStudentController = TextEditingController();

  AiTutorMode _mode = AiTutorMode.explain;
  bool _submitting = false;
  String? _error;
  Map<String, dynamic>? _result;

  @override
  void dispose() {
    _topicController.dispose();
    _questionController.dispose();
    _problemController.dispose();
    _imageController.dispose();
    _voiceController.dispose();
    _teacherPromptController.dispose();
    _targetStudentController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final role = ref.watch(currentRoleLabelProvider);
    final profile = ref.watch(currentProfileProvider);
    final isTeacherView = role == 'teacher' || role == 'admin';

    return ListView(
      padding: const EdgeInsets.all(16),
      children: <Widget>[
        AppSection(
          title: 'AI Tutor',
          subtitle:
              'Not a generic chatbot. This tutor uses LMS lessons, weak topics, tests, study planner signals, live classes, and attendance context.',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              GridView.count(
                crossAxisCount: MediaQuery.of(context).size.width > 720 ? 4 : 2,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                crossAxisSpacing: 12,
                mainAxisSpacing: 12,
                childAspectRatio: 1.5,
                children: <Widget>[
                  StatTile(
                    label: 'Role',
                    value: displayValue(profile?.roleLabel, fallback: role),
                    helper: 'Tutor scope',
                  ),
                  StatTile(
                    label: 'Mode',
                    value: _labelForMode(_mode),
                    helper: 'Current action',
                    color: const Color(0xFF0F766E),
                  ),
                  StatTile(
                    label: 'Image',
                    value: _imageController.text.trim().isEmpty ? 'Optional' : 'Attached',
                    helper: 'URL or storage ref',
                    color: const Color(0xFF7C3AED),
                  ),
                  StatTile(
                    label: 'Voice',
                    value: _voiceController.text.trim().isEmpty ? 'Optional' : 'Attached',
                    helper: 'Voice reference',
                    color: const Color(0xFFB45309),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: AiTutorMode.values.map((AiTutorMode mode) {
                  final selected = _mode == mode;
                  return ChoiceChip(
                    label: Text(_labelForMode(mode)),
                    selected: selected,
                    onSelected: (_) => setState(() => _mode = mode),
                  );
                }).toList(),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _topicController,
                decoration: const InputDecoration(
                  labelText: 'Topic',
                  hintText: 'Chemical Bonding',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _questionController,
                maxLines: 4,
                decoration: const InputDecoration(
                  labelText: 'Question or doubt',
                  hintText: 'Explain this in simple language',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _problemController,
                maxLines: 3,
                decoration: const InputDecoration(
                  labelText: 'Problem statement',
                  hintText: 'Paste a numerical or image transcription',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              Row(
                children: <Widget>[
                  Expanded(
                    child: TextField(
                      controller: _imageController,
                      decoration: const InputDecoration(
                        labelText: 'Image input',
                        hintText: 'Image URL or uploaded ref',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: TextField(
                      controller: _voiceController,
                      decoration: const InputDecoration(
                        labelText: 'Voice input',
                        hintText: 'Voice reference',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                ],
              ),
              if (isTeacherView) ...<Widget>[
                const SizedBox(height: 12),
                TextField(
                  controller: _targetStudentController,
                  decoration: const InputDecoration(
                    labelText: 'Target student UUID',
                    hintText: 'Optional student for personalized tutor context',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _teacherPromptController,
                  maxLines: 3,
                  decoration: const InputDecoration(
                    labelText: 'Teacher prompt',
                    hintText: 'Assignment framing, extra constraints, or review instruction',
                    border: OutlineInputBorder(),
                  ),
                ),
              ],
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: _submitting ? null : _submit,
                icon: const Icon(Icons.auto_awesome_outlined),
                label: Text(_submitting ? 'Generating...' : 'Generate tutor response'),
              ),
              if (_error != null) ...<Widget>[
                const SizedBox(height: 12),
                Text(
                  _error!,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: Colors.red.shade700,
                      ),
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 16),
        if (_submitting)
          const AsyncStateView(
            loading: true,
            child: SizedBox.shrink(),
          )
        else if (_result == null)
          const AppSection(
            title: 'Suggested prompts',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text('Explain Chemical Bonding'),
                SizedBox(height: 8),
                Text('Give me practice on Thermodynamics'),
                SizedBox(height: 8),
                Text('Make revision notes for Mole Concept'),
                SizedBox(height: 8),
                Text('Create challenge questions for Algebra'),
              ],
            ),
          )
        else
          _AiTutorResult(result: _result!),
      ],
    );
  }

  Future<void> _submit() async {
    final topic = _topicController.text.trim();
    final question = _questionController.text.trim();
    final problem = _problemController.text.trim();
    if (topic.isEmpty && question.isEmpty && problem.isEmpty) {
      setState(() {
        _error = 'Enter a topic, question, or problem statement.';
      });
      return;
    }

    final payload = <String, dynamic>{
      if (topic.isNotEmpty) 'topic': topic,
      if (question.isNotEmpty) 'question': question,
      if (problem.isNotEmpty) 'problem_statement': problem,
      if (_imageController.text.trim().isNotEmpty) 'image_url': _imageController.text.trim(),
      if (_voiceController.text.trim().isNotEmpty) 'voice_reference': _voiceController.text.trim(),
      if (_teacherPromptController.text.trim().isNotEmpty) 'teacher_prompt': _teacherPromptController.text.trim(),
      if (_targetStudentController.text.trim().isNotEmpty) 'target_student_id': _targetStudentController.text.trim(),
    };

    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      final repository = ref.read(mobilePortalRepositoryProvider);
      late final Map<String, dynamic> response;
      switch (_mode) {
        case AiTutorMode.chat:
          response = await repository.aiTutorChat(payload);
          break;
        case AiTutorMode.explain:
          response = await repository.aiTutorExplain(payload);
          break;
        case AiTutorMode.practice:
          response = await repository.aiTutorPractice(payload);
          break;
        case AiTutorMode.revision:
          response = await repository.aiTutorRevision(payload);
          break;
      }
      if (!mounted) {
        return;
      }
      setState(() {
        _result = response;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _error = '$error';
      });
    } finally {
      if (mounted) {
        setState(() {
          _submitting = false;
        });
      }
    }
  }

  String _labelForMode(AiTutorMode mode) {
    switch (mode) {
      case AiTutorMode.chat:
        return 'Chat';
      case AiTutorMode.explain:
        return 'Explain';
      case AiTutorMode.practice:
        return 'Practice';
      case AiTutorMode.revision:
        return 'Revision';
    }
  }
}

class _AiTutorResult extends StatelessWidget {
  const _AiTutorResult({
    required this.result,
  });

  final Map<String, dynamic> result;

  @override
  Widget build(BuildContext context) {
    final studentProfile = result['student_profile'] as Map<String, dynamic>? ?? const <String, dynamic>{};
    final practiceQuestions = (result['practice_questions'] as List<dynamic>? ?? const <dynamic>[]);
    final flashCards = (result['flash_cards'] as List<dynamic>? ?? const <dynamic>[]);

    return Column(
      children: <Widget>[
        AppSection(
          title: displayValue(result['topic'], fallback: 'AI Tutor Response'),
          subtitle:
              'Mode ${displayValue(result['mode'])}  |  Class ${displayValue(studentProfile['class_level'])}  |  Band ${displayValue(studentProfile['difficulty_band'])}',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(displayValue(result['explanation'])),
              const SizedBox(height: 12),
              _BulletList(title: 'Key points', items: _toStringList(result['key_points'])),
              _BulletList(title: 'Examples', items: _toStringList(result['examples'])),
              _BulletList(title: 'Revision plan', items: _toStringList(result['revision_plan'])),
              _BulletList(title: 'Challenge questions', items: _toStringList(result['challenge_questions'])),
            ],
          ),
        ),
        const SizedBox(height: 16),
        AppSection(
          title: 'Practice and revision assets',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              if (practiceQuestions.isNotEmpty) ...<Widget>[
                Text('Practice questions', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                ...practiceQuestions.map<Widget>((dynamic item) {
                  final row = item as Map<String, dynamic>;
                  return ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.quiz_outlined),
                    title: Text(displayValue(row['question'])),
                    subtitle: Text(displayValue(row['level']).toUpperCase()),
                  );
                }),
              ],
              if (flashCards.isNotEmpty) ...<Widget>[
                const SizedBox(height: 12),
                Text('Flash cards', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                ...flashCards.map<Widget>((dynamic item) {
                  final row = item as Map<String, dynamic>;
                  return Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text('Q: ${displayValue(row['front'])}', style: Theme.of(context).textTheme.titleSmall),
                          const SizedBox(height: 6),
                          Text('A: ${displayValue(row['back'])}'),
                        ],
                      ),
                    ),
                  );
                }),
              ],
              const SizedBox(height: 12),
              _BulletList(title: 'Revision notes', items: _toStringList(result['revision_notes'])),
              _BulletList(title: 'Formula sheet', items: _toStringList(result['formula_sheet'])),
              _BulletList(title: 'Chapter summary', items: _toStringList(result['chapter_summary'])),
            ],
          ),
        ),
        const SizedBox(height: 16),
        AppSection(
          title: 'Recommended learning path',
          subtitle: 'Grounded from LMS, assignments, tests, planner history, and live classes.',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              _RecommendationList(
                title: 'Lessons',
                items: _toStringListFromRecords(result['recommended_lessons'], <String>['lesson_title', 'title']),
              ),
              _RecommendationList(
                title: 'Recordings',
                items: _toStringListFromRecords(result['recommended_recordings'], <String>['title']),
              ),
              _RecommendationList(
                title: 'Assignments',
                items: _toStringListFromRecords(result['recommended_assignments'], <String>['title']),
              ),
              _RecommendationList(
                title: 'Tests',
                items: _toMixedStringList(result['recommended_tests']),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _BulletList extends StatelessWidget {
  const _BulletList({
    required this.title,
    required this.items,
  });

  final String title;
  final List<String> items;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      return const SizedBox.shrink();
    }
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(title, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          ...items.map((String item) => Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    const Text('- '),
                    Expanded(child: Text(item)),
                  ],
                ),
              )),
        ],
      ),
    );
  }
}

class _RecommendationList extends StatelessWidget {
  const _RecommendationList({
    required this.title,
    required this.items,
  });

  final String title;
  final List<String> items;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(title, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          if (items.isEmpty)
            const Text('No direct match found.')
          else
            ...items.map((String item) => Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Text(item),
                )),
        ],
      ),
    );
  }
}

List<String> _toStringList(Object? raw) {
  if (raw is! List) {
    return const <String>[];
  }
  return raw.map((dynamic item) => displayValue(item)).where((String item) => item != '--').toList();
}

List<String> _toStringListFromRecords(Object? raw, List<String> keys) {
  if (raw is! List) {
    return const <String>[];
  }
  return raw.map<String>((dynamic item) {
    if (item is Map<String, dynamic>) {
      for (final key in keys) {
        final value = displayValue(item[key], fallback: '');
        if (value.isNotEmpty) {
          return value;
        }
      }
    }
    return displayValue(item);
  }).where((String item) => item != '--' && item.isNotEmpty).toList();
}

List<String> _toMixedStringList(Object? raw) {
  if (raw is! List) {
    return const <String>[];
  }
  return raw.map<String>((dynamic item) {
    if (item is String) {
      return item;
    }
    if (item is Map<String, dynamic>) {
      return displayValue(item['title']);
    }
    return displayValue(item);
  }).where((String item) => item != '--').toList();
}
