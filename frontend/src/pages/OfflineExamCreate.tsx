import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, FileText, MapPin, Printer, Settings, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { Batch } from '@types';
import {
  createDefaultOfflineExamForm,
  offlineExamFormToPayload,
  offlineExamInputClass,
  offlineExamLabelClass,
  EXAM_TYPE_OPTIONS,
  PAPER_FORMAT_OPTIONS,
  QUESTION_SOURCE_OPTIONS,
  getSubjectsForExamType,
} from '@pages/offlineExamsShared';

type BannerState = { type: 'success' | 'error' | 'warning' | 'info'; message: string } | null;

const STEPS = [
  { id: 1, name: 'Basic Details', icon: FileText },
  { id: 2, name: 'Question Source', icon: Settings },
  { id: 3, name: 'Paper Config', icon: Settings },
  { id: 4, name: 'Logistics', icon: MapPin },
  { id: 5, name: 'Evaluation', icon: Users },
  { id: 6, name: 'Review & Publish', icon: Check },
];

export default function OfflineExamCreate() {
  const navigate = useNavigate();
  const { authReady, sessionReady, schoolContextReady, session } = useAuth();
  const canRunRequests = authReady && sessionReady && schoolContextReady && !!session;

  const [currentStep, setCurrentStep] = useState(1);
  const [form, setForm] = useState(createDefaultOfflineExamForm());
  const [batches, setBatches] = useState<Batch[]>([]);
  const [subjects, setSubjects] = useState<Array<{ id: string; name: string }>>([]);
  const [allSubjects, setAllSubjects] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState<BannerState>(null);

  useEffect(() => {
    if (!canRunRequests) return;
    void loadFormData();
  }, [canRunRequests]);

  const loadFormData = async () => {
    try {
      setLoading(true);
      const [batchRes] = await Promise.all([
        apiService.listBatches(),
      ]);
      setBatches(batchRes.data || []);
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Form data load nahi ho paya.'));
    } finally {
      setLoading(false);
    }
  };

  const updateForm = (field: string, value: unknown) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (publishNow: boolean) => {
    try {
      setSubmitting(true);
      setError('');
      const payload = offlineExamFormToPayload(form);
      if (publishNow) {
        payload.status = 'published';
      }
      const response = await apiService.createOfflineExam(payload);
      const newExamId = response.data.id;
      setBanner({ type: 'success', message: 'Offline exam created successfully!' });
      setTimeout(() => {
        if (form.question_source === 'create_new') {
          navigate(`/offline-exams/build/${newExamId}`, { state: { banner } });
        } else {
          navigate(`/offline-exams/details/${newExamId}`, { state: { banner } });
        }
      }, 800);
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Exam create nahi ho payi.'));
    } finally {
      setSubmitting(false);
    }
  };

  const canProceed = () => {
    if (currentStep === 1) return form.title.trim().length > 0;
    return true;
  };

  if (loading) {
    return <LoadingSpinner message="Form data load ho raha hai..." />;
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <button
          type="button"
          onClick={() => navigate('/offline-exams')}
          className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Offline Exams
        </button>
        <h1 className="text-2xl font-bold text-slate-900">Create Offline Exam</h1>
        <p className="mt-1 text-sm text-slate-600">Exam details configure karo, question paper banao, seating plan set karo.</p>
      </div>

      {banner ? <Alert type={banner.type} message={banner.message} onClose={() => setBanner(null)} /> : null}
      {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}

      <div className="mb-8">
        <div className="flex items-center justify-between">
          {STEPS.map((step, index) => (
            <div key={step.id} className="flex items-center">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold ${
                  currentStep >= step.id
                    ? 'bg-[#d58a17] text-white'
                    : 'bg-slate-200 text-slate-500'
                }`}
              >
                {currentStep > step.id ? (
                  <Check className="h-5 w-5" />
                ) : (
                  <step.icon className="h-5 w-5" />
                )}
              </div>
              <span className={`ml-2 text-sm font-semibold hidden md:inline ${
                currentStep >= step.id ? 'text-slate-900' : 'text-slate-400'
              }`}>
                {step.name}
              </span>
              {index < STEPS.length - 1 && (
                <div className={`mx-3 h-0.5 w-8 md:w-16 ${
                  currentStep > step.id ? 'bg-[#d58a17]' : 'bg-slate-200'
                }`} />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className={`${offlineExamInputClass.split(' ')[0]} rounded-2xl border border-slate-200 bg-white shadow-sm p-6`}>
        {currentStep === 1 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-slate-900">Basic Details</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className={offlineExamLabelClass}>Exam Title *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => updateForm('title', e.target.value)}
                  placeholder="e.g. Half-Yearly Examination 2026"
                  className={offlineExamInputClass}
                />
              </div>
              <div>
                <label className={offlineExamLabelClass}>Exam Code</label>
                <input
                  type="text"
                  value={form.exam_code}
                  onChange={(e) => updateForm('exam_code', e.target.value)}
                  placeholder="e.g. HY-2026-MATH"
                  className={offlineExamInputClass}
                />
              </div>
              <div>
                <label className={offlineExamLabelClass}>Exam Type</label>
                <select
                  value={form.exam_type}
                  onChange={(e) => {
                    const newType = e.target.value;
                    updateForm('exam_type', newType);
                    const defaultSubjects = getSubjectsForExamType(newType);
                    updateForm('subjects', defaultSubjects);
                    updateForm('subject_id', defaultSubjects.length > 0 ? defaultSubjects[0] : '');
                  }}
                  className={offlineExamInputClass}
                >
                  {EXAM_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={offlineExamLabelClass}>Batch / Class</label>
                <select
                  value={form.batch_id}
                  onChange={(e) => updateForm('batch_id', e.target.value)}
                  className={offlineExamInputClass}
                >
                  <option value="">Select Batch</option>
                  {batches.map((batch) => (
                    <option key={batch.id} value={batch.id}>{batch.name}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className={offlineExamLabelClass}>
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
                          className="h-4 w-4 rounded border-slate-300 text-[#d58a17] focus:ring-[#d58a17]"
                        />
                        {subject}
                      </label>
                    ))}
                  </div>
                ) : (
                  <select
                    value={form.subject_id}
                    onChange={(e) => {
                      updateForm('subject_id', e.target.value);
                      if (e.target.value) {
                        updateForm('subjects', [e.target.value]);
                      } else {
                        updateForm('subjects', []);
                      }
                    }}
                    className={offlineExamInputClass}
                  >
                    <option value="">Select Subject</option>
                    {subjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>{subject.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className={offlineExamLabelClass}>Duration (minutes)</label>
                <input
                  type="number"
                  value={form.duration_minutes}
                  onChange={(e) => updateForm('duration_minutes', e.target.value)}
                  className={offlineExamInputClass}
                  min="1"
                />
              </div>
              <div>
                <label className={offlineExamLabelClass}>Total Marks</label>
                <input
                  type="number"
                  value={form.total_marks}
                  onChange={(e) => updateForm('total_marks', e.target.value)}
                  className={offlineExamInputClass}
                  min="0"
                />
              </div>
              <div>
                <label className={offlineExamLabelClass}>Pass Marks</label>
                <input
                  type="number"
                  value={form.pass_marks}
                  onChange={(e) => updateForm('pass_marks', e.target.value)}
                  className={offlineExamInputClass}
                  min="0"
                  placeholder="Optional"
                />
              </div>
            </div>
            <div>
              <label className={offlineExamLabelClass}>Description</label>
              <textarea
                value={form.description}
                onChange={(e) => updateForm('description', e.target.value)}
                rows={2}
                className={offlineExamInputClass}
                placeholder="Exam description..."
              />
            </div>
            <div>
              <label className={offlineExamLabelClass}>Instructions</label>
              <textarea
                value={form.instructions}
                onChange={(e) => updateForm('instructions', e.target.value)}
                rows={3}
                className={offlineExamInputClass}
                placeholder="Exam instructions for students..."
              />
            </div>
          </div>
        )}

        {currentStep === 2 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-slate-900">Question Source</h2>
            <p className="text-sm text-slate-600">Choose how you want to add questions to this exam.</p>
            <div className="grid gap-4 md:grid-cols-2">
              {QUESTION_SOURCE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => updateForm('question_source', opt.value)}
                  className={`rounded-xl border-2 p-5 text-left transition ${
                    form.question_source === opt.value
                      ? 'border-[#d58a17] bg-amber-50'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <p className="text-sm font-semibold text-slate-900">{opt.label}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {opt.value === 'question_bank' && 'Use existing questions from the Question Bank.'}
                    {opt.value === 'create_new' && 'Add questions inline while creating the exam.'}
                    {opt.value === 'import' && 'Import questions from an Excel file.'}
                    {opt.value === 'pdf' && 'Upload a PDF question paper.'}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        {currentStep === 3 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-slate-900">Paper Configuration</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className={offlineExamLabelClass}>Paper Format</label>
                <select
                  value={form.paper_format}
                  onChange={(e) => updateForm('paper_format', e.target.value)}
                  className={offlineExamInputClass}
                >
                  {PAPER_FORMAT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={offlineExamLabelClass}>Number of Sets (A, B, C...)</label>
                <input
                  type="number"
                  value={form.total_sets}
                  onChange={(e) => updateForm('total_sets', e.target.value)}
                  className={offlineExamInputClass}
                  min="1"
                  max="10"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={form.shuffle_questions}
                  onChange={(e) => updateForm('shuffle_questions', e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[#d58a17] focus:ring-[#d58a17]"
                />
                <span className="text-sm font-semibold text-slate-700">Shuffle Questions</span>
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={form.allow_negative_marking}
                  onChange={(e) => updateForm('allow_negative_marking', e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[#d58a17] focus:ring-[#d58a17]"
                />
                <span className="text-sm font-semibold text-slate-700">Allow Negative Marking</span>
              </label>
            </div>
          </div>
        )}

        {currentStep === 4 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-slate-900">Logistics</h2>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className={offlineExamLabelClass}>Exam Date</label>
                <input
                  type="date"
                  value={form.exam_date}
                  onChange={(e) => updateForm('exam_date', e.target.value)}
                  className={offlineExamInputClass}
                />
              </div>
              <div>
                <label className={offlineExamLabelClass}>Start Time</label>
                <input
                  type="time"
                  value={form.exam_start_time}
                  onChange={(e) => updateForm('exam_start_time', e.target.value)}
                  className={offlineExamInputClass}
                />
              </div>
              <div>
                <label className={offlineExamLabelClass}>End Time</label>
                <input
                  type="time"
                  value={form.exam_end_time}
                  onChange={(e) => updateForm('exam_end_time', e.target.value)}
                  className={offlineExamInputClass}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={form.seating_required}
                  onChange={(e) => updateForm('seating_required', e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[#d58a17] focus:ring-[#d58a17]"
                />
                <span className="text-sm font-semibold text-slate-700">Generate Seating Plan</span>
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={form.invigilators_required}
                  onChange={(e) => updateForm('invigilators_required', e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[#d58a17] focus:ring-[#d58a17]"
                />
                <span className="text-sm font-semibold text-slate-700">Assign Invigilators</span>
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={form.hall_tickets_required}
                  onChange={(e) => updateForm('hall_tickets_required', e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[#d58a17] focus:ring-[#d58a17]"
                />
                <span className="text-sm font-semibold text-slate-700">Generate Hall Tickets</span>
              </label>
            </div>
          </div>
        )}

        {currentStep === 5 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-slate-900">Evaluation</h2>
            <p className="text-sm text-slate-600">Configure how marks will be entered and evaluated.</p>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
              <h3 className="text-sm font-semibold text-slate-900">Evaluation Method</h3>
              <p className="mt-2 text-sm text-slate-600">
                After the exam, you can enter marks manually via the Evaluation page, or import scores from an Excel file.
                The system will auto-calculate results, rankings, and pass/fail status.
              </p>
            </div>
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
              <h3 className="text-sm font-semibold text-blue-900">Offline Exam Flow</h3>
              <ol className="mt-2 list-decimal list-inside space-y-1 text-sm text-blue-800">
                <li>Create exam and configure question paper</li>
                <li>Generate hall tickets for students</li>
                <li>Generate seating plan (rooms + seats)</li>
                <li>Conduct exam, mark attendance</li>
                <li>Enter marks via manual entry or Excel import</li>
                <li>Review and publish results</li>
              </ol>
            </div>
          </div>
        )}

        {currentStep === 6 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-slate-900">Review & Publish</h2>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
              <h3 className="text-sm font-semibold text-slate-900">Exam Summary</h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Title</p>
                  <p className="text-sm font-medium text-slate-900">{form.title || 'Not set'}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Type</p>
                  <p className="text-sm font-medium text-slate-900">{EXAM_TYPE_OPTIONS.find((o) => o.value === form.exam_type)?.label}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Subjects</p>
                  <p className="text-sm font-medium text-slate-900">{form.subjects.length > 0 ? form.subjects.join(', ') : 'Not set'}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Duration</p>
                  <p className="text-sm font-medium text-slate-900">{form.duration_minutes} minutes</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Total Marks</p>
                  <p className="text-sm font-medium text-slate-900">{form.total_marks}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Format</p>
                  <p className="text-sm font-medium text-slate-900">{PAPER_FORMAT_OPTIONS.find((o) => o.value === form.paper_format)?.label}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Sets</p>
                  <p className="text-sm font-medium text-slate-900">{form.total_sets}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Question Source</p>
                  <p className="text-sm font-medium text-slate-900">{QUESTION_SOURCE_OPTIONS.find((o) => o.value === form.question_source)?.label}</p>
                </div>
                {form.exam_date && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Exam Date</p>
                    <p className="text-sm font-medium text-slate-900">{form.exam_date}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setCurrentStep((prev) => Math.max(1, prev - 1))}
          disabled={currentStep === 1}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Previous
        </button>

        <div className="flex gap-3">
          {currentStep < 6 ? (
            <button
              type="button"
              onClick={() => setCurrentStep((prev) => Math.min(6, prev + 1))}
              disabled={!canProceed()}
              className="inline-flex items-center gap-2 rounded-lg bg-[#c07a10] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a6650b] disabled:opacity-50"
            >
              Next
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void handleSubmit(false)}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Save as Draft
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit(true)}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-lg bg-[#c07a10] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a6650b] disabled:opacity-50"
              >
                {submitting ? 'Publishing...' : 'Publish & Create'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
