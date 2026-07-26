import type { Batch, OnlineTest, OnlineTestQuestion } from '@types';

export const onlineTestInputClass =
  'w-full rounded-lg border border-[#d8e2ec] bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-[#d58a17] focus:ring-2 focus:ring-[#f7d9a8]';
export const onlineTestLabelClass = 'mb-1.5 block text-[12px] font-semibold text-slate-700';
export const onlineTestCardClass = 'rounded-2xl border border-slate-200 bg-white shadow-sm';

export type QuestionDraft = {
  id?: string;
  section_id?: string;
  question_code: string;
  subject: string;
  chapter: string;
  topic: string;
  prompt_text: string;
  question_image_url: string;
  question_type: string;
  difficulty_level: string;
  option_lines: string;
  answer_lines: string;
  explanation: string;
  marks: string;
  negative_marks: string;
  display_order: string;
};

export type TestFormState = {
  title: string;
  test_code: string;
  batch_id: string;
  description: string;
  instructions: string;
  test_type: string;
  delivery_mode: string;
  status: string;
  duration_minutes: string;
  total_marks: string;
  pass_marks: string;
  max_attempts: string;
  shuffle_questions: boolean;
  shuffle_options: boolean;
  show_result_immediately: boolean;
  allow_review: boolean;
  starts_at: string;
  ends_at: string;
  exam_type: string;
  subjects: string[];
};

export const createEmptyQuestionDraft = (displayOrder = 1): QuestionDraft => ({
  question_code: '',
  subject: '',
  chapter: '',
  topic: '',
  prompt_text: '',
  question_image_url: '',
  question_type: 'single_choice',
  difficulty_level: 'medium',
  option_lines: '',
  answer_lines: '',
  explanation: '',
  marks: '1',
  negative_marks: '0',
  display_order: String(displayOrder),
});

export const createDefaultTestForm = (): TestFormState => ({
  title: '',
  test_code: '',
  batch_id: '',
  description: '',
  instructions: '',
  test_type: 'objective',
  delivery_mode: 'scheduled',
  status: 'draft',
  duration_minutes: '60',
  total_marks: '0',
  pass_marks: '',
  max_attempts: '1',
  shuffle_questions: false,
  shuffle_options: false,
  show_result_immediately: false,
  allow_review: true,
  starts_at: '',
  ends_at: '',
  exam_type: 'custom',
  subjects: [],
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

export const mapQuestionToDraft = (question: OnlineTestQuestion): QuestionDraft => ({
  id: question.id,
  section_id: question.section_id,
  question_code: question.question_code || '',
  subject: String(question.metadata?.subject || ''),
  chapter: String(question.metadata?.chapter || ''),
  topic: String(question.metadata?.topic || ''),
  prompt_text: question.prompt_text,
  question_image_url: String(question.metadata?.question_image_url || ''),
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
});

export const mapTestToForm = (test: OnlineTest): TestFormState => ({
  title: test.title || '',
  test_code: test.test_code || '',
  batch_id: test.batch_id || '',
  description: test.description || '',
  instructions: test.instructions || '',
  test_type: test.test_type || 'objective',
  delivery_mode: test.delivery_mode || 'scheduled',
  status: test.status || 'draft',
  duration_minutes: String(test.duration_minutes ?? 60),
  total_marks: String(test.total_marks ?? 0),
  pass_marks: test.pass_marks === null || test.pass_marks === undefined ? '' : String(test.pass_marks),
  max_attempts: String(test.max_attempts ?? 1),
  shuffle_questions: Boolean(test.shuffle_questions),
  shuffle_options: Boolean(test.shuffle_options),
  show_result_immediately: Boolean(test.show_result_immediately),
  allow_review: Boolean(test.allow_review),
  starts_at: toLocalDatetimeInput(test.starts_at),
  ends_at: toLocalDatetimeInput(test.ends_at),
  exam_type: String((test as any).metadata?.exam_type || 'custom'),
  subjects: Array.isArray((test as any).metadata?.subjects) ? (test as any).metadata.subjects : [],
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

export const questionDraftToPayload = (draft: QuestionDraft, testId: string) => {
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
    test_id: testId,
    section_id: draft.section_id || undefined,
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
    metadata: {
      subject: draft.subject.trim() || undefined,
      chapter: draft.chapter.trim() || undefined,
      topic: draft.topic.trim() || undefined,
      question_image_url: draft.question_image_url.trim() || undefined,
    },
  };
};

export const testFormToPayload = (form: TestFormState, questionDrafts: QuestionDraft[]) => {
  const questionMarksTotal = questionDrafts.reduce((sum, draft) => sum + Number(draft.marks || 0), 0);
  const totalMarks = Number(form.total_marks || 0);

  return {
    title: form.title.trim(),
    test_code: form.test_code.trim() || undefined,
    batch_id: form.batch_id.trim() || undefined,
    description: form.description.trim() || undefined,
    instructions: form.instructions.trim() || undefined,
    test_type: form.test_type,
    delivery_mode: form.delivery_mode,
    status: form.status,
    duration_minutes: Number(form.duration_minutes || 60),
    total_marks: totalMarks > 0 ? totalMarks : questionMarksTotal,
    pass_marks: form.pass_marks.trim() ? Number(form.pass_marks) : null,
    max_attempts: Number(form.max_attempts || 1),
    shuffle_questions: form.shuffle_questions,
    shuffle_options: form.shuffle_options,
    show_result_immediately: form.show_result_immediately,
    allow_review: form.allow_review,
    starts_at: fromLocalDatetimeInput(form.starts_at),
    ends_at: fromLocalDatetimeInput(form.ends_at),
    metadata: {
      exam_type: form.exam_type || undefined,
      subjects: form.subjects.length > 0 ? form.subjects : undefined,
    },
  };
};

export const describeBatchName = (batchId: string | null | undefined, batches: Batch[]) =>
  batches.find((batch) => String(batch.id) === String(batchId || ''))?.name || 'All batches';
