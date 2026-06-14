import { FormEvent, useMemo, useState } from 'react';
import { BookOpenCheck, Brain, FileText, GraduationCap, ImagePlus, Mic, Sparkles } from 'lucide-react';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { AiTutorResponse } from '@types';

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm';

type TutorMode = 'chat' | 'explain' | 'practice' | 'revision';

export default function AiTutorPage() {
  const { user } = useAuth();
  const roleKey = String(user?.role_key || user?.role || '').toLowerCase();
  const isTeacherView = roleKey === 'teacher' || roleKey === 'school_admin' || roleKey === 'platform_admin' || roleKey === 'admin';

  const [mode, setMode] = useState<TutorMode>('explain');
  const [topic, setTopic] = useState('');
  const [question, setQuestion] = useState('');
  const [problemStatement, setProblemStatement] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [voiceReference, setVoiceReference] = useState('');
  const [teacherPrompt, setTeacherPrompt] = useState('');
  const [targetStudentId, setTargetStudentId] = useState('');
  const [result, setResult] = useState<AiTutorResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const modeCopy = useMemo<Record<TutorMode, { title: string; subtitle: string }>>(
    () => ({
      chat: {
        title: 'Grounded Tutor Chat',
        subtitle: 'Open-ended doubt solving, but always grounded in your class level, weak topics, tests, and LMS path.',
      },
      explain: {
        title: 'Concept Explain',
        subtitle: 'Personalized explanation with simple or advanced framing based on student strength.',
      },
      practice: {
        title: 'Practice Builder',
        subtitle: 'Generate practice questions and answer strategy from weak topics and prior attempts.',
      },
      revision: {
        title: 'Revision Pack',
        subtitle: 'Create revision notes, flash cards, formula sheets, and short chapter summary.',
      },
    }),
    [],
  );

  const submitTutor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!topic.trim() && !question.trim() && !problemStatement.trim()) {
      setError('Topic ya question dena zaroori hai.');
      return;
    }
    try {
      setLoading(true);
      setError('');
      const payload: Record<string, unknown> = {
        topic: topic.trim() || undefined,
        question: question.trim() || undefined,
        problem_statement: problemStatement.trim() || undefined,
        image_url: imageUrl.trim() || undefined,
        voice_reference: voiceReference.trim() || undefined,
        teacher_prompt: isTeacherView ? teacherPrompt.trim() || undefined : undefined,
        target_student_id: isTeacherView ? targetStudentId.trim() || undefined : undefined,
      };
      const response =
        mode === 'chat'
          ? await apiService.aiTutorChat(payload)
          : mode === 'practice'
            ? await apiService.aiTutorPractice(payload)
            : mode === 'revision'
              ? await apiService.aiTutorRevision(payload)
              : await apiService.aiTutorExplain(payload);
      setResult(response.data);
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'AI Tutor response generate nahi hua.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">AI Tutor</h1>
        <p className="mt-1 text-sm text-slate-600">
          Generic chatbot nahi. Yeh tutor LMS lessons, assignments, tests, weak topics, study planner, live class recordings, aur attendance context use karke personalized response banata hai.
        </p>
      </div>

      {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <form onSubmit={submitTutor} className={cardClass}>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-amber-100 p-3 text-amber-700">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{modeCopy[mode].title}</h2>
              <p className="text-sm text-slate-500">{modeCopy[mode].subtitle}</p>
            </div>
          </div>

          <div className="mt-5 grid gap-3">
            <div className="grid gap-2 sm:grid-cols-4">
              {(['chat', 'explain', 'practice', 'revision'] as TutorMode[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setMode(item)}
                  className={`rounded-2xl px-3 py-3 text-sm font-semibold transition ${mode === item ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-100'}`}
                >
                  {item}
                </button>
              ))}
            </div>

            <input
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              placeholder="Topic, e.g. Chemical Bonding"
            />
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              rows={4}
              placeholder="Student question or doubt"
            />
            <textarea
              value={problemStatement}
              onChange={(event) => setProblemStatement(event.target.value)}
              className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              rows={3}
              placeholder="Numerical problem statement or image transcription"
            />
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <ImagePlus className="h-4 w-4" />
                  Image Input
                </div>
                <input
                  value={imageUrl}
                  onChange={(event) => setImageUrl(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Image URL or uploaded image reference"
                />
              </div>
              <div className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <Mic className="h-4 w-4" />
                  Voice Input
                </div>
                <input
                  value={voiceReference}
                  onChange={(event) => setVoiceReference(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Voice note reference"
                />
              </div>
            </div>

            {isTeacherView ? (
              <>
                <input
                  value={targetStudentId}
                  onChange={(event) => setTargetStudentId(event.target.value)}
                  className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                  placeholder="Optional target student UUID for personalization"
                />
                <textarea
                  value={teacherPrompt}
                  onChange={(event) => setTeacherPrompt(event.target.value)}
                  className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                  rows={3}
                  placeholder="Teacher custom prompt, assignment framing, or instruction"
                />
              </>
            ) : null}

            <button
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-70"
            >
              <Brain className="h-4 w-4" />
              {loading ? 'Generating...' : 'Generate Tutor Response'}
            </button>
          </div>
        </form>

        <section className={cardClass}>
          {loading ? <LoadingSpinner message="Tutor response generate ho raha hai..." /> : null}
          {!loading && !result ? (
            <div className="space-y-4 text-sm text-slate-600">
              <p>Use cases:</p>
              <ul className="space-y-2">
                <li>"Explain Chemical Bonding"</li>
                <li>"Give me practice on Thermodynamics"</li>
                <li>"Make revision notes for Mole Concept"</li>
                <li>"Create challenge questions for Algebra"</li>
              </ul>
            </div>
          ) : null}

          {!loading && result ? (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{result.topic}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Mode {result.mode} | Class {String(result.student_profile?.class_level || 'N/A')} | Band {String(result.student_profile?.difficulty_band || 'balanced')}
                </p>
              </div>

              <InfoBlock icon={GraduationCap} title="Explanation" content={[result.explanation, ...result.key_points]} />
              <InfoBlock icon={BookOpenCheck} title="Examples and Revision Plan" content={[...result.examples, ...result.revision_plan]} />
              <InfoBlock icon={Brain} title="Challenge Questions" content={result.challenge_questions} empty="No extra challenge questions for this level." />
              <InfoBlock
                icon={FileText}
                title="Practice Questions"
                content={result.practice_questions.map((item) => `${item.level.toUpperCase()}: ${item.question}`)}
              />
              <InfoBlock icon={Sparkles} title="Revision Notes" content={[...result.chapter_summary, ...result.revision_notes, ...result.formula_sheet]} />

              <div className="grid gap-4 md:grid-cols-2">
                <MiniPanel
                  title="Recommended Lessons"
                  items={result.recommended_lessons.map((item) => String((item as Record<string, unknown>).lesson_title || (item as Record<string, unknown>).title || 'Lesson'))}
                />
                <MiniPanel
                  title="Recommended Recordings"
                  items={result.recommended_recordings.map((item) => String((item as Record<string, unknown>).title || 'Recording'))}
                />
                <MiniPanel
                  title="Recommended Assignments"
                  items={result.recommended_assignments.map((item) => String((item as Record<string, unknown>).title || 'Assignment'))}
                />
                <MiniPanel
                  title="Recommended Tests"
                  items={result.recommended_tests.map((item) => (typeof item === 'string' ? item : String((item as Record<string, unknown>).title || 'Test')))}
                />
              </div>
            </div>
          ) : null}
        </section>
      </section>
    </div>
  );
}

function InfoBlock({
  icon: Icon,
  title,
  content,
  empty,
}: {
  icon: typeof Brain;
  title: string;
  content: string[];
  empty?: string;
}) {
  const rows = content.filter(Boolean);
  return (
    <div>
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <Icon className="h-4 w-4" />
        {title}
      </div>
      <div className="mt-3 space-y-2">
        {rows.length ? rows.map((item) => (
          <div key={item} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            {item}
          </div>
        )) : (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
            {empty || 'No items available.'}
          </div>
        )}
      </div>
    </div>
  );
}

function MiniPanel({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{title}</p>
      <div className="mt-3 space-y-2 text-sm text-slate-700">
        {items.length ? items.map((item) => <div key={item}>{item}</div>) : <div>No match found.</div>}
      </div>
    </div>
  );
}
