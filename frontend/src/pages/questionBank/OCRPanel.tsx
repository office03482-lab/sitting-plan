import { useMemo, useState } from 'react';
import { AlertTriangle, Camera, CheckSquare, Loader2, ScanLine } from 'lucide-react';

import { apiService, getRequestErrorMessage } from '@services/api';

type ImportedQuestion = {
  prompt: string;
  options: string[];
  answer: string;
  explanation: string;
  duplicate: boolean;
  selected: boolean;
  missingFields: string[];
  reviewRequired: boolean;
};

type Props = {
  currentExam?: string;
  currentSubject?: string;
  currentChapter?: string;
  currentTopic?: string;
  onImported: (questions: Array<{ prompt: string; options: string[]; answer: string; explanation: string }>) => void;
  onClose: () => void;
};

export default function OCRPanel({
  currentExam = 'custom',
  currentSubject = '',
  currentChapter = '',
  currentTopic = '',
  onImported,
  onClose,
}: Props) {
  const [fileName, setFileName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [questions, setQuestions] = useState<ImportedQuestion[]>([]);
  const [extractionSummary, setExtractionSummary] = useState<{
    pageCount: number;
    sourceQuestionCount: number;
    method: string;
  } | null>(null);

  const selectedCount = useMemo(() => questions.filter((item) => item.selected).length, [questions]);

  const handleExtract = async () => {
    if (!selectedFile) {
      setError('Please choose an image file first.');
      return;
    }
    try {
      setLoading(true);
      setError('');
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('exam_type_slug', currentExam || 'custom');
      formData.append('subject', currentSubject || '');
      formData.append('chapter', currentChapter || '');
      formData.append('topic', currentTopic || '');
      formData.append('difficulty', 'medium');
      formData.append('marks', '1');
      const response = await apiService.generateQBImportPreview(formData);
      setExtractionSummary({
        pageCount: response.data.extraction.page_count,
        sourceQuestionCount: response.data.extraction.source_question_count,
        method: response.data.extraction.method,
      });
      setQuestions(
        (response.data.questions || []).map((item) => ({
          prompt: item.question_text,
          options: item.options || [],
          answer: item.correct_answer || '',
          explanation: item.explanation || '',
          duplicate: Boolean(item.duplicate_check?.is_duplicate),
          selected: !item.duplicate_check?.is_duplicate,
          missingFields: item.missing_fields || [],
          reviewRequired: Boolean(item.review_required),
        })),
      );
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'OCR import failed.'));
      setQuestions([]);
      setExtractionSummary(null);
    } finally {
      setLoading(false);
    }
  };

  const handleImportSelected = () => {
    const picked = questions
      .filter((item) => item.selected)
      .map(({ prompt, options, answer, explanation }) => ({ prompt, options, answer, explanation }));
    if (!picked.length) {
      setError('Select at least one extracted question to import.');
      return;
    }
    onImported(picked);
    onClose();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
          <ScanLine className="h-4 w-4 text-emerald-500" /> OCR Scanner
        </h4>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">x</button>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{error}</div>
      ) : null}

      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center hover:border-emerald-400 hover:bg-emerald-50">
        <Camera className="h-6 w-6 text-slate-400" />
        <span className="text-[11px] font-medium text-slate-600">
          {fileName || 'Upload question image'}
        </span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0] || null;
            event.target.value = '';
            setSelectedFile(file);
            setFileName(file?.name || '');
            setQuestions([]);
            setExtractionSummary(null);
          }}
        />
      </label>

      <button
        type="button"
        onClick={() => void handleExtract()}
        disabled={loading || !selectedFile}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {loading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Extracting...</> : 'Extract Questions'}
      </button>

      {extractionSummary ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-700">
          <p><span className="font-semibold">Pages:</span> {extractionSummary.pageCount}</p>
          <p><span className="font-semibold">Detected source questions:</span> {extractionSummary.sourceQuestionCount || 'Not clearly detected'}</p>
          <p><span className="font-semibold">Method:</span> {extractionSummary.method}</p>
        </div>
      ) : null}

      {questions.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-700">{questions.length} extracted questions</span>
            <button
              type="button"
              onClick={handleImportSelected}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-emerald-700"
            >
              <CheckSquare className="h-3 w-3" /> Import Selected ({selectedCount})
            </button>
          </div>
          {questions.map((question, index) => (
            <div key={index} className={`space-y-2 rounded-lg border p-2 ${question.duplicate ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={question.selected}
                  onChange={(event) => setQuestions((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, selected: event.target.checked } : item))}
                  className="mt-0.5 h-3 w-3"
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <textarea
                    value={question.prompt}
                    onChange={(event) => setQuestions((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, prompt: event.target.value } : item))}
                    rows={3}
                    className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-800 outline-none focus:border-emerald-400"
                  />
                  <textarea
                    value={question.options.join('\n')}
                    onChange={(event) => setQuestions((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, options: event.target.value.split('\n').map((line) => line.trim()).filter(Boolean) } : item))}
                    rows={Math.max(2, question.options.length || 2)}
                    className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-700 outline-none focus:border-emerald-400"
                  />
                  <input
                    value={question.answer}
                    onChange={(event) => setQuestions((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, answer: event.target.value } : item))}
                    placeholder="Answer (blank if unavailable)"
                    className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-700 outline-none focus:border-emerald-400"
                  />
                  <textarea
                    value={question.explanation}
                    onChange={(event) => setQuestions((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, explanation: event.target.value } : item))}
                    rows={2}
                    placeholder="Explanation (optional)"
                    className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-700 outline-none focus:border-emerald-400"
                  />
                  {question.reviewRequired || question.missingFields.length ? (
                    <p className="text-[10px] font-medium text-amber-700">
                      Review required{question.missingFields.length ? `: ${question.missingFields.join(', ')}` : ''}
                    </p>
                  ) : null}
                  {question.duplicate ? (
                    <p className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700">
                      <AlertTriangle className="h-3 w-3" /> Similar question already exists in Question Bank
                    </p>
                  ) : null}
                </div>
              </label>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
