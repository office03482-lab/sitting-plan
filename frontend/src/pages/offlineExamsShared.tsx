import type { OfflineExam, OfflineExamQuestion } from '@types';

export const offlineExamInputClass =
  'w-full rounded-lg border border-[#d8e2ec] bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-[#d58a17] focus:ring-2 focus:ring-[#f7d9a8]';
export const offlineExamLabelClass = 'mb-1.5 block text-[12px] font-semibold text-slate-700';
export const offlineExamCardClass = 'rounded-2xl border border-slate-200 bg-white shadow-sm';

export type OfflineExamQuestionDraft = {
  id?: string;
  section_id?: string;
  question_code: string;
  prompt_text: string;
  question_type: string;
  difficulty_level: string;
  option_lines: string;
  answer_lines: string;
  explanation: string;
  marks: string;
  negative_marks: string;
  display_order: string;
  set_labels: string;
  subjects: string[];
  subject: string;
  chapter: string;
  topic: string;
  question_image_url: string;
  source: string;
  reference_url: string;
  video_url: string;
};

export type OfflineExamFormState = {
  title: string;
  exam_code: string;
  batch_id: string;
  subject_id: string;
  subjects: string[];
  description: string;
  instructions: string;
  exam_type: string;
  paper_format: string;
  status: string;
  duration_minutes: string;
  total_marks: string;
  pass_marks: string;
  total_sets: string;
  shuffle_questions: boolean;
  allow_negative_marking: boolean;
  exam_date: string;
  exam_start_time: string;
  exam_end_time: string;
  question_source: string;
  seating_required: boolean;
  invigilators_required: boolean;
  hall_tickets_required: boolean;
};

export const createEmptyOfflineExamQuestionDraft = (displayOrder = 1): OfflineExamQuestionDraft => ({
  question_code: '',
  prompt_text: '',
  question_type: 'mcq',
  difficulty_level: 'medium',
  option_lines: '',
  answer_lines: '',
  explanation: '',
  marks: '1',
  negative_marks: '0',
  display_order: String(displayOrder),
  set_labels: 'A',
  subjects: [],
  subject: '',
  chapter: '',
  topic: '',
  question_image_url: '',
  source: '',
  reference_url: '',
  video_url: '',
});

export const createDefaultOfflineExamForm = (): OfflineExamFormState => ({
  title: '',
  exam_code: '',
  batch_id: '',
  subject_id: '',
  subjects: [],
  description: '',
  instructions: '',
  exam_type: 'custom',
  paper_format: 'mcq',
  status: 'draft',
  duration_minutes: '120',
  total_marks: '100',
  pass_marks: '',
  total_sets: '1',
  shuffle_questions: false,
  allow_negative_marking: false,
  exam_date: '',
  exam_start_time: '',
  exam_end_time: '',
  question_source: 'question_bank',
  seating_required: true,
  invigilators_required: true,
  hall_tickets_required: true,
});

const normalizeLine = (value: unknown) => String(value || '').trim();

const toLocalDatetimeInput = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
};

