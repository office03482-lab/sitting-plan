import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileUp,
  Image as ImageIcon,
  Plus,
  Save,
  Trash2,
  Wand2,
} from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { OnlineTest } from '@types';
import {
  createEmptyQuestionDraft,
  mapQuestionToDraft,
  questionDraftToPayload,
  type QuestionDraft,
} from '@pages/onlineTestsShared';

const sideFieldClass =
  'w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100';
const sideLabelClass = 'mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500';
const sideSelectClass = `${sideFieldClass} cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2364748b%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:14px] bg-[right_10px_center] bg-no-repeat pr-8`;

type ActiveTool = 'preview' | 'ocr' | 'pdf' | 'ai' | 'formula' | null;

export default function QuestionBuilder() {
  const { id: testId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { authReady, sessionReady, schoolContextReady, session } = useAuth();
  const canRunRequests = authReady && sessionReady && schoolContextReady && !!session;

  const [test, setTest] = useState<OnlineTest | null>(null);
  const [questionDrafts, setQuestionDrafts] = useState<QuestionDraft[]>([createEmptyQuestionDraft(1)]);
  const [removedQuestionIds, setRemovedQuestionIds] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [pageError, setPageError] = useState('');
  const [banner, setBanner] = useState<{ type: 'success' | 'error' | 'warning' | 'info'; message: string } | null>(null);
  const [activeTool, setActiveTool] = useState<ActiveTool>(null);
  const [uploadingAssetKey, setUploadingAssetKey] = useState('');
  const [assetUploadProgress, setAssetUploadProgress] = useState<Record<string, number>>({});

  const stateBanner = location.state as { banner?: { type: 'success' | 'error' | 'warning' | 'info'; message: string } } | null;
  useEffect(() => {
    if (stateBanner?.banner) {
      setBanner(stateBanner.banner);
      window.history.replaceState({}, '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!canRunRequests || !testId) return;
    void loadTestData(testId);
  }, [canRunRequests, testId]);

  const loadTestData = async (id: string) => {
    try {
      setLoading(true);
      setPageError('');
      const [testResponse, questionResponse] = await Promise.all([
        apiService.getOnlineTest(id),
        apiService.listOnlineTestQuestions({ test_id: id }),
      ]);
      setTest(testResponse.data);
      const questions = questionResponse.data || [];
      setQuestionDrafts(
        questions.length ? questions.map((q) => mapQuestionToDraft(q)) : [createEmptyQuestionDraft(1)],
      );
    } catch (error) {
      setPageError(getRequestErrorMessage(error, 'Question builder load nahi ho paya.'));
    } finally {
      setLoading(false);
    }
  };

  const currentDraft = questionDrafts[currentIndex] || questionDrafts[0];
  const questionCount = questionDrafts.filter((d) => d.prompt_text.trim()).length;
  const totalMarks = useMemo(
    () => questionDrafts.reduce((sum, d) => sum + Number(d.marks || 0), 0),
    [questionDrafts],
  );

  const updateQuestion = useCallback((index: number, field: keyof QuestionDraft, value: string) => {
    setQuestionDrafts((current) =>
      current.map((draft, i) => (i === index ? { ...draft, [field]: value } : draft)),
    );
  }, []);

  const updateCurrentField = useCallback(
    (field: keyof QuestionDraft, value: string) => {
      updateQuestion(currentIndex, field, value);
    },
    [currentIndex, updateQuestion],
  );

  const addQuestion = useCallback(() => {
    setQuestionDrafts((current) => [...current, createEmptyQuestionDraft(current.length + 1)]);
    setCurrentIndex(questionDrafts.length);
  }, [questionDrafts.length]);

  const removeQuestion = useCallback(
    (index: number) => {
      setQuestionDrafts((current) => {
        const target = current[index];
        if (target?.id) {
          setRemovedQuestionIds((existing) => [...existing, target.id as string]);
        }
        const next = current.filter((_, i) => i !== index);
        return next.length ? next : [createEmptyQuestionDraft(1)];
      });
      setCurrentIndex((prev) => Math.max(0, Math.min(prev, questionDrafts.length - 2)));
    },
    [questionDrafts.length],
  );

  const trackAssetProgress = useCallback(
    (key: string) => (progressEvent: { loaded?: number; total?: number }) => {
      const total = Number(progressEvent.total || 0);
      const loaded = Number(progressEvent.loaded || 0);
      if (!total) return;
      setAssetUploadProgress((current) => ({ ...current, [key]: Math.round((loaded / total) * 100) }));
    },
    [],
  );

  const handleQuestionImageUpload = useCallback(
    async (index: number, file: File) => {
      const key = `question-image-${index}`;
      try {
        setUploadingAssetKey(key);
        const response = await apiService.uploadImage(file, {
          purpose: 'online_test_question',
          onUploadProgress: trackAssetProgress(key),
        });
        updateQuestion(index, 'question_image_url', response.data.url);
        setBanner({ type: 'success', message: 'Question image uploaded.' });
      } catch (error) {
        setBanner({ type: 'error', message: getRequestErrorMessage(error, 'Image upload nahi hua.') });
      } finally {
        setUploadingAssetKey('');
      }
    },
    [updateQuestion, trackAssetProgress],
  );

  const handleOptionImageUpload = useCallback(
    async (questionIndex: number, optionIndex: number, file: File) => {
      const key = `option-image-${questionIndex}-${optionIndex}`;
      try {
        setUploadingAssetKey(key);
        const response = await apiService.uploadImage(file, {
          purpose: 'online_test_option',
          onUploadProgress: trackAssetProgress(key),
        });
        const lines = questionDrafts[questionIndex]?.option_lines.split('\n') || [];
        while (lines.length <= optionIndex) lines.push('');
        const currentLine =
          lines[optionIndex]?.split('|')[0]?.trim() || `Option ${String.fromCharCode(65 + optionIndex)}`;
        lines[optionIndex] = `${currentLine} | ${response.data.url}`;
        updateQuestion(questionIndex, 'option_lines', lines.join('\n'));
        setBanner({ type: 'success', message: `Option ${String.fromCharCode(65 + optionIndex)} image uploaded.` });
      } catch (error) {
        setBanner({ type: 'error', message: getRequestErrorMessage(error, 'Option image upload nahi hua.') });
      } finally {
        setUploadingAssetKey('');
      }
    },
    [questionDrafts, updateQuestion, trackAssetProgress],
  );

  const validateCurrentQuestion = () => {
    if (!currentDraft?.prompt_text.trim()) return 'Question prompt is required.';
    if (['single_choice', 'multiple_choice'].includes(currentDraft.question_type) && !currentDraft.option_lines.trim()) {
      return 'Choice questions need option lines.';
    }
    if (!currentDraft.answer_lines.trim()) return 'Answer is required.';
    return '';
  };

  const saveQuestions = async (showBanner = true) => {
    if (!testId) return;
    try {
      setSaving(true);
      setBanner(null);

      for (const questionId of removedQuestionIds) {
        await apiService.deleteOnlineTestQuestion(questionId);
      }
      setRemovedQuestionIds([]);

      const validQuestions = questionDrafts.filter((d) => d.prompt_text.trim());
      for (const question of validQuestions) {
        const payload = questionDraftToPayload(question, testId);
        if (question.id) {
          await apiService.updateOnlineTestQuestion(question.id, payload);
        } else {
          const created = await apiService.createOnlineTestQuestion(payload);
          setQuestionDrafts((prev) =>
            prev.map((d) => (d === question ? { ...d, id: created.data.id } : d)),
          );
        }
      }

      if (showBanner) {
        setBanner({ type: 'success', message: 'Questions saved successfully.' });
      }
      return true;
    } catch (error) {
      setBanner({ type: 'error', message: getRequestErrorMessage(error, 'Questions save nahi hue.') });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAndNext = async () => {
    const error = validateCurrentQuestion();
    if (error) {
      setBanner({ type: 'error', message: error });
      return;
    }
    const ok = await saveQuestions(false);
    if (ok) {
      if (currentIndex >= questionDrafts.length - 1) {
        addQuestion();
      } else {
        setCurrentIndex((prev) => prev + 1);
      }
      setBanner({ type: 'success', message: 'Saved. Next question ready.' });
    }
  };

  const handlePublish = async () => {
    if (!testId) return;
    try {
      setPublishing(true);
      setBanner(null);
      const ok = await saveQuestions(false);
      if (!ok) return;
      await apiService.publishOnlineTest(testId);
      setBanner({ type: 'success', message: 'Test published successfully!' });
    } catch (error) {
      setBanner({ type: 'error', message: getRequestErrorMessage(error, 'Publish nahi ho paya.') });
    } finally {
      setPublishing(false);
    }
  };

  if (loading) {
    return <LoadingSpinner message="Question builder load ho raha hai..." />;
  }

  if (pageError) {
    return (
      <div className="p-4 md:p-6">
        <Alert type="error" message={pageError} />
      </div>
    );
  }

  const toolSections: { key: ActiveTool; label: string; icon: typeof Wand2; color: string }[] = [
    { key: 'ai', label: 'AI Generator', icon: Bot, color: 'text-violet-600' },
    { key: 'ocr', label: 'OCR Scan', icon: ImageIcon, color: 'text-emerald-600' },
    { key: 'pdf', label: 'PDF Import', icon: FileUp, color: 'text-rose-600' },
    { key: 'formula', label: 'Formula', icon: Wand2, color: 'text-amber-600' },
  ];

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      {/* ── Top Bar ── */}
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(`/online-tests/edit/${testId}`)}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div className="h-5 w-px bg-slate-200" />
          <div>
            <h1 className="text-sm font-bold text-slate-900">{test?.title || 'Question Builder'}</h1>
            <p className="text-[11px] text-slate-500">
              {questionCount} questions · {totalMarks} marks
            </p>
          </div>
        </div>

        {/* Question Tabs */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
            disabled={currentIndex === 0}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex max-w-[320px] gap-1 overflow-x-auto">
            {questionDrafts.map((draft, idx) => (
              <button
                key={draft.id || `tab-${idx}`}
                type="button"
                onClick={() => setCurrentIndex(idx)}
                className={`flex h-8 min-w-[32px] shrink-0 items-center justify-center rounded-lg border px-2 text-xs font-bold transition ${
                  idx === currentIndex
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {idx + 1}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setCurrentIndex((prev) => Math.min(questionDrafts.length - 1, prev + 1))}
            disabled={currentIndex >= questionDrafts.length - 1}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={addQuestion}
            className="ml-2 inline-flex h-8 items-center gap-1 rounded-lg border border-dashed border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:border-blue-400 hover:text-blue-600"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </div>
      </header>

      {banner ? (
        <div className="shrink-0 px-4 pt-2">
          <Alert type={banner.type} message={banner.message} onClose={() => setBanner(null)} />
        </div>
      ) : null}

      {/* ── Main 3-Column ── */}
      <div className="flex min-h-0 flex-1">
        {/* LEFT — Metadata */}
        <aside className="w-[300px] shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Metadata</h3>
            {currentDraft?.id ? (
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">SAVED</span>
            ) : (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">DRAFT</span>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <label className={sideLabelClass}>Subject</label>
              <input
                value={currentDraft?.subject || ''}
                onChange={(e) => updateCurrentField('subject', e.target.value)}
                className={sideFieldClass}
                placeholder="Physics"
              />
            </div>
            <div>
              <label className={sideLabelClass}>Chapter</label>
              <input
                value={currentDraft?.chapter || ''}
                onChange={(e) => updateCurrentField('chapter', e.target.value)}
                className={sideFieldClass}
                placeholder="Laws of Motion"
              />
            </div>
            <div>
              <label className={sideLabelClass}>Topic</label>
              <input
                value={currentDraft?.topic || ''}
                onChange={(e) => updateCurrentField('topic', e.target.value)}
                className={sideFieldClass}
                placeholder="Newton's Laws"
              />
            </div>

            <div className="h-px bg-slate-100" />

            <div>
              <label className={sideLabelClass}>Question Type</label>
              <select
                value={currentDraft?.question_type || 'single_choice'}
                onChange={(e) => updateCurrentField('question_type', e.target.value)}
                className={sideSelectClass}
              >
                <option value="single_choice">Single choice</option>
                <option value="multiple_choice">Multiple choice</option>
                <option value="short_answer">Short answer</option>
                <option value="long_answer">Long answer</option>
                <option value="numeric">Numerical</option>
              </select>
            </div>
            <div>
              <label className={sideLabelClass}>Difficulty</label>
              <select
                value={currentDraft?.difficulty_level || 'medium'}
                onChange={(e) => updateCurrentField('difficulty_level', e.target.value)}
                className={sideSelectClass}
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>

            <div className="h-px bg-slate-100" />

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={sideLabelClass}>Marks</label>
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  value={currentDraft?.marks || '1'}
                  onChange={(e) => updateCurrentField('marks', e.target.value)}
                  className={sideFieldClass}
                />
              </div>
              <div>
                <label className={sideLabelClass}>Negative</label>
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  value={currentDraft?.negative_marks || '0'}
                  onChange={(e) => updateCurrentField('negative_marks', e.target.value)}
                  className={sideFieldClass}
                />
              </div>
            </div>
            <div>
              <label className={sideLabelClass}>Display Order</label>
              <input
                type="number"
                min="1"
                value={currentDraft?.display_order || '1'}
                onChange={(e) => updateCurrentField('display_order', e.target.value)}
                className={sideFieldClass}
              />
            </div>

            <div className="h-px bg-slate-100" />

            <div>
              <label className={sideLabelClass}>Question Image</label>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5 text-xs font-medium text-slate-600 hover:border-blue-400 hover:bg-blue-50">
                <ImageIcon className="h-4 w-4" />
                {currentDraft?.question_image_url ? 'Change image' : 'Upload image'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file && currentIndex !== undefined) void handleQuestionImageUpload(currentIndex, file);
                  }}
                />
              </label>
              {currentDraft?.question_image_url ? (
                <img
                  src={currentDraft.question_image_url}
                  alt="Question"
                  className="mt-2 max-h-32 w-full rounded-lg border border-slate-200 object-contain"
                />
              ) : null}
              {uploadingAssetKey === `question-image-${currentIndex}` ? (
                <p className="mt-1 text-[10px] text-slate-400">Uploading... {assetUploadProgress[`question-image-${currentIndex}`] || 0}%</p>
              ) : null}
            </div>
          </div>

          {/* Question Nav — Bottom of sidebar */}
          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
              disabled={currentIndex === 0}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-30"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </button>
            <span className="text-xs font-bold text-slate-400">
              {currentIndex + 1} / {questionDrafts.length}
            </span>
            <button
              type="button"
              onClick={() => setCurrentIndex((prev) => Math.min(questionDrafts.length - 1, prev + 1))}
              disabled={currentIndex >= questionDrafts.length - 1}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-30"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </aside>

        {/* CENTER — Question Editor */}
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto p-6">
          <div className="mx-auto w-full max-w-3xl space-y-5">
            {/* Prompt */}
            <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                <h3 className="text-sm font-bold text-slate-900">Question Prompt</h3>
                <span className="text-[11px] font-medium text-slate-400">
                  {(currentDraft?.prompt_text || '').length} chars
                </span>
              </div>
              <div className="p-1">
                <textarea
                  value={currentDraft?.prompt_text || ''}
                  onChange={(e) => updateCurrentField('prompt_text', e.target.value)}
                  className="w-full resize-none rounded-lg border-0 bg-[#fafbfc] p-4 text-[15px] leading-relaxed text-slate-900 outline-none placeholder:text-slate-400 focus:bg-white"
                  rows={6}
                  placeholder="Type your question here..."
                />
              </div>
            </section>

            {/* Options */}
            {(currentDraft?.question_type === 'single_choice' ||
              currentDraft?.question_type === 'multiple_choice') && (
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="mb-3 text-sm font-bold text-slate-900">Answer Options</h3>
                <div className="grid grid-cols-2 gap-3">
                  {(currentDraft?.option_lines.split('\n').filter(Boolean).length > 0
                    ? currentDraft.option_lines.split('\n').filter(Boolean)
                    : ['', '', '', '']
                  ).map((line, optIdx) => {
                    const text = line.split('|')[0]?.trim() || '';
                    const imageUrl = line.split('|')[1]?.trim() || '';
                    return (
                      <div
                        key={optIdx}
                        className="relative rounded-xl border border-slate-200 bg-slate-50 p-3 transition hover:border-blue-300"
                      >
                        <div className="mb-2 flex items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[11px] font-bold text-slate-700">
                            {String.fromCharCode(65 + optIdx)}
                          </span>
                          <input
                            value={text}
                            onChange={(e) => {
                              const lines = (currentDraft?.option_lines || '').split('\n');
                              while (lines.length <= optIdx) lines.push('');
                              const img = lines[optIdx]?.split('|')[1]?.trim() || '';
                              lines[optIdx] = img ? `${e.target.value} | ${img}` : e.target.value;
                              updateCurrentField('option_lines', lines.join('\n'));
                            }}
                            className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                            placeholder={`Option ${String.fromCharCode(65 + optIdx)}`}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="flex-1 cursor-pointer text-[11px] font-medium text-slate-400 hover:text-blue-600">
                            + Image
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp,image/gif"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                e.target.value = '';
                                if (file) void handleOptionImageUpload(currentIndex, optIdx, file);
                              }}
                            />
                          </label>
                          {imageUrl && (
                            <button
                              type="button"
                              onClick={() => {
                                const lines = (currentDraft?.option_lines || '').split('\n');
                                while (lines.length <= optIdx) lines.push('');
                                lines[optIdx] = lines[optIdx]?.split('|')[0]?.trim() || '';
                                updateCurrentField('option_lines', lines.join('\n'));
                              }}
                              className="text-[11px] font-medium text-rose-500 hover:text-rose-700"
                            >
                              Remove img
                            </button>
                          )}
                          {uploadingAssetKey === `option-image-${currentIndex}-${optIdx}` && (
                            <span className="text-[10px] text-slate-400">Uploading...</span>
                          )}
                        </div>
                        {imageUrl && (
                          <img src={imageUrl} alt="" className="mt-2 max-h-16 rounded border border-slate-200 object-contain" />
                        )}
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const lines = (currentDraft?.option_lines || '').split('\n').filter(Boolean);
                    lines.push('');
                    updateCurrentField('option_lines', lines.join('\n'));
                  }}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add option
                </button>
              </section>
            )}

            {/* Answer */}
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-3 text-sm font-bold text-slate-900">Correct Answer</h3>
              <textarea
                value={currentDraft?.answer_lines || ''}
                onChange={(e) => updateCurrentField('answer_lines', e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
                rows={3}
                placeholder={
                  ['single_choice', 'multiple_choice'].includes(currentDraft?.question_type || '')
                    ? 'Enter correct option text or id'
                    : 'Enter answer'
                }
              />
            </section>

            {/* Explanation */}
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-3 text-sm font-bold text-slate-900">Explanation (Optional)</h3>
              <textarea
                value={currentDraft?.explanation || ''}
                onChange={(e) => updateCurrentField('explanation', e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
                rows={3}
                placeholder="Explanation shown during review..."
              />
            </section>

            {/* Danger Zone */}
            <div className="flex justify-end pb-4">
              <button
                type="button"
                onClick={() => {
                  if (questionDrafts.length <= 1) return;
                  removeQuestion(currentIndex);
                }}
                disabled={questionDrafts.length <= 1}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-30"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Question
              </button>
            </div>
          </div>
        </main>

        {/* RIGHT — Tools */}
        <aside className="w-[300px] shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-4">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Tools</h3>

          {/* Tool toggle buttons */}
          <div className="space-y-2">
            {toolSections.map((tool) => (
              <button
                key={tool.key}
                type="button"
                onClick={() => setActiveTool(activeTool === tool.key ? null : tool.key)}
                className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-semibold transition ${
                  activeTool === tool.key
                    ? 'border-blue-300 bg-blue-50 text-blue-900'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <tool.icon className={`h-5 w-5 ${tool.color}`} />
                {tool.label}
              </button>
            ))}
          </div>

          {/* Active tool panel */}
          {activeTool && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              {activeTool === 'ai' && (
                <div>
                  <h4 className="mb-3 text-sm font-bold text-slate-900">AI Question Generator</h4>
                  <div className="space-y-2">
                    <input
                      className={sideFieldClass}
                      placeholder="Subject"
                      defaultValue={currentDraft?.subject}
                    />
                    <input className={sideFieldClass} placeholder="Chapter" defaultValue={currentDraft?.chapter} />
                    <input className={sideFieldClass} placeholder="Topic" defaultValue={currentDraft?.topic} />
                    <button
                      type="button"
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700"
                    >
                      <Bot className="h-4 w-4" />
                      Generate
                    </button>
                  </div>
                </div>
              )}
              {activeTool === 'ocr' && (
                <div>
                  <h4 className="mb-3 text-sm font-bold text-slate-900">OCR from Image</h4>
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-white px-4 py-6 text-sm font-medium text-slate-600 hover:border-emerald-400 hover:bg-emerald-50">
                    <ImageIcon className="h-5 w-5 text-emerald-500" />
                    Upload image to scan
                    <input type="file" accept="image/*" className="hidden" />
                  </label>
                </div>
              )}
              {activeTool === 'pdf' && (
                <div>
                  <h4 className="mb-3 text-sm font-bold text-slate-900">Import from PDF</h4>
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-white px-4 py-6 text-sm font-medium text-slate-600 hover:border-rose-400 hover:bg-rose-50">
                    <FileUp className="h-5 w-5 text-rose-500" />
                    Upload PDF document
                    <input type="file" accept=".pdf" className="hidden" />
                  </label>
                </div>
              )}
              {activeTool === 'formula' && (
                <div>
                  <h4 className="mb-3 text-sm font-bold text-slate-900">Formula Editor</h4>
                  <textarea
                    className={`${sideFieldClass} min-h-[100px] font-mono text-xs`}
                    placeholder="Type LaTeX formula here..."
                    defaultValue=""
                  />
                  <p className="mt-2 text-[10px] text-slate-400">Use LaTeX syntax. Preview renders below.</p>
                </div>
              )}
            </div>
          )}

          {/* Live Preview (always visible) */}
          <div className="mt-5 border-t border-slate-100 pt-4">
            <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Live Preview</h4>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] font-bold text-blue-700">
                Q{currentIndex + 1} · {currentDraft?.question_type?.replace('_', ' ')} · {currentDraft?.difficulty_level}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-slate-800">
                {currentDraft?.prompt_text || (
                  <span className="italic text-slate-400">Start typing to see preview...</span>
                )}
              </p>
              {currentDraft?.question_image_url && (
                <img src={currentDraft.question_image_url} alt="" className="mt-2 max-h-32 rounded-lg border border-slate-200 object-contain" />
              )}
              {['single_choice', 'multiple_choice'].includes(currentDraft?.question_type || '') &&
                currentDraft?.option_lines && (
                  <div className="mt-3 space-y-1">
                    {currentDraft.option_lines
                      .split('\n')
                      .filter(Boolean)
                      .map((line, i) => (
                        <p key={i} className="text-xs text-slate-700">
                          <span className="font-bold">{String.fromCharCode(65 + i)}.</span>{' '}
                          {line.split('|')[0]?.trim()}
                        </p>
                      ))}
                  </div>
                )}
            </div>
          </div>
        </aside>
      </div>

      {/* ── Sticky Bottom Bar ── */}
      <footer className="flex shrink-0 items-center justify-between border-t border-slate-200 bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(`/online-tests/edit/${testId}`)}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void saveQuestions()}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-70"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving...' : 'Save Draft'}
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleSaveAndNext()}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-[#1e3a8a] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1b3277] disabled:opacity-70"
          >
            Save & Next
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => void handlePublish()}
            disabled={publishing}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-70"
          >
            <CheckCircle2 className="h-4 w-4" />
            {publishing ? 'Publishing...' : 'Publish'}
          </button>
        </div>
      </footer>
    </div>
  );
}
