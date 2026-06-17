import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Flag, PlayCircle, Send } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { OnlineTest, OnlineTestAttempt, OnlineTestQuestion, OnlineTestResult } from '@types';
import { onlineTestCardClass } from '@pages/onlineTestsShared';

type ResponseDraft = {
  question_id: string;
  response_payload: Record<string, unknown>;
  is_marked_for_review: boolean;
};

export default function OnlineTestTake() {
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const { authReady, sessionReady, schoolContextReady, session } = useAuth();
  const canRunRequests = authReady && sessionReady && schoolContextReady && !!session;

  const [test, setTest] = useState<OnlineTest | null>(null);
  const [questions, setQuestions] = useState<OnlineTestQuestion[]>([]);
  const [attempt, setAttempt] = useState<OnlineTestAttempt | null>(null);
  const [existingResult, setExistingResult] = useState<OnlineTestResult | null>(null);
  const [responseMap, setResponseMap] = useState<Record<string, ResponseDraft>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');
  const autoSubmitTriggeredRef = useRef(false);

  useEffect(() => {
    if (!canRunRequests || !id) return;
    void loadPage();
  }, [canRunRequests, id]);

  useEffect(() => {
    if (!attempt?.started_at || !test?.duration_minutes || existingResult) return;
    const tick = () => {
      const startedAt = new Date(attempt.started_at || '').getTime();
      const expiresAt = startedAt + test.duration_minutes * 60_000;
      const next = Math.max(Math.floor((expiresAt - Date.now()) / 1000), 0);
      setTimeLeft(next);
    };

    tick();
    const intervalId = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalId);
  }, [attempt?.started_at, existingResult, test?.duration_minutes]);

  useEffect(() => {
    if (!attempt || existingResult || timeLeft === null || timeLeft > 0 || autoSubmitTriggeredRef.current) {
      return;
    }
    autoSubmitTriggeredRef.current = true;
    setBanner('Time is over. Your attempt is being auto-submitted.');
    void submitAttempt();
  }, [attempt, existingResult, timeLeft]);

  const currentQuestion = questions[currentIndex] || null;

  const answeredCount = useMemo(
    () => Object.values(responseMap).filter((item) => Object.keys(item.response_payload || {}).length > 0).length,
    [responseMap],
  );

  const loadPage = async () => {
    try {
      setLoading(true);
      setError('');
      const [testResponse, attemptsResponse, resultsResponse] = await Promise.all([
        apiService.getOnlineTest(id),
        apiService.listOnlineTestAttempts({ test_id: id }),
        apiService.listOnlineTestResults({ test_id: id }),
      ]);

      const nextTest = testResponse.data;
      const nextAttempt =
        (attemptsResponse.data || []).find((item) => item.status === 'in_progress') ||
        (attemptsResponse.data || [])[0] ||
        null;
      const nextResult = (resultsResponse.data || [])[0] || null;

      setTest(nextTest);
      setAttempt(nextAttempt);
      setExistingResult(nextResult);

      if (nextAttempt) {
        const attemptResponse = await apiService.getOnlineTestAttempt(nextAttempt.id);
        setAttempt(attemptResponse.data);
        setResponseMap(
          (attemptResponse.data.responses || []).reduce<Record<string, ResponseDraft>>((accumulator, item) => {
            accumulator[item.question_id] = {
              question_id: item.question_id,
              response_payload: item.response_payload || {},
              is_marked_for_review: item.is_marked_for_review,
            };
            return accumulator;
          }, {}),
        );
      } else {
        setResponseMap({});
      }

      try {
        const questionsResponse = await apiService.listOnlineTestQuestions({ test_id: id });
        setQuestions(questionsResponse.data || []);
      } catch (questionError) {
        setQuestions([]);
        setError(
          getRequestErrorMessage(
            questionError,
            'Question paper load nahi ho paya. Backend reader access verify karna hoga before students can attempt this test.',
          ),
        );
      }
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Online test attempt screen load nahi ho payi.'));
    } finally {
      setLoading(false);
    }
  };

  const startAttempt = async () => {
    try {
      setStarting(true);
      const response = await apiService.createOnlineTestAttempt({ test_id: id });
      setAttempt(response.data);
      setExistingResult(null);
      autoSubmitTriggeredRef.current = false;
      setBanner('Attempt started. Answers are being saved question by question.');
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Attempt start nahi ho paya.'));
    } finally {
      setStarting(false);
    }
  };

  const updateDraft = (questionId: string, payload: Record<string, unknown>) => {
    setResponseMap((current) => ({
      ...current,
      [questionId]: {
        question_id: questionId,
        response_payload: payload,
        is_marked_for_review: current[questionId]?.is_marked_for_review || false,
      },
    }));
  };

  const toggleMarkedForReview = (questionId: string) => {
    setResponseMap((current) => ({
      ...current,
      [questionId]: {
        question_id: questionId,
        response_payload: current[questionId]?.response_payload || {},
        is_marked_for_review: !current[questionId]?.is_marked_for_review,
      },
    }));
  };

  const saveCurrentQuestion = async () => {
    if (!attempt || !currentQuestion) return true;
    const responsePayload = responseMap[currentQuestion.id];
    if (!responsePayload) return true;
    try {
      setSaving(true);
      const response = await apiService.saveOnlineTestResponse(attempt.id, responsePayload);
      setAttempt(response.data);
      return true;
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Current answer save nahi ho paya.'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const moveToQuestion = async (index: number) => {
    const saved = await saveCurrentQuestion();
    if (!saved) return;
    setCurrentIndex(index);
  };

  const submitAttempt = async () => {
    if (!attempt) return;
    const saved = await saveCurrentQuestion();
    if (!saved) return;

    try {
      setSubmitting(true);
      const response = await apiService.submitOnlineTestAttempt(attempt.id);
      navigate(`/online-tests/results/${response.data.id}`);
    } catch (requestError) {
      autoSubmitTriggeredRef.current = false;
      setError(getRequestErrorMessage(requestError, 'Attempt submit nahi ho paya.'));
    } finally {
      setSubmitting(false);
    }
  };

  const renderQuestionEditor = () => {
    if (!currentQuestion) return null;
    const currentResponse = responseMap[currentQuestion.id];
    const selectedOptionId = String(currentResponse?.response_payload?.selected_option_id || '');
    const selectedOptionIds = Array.isArray(currentResponse?.response_payload?.selected_option_ids)
      ? (currentResponse?.response_payload?.selected_option_ids as string[])
      : [];
    const textAnswer = String(currentResponse?.response_payload?.text || '');

    if (currentQuestion.question_type === 'multiple_choice') {
      return (
        <div className="space-y-3">
          {(currentQuestion.option_items || []).map((option) => {
            const optionId = String(option.id || '');
            const label = String(option.label || option.value || optionId);
            const checked = selectedOptionIds.includes(optionId);
            return (
              <label key={optionId} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...selectedOptionIds, optionId]
                      : selectedOptionIds.filter((item) => item !== optionId);
                    updateDraft(currentQuestion.id, { selected_option_ids: next });
                  }}
                />
                <span>{label}</span>
              </label>
            );
          })}
        </div>
      );
    }

    if (currentQuestion.question_type === 'single_choice') {
      return (
        <div className="space-y-3">
          {(currentQuestion.option_items || []).map((option) => {
            const optionId = String(option.id || '');
            const label = String(option.label || option.value || optionId);
            return (
              <label key={optionId} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                <input
                  type="radio"
                  name={`question-${currentQuestion.id}`}
                  checked={selectedOptionId === optionId}
                  onChange={() => updateDraft(currentQuestion.id, { selected_option_id: optionId })}
                />
                <span>{label}</span>
              </label>
            );
          })}
        </div>
      );
    }

    if (currentQuestion.question_type === 'numeric') {
      return (
        <input
          type="number"
          value={textAnswer}
          onChange={(event) => updateDraft(currentQuestion.id, { text: event.target.value })}
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-[#d58a17] focus:ring-2 focus:ring-[#f7d9a8]"
          placeholder="Enter the numerical answer"
        />
      );
    }

    return (
      <textarea
        value={textAnswer}
        onChange={(event) => updateDraft(currentQuestion.id, { text: event.target.value })}
        className="min-h-[160px] w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-[#d58a17] focus:ring-2 focus:ring-[#f7d9a8]"
        placeholder="Type your answer here"
      />
    );
  };

  if (loading) {
    return <LoadingSpinner message="Online test load ho raha hai..." />;
  }

  if (!test) {
    return (
      <div className="p-4 md:p-6">
        <Alert type="error" message={error || 'Online test not found.'} />
      </div>
    );
  }

  if (existingResult && !attempt) {
    return (
      <div className="p-4 md:p-6">
        <section className={`${onlineTestCardClass} p-8 text-center`}>
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
          <h1 className="mt-4 text-2xl font-bold text-slate-900">This test has already been submitted</h1>
          <p className="mt-2 text-sm text-slate-600">
            Aapka latest evaluated result already available hai. Result page open kar sakte ho.
          </p>
          <button
            type="button"
            onClick={() => navigate(`/online-tests/results/${existingResult.id}`)}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#1e3a8a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1b3277]"
          >
            <CheckCircle2 className="h-4 w-4" />
            View Result
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{test.title}</h1>
          <p className="mt-1 text-sm text-slate-600">{test.description || 'Read instructions carefully before starting.'}</p>
        </div>
        <div className={`${onlineTestCardClass} px-4 py-3`}>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Clock3 className="h-4 w-4" />
            {timeLeft === null
              ? `${test.duration_minutes} minutes`
              : `${Math.floor(timeLeft / 60)
                  .toString()
                  .padStart(2, '0')}:${(timeLeft % 60).toString().padStart(2, '0')}`}
          </div>
          <p className="mt-1 text-xs text-slate-500">Duration and countdown for the active attempt</p>
        </div>
      </div>

      {banner ? <Alert type="success" message={banner} onClose={() => setBanner('')} /> : null}
      {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}

      {!attempt ? (
        <section className={`${onlineTestCardClass} p-6`}>
          <h2 className="text-lg font-semibold text-slate-900">Ready to begin?</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Questions</p>
              <p className="mt-2 text-xl font-bold text-slate-900">{questions.length || test.sections.reduce((sum, item) => sum + item.question_count, 0)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Total Marks</p>
              <p className="mt-2 text-xl font-bold text-slate-900">{test.total_marks}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Attempts Allowed</p>
              <p className="mt-2 text-xl font-bold text-slate-900">{test.max_attempts}</p>
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-4 text-sm text-blue-800">
            <p className="font-semibold">Instructions</p>
            <p className="mt-2 whitespace-pre-wrap">{test.instructions || 'No additional instructions were published for this test.'}</p>
          </div>

          <button
            type="button"
            onClick={() => void startAttempt()}
            disabled={starting || !questions.length}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#1e3a8a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1b3277] disabled:opacity-70"
          >
            <PlayCircle className="h-4 w-4" />
            {starting ? 'Starting...' : questions.length ? 'Start Test' : 'Questions unavailable'}
          </button>
          {!questions.length ? (
            <p className="mt-3 text-sm text-amber-700">
              Student question reader access currently unavailable hai. Question API access verify karna hoga.
            </p>
          ) : null}
        </section>
      ) : !questions.length ? (
        <section className={`${onlineTestCardClass} p-8 text-center`}>
          <AlertTriangle className="mx-auto h-10 w-10 text-amber-600" />
          <h2 className="mt-4 text-lg font-semibold text-slate-900">Question paper unavailable</h2>
          <p className="mt-2 text-sm text-slate-600">
            Attempt start ho gaya hai, lekin student reader ko questions payload nahi mil raha. Please verify online test question read access.
          </p>
        </section>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
          <aside className={`${onlineTestCardClass} p-4`}>
            <p className="text-sm font-semibold text-slate-900">Question Navigator</p>
            <p className="mt-1 text-xs text-slate-500">{answeredCount} answered of {questions.length}</p>
            <div className="mt-4 grid grid-cols-5 gap-2">
              {questions.map((question, index) => {
                const isAnswered = Boolean(responseMap[question.id] && Object.keys(responseMap[question.id].response_payload || {}).length);
                const isMarked = Boolean(responseMap[question.id]?.is_marked_for_review);
                const isCurrent = index === currentIndex;
                return (
                  <button
                    key={question.id}
                    type="button"
                    onClick={() => void moveToQuestion(index)}
                    className={`rounded-lg border px-0 py-2 text-sm font-semibold transition ${
                      isCurrent
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : isMarked
                          ? 'border-amber-300 bg-amber-50 text-amber-700'
                          : isAnswered
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {index + 1}
                  </button>
                );
              })}
            </div>
          </aside>

          <section className={`${onlineTestCardClass} p-5`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Question {currentIndex + 1} of {questions.length}
                </p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">{currentQuestion?.prompt_text}</h2>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                Marks {currentQuestion?.marks} | Negative {currentQuestion?.negative_marks}
              </div>
            </div>

            {renderQuestionEditor()}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => currentQuestion && toggleMarkedForReview(currentQuestion.id)}
                className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100"
              >
                <Flag className="h-4 w-4" />
                {responseMap[currentQuestion?.id || '']?.is_marked_for_review ? 'Unmark Review' : 'Mark for Review'}
              </button>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void moveToQuestion(Math.max(currentIndex - 1, 0))}
                  disabled={currentIndex === 0 || saving}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-70"
                >
                  Previous
                </button>
                {currentIndex < questions.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => void moveToQuestion(currentIndex + 1)}
                    disabled={saving}
                    className="rounded-lg bg-[#1e3a8a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1b3277] disabled:opacity-70"
                  >
                    {saving ? 'Saving...' : 'Save & Next'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void submitAttempt()}
                    disabled={submitting || saving}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-70"
                  >
                    <Send className="h-4 w-4" />
                    {submitting ? 'Submitting...' : 'Submit Test'}
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