const fromLocalDatetimeInput = (value: string) => {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const questionOptionLabel = (item: Record<string, unknown>) =>
  normalizeLine(item.label) || normalizeLine(item.text) || normalizeLine(item.value) || normalizeLine(item.id);

const mapCorrectAnswersToLines = (answerKey: Record<string, unknown>) => {
  const lines: string[] = [];
  const singleValue = normalizeLine(answerKey.correct_option_id) || normalizeLine(answerKey.correct_value) || normalizeLine(answerKey.expected_value);
  if (singleValue) {
    lines.push(singleValue);
  }
  const multiValues = answerKey.correct_option_ids || answerKey.accepted_values;
  if (Array.isArray(multiValues)) {
    lines.push(...multiValues.map(normalizeLine).filter(Boolean));
  }
  return Array.from(new Set(lines)).join('\n');
};

export const mapOfflineQuestionToDraft = (question: OfflineExamQuestion): OfflineExamQuestionDraft => {
  const meta = (question.metadata || {}) as Record<string, unknown>;
  return {
    id: question.id,
    section_id: question.section_id,
    question_code: question.question_code || '',
    prompt_text: question.prompt_text,
    question_type: question.question_type,
    difficulty_level: question.difficulty_level,
    option_lines: (question.option_items || [])
      .map((item) => {
        const label = questionOptionLabel(item);
        const imageUrl = normalizeLine((item as Record<string, unknown>).image_url);
        return imageUrl ? `${label} | ${imageUrl}` : label;
      })
      .filter(Boolean)
      .join('\n'),
    answer_lines: mapCorrectAnswersToLines(question.answer_key || {}),
    explanation: question.explanation || '',
    marks: String(question.marks ?? 1),
    negative_marks: String(question.negative_marks ?? 0),
    display_order: String(question.display_order ?? 1),
    set_labels: (question.set_labels || ['A']).join(', '),
    subjects: Array.isArray(meta.subjects) ? (meta.subjects as string[]) : [],
    subject: (meta.subject as string) || '',
    chapter: (meta.chapter as string) || '',
    topic: (meta.topic as string) || '',
    question_image_url: normalizeLine(meta.question_image_url),
    source: normalizeLine(meta.source),
    reference_url: normalizeLine(meta.reference_url),
    video_url: normalizeLine(meta.video_url),
  };
};

export const mapOfflineExamToForm = (exam: OfflineExam): OfflineExamFormState => ({
  title: exam.title || '',
  exam_code: exam.exam_code || '',
  batch_id: exam.batch_id || '',
  subject_id: exam.subject_id || '',
  subjects: Array.isArray(exam.metadata?.subjects) ? exam.metadata.subjects : (exam.subject_id ? [exam.subject_id] : []),
  description: exam.description || '',
  instructions: exam.instructions || '',
  exam_type: exam.exam_type || 'custom',
  paper_format: exam.paper_format || 'mcq',
  status: exam.status || 'draft',
  duration_minutes: String(exam.duration_minutes ?? 120),
  total_marks: String(exam.total_marks ?? 100),
  pass_marks: exam.pass_marks === null || exam.pass_marks === undefined ? '' : String(exam.pass_marks),
  total_sets: String(exam.total_sets ?? 1),
  shuffle_questions: Boolean(exam.shuffle_questions),
  allow_negative_marking: Boolean(exam.allow_negative_marking),
  exam_date: exam.exam_date || '',
  exam_start_time: exam.exam_start_time || '',
  exam_end_time: exam.exam_end_time || '',
  question_source: exam.question_source || 'question_bank',
  seating_required: Boolean(exam.seating_required),
  invigilators_required: Boolean(exam.invigilators_required),
  hall_tickets_required: Boolean(exam.hall_tickets_required),
});

const linesToOptions = (lines: string) =>
  lines
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [labelPart, imagePart] = line.split('|').map((item) => item.trim());
      const optionItem: Record<string, unknown> = {
        id: `option_${index + 1}`,
        label: labelPart,
        value: labelPart,
      };
      if (imagePart) {
        optionItem.image_url = imagePart;
      }
      return optionItem;
    });

export const offlineExamQuestionDraftToPayload = (draft: OfflineExamQuestionDraft, examId: string, sectionId: string) => {
  const optionItems = linesToOptions(draft.option_lines);
  const answerValues = draft.answer_lines
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const resolvedOptionIds = answerValues
    .map((answer) => {
      const matched = optionItems.find(
        (item) =>
          String(item.id || '').toLowerCase() === answer.toLowerCase() ||
          String(item.label || '').toLowerCase() === answer.toLowerCase(),
      );
      return matched?.id || answer;
    })
    .filter(Boolean);

  let answer_key: Record<string, unknown> = {};
  if (draft.question_type === 'multiple_choice') {
    answer_key = { correct_option_ids: resolvedOptionIds };
  } else if (draft.question_type === 'numeric') {
    answer_key = { expected_value: answerValues[0] || '' };
  } else if (draft.question_type === 'short_answer' || draft.question_type === 'long_answer') {
    answer_key = { accepted_values: answerValues };
  } else {
    answer_key = { correct_option_id: resolvedOptionIds[0] || '' };
  }

  return {
    exam_id: examId,
    section_id: sectionId,
    question_code: draft.question_code.trim() || undefined,
    display_order: Number(draft.display_order || 1),
    question_type: draft.question_type,
    difficulty_level: draft.difficulty_level,
    prompt_text: draft.prompt_text.trim(),
    option_items: optionItems,
    answer_key,
    explanation: draft.explanation.trim() || undefined,
    marks: Number(draft.marks || 1),
    negative_marks: Number(draft.negative_marks || 0),
    set_labels: draft.set_labels.split(',').map((s) => s.trim()).filter(Boolean),
    metadata: {
      subjects: draft.subjects.length > 0 ? draft.subjects : undefined,
      subject: draft.subject || undefined,
      chapter: draft.chapter || undefined,
      topic: draft.topic || undefined,
      question_image_url: draft.question_image_url || undefined,
      source: draft.source || undefined,
      reference_url: draft.reference_url || undefined,
      video_url: draft.video_url || undefined,
    },
  };
};

