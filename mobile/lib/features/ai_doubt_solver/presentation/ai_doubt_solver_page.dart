import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/widgets/app_section.dart';
import '../../../core/widgets/async_state_view.dart';
import '../../../core/widgets/stat_tile.dart';
import '../../portal/application/mobile_portal_providers.dart';
import '../../portal/data/mobile_portal_repository.dart';
import '../../portal/presentation/portal_ui.dart';

enum DoubtSolverMode { text, image, pdf }

class AiDoubtSolverPage extends ConsumerStatefulWidget {
  const AiDoubtSolverPage({super.key});

  @override
  ConsumerState<AiDoubtSolverPage> createState() => _AiDoubtSolverPageState();
}

class _AiDoubtSolverPageState extends ConsumerState<AiDoubtSolverPage> {
  final TextEditingController _questionController = TextEditingController();
  final TextEditingController _ocrController = TextEditingController();
  final TextEditingController _imageController = TextEditingController();
  final TextEditingController _pdfController = TextEditingController();
  final TextEditingController _screenshotController = TextEditingController();
  final TextEditingController _handwrittenController = TextEditingController();
  final TextEditingController _voiceController = TextEditingController();
  final TextEditingController _teacherPromptController = TextEditingController();
  final TextEditingController _targetStudentController = TextEditingController();

  DoubtSolverMode _mode = DoubtSolverMode.text;
  bool _submitting = false;
  bool _historyLoading = false;
  String? _error;
  Map<String, dynamic>? _result;
  List<Map<String, dynamic>> _history = <Map<String, dynamic>>[];

