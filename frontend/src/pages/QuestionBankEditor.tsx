import { useState, type ReactNode } from 'react';
import {
  Eye,
  EyeOff,
  Upload,
  FileText,
  Sparkles,
  Calculator,
  Clock,
  Hash,
  BookOpen,
  GraduationCap,
  Brain,
  Sigma,
  ChevronRight,
} from 'lucide-react';
import RichTextEditor from './questionBank/RichTextEditor';
import OptionRow from './questionBank/OptionRow';
import LivePreview from './questionBank/LivePreview';
import ActionBar from './questionBank/ActionBar';

type QuestionFormState = {
  questionNumber: string;
  questionType: string;
  marks: string;
  negativeMarks: string;
  examType: string;
  className: string;
  stream: string;
  subject: string;
  chapter: string;
  topic: string;
  subTopic: string;
  difficulty: string;
  questionSource: string;
  sourceName: string;
  language: string;
  tags: string;
  estimatedTime: string;
  promptText: string;
  options: Array<{
    id: string;
    label: string;
    text: string;
    imageUrl: string;
    isCorrect: boolean;
  }>;
  correctAnswer: string;
  answerType: string;
  explanation: string;
  keyPoints: string;
  teacherNotes: string;
  studentExplanation: string;
};

/* ── Left-panel primitives ────────────────────────────────────────────────── */