export const offlineExamFormToPayload = (form: OfflineExamFormState) => ({
  title: form.title.trim(),
  exam_code: form.exam_code.trim() || undefined,
  batch_id: form.batch_id.trim() || undefined,
  subject_id: form.subjects.length > 0 ? form.subjects[0] : (form.subject_id.trim() || undefined),
  description: form.description.trim() || undefined,
  instructions: form.instructions.trim() || undefined,
  exam_type: form.exam_type,
  paper_format: form.paper_format,
  status: form.status,
  duration_minutes: Number(form.duration_minutes || 120),
  total_marks: Number(form.total_marks || 100),
  pass_marks: form.pass_marks.trim() ? Number(form.pass_marks) : null,
  total_sets: Number(form.total_sets || 1),
  shuffle_questions: form.shuffle_questions,
  allow_negative_marking: form.allow_negative_marking,
  exam_date: form.exam_date || null,
  exam_start_time: form.exam_start_time || null,
  exam_end_time: form.exam_end_time || null,
  question_source: form.question_source,
  seating_required: form.seating_required,
  invigilators_required: form.invigilators_required,
  hall_tickets_required: form.hall_tickets_required,
  metadata: { subjects: form.subjects },
});

export const EXAM_TYPE_OPTIONS = [
  { value: 'neet', label: 'NEET' },
  { value: 'jee_main', label: 'JEE Main' },
  { value: 'jee_advanced', label: 'JEE Advanced' },
  { value: 'boards', label: 'Boards' },
  { value: 'cuet', label: 'CUET' },
  { value: 'olympiad', label: 'Olympiad' },
  { value: 'foundation', label: 'Foundation' },
  { value: 'custom', label: 'Custom' },
];

export const EXAM_TYPE_SUBJECTS_MAP: Record<string, string[]> = {
  neet: ['Physics', 'Chemistry', 'Botany', 'Zoology'],
  jee_main: ['Physics', 'Chemistry', 'Mathematics'],
  jee_advanced: ['Physics', 'Chemistry', 'Mathematics'],
  boards: ['Physics', 'Chemistry', 'Mathematics', 'Biology', 'English', 'Hindi', 'Computer Science'],
  cuet: ['Physics', 'Chemistry', 'Mathematics', 'Biology', 'English', 'General Test'],
  olympiad: ['Physics', 'Chemistry', 'Mathematics', 'Biology'],
  foundation: ['Physics', 'Chemistry', 'Mathematics', 'Biology'],
  custom: [],
};

export const getSubjectsForExamType = (examType: string): string[] =>
  EXAM_TYPE_SUBJECTS_MAP[examType] || EXAM_TYPE_SUBJECTS_MAP.custom;

export const PAPER_FORMAT_OPTIONS = [
  { value: 'mcq', label: 'MCQ Only' },
  { value: 'subjective', label: 'Subjective Only' },
  { value: 'mixed', label: 'Mixed (MCQ + Subjective)' },
  { value: 'omr', label: 'OMR Sheet' },
];

export const QUESTION_SOURCE_OPTIONS = [
  { value: 'question_bank', label: 'Question Bank' },
  { value: 'create_new', label: 'Create New' },
  { value: 'import', label: 'Import (Excel)' },
  { value: 'pdf', label: 'PDF Upload' },
];
