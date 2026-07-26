import { useEffect, useState } from 'react';
import { ArrowLeft, Save, Upload } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { OfflineExam, OfflineExamQuestion, OfflineExamEvaluation } from '@types';
import { offlineExamCardClass, offlineExamInputClass, offlineExamLabelClass } from '@pages/offlineExamsShared';

type BannerState = { type: 'success' | 'error' | 'warning' | 'info'; message: string } | null;

export default function OfflineExamEvaluate() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const { authReady, sessionReady, schoolContextReady, session } = useAuth();
  const canRunRequests = authReady && sessionReady && schoolContextReady && !!session && !!examId;

  const [exam, setExam] = useState<OfflineExam | null>(null);
  const [questions, setQuestions] = useState<OfflineExamQuestion[]>([]);
  const [evaluations, setEvaluations] = useState<OfflineExamEvaluation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState<BannerState>(null);
  const [marksMap, setMarksMap] = useState<Record<string, Record<string, string>>>({});
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  useEffect(() => {
    if (!canRunRequests || !examId) return;
    void loadData();
  }, [canRunRequests, examId]);

  const loadData = async () => {
    if (!examId) return;
    try {
      setLoading(true);
      const [examRes, questionsRes, evalsRes] = await Promise.all([
        apiService.getOfflineExam(examId),
        apiService.listOfflineExamQuestions(examId),
        apiService.listOfflineExamEvaluations(examId),
      ]);
      setExam(examRes.data);
      setQuestions(questionsRes.data || []);
      setEvaluations(evalsRes.data || []);

      const initialMarks: Record<string, Record<string, string>> = {};
      for (const ev of (evalsRes.data || [])) {
        if (!initialMarks[ev.student_id]) initialMarks[ev.student_id] = {};
        initialMarks[ev.student_id][ev.question_id] = String(ev.marks_awarded);
      }
      setMarksMap(initialMarks);
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Data load nahi ho payi.'));
    } finally {
      setLoading(false);
    }
  };

  const updateMark = (studentId: string, questionId: string, value: string) => {
    setMarksMap((prev) => ({
      ...prev,
      [studentId]: {
        ...prev[student_id],
        [questionId]: value,
      },
    }));
  };

  const handleSaveAll = async () => {
    if (!examId) return;
    try {
      setSaving(true);
      let count = 0;
      for (const studentId of Object.keys(marksMap)) {
        for (const questionId of Object.keys(marksMap[studentId] || {})) {
          const marks = parseFloat(marksMap[studentId][questionId]);
          if (!isNaN(marks)) {
            await apiService.saveOfflineExamEvaluation(examId, {
              student_id: studentId,
              question_id: questionId,
              marks_awarded: marks,
              max_marks: questions.find((q) => q.id === questionId)?.marks || 1,
              set_label: 'A',
              evaluation_method: 'manual',
            });
            count++;
          }
        }
      }
      setBanner({ type: 'success', message: `${count} evaluations saved successfully!` });
      await loadData();
    } catch (requestError) {
      setBanner({ type: 'error', message: getRequestErrorMessage(requestError, 'Save failed.') });
    } finally {
      setSaving(false);
    }
  };

  const handleUploadExcel = async () => {
    if (!examId || !uploadFile) return;
    try {
      setSaving(true);
      await apiService.importOfflineExamScores(examId, uploadFile);
      setBanner({ type: 'success', message: 'Scores imported successfully!' });
      setUploadFile(null);
      await loadData();
    } catch (requestError) {
      setBanner({ type: 'error', message: getRequestErrorMessage(requestError, 'Import failed.') });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <LoadingSpinner message="Evaluation data load ho rahi hai..." />;
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <button
          type="button"
          onClick={() => navigate(`/offline-exams/details/${examId}`)}
          className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Exam Details
        </button>
        <h1 className="text-2xl font-bold text-slate-900">Evaluate: {exam?.title}</h1>
        <p className="mt-1 text-sm text-slate-600">Student-wise marks entry karo ya Excel file se import karo.</p>
      </div>

      {banner ? <Alert type={banner.type} message={banner.message} onClose={() => setBanner(null)} /> : null}
      {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}

      <div className={`${offlineExamCardClass} mb-6 p-5`}>
        <h2 className="text-lg font-semibold text-slate-900">Import from Excel</h2>
        <p className="mt-1 text-sm text-slate-600">Excel file upload karo with columns: student_id, question_id, marks_awarded</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className={offlineExamLabelClass}>Select Excel File</label>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              className={offlineExamInputClass}
            />
          </div>
          <button
            type="button"
            onClick={() => void handleUploadExcel()}
            disabled={!uploadFile || saving}
            className="inline-flex items-center gap-2 rounded-lg bg-[#c07a10] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#a6650b] disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            {saving ? 'Importing...' : 'Import Scores'}
          </button>
        </div>
      </div>

      <div className={`${offlineExamCardClass} p-5`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Manual Marks Entry</h2>
          <button
            type="button"
            onClick={() => void handleSaveAll()}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-[#c07a10] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a6650b] disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving...' : 'Save All'}
          </button>
        </div>
        {questions.length === 0 ? (
          <p className="text-sm text-slate-600">No questions found. Add questions first.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Student ID</th>
                  {questions.slice(0, 10).map((q, idx) => (
                    <th key={q.id} className="px-3 py-3 text-center font-semibold text-slate-700">
                      Q{idx + 1}<br />
                      <span className="text-xs text-slate-400">({q.marks})</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-100">
                  <td className="px-4 py-3 text-xs text-slate-500 italic">Enter student IDs as rows...</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-3 text-xs text-slate-500">
              Note: For bulk evaluation, use the Excel import feature above. Manual entry requires student IDs which will be populated when students are assigned to this exam.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
