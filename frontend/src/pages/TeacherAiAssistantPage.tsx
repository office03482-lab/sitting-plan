import { FormEvent, useState } from 'react';
import { BookOpen, ClipboardList, FileSpreadsheet, MessagesSquare, Sparkles, Users } from 'lucide-react';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { apiService, getRequestErrorMessage } from '@services/api';
import { useEffectiveSchoolId } from '@hooks/useEffectiveSchoolId';
import type {
  BatchAnalytics,
  SchoolAnalytics,
  TeacherAiAssignmentResponse,
  TeacherAiLessonPlanResponse,
  TeacherAiQuestionPaperResponse,
  TeacherAiReportCommentsResponse,
} from '@types';

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm';

type AssistantTab = 'paper' | 'assignment' | 'lesson' | 'report' | 'analysis';

export default function TeacherAiAssistantPage() {
  const effectiveSchoolId = useEffectiveSchoolId();
  const [tab, setTab] = useState<AssistantTab>('paper');
  const [topic, setTopic] = useState('');
  const [batchId, setBatchId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [difficulty, setDifficulty] = useState('medium');
  const [paperType, setPaperType] = useState('unit_test');
  const [assignmentType, setAssignmentType] = useState('homework');
  const [planScope, setPlanScope] = useState('daily');
  const [score, setScore] = useState('');
  const [maxScore, setMaxScore] = useState('');
  const [teacherNote, setTeacherNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [paperResult, setPaperResult] = useState<TeacherAiQuestionPaperResponse | null>(null);
  const [assignmentResult, setAssignmentResult] = useState<TeacherAiAssignmentResponse | null>(null);
  const [lessonResult, setLessonResult] = useState<TeacherAiLessonPlanResponse | null>(null);
  const [reportResult, setReportResult] = useState<TeacherAiReportCommentsResponse | null>(null);
  const [batchAnalysis, setBatchAnalysis] = useState<BatchAnalytics | null>(null);
  const [schoolAnalysis, setSchoolAnalysis] = useState<SchoolAnalytics | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      setLoading(true);
      setError('');
      if (tab === 'paper') {
        const response = await apiService.generateTeacherQuestionPaper({
          title: title.trim() || undefined,
          prompt: prompt.trim() || undefined,
          topic: topic.trim() || undefined,
          batch_id: batchId.trim() || undefined,
          subject_id: subjectId.trim() || undefined,
          paper_type: paperType,
          difficulty_level: difficulty,
        });
        setPaperResult(response.data);
      } else if (tab === 'assignment') {
        const response = await apiService.generateTeacherAssignment({
          title: title.trim() || undefined,
          prompt: prompt.trim() || undefined,
          topic: topic.trim() || undefined,
          batch_id: batchId.trim() || undefined,
          subject_id: subjectId.trim() || undefined,
          assignment_type: assignmentType,
          difficulty_level: difficulty,
        });
        setAssignmentResult(response.data);
      } else if (tab === 'lesson') {
        const response = await apiService.generateTeacherLessonPlan({
          title: title.trim() || undefined,
          prompt: prompt.trim() || undefined,
          topic: topic.trim() || undefined,
          class_name: batchId.trim() || undefined,
          plan_scope: planScope,
        });
        setLessonResult(response.data);
      } else if (tab === 'report') {
        const response = await apiService.generateTeacherReportComments({
          title: title.trim() || undefined,
          prompt: prompt.trim() || undefined,
          student_id: studentId.trim(),
          score: score ? Number(score) : undefined,
          max_score: maxScore ? Number(maxScore) : undefined,
          teacher_note: teacherNote.trim() || undefined,
        });
        setReportResult(response.data);
      } else {
        setBatchAnalysis(null);
        setSchoolAnalysis(null);
        if (batchId.trim()) {
          const response = await apiService.getBatchAnalytics(batchId.trim());
          setBatchAnalysis(response.data);
        } else if (effectiveSchoolId) {
          const response = await apiService.getSchoolAnalytics(effectiveSchoolId);
          setSchoolAnalysis(response.data);
        } else {
          throw new Error('School context missing for weak student analysis.');
        }
      }
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Teacher AI response generate nahi hua.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Teacher AI Assistant</h1>
        <p className="mt-1 text-sm text-slate-600">
          Question papers, assignments, lesson plans, report comments, topper and weak-student context, sab existing LMS, tests, timetable, aur analytics data se grounded.
        </p>
      </div>

      {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <form onSubmit={submit} className={cardClass}>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-emerald-100 p-3 text-emerald-700">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Teacher Copilot Workspace</h2>
              <p className="text-sm text-slate-500">Generate content, evaluate performance, and draft parent-ready academic communication.</p>
            </div>
          </div>

          <div className="mt-5 grid gap-3">
            <div className="grid gap-2 sm:grid-cols-4">
              {([
                ['paper', 'Paper'],
                ['assignment', 'Assignment'],
                ['lesson', 'Lesson'],
                ['report', 'Report'],
                ['analysis', 'Weak Students'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`rounded-2xl px-3 py-3 text-sm font-semibold transition ${tab === key ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-100'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <input value={title} onChange={(event) => setTitle(event.target.value)} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" placeholder="Optional title" />
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" rows={3} placeholder="Teacher prompt or special instruction" />
            <input value={topic} onChange={(event) => setTopic(event.target.value)} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" placeholder="Topic or chapter" />

            {tab !== 'report' ? (
              <div className="grid gap-3 md:grid-cols-2">
                <input value={batchId} onChange={(event) => setBatchId(event.target.value)} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" placeholder={tab === 'lesson' ? 'Class name for timetable matching' : tab === 'analysis' ? 'Batch UUID for weak student analysis' : 'Batch UUID'} />
                {tab !== 'analysis' ? (
                  <input value={subjectId} onChange={(event) => setSubjectId(event.target.value)} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" placeholder="Subject UUID" />
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    Batch UUID dene par weak students, weak topics, and intervention suggestions batch-wise milenge. Empty chhodne par school-level trend snapshot load hoga.
                  </div>
                )}
              </div>
            ) : null}

            {(tab === 'paper' || tab === 'assignment') ? (
              <div className="grid gap-3 md:grid-cols-2">
                <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm">
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
                <select value={tab === 'paper' ? paperType : assignmentType} onChange={(event) => tab === 'paper' ? setPaperType(event.target.value) : setAssignmentType(event.target.value)} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm">
                  {(tab === 'paper'
                    ? [
                        ['unit_test', 'Unit Test'],
                        ['weekly_test', 'Weekly Test'],
                        ['monthly_test', 'Monthly Test'],
                        ['final_exam', 'Final Exam'],
                      ]
                    : [
                        ['homework', 'Homework'],
                        ['worksheet', 'Worksheet'],
                        ['practice_set', 'Practice Set'],
                        ['revision_sheet', 'Revision Sheet'],
                      ]).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            ) : null}

            {tab === 'lesson' ? (
              <select value={planScope} onChange={(event) => setPlanScope(event.target.value)} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm">
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            ) : null}

            {tab === 'report' ? (
              <>
                <input value={studentId} onChange={(event) => setStudentId(event.target.value)} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" placeholder="Student UUID" />
                <div className="grid gap-3 md:grid-cols-2">
                  <input value={score} onChange={(event) => setScore(event.target.value)} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" placeholder="Score" />
                  <input value={maxScore} onChange={(event) => setMaxScore(event.target.value)} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" placeholder="Max score" />
                </div>
                <textarea value={teacherNote} onChange={(event) => setTeacherNote(event.target.value)} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" rows={3} placeholder="Optional teacher note" />
              </>
            ) : null}

            <button disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-70">
              <Sparkles className="h-4 w-4" />
              {loading ? 'Generating...' : 'Generate'}
            </button>
          </div>
        </form>

        <section className={cardClass}>
          {loading ? <LoadingSpinner message="Teacher AI output generate ho raha hai..." /> : null}
          {!loading && tab === 'paper' && paperResult ? <PaperView result={paperResult} /> : null}
          {!loading && tab === 'assignment' && assignmentResult ? <AssignmentView result={assignmentResult} /> : null}
          {!loading && tab === 'lesson' && lessonResult ? <LessonView result={lessonResult} /> : null}
          {!loading && tab === 'report' && reportResult ? <ReportView result={reportResult} /> : null}
          {!loading && tab === 'analysis' && (batchAnalysis || schoolAnalysis) ? <AnalysisView batchAnalysis={batchAnalysis} schoolAnalysis={schoolAnalysis} /> : null}
          {!loading && ((tab === 'paper' && !paperResult) || (tab === 'assignment' && !assignmentResult) || (tab === 'lesson' && !lessonResult) || (tab === 'report' && !reportResult) || (tab === 'analysis' && !batchAnalysis && !schoolAnalysis)) ? (
            <div className="space-y-4 text-sm text-slate-600">
              <p>Supported teacher workflows:</p>
              <ul className="space-y-2">
                <li>Unit test / weekly test / final exam generation</li>
                <li>Homework, worksheet, revision sheet, practice set generation</li>
                <li>Daily, weekly, monthly lesson planning from timetable</li>
                <li>Student report comments and parent communication summaries</li>
                <li>Weak student analysis with batch-level intervention suggestions</li>
              </ul>
            </div>
          ) : null}
        </section>
      </section>
    </div>
  );
}

function PaperView({ result }: { result: TeacherAiQuestionPaperResponse }) {
  return (
    <div className="space-y-5">
      <Header title={result.title} subtitle={`${result.paper_type} | ${result.topic} | ${result.total_marks} marks`} icon={FileSpreadsheet} />
      <Block title="Instructions" items={result.instructions ? [result.instructions] : []} />
      <Block title="Questions" items={result.questions.map((item, index) => `${index + 1}. [${item.question_type.toUpperCase()} | ${item.marks}] ${item.prompt}`)} />
    </div>
  );
}

function AssignmentView({ result }: { result: TeacherAiAssignmentResponse }) {
  return (
    <div className="space-y-5">
      <Header title={result.title} subtitle={`${result.assignment_type} | ${result.difficulty_level} | ${result.estimated_minutes} min`} icon={ClipboardList} />
      <Block title="Instructions" items={result.instructions ? [result.instructions] : []} />
      <Block title="Tasks" items={result.tasks.map((item) => `${item.task_no}. ${item.prompt}`)} />
    </div>
  );
}

function LessonView({ result }: { result: TeacherAiLessonPlanResponse }) {
  return (
    <div className="space-y-5">
      <Header title={result.title} subtitle={`${result.plan_scope} | ${result.topic}`} icon={BookOpen} />
      <Block title="Teaching Goals" items={result.teaching_goals} />
      <Block title="Holiday Notes" items={result.holiday_notes} />
      <Block title="Schedule" items={result.schedule.map((item) => `${item.day_of_week || 'day'} ${item.start_time || ''}-${item.end_time || ''}: ${item.chapter} | ${item.activity}`)} />
    </div>
  );
}

function ReportView({ result }: { result: TeacherAiReportCommentsResponse }) {
  return (
    <div className="space-y-5">
      <Header title={result.title} subtitle={result.report_type} icon={MessagesSquare} />
      <Block title="Summary" items={result.summary ? [result.summary] : []} />
      <Block title="Remarks" items={result.remarks ? [result.remarks] : []} />
      <Block title="Improvement Suggestions" items={result.improvement_suggestions} />
      <Block title="AI Signals" items={Object.entries(result.score_payload).map(([key, value]) => `${key}: ${String(value)}`)} />
    </div>
  );
}

function AnalysisView({
  batchAnalysis,
  schoolAnalysis,
}: {
  batchAnalysis: BatchAnalytics | null;
  schoolAnalysis: SchoolAnalytics | null;
}) {
  if (batchAnalysis) {
    return (
      <div className="space-y-5">
        <Header title={`${batchAnalysis.batch_name} Weak Student Analysis`} subtitle={`${batchAnalysis.active_students} active students | ${batchAnalysis.overall_percentage.toFixed(1)}% overall`} icon={Users} />
        <Block title="Weak Students" items={batchAnalysis.weak_students.map((student) => `${student.student_name} | ${student.percentage.toFixed(1)}% | Rank ${student.rank}`)} />
        <Block title="Weak Topics" items={batchAnalysis.weak_topics} />
        <Block title="Intervention Suggestions" items={batchAnalysis.suggestions} />
      </div>
    );
  }

  if (schoolAnalysis) {
    return (
      <div className="space-y-5">
        <Header title="School-Level Trend Snapshot" subtitle={`${schoolAnalysis.active_students} active students | ${schoolAnalysis.average_percentage.toFixed(1)}% average`} icon={Users} />
        <Block title="Teacher Performance" items={schoolAnalysis.teacher_wise_performance.map((item) => `${item.name}: ${item.average_percentage.toFixed(1)}% across ${item.tests_count} tests`)} />
        <Block title="Subject Trends" items={schoolAnalysis.subject_wise_trends.map((item) => `${item.name}: ${item.average_percentage.toFixed(1)}% across ${item.tests_count} tests`)} />
        <Block title="Monthly Progress" items={schoolAnalysis.monthly_progress.map((item) => `${item.period}: ${item.average_percentage.toFixed(1)}% average across ${item.tests_count} tests`)} />
      </div>
    );
  }

  return null;
}

function Header({ title, subtitle, icon: Icon }: { title: string; subtitle: string; icon: typeof Sparkles }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-slate-900">
        <Icon className="h-5 w-5" />
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}

function Block({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <Users className="h-4 w-4" />
        {title}
      </div>
      <div className="mt-3 space-y-2">
        {items.length ? items.map((item) => (
          <div key={item} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            {item}
          </div>
        )) : (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
            No items available.
          </div>
        )}
      </div>
    </div>
  );
}
