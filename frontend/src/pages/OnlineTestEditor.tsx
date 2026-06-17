import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Plus, Save, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { Batch, OnlineTest, OnlineTestQuestion } from '@types';
import {
  createDefaultTestForm,
  createEmptyQuestionDraft,
  describeBatchName,
  mapQuestionToDraft,
  mapTestToForm,
  onlineTestCardClass,
  onlineTestInputClass,
  onlineTestLabelClass,
  questionDraftToPayload,
  testFormToPayload,
  type QuestionDraft,
  type TestFormState,
} from '@pages/onlineTestsShared';

type OnlineTestEditorProps = {
  mode: 'create' | 'edit';
  testId?: string;
};

export default function OnlineTestEditor({ mode, testId }: OnlineTestEditorProps) {
  const navigate = useNavigate();
  const { authReady, sessionReady, schoolContextReady, session } = useAuth();
  const canRunRequests = authReady && sessionReady && schoolContextReady && !!session;

  const [form, setForm] = useState<TestFormState>(createDefaultTestForm());
  const [questionDrafts, setQuestionDrafts] = useState<QuestionDraft[]>([createEmptyQuestionDraft(1)]);
  const [removedQuestionIds, setRemovedQuestionIds] = useState<string[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [test, setTest] = useState<OnlineTest | null>(null);
  const [existingQuestions, setExistingQuestions] = useState<OnlineTestQuestion[]>([]);
  const [loading, setLoading] = useState(mode === 'edit');
  const [saving, setSaving] = useState(false);
  const [pageError, setPageError] = useState('');
  const [banner, setBanner] = useState<{ type: 'success' | 'error' | 'warning' | 'info'; message: string } | null>(null);

  useEffect(() => {
    if (!canRunRequests) return;
    void loadBatches();
    if (mode === 'edit' && testId) {
      void loadEditorData(testId);
    }
  }, [canRunRequests, mode, testId]);

  const questionMarksTotal = useMemo(
    () => questionDrafts.reduce((sum, draft) => sum + Number(draft.marks || 0), 0),
    [questionDrafts],
  );

  const loadBatches = async () => {
    try {
      const response = await apiService.listBatches(1, true, 'batch');
      setBatches(response.data || []);
    } catch {
      setBatches([]);
    }
  };

  const loadEditorData = async (id: string) => {
    try {
      setLoading(true);
      setPageError('');
      const [testResponse, questionResponse] = await Promise.all([
        apiService.getOnlineTest(id),
        apiService.listOnlineTestQuestions({ test_id: id }),
      ]);
      setTest(testResponse.data);
      setExistingQuestions(questionResponse.data || []);
      setForm(mapTestToForm(testResponse.data));
      setQuestionDrafts(
        (questionResponse.data || []).length
          ? (questionResponse.data || []).map((question) => mapQuestionToDraft(question))
          : [createEmptyQuestionDraft(1)],
      );
    } catch (error) {
      setPageError(getRequestErrorMessage(error, 'Online test editor load nahi ho paya.'));
    } finally {
      setLoading(false);
    }
  };

  const updateForm = <K extends keyof TestFormState>(field: K, value: TestFormState[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const updateQuestion = (index: number, field: keyof QuestionDraft, value: string) => {
    setQuestionDrafts((current) =>
      current.map((draft, draftIndex) => (draftIndex === index ? { ...draft, [field]: value } : draft)),
    );
  };

  const addQuestion = () => {
    setQuestionDrafts((current) => [...current, createEmptyQuestionDraft(current.length + 1)]);
  };

  const removeQuestion = (index: number) => {
    setQuestionDrafts((current) => {
      const target = current[index];
      if (target?.id) {
        setRemovedQuestionIds((existing) => [...existing, target.id as string]);
      }
      const next = current.filter((_, itemIndex) => itemIndex !== index);
      return next.length ? next : [createEmptyQuestionDraft(1)];
    });
  };

  const validateForm = () => {
    if (!form.title.trim()) return 'Test title is required.';
    const validQuestions = questionDrafts.filter((question) => question.prompt_text.trim());
    if (!validQuestions.length) return 'At least one question is required.';
    for (const question of validQuestions) {
      if (['single_choice', 'multiple_choice'].includes(question.question_type) && !question.option_lines.trim()) {
        return 'Choice questions need option lines.';
      }
      if (!question.answer_lines.trim()) {
        return 'Each question needs an answer key or accepted answer.';
      }
    }
    return '';
  };

  const handleSubmit = async () => {
    const validationMessage = validateForm();
    if (validationMessage) {
      setBanner({ type: 'error', message: validationMessage });
      return;
    }

    try {
      setSaving(true);
      setBanner(null);
      const validQuestions = questionDrafts.filter((question) => question.prompt_text.trim());
      const testPayload = testFormToPayload(form, validQuestions);

      let activeTestId = testId || '';
      if (mode === 'create') {
        const createResponse = await apiService.createOnlineTest(testPayload);
        activeTestId = createResponse.data.id;
      } else if (activeTestId) {
        await apiService.updateOnlineTest(activeTestId, testPayload);
      }

      for (const questionId of removedQuestionIds) {
        await apiService.deleteOnlineTestQuestion(questionId);
      }

      for (const question of validQuestions) {
        const questionPayload = questionDraftToPayload(question, activeTestId);
        if (question.id) {
          await apiService.updateOnlineTestQuestion(question.id, questionPayload);
        } else {
          await apiService.createOnlineTestQuestion(questionPayload);
        }
      }

      navigate(mode === 'create' ? `/online-tests/edit/${activeTestId}` : '/online-tests', {
        state: {
          banner: {
            type: 'success',
            message:
              mode === 'create'
                ? 'Online test created successfully. You can continue editing it here.'
                : 'Online test updated successfully.',
          },
        },
      });
    } catch (error) {
      setBanner({ type: 'error', message: getRequestErrorMessage(error, 'Online test save nahi ho paya.') });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <LoadingSpinner message="Online test editor load ho raha hai..." />;
  }

  if (pageError) {
    return (
      <div className="p-4 md:p-6">
        <Alert type="error" message={pageError} />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <button
            type="button"
            onClick={() => navigate('/online-tests')}
            className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Online Tests
          </button>
          <h1 className="text-2xl font-bold text-slate-900">
            {mode === 'create' ? 'Create Online Test' : `Edit ${test?.title || 'Online Test'}`}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Existing UI pattern ke andar hi test setup, schedule aur questions manage karo.
          </p>
        </div>

        <div className={`${onlineTestCardClass} px-4 py-3`}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Question Bank</p>
          <p className="mt-1 text-lg font-bold text-slate-900">{questionDrafts.filter((item) => item.prompt_text.trim()).length}</p>
          <p className="text-xs text-slate-500">Total marks {questionMarksTotal}</p>
        </div>
      </div>

      {banner ? <Alert type={banner.type} message={banner.message} onClose={() => setBanner(null)} /> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <section className={`${onlineTestCardClass} p-5`}>
            <h2 className="mb-4 text-lg font-semibold text-slate-900">Test Details</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className={onlineTestLabelClass}>Title</label>
                <input
                  value={form.title}
                  onChange={(event) => updateForm('title', event.target.value)}
                  className={onlineTestInputClass}
                  placeholder="Unit Test - Physics"
                />
              </div>
              <div>
                <label className={onlineTestLabelClass}>Test Code</label>
                <input
                  value={form.test_code}
                  onChange={(event) => updateForm('test_code', event.target.value)}
                  className={onlineTestInputClass}
                  placeholder="PHY-UT-01"
                />
              </div>
              <div>
                <label className={onlineTestLabelClass}>Batch</label>
                <select
                  value={form.batch_id}
                  onChange={(event) => updateForm('batch_id', event.target.value)}
                  className={onlineTestInputClass}
                >
                  <option value="">All batches</option>
                  {batches.map((batch) => (
                    <option key={String(batch.id)} value={String(batch.id)}>
                      {batch.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={onlineTestLabelClass}>Status</label>
                <select
                  value={form.status}
                  onChange={(event) => updateForm('status', event.target.value)}
                  className={onlineTestInputClass}
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
              <div>
                <label className={onlineTestLabelClass}>Duration (minutes)</label>
                <input
                  type="number"
                  min="1"
                  value={form.duration_minutes}
                  onChange={(event) => updateForm('duration_minutes', event.target.value)}
                  className={onlineTestInputClass}
                />
              </div>
              <div>
                <label className={onlineTestLabelClass}>Maximum Attempts</label>
                <input
                  type="number"
                  min="1"
                  value={form.max_attempts}
                  onChange={(event) => updateForm('max_attempts', event.target.value)}
                  className={onlineTestInputClass}
                />
              </div>
              <div>
                <label className={onlineTestLabelClass}>Total Marks</label>
                <input
                  type="number"
                  min="0"
                  value={form.total_marks}
                  onChange={(event) => updateForm('total_marks', event.target.value)}
                  className={onlineTestInputClass}
                />
              </div>
              <div>
                <label className={onlineTestLabelClass}>Pass Marks</label>
                <input
                  type="number"
                  min="0"
                  value={form.pass_marks}
                  onChange={(event) => updateForm('pass_marks', event.target.value)}
                  className={onlineTestInputClass}
                />
              </div>
              <div>
                <label className={onlineTestLabelClass}>Starts At</label>
                <input
                  type="datetime-local"
                  value={form.starts_at}
                  onChange={(event) => updateForm('starts_at', event.target.value)}
                  className={onlineTestInputClass}
                />
              </div>
              <div>
                <label className={onlineTestLabelClass}>Ends At</label>
                <input
                  type="datetime-local"
                  value={form.ends_at}
                  onChange={(event) => updateForm('ends_at', event.target.value)}
                  className={onlineTestInputClass}
                />
              </div>
              <div className="md:col-span-2">
                <label className={onlineTestLabelClass}>Description</label>
                <textarea
                  value={form.description}
                  onChange={(event) => updateForm('description', event.target.value)}
                  className={`${onlineTestInputClass} min-h-[84px]`}
                  placeholder="Short overview for teachers or students."
                />
              </div>
              <div className="md:col-span-2">
                <label className={onlineTestLabelClass}>Instructions</label>
                <textarea
                  value={form.instructions}
                  onChange={(event) => updateForm('instructions', event.target.value)}
                  className={`${onlineTestInputClass} min-h-[120px]`}
                  placeholder="Question navigation, calculator rules, submission guidance..."
                />
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {[
                ['shuffle_questions', 'Shuffle questions'],
                ['shuffle_options', 'Shuffle options'],
                ['show_result_immediately', 'Show result immediately'],
                ['allow_review', 'Allow review'],
              ].map(([field, label]) => (
                <label
                  key={field}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(form[field as keyof TestFormState])}
                    onChange={(event) =>
                      updateForm(field as keyof TestFormState, event.target.checked as TestFormState[keyof TestFormState])
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </section>

          <section className={`${onlineTestCardClass} p-5`}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Questions</h2>
                <p className="text-sm text-slate-600">Every question saves into the default section created for the test.</p>
              </div>
              <button
                type="button"
                onClick={addQuestion}
                className="inline-flex items-center gap-2 rounded-lg bg-[#c07a10] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a6650b]"
              >
                <Plus className="h-4 w-4" />
                Add Question
              </button>
            </div>

            <div className="space-y-5">
              {questionDrafts.map((question, index) => (
                <div key={question.id || `draft-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h3 className="text-base font-semibold text-slate-900">Question {index + 1}</h3>
                    <button
                      type="button"
                      onClick={() => removeQuestion(index)}
                      className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100"
                    >
                      <Trash2 className="h-4 w-4" />
                      Remove
                    </button>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className={onlineTestLabelClass}>Prompt</label>
                      <textarea
                        value={question.prompt_text}
                        onChange={(event) => updateQuestion(index, 'prompt_text', event.target.value)}
                        className={`${onlineTestInputClass} min-h-[86px]`}
                        placeholder="What is the acceleration due to gravity on Earth?"
                      />
                    </div>
                    <div className="grid gap-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <label className={onlineTestLabelClass}>Question Type</label>
                          <select
                            value={question.question_type}
                            onChange={(event) => updateQuestion(index, 'question_type', event.target.value)}
                            className={onlineTestInputClass}
                          >
                            <option value="single_choice">Single choice</option>
                            <option value="multiple_choice">Multiple choice</option>
                            <option value="short_answer">Short answer</option>
                            <option value="long_answer">Long answer</option>
                            <option value="numeric">Numerical</option>
                          </select>
                        </div>
                        <div>
                          <label className={onlineTestLabelClass}>Difficulty</label>
                          <select
                            value={question.difficulty_level}
                            onChange={(event) => updateQuestion(index, 'difficulty_level', event.target.value)}
                            className={onlineTestInputClass}
                          >
                            <option value="easy">Easy</option>
                            <option value="medium">Medium</option>
                            <option value="hard">Hard</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-3">
                        <div>
                          <label className={onlineTestLabelClass}>Marks</label>
                          <input
                            type="number"
                            min="0"
                            step="0.25"
                            value={question.marks}
                            onChange={(event) => updateQuestion(index, 'marks', event.target.value)}
                            className={onlineTestInputClass}
                          />
                        </div>
                        <div>
                          <label className={onlineTestLabelClass}>Negative Marks</label>
                          <input
                            type="number"
                            min="0"
                            step="0.25"
                            value={question.negative_marks}
                            onChange={(event) => updateQuestion(index, 'negative_marks', event.target.value)}
                            className={onlineTestInputClass}
                          />
                        </div>
                        <div>
                          <label className={onlineTestLabelClass}>Display Order</label>
                          <input
                            type="number"
                            min="1"
                            value={question.display_order}
                            onChange={(event) => updateQuestion(index, 'display_order', event.target.value)}
                            className={onlineTestInputClass}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <label className={onlineTestLabelClass}>Options</label>
                      <textarea
                        value={question.option_lines}
                        onChange={(event) => updateQuestion(index, 'option_lines', event.target.value)}
                        className={`${onlineTestInputClass} min-h-[120px]`}
                        placeholder={'One option per line\n9.8 m/s^2\n10.2 m/s^2\n12 m/s^2'}
                      />
                    </div>
                    <div>
                      <label className={onlineTestLabelClass}>Correct Answer / Accepted Values</label>
                      <textarea
                        value={question.answer_lines}
                        onChange={(event) => updateQuestion(index, 'answer_lines', event.target.value)}
                        className={`${onlineTestInputClass} min-h-[120px]`}
                        placeholder={'For choice questions use option text or option id.\nFor multi-correct use one answer per line.'}
                      />
                    </div>
                  </div>

                  <div className="mt-4">
                    <label className={onlineTestLabelClass}>Explanation</label>
                    <textarea
                      value={question.explanation}
                      onChange={(event) => updateQuestion(index, 'explanation', event.target.value)}
                      className={`${onlineTestInputClass} min-h-[84px]`}
                      placeholder="Optional explanation shown during review."
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section className={`${onlineTestCardClass} p-5`}>
            <h2 className="text-lg font-semibold text-slate-900">Publishing Snapshot</h2>
            <div className="mt-4 space-y-3 text-sm text-slate-600">
              <div className="flex items-center justify-between gap-3">
                <span>Assigned batch</span>
                <span className="font-semibold text-slate-900">{describeBatchName(form.batch_id, batches)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Question count</span>
                <span className="font-semibold text-slate-900">{questionDrafts.filter((item) => item.prompt_text.trim()).length}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Total marks</span>
                <span className="font-semibold text-slate-900">{Number(form.total_marks || 0) || questionMarksTotal}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Status</span>
                <span className="font-semibold capitalize text-slate-900">{form.status.replace('_', ' ')}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Existing questions</span>
                <span className="font-semibold text-slate-900">{existingQuestions.length}</span>
              </div>
            </div>
          </section>

          <section className={`${onlineTestCardClass} p-5`}>
            <h2 className="text-lg font-semibold text-slate-900">Save Changes</h2>
            <p className="mt-2 text-sm text-slate-600">
              Test metadata aur question bank ek hi action me persist honge.
            </p>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={saving}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#1e3a8a] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1b3277] disabled:opacity-70"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : mode === 'create' ? 'Create Test' : 'Update Test'}
            </button>
          </section>
        </aside>
      </div>
    </div>
  );
}