function SideField({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-medium text-slate-400">
          {label}
          {required && <span className="ml-0.5 text-red-400">*</span>}
        </span>
        {hint && <span className="text-[10px] text-slate-300">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function SideSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-lg bg-slate-50 px-3 py-2 pr-8 text-[13px] text-slate-700 outline-none ring-1 ring-inset ring-slate-200 transition focus:bg-white focus:ring-2 focus:ring-blue-500/40"
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      <ChevronRight className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 rotate-90 text-slate-300" />
    </div>
  );
}

function SideInput({
  value,
  onChange,
  placeholder,
  type,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type || 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-slate-700 outline-none ring-1 ring-inset ring-slate-200 transition placeholder-slate-400 focus:bg-white focus:ring-2 focus:ring-blue-500/40"
    />
  );
}

function SideSection({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <div className="flex items-center gap-2 px-4 py-3">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-50">
          <Icon className="h-3.5 w-3.5 text-blue-500" />
        </div>
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{title}</span>
      </div>
      <div className="space-y-3 px-4 pb-4 pt-1">{children}</div>
    </div>
  );
}

/* ── Main Component ───────────────────────────────────────────────────────── */

export default function QuestionBankEditor() {
  const [_activeTab, setActiveTab] = useState<'editor' | 'preview'>('editor');
  const [autoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [form, setForm] = useState<QuestionFormState>({
    questionNumber: 'Q-001',
    questionType: 'single_choice',
    marks: '1',
    negativeMarks: '0.25',
    examType: '',
    className: '',
    stream: '',
    subject: '',
    chapter: '',
    topic: '',
    subTopic: '',
    difficulty: 'medium',
    questionSource: '',
    sourceName: '',
    language: 'English',
    tags: '',
    estimatedTime: '2',
    promptText: '',
    options: [
      { id: 'opt-1', label: 'A', text: '', imageUrl: '', isCorrect: false },
      { id: 'opt-2', label: 'B', text: '', imageUrl: '', isCorrect: false },
      { id: 'opt-3', label: 'C', text: '', imageUrl: '', isCorrect: false },
      { id: 'opt-4', label: 'D', text: '', imageUrl: '', isCorrect: false },
    ],
    correctAnswer: '',
    answerType: 'text',
    explanation: '',
    keyPoints: '',
    teacherNotes: '',
    studentExplanation: '',
  });

  const updateForm = <K extends keyof QuestionFormState>(field: K, value: QuestionFormState[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateOption = (index: number, field: string, value: string | boolean) => {
    setForm((prev) => ({
      ...prev,
      options: prev.options.map((opt, i) =>
        i === index ? { ...opt, [field]: value } : opt,
      ),
    }));
  };

  const addOption = () => {
    const nextLabel = String.fromCharCode(65 + form.options.length);
    setForm((prev) => ({
      ...prev,
      options: [
        ...prev.options,
        { id: `opt-${Date.now()}`, label: nextLabel, text: '', imageUrl: '', isCorrect: false },
      ],
    }));
  };

  const removeOption = (index: number) => {
    if (form.options.length <= 2) return;
    setForm((prev) => ({
      ...prev,
      options: prev.options.filter((_, i) => i !== index),
    }));
  };

  const promptCharCount = form.promptText.length;
  const maxPromptChars = 5000;

  const questionTypes = ['single_choice', 'multiple_choice', 'short_answer', 'long_answer', 'match_the_following', 'assertion_reason'];

  return (
    <div className="flex h-screen flex-col bg-[#f0f2f5] font-sans">

      {/* ═══════ TOP RIBBON ═══════ */}
      <header className="relative z-30 flex items-center border-b border-slate-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="flex h-12 w-12 items-center justify-center border-r border-slate-100 bg-blue-600">
          <Hash className="h-5 w-5 text-white" />
        </div>
        <div className="flex flex-1 items-center gap-3 px-5">
          <div>
            <h1 className="text-sm font-bold text-slate-800">Add Question</h1>
          </div>
          <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600">NEW</span>
          <div className="ml-2 h-4 w-px bg-slate-200" />
          <span className="text-xs text-slate-400">Question Bank</span>
        </div>
        <div className="flex items-center gap-3 pr-5">
          <span className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500 ring-1 ring-slate-100">
            {promptCharCount} / {maxPromptChars.toLocaleString()} chars
          </span>
          <span className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500 ring-1 ring-slate-100">
            <span className={`h-1.5 w-1.5 rounded-full ${autoSaveStatus === 'saved' ? 'bg-emerald-500' : autoSaveStatus === 'saving' ? 'bg-blue-500 animate-pulse' : 'bg-slate-300'}`} />
            {autoSaveStatus === 'saved' ? 'Saved' : autoSaveStatus === 'saving' ? 'Saving' : 'Draft'}
          </span>
          <button
            onClick={() => setShowRightPanel(!showRightPanel)}
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-400 transition hover:border-slate-300 hover:text-slate-600"
          >
            {showRightPanel ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* ═══════ 3-COLUMN BODY ═══════ */}
      <div className="flex flex-1 min-h-0">

        {/* ─── LEFT: Metadata Sidebar ─── */}
        <aside className="hidden w-80 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
          <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-[11px] font-bold text-white shadow-sm">
              {form.questionNumber}
            </span>
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-slate-800">Question Metadata</p>
              <p className="text-[10px] text-slate-400">Classification & scoring</p>
            </div>
            <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Active
            </span>
          </div>

          <div className="flex-1 overflow-y-auto">
            <SideSection icon={GraduationCap} title="Exam & Class">
              <SideField label="Exam Type">
                <SideSelect value={form.examType} onChange={(v) => updateForm('examType', v)} options={['Board Exam', 'Entrance', 'Unit Test', 'Mid-Term', 'Final Exam', 'Practice']} placeholder="Select exam type" />
              </SideField>
              <SideField label="Class">
                <SideSelect value={form.className} onChange={(v) => updateForm('className', v)} options={['Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12']} placeholder="Select class" />
              </SideField>
              <SideField label="Stream">
                <SideSelect value={form.stream} onChange={(v) => updateForm('stream', v)} options={['Science', 'Commerce', 'Arts', 'Computer Science', 'General']} placeholder="Select stream" />
              </SideField>
            </SideSection>

            <SideSection icon={BookOpen} title="Subject & Topics">
              <SideField label="Subject">
                <SideSelect value={form.subject} onChange={(v) => updateForm('subject', v)} options={['Mathematics', 'Physics', 'Chemistry', 'Biology', 'English', 'Hindi', 'Computer Science', 'Social Science']} placeholder="Select subject" />
              </SideField>
              <SideField label="Chapter">
                <SideSelect value={form.chapter} onChange={(v) => updateForm('chapter', v)} options={['Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4', 'Chapter 5']} placeholder="Select chapter" />
              </SideField>
              <SideField label="Topic">
                <SideSelect value={form.topic} onChange={(v) => updateForm('topic', v)} options={['Topic A', 'Topic B', 'Topic C']} placeholder="Select topic" />
              </SideField>
              <SideField label="Sub Topic">
                <SideSelect value={form.subTopic} onChange={(v) => updateForm('subTopic', v)} options={['Sub-topic 1', 'Sub-topic 2', 'Sub-topic 3']} placeholder="Select sub topic" />
              </SideField>
            </SideSection>

            <SideSection icon={Brain} title="Difficulty & Source">
              <SideField label="Difficulty">
                <SideSelect value={form.difficulty} onChange={(v) => updateForm('difficulty', v)} options={['Easy', 'Medium', 'Hard', 'Expert']} placeholder="Select difficulty" />
              </SideField>
              <SideField label="Question Source">
                <SideSelect value={form.questionSource} onChange={(v) => updateForm('questionSource', v)} options={['Textbook', 'Custom', 'OCR', 'AI Generated', 'PDF Import']} placeholder="Select source" />
              </SideField>
              <SideField label="Source Name">
                <SideInput value={form.sourceName} onChange={(v) => updateForm('sourceName', v)} placeholder="e.g. NCERT Part 1" />
              </SideField>
              <SideField label="Language">
                <SideInput value={form.language} onChange={(v) => updateForm('language', v)} placeholder="Language" />
              </SideField>
            </SideSection>

            <SideSection icon={Sigma} title="Scoring">
              <SideField label="Tags">
                <SideInput value={form.tags} onChange={(v) => updateForm('tags', v)} placeholder="comma separated" />
              </SideField>
              <div className="grid grid-cols-2 gap-2">
                <SideField label="Marks" required>
                  <SideInput value={form.marks} onChange={(v) => updateForm('marks', v)} placeholder="1" type="number" />
                </SideField>
                <SideField label="Neg. Marks">
                  <SideInput value={form.negativeMarks} onChange={(v) => updateForm('negativeMarks', v)} placeholder="0.25" type="number" />
                </SideField>
              </div>
              <SideField label="Est. Time (min)">
                <SideInput value={form.estimatedTime} onChange={(v) => updateForm('estimatedTime', v)} placeholder="2" type="number" />
              </SideField>
            </SideSection>
          </div>
        </aside>

        {/* ─── CENTER: Editor Canvas ─── */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#f0f2f5]">
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-4xl px-8 py-6">

              {/* ── Question-type strip ── */}
              <div className="mb-5 flex items-center gap-3">
                <span className="text-[11px] font-semibold text-slate-400">Type</span>
                <div className="flex gap-1.5">
                  {questionTypes.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => updateForm('questionType', t)}
                      className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold transition ${
                        form.questionType === t
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:ring-blue-300 hover:text-blue-600'
                      }`}
                    >
                      {t.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Scoring strip ── */}
              <div className="mb-5 flex items-center gap-4">
                <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
                  <span className="text-[11px] text-slate-400">Marks</span>
                  <input
                    type="number"
                    value={form.marks}
                    onChange={(e) => updateForm('marks', e.target.value)}
                    className="w-12 bg-transparent text-center text-[13px] font-bold text-slate-800 outline-none"
                  />
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
                  <span className="text-[11px] text-slate-400">Negative</span>
                  <input
                    type="number"
                    value={form.negativeMarks}
                    onChange={(e) => updateForm('negativeMarks', e.target.value)}
                    className="w-12 bg-transparent text-center text-[13px] font-bold text-slate-800 outline-none"
                  />
                </div>
                <div className="flex-1" />
                <span className="text-[11px] text-slate-400">Ctrl+S to save</span>
              </div>

              {/* ── Editor Card ── */}
              <div className="mb-5 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
                <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
                  <div className="h-5 w-1 rounded-full bg-blue-600" />
                  <span className="text-xs font-semibold text-slate-600">Question Statement</span>
                </div>
                <div className="p-2">
                  <RichTextEditor
                    value={form.promptText}
                    onChange={(v) => updateForm('promptText', v)}
                    charCount={promptCharCount}
                    maxChars={maxPromptChars}
                  />
                </div>
              </div>

              {/* ── Options Grid ── */}
              <div className="mb-5">
                <div className="mb-3 flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-600">Answer Options</span>
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{form.options.length}</span>
                  </div>
                  <span className="text-[10px] text-slate-400">Click circle to mark correct</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {form.options.map((option, index) => (
                    <OptionRow
                      key={option.id}
                      index={index}
                      option={option}
                      totalOptions={form.options.length}
                      onChange={(field, value) => updateOption(index, field, value)}
                      onRemove={() => removeOption(index)}
                      onCorrectToggle={() => {
                        const newOptions = form.options.map((opt, i) => ({
                          ...opt,
                          isCorrect: i === index ? !opt.isCorrect : opt.isCorrect,
                        }));
                        updateForm('options', newOptions);
                      }}
                    />
                  ))}
                </div>
                {form.options.length < 6 && (
                  <button
                    type="button"
                    onClick={addOption}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white/60 py-2.5 text-xs font-medium text-slate-400 transition hover:border-blue-300 hover:bg-blue-50/50 hover:text-blue-500"
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-[10px] font-bold">+</span>
                    Add option
                  </button>
                )}
              </div>

              {/* ── Answer & Explanation ── */}
              <div className="mb-5 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
                <div className="border-b border-slate-100 px-5 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-1 rounded-full bg-emerald-500" />
                    <span className="text-xs font-semibold text-slate-600">Correct Answer</span>
                  </div>
                </div>
                <div className="p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] font-medium text-slate-400 w-20">Answer Type</span>
                    <select
                      value={form.answerType}
                      onChange={(e) => updateForm('answerType', e.target.value)}
                      className="appearance-none rounded-lg bg-slate-50 px-3 py-2 pr-8 text-[13px] text-slate-700 outline-none ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-blue-500/40"
                    >
                      <option value="text">Text</option>
                      <option value="option_label">Option Label</option>
                    </select>
                  </div>
                  {form.answerType === 'option_label' ? (
                    <div className="flex flex-wrap gap-2">
                      {form.options.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => updateForm('correctAnswer', opt.isCorrect ? opt.label : form.correctAnswer)}
                          className={`flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold transition ${
                            form.correctAnswer === opt.label
                              ? 'bg-blue-600 text-white shadow-md'
                              : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <input
                      value={form.correctAnswer}
                      onChange={(e) => updateForm('correctAnswer', e.target.value)}
                      placeholder="Enter correct answer text..."
                      className="w-full rounded-lg bg-slate-50 px-3 py-2.5 text-[13px] text-slate-700 outline-none ring-1 ring-inset ring-slate-200 placeholder-slate-400 focus:bg-white focus:ring-2 focus:ring-blue-500/40"
                    />
                  )}
                </div>
              </div>

              {/* ── Explanation Card ── */}
              <div className="mb-5 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
                <div className="border-b border-slate-100 px-5 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-1 rounded-full bg-amber-500" />
                    <span className="text-xs font-semibold text-slate-600">Explanation</span>
                  </div>
                </div>
                <div className="p-5">
                  <textarea
                    value={form.explanation}
                    onChange={(e) => updateForm('explanation', e.target.value)}
                    placeholder="Explain the answer with detailed reasoning..."
                    rows={4}
                    className="w-full resize-y rounded-lg bg-slate-50 px-4 py-3 text-[13px] leading-relaxed text-slate-700 outline-none ring-1 ring-inset ring-slate-200 placeholder-slate-400 focus:bg-white focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>
              </div>

              {/* ── Teacher Notes Card ── */}
              <div className="mb-5 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
                <div className="border-b border-slate-100 px-5 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-1 rounded-full bg-violet-500" />
                    <span className="text-xs font-semibold text-slate-600">Teacher Notes</span>
                  </div>
                </div>
                <div className="p-5 space-y-4">
                  <div>
                    <label className="mb-1.5 block text-[11px] font-medium text-slate-400">Key Points</label>
                    <textarea
                      value={form.keyPoints}
                      onChange={(e) => updateForm('keyPoints', e.target.value)}
                      placeholder="Important key points for this question..."
                      rows={2}
                      className="w-full resize-y rounded-lg bg-slate-50 px-4 py-3 text-[13px] text-slate-700 outline-none ring-1 ring-inset ring-slate-200 placeholder-slate-400 focus:bg-white focus:ring-2 focus:ring-blue-500/40"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[11px] font-medium text-slate-400">Teacher Notes</label>
                    <textarea
                      value={form.teacherNotes}
                      onChange={(e) => updateForm('teacherNotes', e.target.value)}
                      placeholder="Internal notes visible only to teachers..."
                      rows={2}
                      className="w-full resize-y rounded-lg bg-slate-50 px-4 py-3 text-[13px] text-slate-700 outline-none ring-1 ring-inset ring-slate-200 placeholder-slate-400 focus:bg-white focus:ring-2 focus:ring-blue-500/40"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[11px] font-medium text-slate-400">Student Explanation</label>
                    <textarea
                      value={form.studentExplanation}
                      onChange={(e) => updateForm('studentExplanation', e.target.value)}
                      placeholder="Simplified explanation for students..."
                      rows={2}
                      className="w-full resize-y rounded-lg bg-slate-50 px-4 py-3 text-[13px] text-slate-700 outline-none ring-1 ring-inset ring-slate-200 placeholder-slate-400 focus:bg-white focus:ring-2 focus:ring-blue-500/40"
                    />
                  </div>
                </div>
              </div>

              <div className="h-20" />
            </div>
          </div>
          <ActionBar />
        </main>

        {/* ─── RIGHT: Preview & Tools ─── */}
        {showRightPanel && (
          <aside className="hidden w-80 shrink-0 flex-col border-l border-slate-200 bg-white xl:flex">
            <div className="flex border-b border-slate-100">
              <button
                type="button"
                onClick={() => setActiveTab('editor')}
                className="flex-1 py-3 text-[11px] font-bold uppercase tracking-wider text-blue-600 border-b-2 border-blue-600"
              >
                Preview
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('preview')}
                className="flex-1 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-600"
              >
                Tools
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <LivePreview form={form} />

              {/* Tool Tiles */}
              <div className="space-y-2">
                <p className="px-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Quick Tools</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { icon: Upload, label: 'OCR Upload', bg: 'bg-violet-50', fg: 'text-violet-600' },
                    { icon: FileText, label: 'PDF Import', bg: 'bg-rose-50', fg: 'text-rose-600' },
                    { icon: Sparkles, label: 'AI Generate', bg: 'bg-amber-50', fg: 'text-amber-600' },
                    { icon: Calculator, label: 'Formulas', bg: 'bg-cyan-50', fg: 'text-cyan-600' },
                  ].map((tool) => (
                    <button
                      key={tool.label}
                      type="button"
                      className="flex flex-col items-center gap-2 rounded-xl border border-slate-100 bg-white p-4 transition hover:border-blue-200 hover:shadow-sm"
                    >
                      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tool.bg}`}>
                        <tool.icon className={`h-5 w-5 ${tool.fg}`} />
                      </div>
                      <span className="text-[11px] font-medium text-slate-600">{tool.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Recent Images */}
              <div className="rounded-xl border border-slate-100 bg-white p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="h-3.5 w-3.5 text-slate-300" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Recent Images</span>
                </div>
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 py-8 text-center">
                  <Upload className="mb-2 h-6 w-6 text-slate-200" />
                  <p className="text-[11px] text-slate-400">No images yet</p>
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
