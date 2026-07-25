import { FileText, Tag, Clock, CheckCircle2, Smartphone } from 'lucide-react';

interface QuestionFormState {
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
}

interface LivePreviewProps {
  form: QuestionFormState;
}

export default function LivePreview({ form }: LivePreviewProps) {
  return (
    <div className="space-y-3">
      {/* Device Frame */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <Smartphone className="h-3 w-3 text-slate-400" />
            <span className="text-[10px] font-semibold text-slate-400">Student View</span>
          </div>
          <span className="text-[10px] text-slate-300">{form.marks} marks</span>
        </div>

        <div className="p-4 space-y-4">
          {/* Question */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 text-[10px] font-bold text-blue-600">Q</span>
              <span className="text-[10px] font-medium text-slate-400">{form.questionType.replace(/_/g, ' ')}</span>
            </div>
            {form.promptText ? (
              <div
                className="text-[13px] leading-relaxed text-slate-700"
                dangerouslySetInnerHTML={{ __html: form.promptText }}
              />
            ) : (
              <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center">
                <p className="text-[11px] text-slate-300">Preview appears here...</p>
              </div>
            )}
          </div>

          {/* Options */}
          {form.options.filter((o) => o.text).length > 0 && (
            <div className="space-y-1.5">
              {form.options.filter((o) => o.text).map((opt) => (
                <div
                  key={opt.id}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] ${
                    opt.isCorrect
                      ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                      : 'bg-slate-50 text-slate-600'
                  }`}
                >
                  <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold ${
                    opt.isCorrect ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'
                  }`}>{opt.label}</span>
                  <span className="flex-1 truncate">{opt.text}</span>
                  {opt.isCorrect && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                </div>
              ))}
            </div>
          )}

          {/* Answer */}
          {form.correctAnswer && (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 ring-1 ring-emerald-100">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              <span className="text-[12px] font-medium text-emerald-700">{form.correctAnswer}</span>
            </div>
          )}
        </div>
      </div>

      {/* Metadata Chips */}
      <div className="flex flex-wrap gap-1.5">
        {[
          { icon: Tag, label: form.difficulty || 'Medium', color: 'bg-blue-50 text-blue-600' },
          { icon: Clock, label: `${form.estimatedTime || '2'}m`, color: 'bg-amber-50 text-amber-600' },
          { icon: FileText, label: form.sourceName || 'Source', color: 'bg-violet-50 text-violet-600' },
        ].map((chip) => (
          <span key={chip.label} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold ${chip.color}`}>
            <chip.icon className="h-2.5 w-2.5" />
            {chip.label}
          </span>
        ))}
      </div>
    </div>
  );
}
