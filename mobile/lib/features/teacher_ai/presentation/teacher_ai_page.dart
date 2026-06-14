import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/widgets/app_section.dart';
import '../../../core/widgets/async_state_view.dart';
import '../../../core/widgets/stat_tile.dart';
import '../../portal/data/mobile_portal_repository.dart';
import '../../portal/presentation/portal_ui.dart';

enum TeacherAiMode { paper, assignment, lesson, report }

class TeacherAiPage extends ConsumerStatefulWidget {
  const TeacherAiPage({super.key});

  @override
  ConsumerState<TeacherAiPage> createState() => _TeacherAiPageState();
}

class _TeacherAiPageState extends ConsumerState<TeacherAiPage> {
  final TextEditingController _titleController = TextEditingController();
  final TextEditingController _promptController = TextEditingController();
  final TextEditingController _topicController = TextEditingController();
  final TextEditingController _batchController = TextEditingController();
  final TextEditingController _subjectController = TextEditingController();
  final TextEditingController _studentController = TextEditingController();
  final TextEditingController _scoreController = TextEditingController();
  final TextEditingController _maxScoreController = TextEditingController();
  final TextEditingController _teacherNoteController = TextEditingController();

  TeacherAiMode _mode = TeacherAiMode.paper;
  String _difficulty = 'medium';
  String _paperType = 'unit_test';
  String _assignmentType = 'homework';
  String _planScope = 'daily';
  bool _submitting = false;
  String? _error;
  Map<String, dynamic>? _result;

