import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import { useRefDataStore } from '@store/referenceData';
import type { Batch, OnlineTest } from '@types';
import {
  createDefaultTestForm,
  describeBatchName,
  mapTestToForm,
  onlineTestInputClass,
  onlineTestLabelClass,
  testFormToPayload,
  type TestFormState,
} from '@pages/onlineTestsShared';
import { EXAM_TYPE_OPTIONS, getSubjectsForExamType } from '@pages/offlineExamsShared';

type OnlineTestEditorProps = {
  mode: 'create' | 'edit';
  testId?: string;
};

export default function OnlineTestEditor({ mode, testId }: OnlineTestEditorProps) {
  const navigate = useNavigate();
  const { authReady, sessionReady, schoolContextReady, session } = useAuth();
  const canRunRequests = authReady && sessionReady && schoolContextReady && !!session;

  const [form, setForm] = useState<TestFormState>(createDefaultTestForm());
  const [batches, setBatches] = useState<Batch[]>([]);
  const [test, setTest] = useState<OnlineTest | null>(null);
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

  const loadBatches = async () => {
    try {
      const batchData = await useRefDataStore.getState().getBatches(1, 'batch');
      setBatches(batchData || []);
    } catch {
      setBatches([]);
    }
  };

  const loadEditorData = async (id: string) => {
    try {
      setLoading(true);
      setPageError('');
      const testResponse = await apiService.getOnlineTest(id);
      setTest(testResponse.data);
      setForm(mapTestToForm(testResponse.data));
    } catch (error) {
      setPageError(getRequestErrorMessage(error, 'Online test editor load nahi ho paya.'));
    } finally {
      setLoading(false);
    }
  };

  const updateForm = <K extends keyof TestFormState>(field: K, value: TestFormState[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const validateForm = () => {
    if (!form.title.trim()) return 'Test title is required.';
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
      const testPayload = testFormToPayload(form, []);

      let activeTestId = testId || '';
      if (mode === 'create') {
        const createResponse = await apiService.createOnlineTest(testPayload);
        activeTestId = createResponse.data.id;
      } else if (activeTestId) {
        await apiService.updateOnlineTest(activeTestId, testPayload);
      }

      navigate(`/online-tests/${activeTestId}/build`, {
        state: {
          banner: {
            type: 'success',
            message:
              mode === 'create'
                ? 'Test created successfully. Now add your questions below.'
                : 'Test details updated successfully.',
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
      <div className="mb-6">
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
          {mode === 'create'
            ? 'Set up test details first, then add questions in the next step.'
            : 'Update test details below.'}
        </p>
      </div>

      {banner ? <Alert type={banner.type} message={banner.message} onClose={() => setBanner(null)} /> : null}

      <div className="mx-auto max-w-3xl space-y-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-5 text-lg font-semibold text-slate-900">Test Details</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className={onlineTestLabelClass}>Title *</label>
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
              <label className={onlineTestLabelClass}>Exam Type</label>
              <select
                value={form.exam_type}
                onChange={(event) => {
                  updateForm('exam_type', event.target.value);
                  updateForm('subjects', []);
                }}
                className={onlineTestInputClass}
              >
                {EXAM_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className={onlineTestLabelClass}>
                Subjects {form.exam_type !== 'custom' ? '(Select one or more)' : ''}
              </label>
              {form.exam_type !== 'custom' ? (
                <div className="flex flex-wrap gap-3 rounded-lg border border-[#d8e2ec] bg-white p-3">
                  {getSubjectsForExamType(form.exam_type).map((subject) => (
                    <label key={subject} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={form.subjects.includes(subject)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            updateForm('subjects', [...form.subjects, subject]);
                          } else {
                            updateForm('subjects', form.subjects.filter((s) => s !== subject));
                          }
                        }}
                        className="h-4 w-4 rounded border-slate-300 text-[#1e3a8a] focus:ring-[#1e3a8a]"
                      />
                      {subject}
                    </label>
                  ))}
                </div>
              ) : (
                <input
                  value={form.subjects.join(', ')}
                  onChange={(event) => {
                    const raw = event.target.value;
                    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
                    updateForm('subjects', parts);
                  }}
                  className={onlineTestInputClass}
                  placeholder="e.g. Physics, Chemistry, Mathematics"
                />
              )}
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

        <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-6 py-4 shadow-sm">
          <div className="text-sm text-slate-600">
            <span className="font-semibold text-slate-900">{describeBatchName(form.batch_id, batches)}</span>
            {form.duration_minutes ? <span className="ml-3">Duration: {form.duration_minutes} min</span> : null}
          </div>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-[#1e3a8a] px-6 py-3 text-sm font-semibold text-white hover:bg-[#1b3277] disabled:opacity-70"
          >
            {saving ? 'Saving...' : 'Save & Add Questions'}
            {!saving && <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
