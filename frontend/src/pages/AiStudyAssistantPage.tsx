import { FormEvent, useMemo, useState } from 'react';
import { BookOpenCheck, SearchCheck, Sparkles, Target } from 'lucide-react';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { apiService, getRequestErrorMessage } from '@services/api';
import { useAuth } from '@/contexts/AuthProvider';
import type { AiTutorResponse, DoubtSolverResponse } from '@types';

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm';

type AssistantTab = 'doubt' | 'practice';

export default function AiStudyAssistantPage() {
  const { authReady, sessionReady, schoolContextReady, session } = useAuth();
  const canRunRequests = authReady && sessionReady && schoolContextReady && !!session;

  const [tab, setTab] = useState<AssistantTab>('doubt');
  const [subject, setSubject] = useState('');
  const [chapter, setChapter] = useState('');
  const [topic, setTopic] = useState('');
  const [question, setQuestion] = useState('');
  const [ocrText, setOcrText] = useState('');
  const [difficulty, setDifficulty] = useState('medium');
  const [questionCount, setQuestionCount] = useState('5');
  const [practiceResult, setPracticeResult] = useState<AiTutorResponse | null>(null);
  const [doubtResult, setDoubtResult] = useState<DoubtSolverResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canSubmitPractice = useMemo(
    () => Boolean(subject.trim() && chapter.trim() && topic.trim() && Number(questionCount) > 0),
    [subject, chapter, topic, questionCount],
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canRunRequests) return;
    try {
      setLoading(true);
      setError('');
      setPracticeResult(null);
      setDoubtResult(null);

      if (tab === 'doubt') {
        if (!question.trim() && !ocrText.trim()) {
          setError('Question ya extracted text dena zaroori hai.');
          return;
        }
        const response = await apiService.solveTextDoubt({
          question: question.trim() || undefined,
          extracted_text: ocrText.trim() || undefined,
          metadata: {
            source: 'student_ai',
            subject: subject.trim() || undefined,
            chapter: chapter.trim() || undefined,
            topic: topic.trim() || undefined,
          },
        });
        setDoubtResult(response.data);
        return;
      }

      if (!canSubmitPractice) {
        setError('Subject, chapter, topic, aur count dena zaroori hai.');
        return;
      }

      const response = await apiService.aiTutorPractice({
        topic: `${subject.trim()} - ${chapter.trim()} - ${topic.trim()}`,
        question: `Generate ${questionCount} ${difficulty} practice questions for ${subject.trim()} / ${chapter.trim()} / ${topic.trim()}.`,
        metadata: {
          source: 'student_ai',
          subject: subject.trim(),
          chapter: chapter.trim(),
          topic: topic.trim(),
          difficulty,
          question_count: Number(questionCount),
        },
      });
      setPracticeResult(response.data);
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Student AI response generate nahi hua.'));
    } finally {
      setLoading(false);
    }
  };

  if (!canRunRequests) {
    return <LoadingSpinner message="Student AI load ho raha hai..." />;
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="rounded-[2rem] bg-[linear-gradient(135deg,_#0f172a_0%,_#1d4ed8_55%,_#38bdf8_100%)] p-8 text-white shadow-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-sky-100/80">Student AI</p>
        <h1 className="mt-3 text-3xl font-bold">Doubt Solver & Topic Practice</h1>
        <p className="mt-3 max-w-3xl text-sm text-sky-50/90">
          Sirf do AI tools available hain: academic doubt solving aur chapter/topic based practice generation.
        </p>
      </div>

      {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}

      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard icon={Target} label="Subject Scoped" value={subject.trim() || 'Not set'} helper="Current academic context" />
        <MetricCard icon={SearchCheck} label="Active Topic" value={topic.trim() || 'Not set'} helper="Use for grounded answers" />
        <MetricCard icon={BookOpenCheck} label="Practice Count" value={questionCount || '0'} helper="Requested generated questions" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <div className={cardClass}>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { key: 'doubt', label: 'Ask Doubt' },
              { key: 'practice', label: 'Topic Practice' },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key as AssistantTab)}
                className={`rounded-2xl px-3 py-3 text-sm font-semibold transition ${tab === item.key ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-100'}`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-5 grid gap-3">
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              placeholder="Subject, e.g. Physics"
            />
            <input
              value={chapter}
              onChange={(event) => setChapter(event.target.value)}
              className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              placeholder="Chapter, e.g. Current Electricity"
            />
            <input
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              placeholder="Topic, e.g. Ohm's Law"
            />

            {tab === 'practice' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <select
                  value={difficulty}
                  onChange={(event) => setDifficulty(event.target.value)}
                  className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                >
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={questionCount}
                  onChange={(event) => setQuestionCount(event.target.value)}
                  className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                  placeholder="Question count"
                />
              </div>
            ) : null}

            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              rows={4}
              placeholder={tab === 'doubt' ? 'Type your academic doubt here' : 'Optional extra instruction for practice generation'}
            />

            {tab === 'doubt' ? (
              <textarea
                value={ocrText}
                onChange={(event) => setOcrText(event.target.value)}
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                rows={3}
                placeholder="Optional extracted image text"
              />
            ) : null}

            <button
              disabled={loading || (tab === 'practice' && !canSubmitPractice)}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-70"
            >
              <Sparkles className="h-4 w-4" />
              {loading ? 'Running...' : tab === 'doubt' ? 'Solve Doubt' : 'Generate Practice'}
            </button>
          </form>
        </div>

        <div className={cardClass}>
          {loading ? <LoadingSpinner message="Student AI working..." /> : null}
          {!loading && !practiceResult && !doubtResult ? (
            <div className="space-y-3 text-sm text-slate-600">
              <p>Available workflows:</p>
              <ul className="space-y-2">
                <li>Doubt Solver: direct answer, step-by-step explanation, and common mistakes.</li>
                <li>Topic Practice: chapter/topic-specific practice questions with explanations.</li>
              </ul>
            </div>
          ) : null}

          {!loading && practiceResult ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-slate-900">{practiceResult.topic}</h2>
              <Panel
                title="Practice Questions"
                items={practiceResult.practice_questions.map((item) => `${item.level.toUpperCase()}: ${item.question}`)}
              />
              <Panel title="Answer Strategy" items={practiceResult.answer_strategy} />
              <Panel title="Revision Notes" items={practiceResult.revision_notes} />
            </div>
          ) : null}

          {!loading && doubtResult ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-slate-900">{doubtResult.detected_topic || 'Solved Doubt'}</h2>
              <Panel title="Answer" items={[doubtResult.explanation, doubtResult.final_answer || '']} />
              <Panel title="Step by Step" items={doubtResult.step_by_step} />
              <Panel title="Common Mistakes" items={doubtResult.common_mistakes} />
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, helper }: { icon: typeof Target; label: string; value: string; helper: string }) {
  return (
    <div className={cardClass}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
          <p className="mt-2 text-sm text-slate-600">{helper}</p>
        </div>
        <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function Panel({ title, items }: { title: string; items: string[] }) {
  const cleaned = items.filter(Boolean);
  return (
    <div>
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <div className="mt-2 space-y-2">
        {cleaned.length ? cleaned.map((item) => (
          <div key={`${title}-${item}`} className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
            {item}
          </div>
        )) : <p className="text-sm text-slate-500">No items generated.</p>}
      </div>
    </div>
  );
}