  @override
  void dispose() {
    _titleController.dispose();
    _promptController.dispose();
    _topicController.dispose();
    _batchController.dispose();
    _subjectController.dispose();
    _studentController.dispose();
    _scoreController.dispose();
    _maxScoreController.dispose();
    _teacherNoteController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: <Widget>[
        AppSection(
          title: 'Teacher AI Assistant',
          subtitle: 'Generate papers, assignments, lesson plans, and report comments from existing school data.',
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
                  StatTile(label: 'Mode', value: _label(_mode), helper: 'Current generator'),
                  StatTile(label: 'Difficulty', value: _difficulty, helper: 'Paper / assignment', color: const Color(0xFF7C3AED)),
                  StatTile(label: 'Plan Scope', value: _planScope, helper: 'Lesson planner', color: const Color(0xFF0F766E)),
                  StatTile(label: 'Student', value: _studentController.text.trim().isEmpty ? 'Optional' : 'Selected', helper: 'Report comments', color: const Color(0xFFB45309)),
                ],
              ),
              const SizedBox(height: 16),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: TeacherAiMode.values.map((TeacherAiMode mode) {
                  return ChoiceChip(
                    label: Text(_label(mode)),
                    selected: _mode == mode,
                    onSelected: (_) => setState(() => _mode = mode),
                  );
                }).toList(),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _titleController,
                decoration: const InputDecoration(
                  labelText: 'Title',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _promptController,
                maxLines: 3,
                decoration: const InputDecoration(
                  labelText: 'Prompt',
                  hintText: 'Special instruction or generation note',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _topicController,
                decoration: const InputDecoration(
                  labelText: 'Topic',
                  hintText: 'Chemical Bonding / Algebra / Current Unit',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              if (_mode != TeacherAiMode.report) ...<Widget>[
                Row(
                  children: <Widget>[
                    Expanded(
                      child: TextField(
                        controller: _batchController,
                        decoration: InputDecoration(
                          labelText: _mode == TeacherAiMode.lesson ? 'Class name' : 'Batch UUID',
                          border: const OutlineInputBorder(),
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: TextField(
                        controller: _subjectController,
                        decoration: const InputDecoration(
                          labelText: 'Subject UUID',
                          border: OutlineInputBorder(),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
              ],
              if (_mode == TeacherAiMode.paper || _mode == TeacherAiMode.assignment) ...<Widget>[
                DropdownButtonFormField<String>(
                  value: _difficulty,
                  items: const <DropdownMenuItem<String>>[
                    DropdownMenuItem(value: 'easy', child: Text('Easy')),
                    DropdownMenuItem(value: 'medium', child: Text('Medium')),
                    DropdownMenuItem(value: 'hard', child: Text('Hard')),
                  ],
                  onChanged: (String? value) => setState(() => _difficulty = value ?? 'medium'),
                  decoration: const InputDecoration(
                    labelText: 'Difficulty',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
              ],
              if (_mode == TeacherAiMode.paper) ...<Widget>[
                DropdownButtonFormField<String>(
                  value: _paperType,
                  items: const <DropdownMenuItem<String>>[
                    DropdownMenuItem(value: 'unit_test', child: Text('Unit Test')),
                    DropdownMenuItem(value: 'weekly_test', child: Text('Weekly Test')),
                    DropdownMenuItem(value: 'monthly_test', child: Text('Monthly Test')),
                    DropdownMenuItem(value: 'final_exam', child: Text('Final Exam')),
                  ],
                  onChanged: (String? value) => setState(() => _paperType = value ?? 'unit_test'),
                  decoration: const InputDecoration(
                    labelText: 'Paper Type',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
              ],
              if (_mode == TeacherAiMode.assignment) ...<Widget>[
                DropdownButtonFormField<String>(
                  value: _assignmentType,
                  items: const <DropdownMenuItem<String>>[
                    DropdownMenuItem(value: 'homework', child: Text('Homework')),
                    DropdownMenuItem(value: 'worksheet', child: Text('Worksheet')),
                    DropdownMenuItem(value: 'practice_set', child: Text('Practice Set')),
                    DropdownMenuItem(value: 'revision_sheet', child: Text('Revision Sheet')),
                  ],
                  onChanged: (String? value) => setState(() => _assignmentType = value ?? 'homework'),
                  decoration: const InputDecoration(
                    labelText: 'Assignment Type',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
              ],
              if (_mode == TeacherAiMode.lesson) ...<Widget>[
                DropdownButtonFormField<String>(
                  value: _planScope,
                  items: const <DropdownMenuItem<String>>[
                    DropdownMenuItem(value: 'daily', child: Text('Daily')),
                    DropdownMenuItem(value: 'weekly', child: Text('Weekly')),
                    DropdownMenuItem(value: 'monthly', child: Text('Monthly')),
                  ],
                  onChanged: (String? value) => setState(() => _planScope = value ?? 'daily'),
                  decoration: const InputDecoration(
                    labelText: 'Plan Scope',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
              ],
              if (_mode == TeacherAiMode.report) ...<Widget>[
                TextField(
                  controller: _studentController,
                  decoration: const InputDecoration(
                    labelText: 'Student UUID',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: <Widget>[
                    Expanded(
                      child: TextField(
                        controller: _scoreController,
                        decoration: const InputDecoration(
                          labelText: 'Score',
                          border: OutlineInputBorder(),
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: TextField(
                        controller: _maxScoreController,
                        decoration: const InputDecoration(
                          labelText: 'Max score',
                          border: OutlineInputBorder(),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _teacherNoteController,
                  maxLines: 3,
                  decoration: const InputDecoration(
                    labelText: 'Teacher note',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
              ],
              FilledButton.icon(
                onPressed: _submitting ? null : _submit,
                icon: const Icon(Icons.auto_awesome_outlined),
                label: Text(_submitting ? 'Generating...' : 'Generate'),
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
          const AsyncStateView(loading: true, child: SizedBox.shrink())
        else if (_result != null)
          _ResultView(result: _result!)
        else
          const AppSection(
            title: 'Teacher workflows',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text('Generate question papers'),
                SizedBox(height: 8),
                Text('Generate assignments'),
                SizedBox(height: 8),
                Text('Generate lesson plans'),
                SizedBox(height: 8),
                Text('Generate report comments'),
              ],
            ),
          ),
      ],
    );
  }

  Future<void> _submit() async {
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final repository = ref.read(mobilePortalRepositoryProvider);
      late final Map<String, dynamic> response;
      if (_mode == TeacherAiMode.paper) {
        response = await repository.generateTeacherQuestionPaper(<String, dynamic>{
          if (_titleController.text.trim().isNotEmpty) 'title': _titleController.text.trim(),
          if (_promptController.text.trim().isNotEmpty) 'prompt': _promptController.text.trim(),
          if (_topicController.text.trim().isNotEmpty) 'topic': _topicController.text.trim(),
          if (_batchController.text.trim().isNotEmpty) 'batch_id': _batchController.text.trim(),
          if (_subjectController.text.trim().isNotEmpty) 'subject_id': _subjectController.text.trim(),
          'paper_type': _paperType,
          'difficulty_level': _difficulty,
        });
      } else if (_mode == TeacherAiMode.assignment) {
        response = await repository.generateTeacherAssignment(<String, dynamic>{
          if (_titleController.text.trim().isNotEmpty) 'title': _titleController.text.trim(),
          if (_promptController.text.trim().isNotEmpty) 'prompt': _promptController.text.trim(),
          if (_topicController.text.trim().isNotEmpty) 'topic': _topicController.text.trim(),
          if (_batchController.text.trim().isNotEmpty) 'batch_id': _batchController.text.trim(),
          if (_subjectController.text.trim().isNotEmpty) 'subject_id': _subjectController.text.trim(),
          'assignment_type': _assignmentType,
          'difficulty_level': _difficulty,
        });
      } else if (_mode == TeacherAiMode.lesson) {
        response = await repository.generateTeacherLessonPlan(<String, dynamic>{
          if (_titleController.text.trim().isNotEmpty) 'title': _titleController.text.trim(),
          if (_promptController.text.trim().isNotEmpty) 'prompt': _promptController.text.trim(),
          if (_topicController.text.trim().isNotEmpty) 'topic': _topicController.text.trim(),
          if (_batchController.text.trim().isNotEmpty) 'class_name': _batchController.text.trim(),
          'plan_scope': _planScope,
        });
      } else {
        if (_studentController.text.trim().isEmpty) {
          throw Exception('Student UUID is required for report comments.');
        }
        response = await repository.generateTeacherReportComments(<String, dynamic>{
          'student_id': _studentController.text.trim(),
          if (_titleController.text.trim().isNotEmpty) 'title': _titleController.text.trim(),
          if (_promptController.text.trim().isNotEmpty) 'prompt': _promptController.text.trim(),
          if (_scoreController.text.trim().isNotEmpty) 'score': double.tryParse(_scoreController.text.trim()),
          if (_maxScoreController.text.trim().isNotEmpty) 'max_score': double.tryParse(_maxScoreController.text.trim()),
          if (_teacherNoteController.text.trim().isNotEmpty) 'teacher_note': _teacherNoteController.text.trim(),
        });
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

  String _label(TeacherAiMode mode) {
    switch (mode) {
      case TeacherAiMode.paper:
        return 'Paper';
      case TeacherAiMode.assignment:
        return 'Assignment';
      case TeacherAiMode.lesson:
        return 'Lesson';
      case TeacherAiMode.report:
        return 'Report';
    }
  }
}

class _ResultView extends StatelessWidget {
  const _ResultView({required this.result});

  final Map<String, dynamic> result;

  @override
  Widget build(BuildContext context) {
    return AppSection(
      title: displayValue(result['title'], fallback: 'Teacher AI Output'),
      subtitle: displayValue(result['generated_at'], fallback: 'Generated'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          ...result.entries.take(10).map((MapEntry<String, dynamic> entry) {
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text('${entry.key}: ${displayValue(entry.value)}'),
            );
          }),
        ],
      ),
    );
  }
}
