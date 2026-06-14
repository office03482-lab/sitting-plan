import { FormEvent, useMemo, useState } from 'react';
import { AlertCircle, BookCheck, BrainCircuit, Camera, FileText, History, Mic, ScanSearch, Sparkles } from 'lucide-react';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { DoubtHistoryItem, DoubtSolverInput, DoubtSolverResponse } from '@types';

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm';

type SolverMode = 'text' | 'image' | 'pdf';

export default function AiDoubtSolverPage() {
  const { user } = useAuth();
  const roleKey = String(user?.role_key || user?.role || '').toLowerCase();
  const canReviewAll = ['teacher', 'school_admin', 'platform_admin', 'admin'].includes(roleKey);

  const [mode, setMode] = useState<SolverMode>('text');
  const [question, setQuestion] = useState('');
  const [extractedText, setExtractedText] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [pdfUrl, setPdfUrl] = useState('');
  const [screenshotUrl, setScreenshotUrl] = useState('');
  const [handwrittenUrl, setHandwrittenUrl] = useState('');
  const [voiceReference, setVoiceReference] = useState('');
  const [teacherPrompt, setTeacherPrompt] = useState('');
  const [targetStudentId, setTargetStudentId] = useState('');
  const [result, setResult] = useState<DoubtSolverResponse | null>(null);
  const [history, setHistory] = useState<DoubtHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState('');

  const modeCopy = useMemo<Record<SolverMode, { title: string; subtitle: string }>>(
    () => ({
      text: {
        title: 'Text Doubt Solver',
        subtitle: 'Use typed questions with weak-topic detection, test history, and LMS context.',
      },
      image: {
        title: 'OCR + Vision Intake',
        subtitle: 'Use screenshots, handwritten notes, or camera captures with extracted text.',
      },
      pdf: {
        title: 'PDF Doubt Review',
        subtitle: 'Solve worksheet or document doubts with chapter-aware recommendations.',
      },
    }),
    [],
  );

  const loadHistory = async () => {
    try {
      setHistoryLoading(true);
      const response = await apiService.getDoubtHistory({
        target_student_id: canReviewAll ? targetStudentId.trim() || undefined : undefined,
        limit: 12,
      });
      setHistory(response.data);
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Doubt history load nahi hua.'));
    } finally {
      setHistoryLoading(false);
    }
  };

  const submitSolver = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!question.trim() && !extractedText.trim()) {
      setError('Question ya OCR text dena zaroori hai.');
      return;
    }
    try {
      setLoading(true);
      setError('');
      const payload: DoubtSolverInput = {
        question: question.trim() || undefined,
        extracted_text: extractedText.trim() || undefined,
        image_url: imageUrl.trim() || undefined,
        pdf_url: pdfUrl.trim() || undefined,
        screenshot_url: screenshotUrl.trim() || undefined,
        handwritten_note_url: handwrittenUrl.trim() || undefined,
        voice_reference: voiceReference.trim() || undefined,
        teacher_prompt: canReviewAll ? teacherPrompt.trim() || undefined : undefined,
        target_student_id: canReviewAll ? targetStudentId.trim() || undefined : undefined,
        metadata: {
          source: 'web',
          role_key: roleKey,
        },
      };
      const response = mode === 'image'
        ? await apiService.solveImageDoubt(payload)
        : mode === 'pdf'
          ? await apiService.solvePdfDoubt(payload)
          : await apiService.solveTextDoubt(payload);
      setResult(response.data);
      await loadHistory();
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Doubt solve nahi hua.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">AI Doubt Solver</h1>
        <p className="mt-1 text-sm text-slate-600">
          Generic chatbot nahi. Yeh solver OCR-style extraction, student weak-topic history, previous tests, LMS lessons, recordings, aur analytics context use karta hai.
        </p>
      </div>

      {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <form onSubmit={submitSolver} className={cardClass}>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-orange-100 p-3 text-orange-700">
              <ScanSearch className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{modeCopy[mode].title}</h2>
              <p className="text-sm text-slate-500">{modeCopy[mode].subtitle}</p>
            </div>
          </div>

          <div className="mt-5 grid gap-3">
            <div className="grid gap-2 sm:grid-cols-3">
              {(['text', 'image', 'pdf'] as SolverMode[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setMode(item)}
                  className={`rounded-2xl px-3 py-3 text-sm font-semibold transition ${mode === item ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-100'}`}
                >
                  {item.toUpperCase()}
                </button>
              ))}
            </div>

            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              rows={4}
              placeholder="Type the student doubt, e.g. Explain why ionic bond forms here"
            />
            <textarea
              value={extractedText}
              onChange={(event) => setExtractedText(event.target.value)}
              className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              rows={4}
              placeholder="Paste OCR text, handwritten transcription, MCQ options, or PDF snippet"
            />

            <div className="grid gap-3 md:grid-cols-2">
              <input
                value={imageUrl}
                onChange={(event) => setImageUrl(event.target.value)}
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                placeholder="Image URL or upload reference"
              />
              <input
                value={pdfUrl}
                onChange={(event) => setPdfUrl(event.target.value)}
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                placeholder="PDF URL or upload reference"
              />
              <input
                value={screenshotUrl}
                onChange={(event) => setScreenshotUrl(event.target.value)}
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                placeholder="Screenshot reference"
              />
              <input
                value={handwrittenUrl}
                onChange={(event) => setHandwrittenUrl(event.target.value)}
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                placeholder="Handwritten note reference"
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <Mic className="h-4 w-4" />
                  Voice Reference
                </div>
                <input
                  value={voiceReference}
                  onChange={(event) => setVoiceReference(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Voice note reference"
                />
              </div>
              <div className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <Camera className="h-4 w-4" />
                  OCR Intake
                </div>
                <p className="text-sm text-slate-500">
                  English, Hindi, and mixed text are supported through extracted text + source references.
                </p>
              </div>
            </div>

            {canReviewAll ? (
              <>
                <input
                  value={targetStudentId}
                  onChange={(event) => setTargetStudentId(event.target.value)}
                  className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                  placeholder="Optional target student UUID"
                />
                <textarea
                  value={teacherPrompt}
                  onChange={(event) => setTeacherPrompt(event.target.value)}
                  className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                  rows={3}
                  placeholder="Teacher instruction, escalation note, or review framing"
                />
              </>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <button
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-70"
              >
                <BrainCircuit className="h-4 w-4" />
                {loading ? 'Solving...' : 'Solve Doubt'}
              </button>
              <button
                type="button"
                onClick={loadHistory}
                disabled={historyLoading}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-70"
              >
                <History className="h-4 w-4" />
                {historyLoading ? 'Loading...' : 'Load History'}
              </button>
            </div>
          </div>
        </form>

        <section className={cardClass}>
          {loading ? <LoadingSpinner message="Academic doubt solve ho raha hai..." /> : null}
          {!loading && !result ? (
            <div className="space-y-4 text-sm text-slate-600">
              <p>Supported flows:</p>
              <ul className="space-y-2">
                <li>Text doubt with personalized explanation</li>
                <li>Screenshot or handwritten note with OCR text pasted</li>
                <li>Worksheet/PDF snippet with step-by-step solution</li>
                <li>Teacher escalation when solver confidence is low</li>
              </ul>
            </div>
          ) : null}

          {!loading && result ? (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{result.detected_subject} / {result.detected_topic}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Confidence {result.confidence_score}% | Input {result.input_type} | Escalation {result.escalation_status}
                </p>
              </div>

              <InfoBlock icon={BookCheck} title="Explanation" content={[result.explanation]} />
              <InfoBlock icon={BrainCircuit} title="Step By Step" content={result.step_by_step} />
              <InfoBlock icon={Sparkles} title="Common Mistakes" content={result.common_mistakes} />
              <InfoBlock icon={FileText} title="Final Answer" content={result.final_answer ? [result.final_answer] : []} empty="Final answer not confidently resolved yet." />
              <InfoBlock icon={AlertCircle} title="Shortcut Method" content={result.shortcut_method ? [result.shortcut_method] : []} empty="No shortcut suggested." />

              <div className="grid gap-4 md:grid-cols-2">
                <MiniPanel title="Equations" items={result.extracted_equations} />
                <MiniPanel title="Numericals" items={result.extracted_numericals} />
                <MiniPanel title="Diagrams" items={result.extracted_diagrams} />
                <MiniPanel
                  title="Recommendations"
                  items={result.recommendations.map((item) => {
                    const row = item as Record<string, unknown>;
                    return String(row.title || row.summary || row.recommendation_type || 'Recommendation');
                  })}
                />
              </div>
            </div>
          ) : null}
        </section>
      </section>

      <section className={cardClass}>
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-slate-700" />
          <h2 className="text-lg font-semibold text-slate-900">Doubt History</h2>
        </div>
        <div className="mt-4 grid gap-3">
          {history.length ? history.map((item) => (
            <div key={item.session_id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-900">
                  {item.detected_subject || 'general'} / {item.detected_topic || 'general'}
                </div>
                <div className="text-xs uppercase tracking-[0.14em] text-slate-500">
                  {item.input_type} | {item.escalation_status}
                </div>
              </div>
              <div className="mt-2 text-sm text-slate-600">
                {item.final_answer || 'Solution logged without a high-confidence final answer.'}
              </div>
            </div>
          )) : (
            <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
              No doubt history loaded yet.
            </div>
          )}
        </div>
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
  icon: typeof BrainCircuit;
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