  @override
  void dispose() {
    _questionController.dispose();
    _ocrController.dispose();
    _imageController.dispose();
    _pdfController.dispose();
    _screenshotController.dispose();
    _handwrittenController.dispose();
    _voiceController.dispose();
    _teacherPromptController.dispose();
    _targetStudentController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final role = ref.watch(currentRoleLabelProvider);
    final isTeacherView = role == 'teacher' || role == 'admin';

    return ListView(
      padding: const EdgeInsets.all(16),
      children: <Widget>[
        AppSection(
          title: 'AI Doubt Solver',
          subtitle:
              'OCR-style extraction, subject detection, topic detection, personalized solving, and teacher escalation.',
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
                    label: 'Mode',
                    value: _labelForMode(_mode),
                    helper: 'Input pipeline',
                  ),
                  StatTile(
                    label: 'OCR Text',
                    value: _ocrController.text.trim().isEmpty ? 'Pending' : 'Ready',
                    helper: 'Text extraction',
                    color: const Color(0xFF7C3AED),
                  ),
                  StatTile(
                    label: 'Voice',
                    value: _voiceController.text.trim().isEmpty ? 'Optional' : 'Attached',
                    helper: 'Voice reference',
                    color: const Color(0xFFB45309),
                  ),
                  StatTile(
                    label: 'History',
                    value: _history.isEmpty ? 'Empty' : '${_history.length}',
                    helper: 'Recent doubts',
                    color: const Color(0xFF0F766E),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: DoubtSolverMode.values.map((DoubtSolverMode mode) {
                  return ChoiceChip(
                    label: Text(_labelForMode(mode)),
                    selected: _mode == mode,
                    onSelected: (_) => setState(() => _mode = mode),
                  );
                }).toList(),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _questionController,
                maxLines: 4,
                decoration: const InputDecoration(
                  labelText: 'Question',
                  hintText: 'Explain Chemical Bonding or solve the numerical',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _ocrController,
                maxLines: 4,
                decoration: const InputDecoration(
                  labelText: 'OCR / extracted text',
                  hintText: 'Paste image text, handwritten note, or PDF snippet',
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
                        labelText: 'Image reference',
                        hintText: 'Camera or gallery URL/ref',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: TextField(
                      controller: _pdfController,
                      decoration: const InputDecoration(
                        labelText: 'PDF reference',
                        hintText: 'Worksheet or PDF URL/ref',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: <Widget>[
                  Expanded(
                    child: TextField(
                      controller: _screenshotController,
                      decoration: const InputDecoration(
                        labelText: 'Screenshot reference',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: TextField(
                      controller: _handwrittenController,
                      decoration: const InputDecoration(
                        labelText: 'Handwritten note ref',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _voiceController,
                decoration: const InputDecoration(
                  labelText: 'Voice reference',
                  hintText: 'Voice question upload ref',
                  border: OutlineInputBorder(),
                ),
              ),
              if (isTeacherView) ...<Widget>[
                const SizedBox(height: 12),
                TextField(
                  controller: _targetStudentController,
                  decoration: const InputDecoration(
                    labelText: 'Target student UUID',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _teacherPromptController,
                  maxLines: 3,
                  decoration: const InputDecoration(
                    labelText: 'Teacher prompt',
                    hintText: 'Review note or custom solving instruction',
                    border: OutlineInputBorder(),
                  ),
                ),
              ],
              const SizedBox(height: 16),
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: <Widget>[
                  FilledButton.icon(
                    onPressed: _submitting ? null : _submit,
                    icon: const Icon(Icons.auto_awesome_outlined),
                    label: Text(_submitting ? 'Solving...' : 'Solve doubt'),
                  ),
                  OutlinedButton.icon(
                    onPressed: _historyLoading ? null : _loadHistory,
                    icon: const Icon(Icons.history_outlined),
                    label: Text(_historyLoading ? 'Loading...' : 'Load history'),
                  ),
                ],
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
          _DoubtResult(result: _result!)
        else
          const AppSection(
            title: 'Supported doubt inputs',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text('Text question'),
                SizedBox(height: 8),
                Text('Screenshot or handwritten note'),
                SizedBox(height: 8),
                Text('PDF snippet'),
                SizedBox(height: 8),
                Text('Voice note with extracted text'),
              ],
            ),
          ),
        const SizedBox(height: 16),
        AppSection(
          title: 'Recent doubt history',
          child: _history.isEmpty
              ? const Text('No doubt history loaded yet.')
              : Column(
                  children: _history.map((Map<String, dynamic> item) {
                    return ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.history_edu_outlined),
                      title: Text(
                        '${displayValue(item['detected_subject'], fallback: 'general')} / ${displayValue(item['detected_topic'], fallback: 'general')}',
                      ),
                      subtitle: Text(displayValue(item['final_answer'], fallback: 'Solution saved without a final answer.')),
                      trailing: Text(displayValue(item['escalation_status'], fallback: 'resolved')),
                    );
                  }).toList(),
                ),
        ),
      ],
    );
  }

  Future<void> _submit() async {
    final question = _questionController.text.trim();
    final ocrText = _ocrController.text.trim();
    if (question.isEmpty && ocrText.isEmpty) {
      setState(() {
        _error = 'Enter a question or OCR text.';
      });
      return;
    }

    final payload = <String, dynamic>{
      if (question.isNotEmpty) 'question': question,
      if (ocrText.isNotEmpty) 'extracted_text': ocrText,
      if (_imageController.text.trim().isNotEmpty) 'image_url': _imageController.text.trim(),
      if (_pdfController.text.trim().isNotEmpty) 'pdf_url': _pdfController.text.trim(),
      if (_screenshotController.text.trim().isNotEmpty) 'screenshot_url': _screenshotController.text.trim(),
      if (_handwrittenController.text.trim().isNotEmpty) 'handwritten_note_url': _handwrittenController.text.trim(),
      if (_voiceController.text.trim().isNotEmpty) 'voice_reference': _voiceController.text.trim(),
      if (_teacherPromptController.text.trim().isNotEmpty) 'teacher_prompt': _teacherPromptController.text.trim(),
      if (_targetStudentController.text.trim().isNotEmpty) 'target_student_id': _targetStudentController.text.trim(),
      'metadata': <String, dynamic>{'source': 'mobile'},
    };

    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      final repository = ref.read(mobilePortalRepositoryProvider);
      late final Map<String, dynamic> response;
      switch (_mode) {
        case DoubtSolverMode.text:
          response = await repository.solveTextDoubt(payload);
          break;
        case DoubtSolverMode.image:
          response = await repository.solveImageDoubt(payload);
          break;
        case DoubtSolverMode.pdf:
          response = await repository.solvePdfDoubt(payload);
          break;
      }
      if (!mounted) {
        return;
      }
      setState(() {
        _result = response;
      });
      await _loadHistory();
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

  Future<void> _loadHistory() async {
    setState(() {
      _historyLoading = true;
      _error = null;
    });
    try {
      final repository = ref.read(mobilePortalRepositoryProvider);
      final response = await repository.loadDoubtHistory(
        targetStudentId: _targetStudentController.text.trim().isEmpty
            ? null
            : _targetStudentController.text.trim(),
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _history = response;
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
          _historyLoading = false;
        });
      }
    }
  }

  String _labelForMode(DoubtSolverMode mode) {
    switch (mode) {
      case DoubtSolverMode.text:
        return 'Text';
      case DoubtSolverMode.image:
        return 'Image';
      case DoubtSolverMode.pdf:
        return 'PDF';
    }
  }
}

class _DoubtResult extends StatelessWidget {
  const _DoubtResult({
    required this.result,
  });

  final Map<String, dynamic> result;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: <Widget>[
        AppSection(
          title:
              '${displayValue(result['detected_subject'], fallback: 'general')} / ${displayValue(result['detected_topic'], fallback: 'general')}',
          subtitle:
              'Confidence ${displayValue(result['confidence_score'])}  |  Escalation ${displayValue(result['escalation_status'])}',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(displayValue(result['explanation'])),
              const SizedBox(height: 12),
              _BulletList(title: 'Step-by-step solution', items: _toStringList(result['step_by_step'])),
              _BulletList(title: 'Common mistakes', items: _toStringList(result['common_mistakes'])),
              _BulletList(title: 'Equations', items: _toStringList(result['extracted_equations'])),
              _BulletList(title: 'Numericals', items: _toStringList(result['extracted_numericals'])),
              _BulletList(title: 'Diagrams', items: _toStringList(result['extracted_diagrams'])),
              _BulletList(
                title: 'Recommendations',
                items: (result['recommendations'] as List<dynamic>? ?? const <dynamic>[])
                    .map<String>((dynamic item) {
                  final row = item as Map<String, dynamic>;
                  return displayValue(
                    row['title'],
                    fallback: displayValue(row['summary'], fallback: displayValue(row['recommendation_type'])),
                  );
                }).toList(),
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
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(title, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          if (items.isEmpty)
            const Text('No items available.')
          else
            ...items.map(
              (String item) => Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    const Padding(
                      padding: EdgeInsets.only(top: 6, right: 8),
                      child: Icon(Icons.circle, size: 8),
                    ),
                    Expanded(child: Text(item)),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

List<String> _toStringList(Object? payload) {
  if (payload is List) {
    return payload.map((Object? item) => displayValue(item)).where((String item) => item.isNotEmpty).toList();
  }
  return const <String>[];
}
