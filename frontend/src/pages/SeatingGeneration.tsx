import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, PlusCircle, Pencil, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthProvider';
import { useAppStore } from '@store/app';
import { useAuthStore } from '@store/auth';
import { useRefDataStore } from '@store/referenceData';
import {
  apiService,
  getRequestErrorMessage,
  logIfUnexpectedRequestError,
} from '@services/api';
import type { SeatingPlan, Exam, Batch, Student, Room } from '@types';

const toDateTimeLocalValue = (date: Date) => {
  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

const toArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const normalizeBatchLabelPart = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim();
const prettifyBatchName = (value: string) => normalizeBatchLabelPart(value).replace(/\s*\|\s*/g, ' | ');

const buildBatchDisplay = (batch: Batch) => {
  const category = normalizeBatchLabelPart(batch.category).toLowerCase();
  const name = prettifyBatchName(batch.name || `Batch ${batch.id}`);
  const className = normalizeBatchLabelPart(batch.class_name);
  const section = normalizeBatchLabelPart(batch.section);
  const stream = normalizeBatchLabelPart(batch.stream);
  const syllabus = normalizeBatchLabelPart(batch.syllabus);

  const metaParts = [
    className && className !== name ? className : '',
    section ? `Section ${section}` : '',
    stream,
    syllabus,
    category === 'class' ? 'Class Group' : '',
  ].filter(Boolean);

  return {
    primary: name,
    secondary: metaParts.join(' • '),
    compact: [name, metaParts.join(' • ')].filter(Boolean).join(' — '),
  };
};

const getBatchDisplayByName = (batchName: string, batches: Batch[]) => {
  const matchedBatch = batches.find((item) => item.name === batchName);
  if (!matchedBatch) {
    const fallbackName = prettifyBatchName(batchName);
    return { primary: fallbackName, secondary: '', compact: fallbackName };
  }
  return buildBatchDisplay(matchedBatch);
};

type GenerationSummary = {
  generatedCount: number;
  selectedStudentCount: number;
  unassignedCount: number;
  examName: string;
};

export default function SeatingGeneration() {
  const navigate = useNavigate();
  const defaultExamDate = new Date().toISOString().slice(0, 10);
  const { authReady, sessionReady, schoolContextReady, session } = useAuth();
  const currentSchoolId = useAuthStore((state) => state.user?.school_id);
  const canRunRequests = authReady && sessionReady && schoolContextReady && !!session;
  const { rooms, setRooms, setSeatingPlans } = useAppStore();
  const [loading, setLoading] = useState(false);
  const [selectedExam, setSelectedExam] = useState<string | number | null>(null);
  const [selectedBatches, setSelectedBatches] = useState<string[]>([]);
  const [selectedClassFilter, setSelectedClassFilter] = useState('');
  const [selectedBatchOption, setSelectedBatchOption] = useState('');
  const [selectedRooms, setSelectedRooms] = useState<Array<string | number>>([]);
  const [planType] = useState<'all_in_one'>('all_in_one');
  const [generatedDate, setGeneratedDate] = useState(toDateTimeLocalValue(new Date()));
  const [batchConflictGroups, setBatchConflictGroups] = useState<string[][]>([]);
  const [currentConflictGroup, setCurrentConflictGroup] = useState<string[]>([]);
  const [selectedConflictBatch, setSelectedConflictBatch] = useState('');
  const [exams, setExams] = useState<Exam[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [message, setMessage] = useState('');
  const [generationSummary, setGenerationSummary] = useState<GenerationSummary | null>(null);
  const [showExamForm, setShowExamForm] = useState(false);
  const [examForm, setExamForm] = useState({ name: '', exam_date: defaultExamDate });
  const [editingExamId, setEditingExamId] = useState<string | number | null>(null);
  const [deletingExam, setDeletingExam] = useState(false);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [generationUnavailable, setGenerationUnavailable] = useState({
    rooms: false,
    batches: false,
    students: false,
  });

  const selectedExamDetails = exams.find((exam) => exam.id === selectedExam);

  const classOptions = useMemo(() => {
    const values = new Set<string>();
    batches.forEach((batch) => {
      const category = normalizeBatchLabelPart(batch.category).toLowerCase();
      const className = normalizeBatchLabelPart(batch.class_name);
      if (className) {
        values.add(className);
      } else if (category === 'class') {
        values.add(prettifyBatchName(batch.name));
      }
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [batches]);

  const selectableBatches = useMemo(() => {
    return batches
      .filter((batch) => normalizeBatchLabelPart(batch.category).toLowerCase() !== 'class')
      .filter((batch) => {
        if (!selectedClassFilter) return true;
        const className = normalizeBatchLabelPart(batch.class_name);
        return className
          ? className === selectedClassFilter
          : prettifyBatchName(batch.name).includes(selectedClassFilter);
      })
      .sort((a, b) => prettifyBatchName(a.name).localeCompare(prettifyBatchName(b.name)));
  }, [batches, selectedClassFilter]);

  const studentsGroupedByBatch = useMemo(() => {
    const grouped: Record<string, Student[]> = {};
    allStudents.forEach((student) => {
      const batchName = String(student.batch || '').trim();
      if (!batchName) return;
      if (!grouped[batchName]) {
        grouped[batchName] = [];
      }
      grouped[batchName].push(student);
    });
    return grouped;
  }, [allStudents]);

  const totalSelectedStudents = useMemo(
    () => selectedBatches.reduce((sum, batchName) => sum + (studentsGroupedByBatch[batchName]?.length || 0), 0),
    [selectedBatches, studentsGroupedByBatch]
  );

  useEffect(() => {
    if (!canRunRequests || !currentSchoolId) return;
    void loadInitialData();
  }, [canRunRequests, currentSchoolId]);

  const reloadExamsFromBackend = async (invalidExamId?: string | number | null) => {
    const examsResponse = await apiService.listExams();
    const refreshedExams = toArray<Exam>(examsResponse.data);
    setExams(refreshedExams);

    if (invalidExamId == null) {
      return refreshedExams;
    }

    const stillExists = refreshedExams.some((exam) => String(exam.id) === String(invalidExamId));
    if (!stillExists) {
      if (selectedExam != null && String(selectedExam) === String(invalidExamId)) {
        setSelectedExam(null);
      }
      if (editingExamId != null && String(editingExamId) === String(invalidExamId)) {
        setEditingExamId(null);
      }
    }

    return refreshedExams;
  };

  const loadInitialData = async () => {
    if (!currentSchoolId) return;

    setLoading(true);
    try {
      const { getRooms, getBatches, getStudents } = useRefDataStore.getState();
      const dataSources = [
        { key: 'rooms', required: true, request: getRooms(currentSchoolId) },
        { key: 'exams', required: true, request: apiService.listExams() },
        { key: 'batches', required: true, request: getBatches(currentSchoolId) },
        { key: 'students', required: true, request: getStudents(currentSchoolId) },
      ] as const;

      const results = await Promise.allSettled(dataSources.map((item) => item.request));
      const resultMap = Object.fromEntries(
        dataSources.map((item, index) => [item.key, results[index]])
      ) as Record<string, PromiseSettledResult<any>>;

      const roomsData = resultMap.rooms?.status === 'fulfilled' ? toArray<Room>(resultMap.rooms.value) : [];
      const examsData = resultMap.exams?.status === 'fulfilled' ? toArray<Exam>(resultMap.exams.value.data) : [];
      const batchesData = resultMap.batches?.status === 'fulfilled' ? toArray<Batch>(resultMap.batches.value) : [];
      const studentsData = resultMap.students?.status === 'fulfilled' ? toArray<Student>(resultMap.students.value) : [];

      const batchByName = new Map<string, Batch>();
      batchesData.forEach((batch: Batch) => batchByName.set(batch.name, batch));
      studentsData.forEach((student: Student) => {
        if (student.batch && !batchByName.has(student.batch)) {
          batchByName.set(student.batch, {
            id: -batchByName.size - 1,
            name: student.batch,
            school_id: currentSchoolId,
            is_active: true,
            created_at: '',
            updated_at: '',
            student_count: 0,
          });
        }
      });
      
      setRooms(roomsData);
      setExams(examsData);
      setBatches(Array.from(batchByName.values()));
      setAllStudents(studentsData);

      const requiredFailures = dataSources.filter((item, index) => item.required && results[index].status === 'rejected');
      const optionalFailures = dataSources.filter((item, index) => !item.required && results[index].status === 'rejected');
      const nextUnavailable = {
        rooms: resultMap.rooms?.status === 'rejected',
        batches: resultMap.batches?.status === 'rejected',
        students: resultMap.students?.status === 'rejected',
      };
      setGenerationUnavailable(nextUnavailable);

      const unexpectedFailures = [...requiredFailures, ...optionalFailures].filter((item) => {
        const result = resultMap[item.key];
        return result?.status === 'rejected';
      });

      unexpectedFailures.forEach((item) => {
        const result = resultMap[item.key];
        if (result?.status === 'rejected') {
          logIfUnexpectedRequestError(`[SeatingGeneration] Failed to load ${item.key}`, result.reason, 'warn');
        }
      });

      if (requiredFailures.length > 0) {
        const failedSource = requiredFailures[0];
        const failedResult = resultMap[failedSource.key];
        const detail =
          failedResult?.status === 'rejected'
            ? getRequestErrorMessage(failedResult.reason, '')
            : '';
        setMessage(detail || `Failed to load ${requiredFailures.map((item) => item.key).join(', ')}.`);
      } else if (optionalFailures.length > 0) {
        setMessage('');
      } else {
        setMessage('');
      }
    } catch (error) {
      logIfUnexpectedRequestError('Failed to load data:', error);
      setMessage(getRequestErrorMessage(error, 'Failed to load seating generation data'));
    } finally {
      setLoading(false);
    }
  };

  const handleRoomToggle = (roomId: string | number) => {
    setSelectedRooms((prev) =>
      prev.includes(roomId) ? prev.filter((id) => id !== roomId) : [...prev, roomId]
    );
  };

  const handleAddSelectedBatch = () => {
    if (selectedBatchOption) {
      setSelectedBatches((prev) => (prev.includes(selectedBatchOption) ? prev : [...prev, selectedBatchOption]));
      setSelectedBatchOption('');
      return;
    }

    if (!selectedClassFilter) return;
    const classBatchNames = selectableBatches.map((batch) => batch.name).filter(Boolean);
    if (classBatchNames.length === 0) return;

    setSelectedBatches((prev) => {
      const merged = new Set(prev);
      classBatchNames.forEach((batchName) => merged.add(batchName));
      return Array.from(merged);
    });
    setSelectedBatchOption('');
  };

  const handleRemoveSelectedBatch = (batchName: string) => {
    setSelectedBatches((prev) => prev.filter((name) => name !== batchName));
  };

  const handleGeneratePlans = async () => {
    if (!selectedExam) {
      setMessage('Please select an exam');
      return;
    }

    if (selectedBatches.length === 0) {
      setMessage('Please select at least one batch before generating the seating plan');
      return;
    }

    if (selectedRooms.length === 0) {
      setMessage('Please select at least one room');
      return;
    }

    setLoading(true);
    setMessage('');
    setGenerationSummary(null);

    try {
      const response = await apiService.generateSeatingPlans(
        selectedExam,
        selectedRooms,
        planType,
        selectedBatches,
        undefined,
        generatedDate ? new Date(generatedDate).toISOString() : undefined,
        batchConflictGroups
      );

      // Backend generate endpoint currently returns generated IDs, not full SeatingPlan objects.
      // Reload the plan list before rendering to avoid crashing the page with mismatched data.
      const plansResponse = await apiService.listAllPlans(selectedExam);
      const allExamPlans = toArray<SeatingPlan>(plansResponse.data);
      const generatedIds = new Set<string>();
      toArray<string | number>(response.data?.plan_ids).forEach((id) => {
        const normalizedId = String(id || '').trim();
        if (normalizedId) generatedIds.add(normalizedId);
      });
      toArray(response.data?.plans).forEach((item: any) => {
        toArray<string | number>(item?.plan_ids).forEach((id) => {
          const normalizedId = String(id || '').trim();
          if (normalizedId) generatedIds.add(normalizedId);
        });
        const planAId = String(item?.plan_a_id || '').trim();
        const planBId = String(item?.plan_b_id || '').trim();
        if (planAId) generatedIds.add(planAId);
        if (planBId) generatedIds.add(planBId);
      });
      const plansForBatches = allExamPlans.filter((plan) => generatedIds.has(String(plan.id || '').trim()));
      const unassignedCount = Number(response.data?.unassigned_count || 0);
      const selectedStudentCount = Number(response.data?.selected_student_count || 0);

      setSeatingPlans(plansForBatches);
      setGenerationSummary({
        generatedCount: plansForBatches.length,
        selectedStudentCount,
        unassignedCount,
        examName: selectedExamDetails?.name || 'Selected Exam',
      });
      setMessage(
        unassignedCount > 0
          ? `Generated ${plansForBatches.length} seating plans. Selected students: ${selectedStudentCount || 'N/A'}, not seated: ${unassignedCount}.`
          : `Successfully generated ${plansForBatches.length} seating plans for ${selectedBatches.length} batches`
      );
    } catch (error: any) {
      console.error('Failed to generate plans:', error);
      if (selectedExam && !isUuid(String(selectedExam))) {
        try {
          await reloadExamsFromBackend(selectedExam);
        } catch (reloadError) {
          console.error('Failed to reload exams after invalid local exam ID:', reloadError);
        }
      }
      setMessage(getRequestErrorMessage(error, 'Failed to generate seating plans'));
    } finally {
      setLoading(false);
    }
  };

  const handleCreateExam = async () => {
    if (!examForm.name.trim()) {
      setMessage('Exam name is required');
      return;
    }
    if (!examForm.exam_date) {
      setMessage('Exam date is required');
      return;
    }

    const examPayload = {
      name: examForm.name.trim(),
      exam_date: examForm.exam_date,
    };

    try {
      if (editingExamId) {
        const response = await apiService.updateExam(editingExamId, examPayload);
        const updatedExam = response.data;
        setExams((prev) => prev.map((exam) => (exam.id === editingExamId ? updatedExam : exam)));
        setSelectedExam(updatedExam.id);
        setMessage('Exam updated successfully');
      } else {
        const response = await apiService.createExam(examPayload);
        const createdExam = response.data;
        setExams((prev) => [...prev, createdExam]);
        setSelectedExam(createdExam.id);
        setMessage('Exam created successfully');
      }
      setExamForm({ name: '', exam_date: defaultExamDate });
      setShowExamForm(false);
      setEditingExamId(null);
    } catch (error: any) {
      console.error('Failed to create exam:', error);
      if ((editingExamId && !isUuid(String(editingExamId))) || (selectedExam && !isUuid(String(selectedExam)))) {
        try {
          await reloadExamsFromBackend(editingExamId || selectedExam);
        } catch (reloadError) {
          console.error('Failed to reload exams after invalid local exam ID:', reloadError);
        }
      }
      setMessage(getRequestErrorMessage(error, 'Failed to save exam'));
    }
  };

  const handleEditExam = (exam: Exam) => {
    setEditingExamId(exam.id);
    setExamForm({
      name: exam.name || '',
      exam_date: (exam.exam_date || '').slice(0, 10) || defaultExamDate,
    });
    setShowExamForm(true);
    setMessage('');
  };

  const handleDeleteExam = async () => {
    if (!selectedExam) {
      setMessage('Please select an exam first');
      return;
    }

    const exam = exams.find((item) => item.id === selectedExam);
    if (!exam) {
      setMessage('Selected exam not found');
      return;
    }

    const confirmed = window.confirm(
      `"${exam.name}" exam ko delete karna hai? Is exam ke related seating plans bhi delete ho jayenge.`
    );
    if (!confirmed) return;

    try {
      setDeletingExam(true);
      await apiService.deleteExam(selectedExam);
      setExams((prev) => prev.filter((item) => item.id !== selectedExam));
      setSelectedExam(null);
      setSeatingPlans([]);
      setGenerationSummary(null);
      setShowExamForm(false);
      setEditingExamId(null);
      setExamForm({ name: '', exam_date: defaultExamDate });
      setMessage('Exam deleted successfully');
    } catch (error: any) {
      console.error('Failed to delete exam:', error);
      if (selectedExam && !isUuid(String(selectedExam))) {
        try {
          await reloadExamsFromBackend(selectedExam);
        } catch (reloadError) {
          console.error('Failed to reload exams after invalid local exam ID:', reloadError);
        }
      }
      setMessage(getRequestErrorMessage(error, 'Failed to delete exam'));
    } finally {
      setDeletingExam(false);
    }
  };

  const handleAddBatchToConflictGroup = () => {
    if (!selectedConflictBatch || currentConflictGroup.includes(selectedConflictBatch)) return;
    setCurrentConflictGroup((prev) => [...prev, selectedConflictBatch]);
    setSelectedConflictBatch('');
  };

  const handleSaveConflictGroup = () => {
    if (currentConflictGroup.length < 2) {
      setMessage('Same Test/Syllabus group mein kam se kam 2 batches select karo');
      return;
    }

    setBatchConflictGroups((prev) => [...prev, currentConflictGroup]);
    setCurrentConflictGroup([]);
    setSelectedConflictBatch('');
    setMessage('');
  };

  const handleRemoveConflictGroup = (index: number) => {
    setBatchConflictGroups((prev) => prev.filter((_, groupIndex) => groupIndex !== index));
  };

  const handleRemoveBatchFromCurrentGroup = (batchName: string) => {
    setCurrentConflictGroup((prev) => prev.filter((batch) => batch !== batchName));
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-800 mb-8">Generate Seating Plans</h1>

        {/* Configuration Section */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-6">Plan Configuration</h2>

          <div className="space-y-6 mb-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.8fr)]">
            {/* Exam Selection */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="block text-sm font-medium text-gray-700">
                  Select Exam
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingExamId(null);
                      setExamForm({ name: '', exam_date: defaultExamDate });
                      setShowExamForm((prev) => !prev);
                    }}
                    className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
                  >
                    <PlusCircle className="w-4 h-4" />
                    Add Exam
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const exam = exams.find((item) => item.id === selectedExam);
                      if (exam) handleEditExam(exam);
                    }}
                    disabled={!selectedExam}
                    className="inline-flex items-center gap-1 text-sm text-amber-600 hover:text-amber-700 disabled:opacity-50"
                  >
                    <Pencil className="w-4 h-4" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteExam}
                    disabled={!selectedExam || deletingExam}
                    className="inline-flex items-center gap-1 text-sm text-red-600 hover:text-red-700 disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" />
                    {deletingExam ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>
              <select
                value={selectedExam || ''}
                onChange={(e) => setSelectedExam(e.target.value || null)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="">-- Choose Exam --</option>
                {exams.map((exam) => (
                  <option key={exam.id} value={exam.id}>
                    {exam.name}
                  </option>
                ))}
              </select>
              {selectedExam && (
                <p className="text-xs text-gray-500 mt-2">
                  Selected exam ready for seating generation
                </p>
              )}
              {showExamForm && (
                <div className="mt-3 space-y-2 rounded-lg border border-blue-100 bg-blue-50 p-3">
                  <input
                    type="text"
                    value={examForm.name}
                    onChange={(e) => setExamForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="Exam name"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                  <input
                    type="date"
                    value={examForm.exam_date}
                    onChange={(e) => setExamForm((prev) => ({ ...prev, exam_date: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                  <button
                    type="button"
                    onClick={handleCreateExam}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
                  >
                    {editingExamId ? 'Update Exam' : 'Save Exam'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowExamForm(false);
                      setEditingExamId(null);
                      setExamForm({ name: '', exam_date: defaultExamDate });
                    }}
                    className="ml-2 rounded-lg bg-gray-200 px-4 py-2 text-gray-800 hover:bg-gray-300"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
            {/* Generated Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Generated Date
              </label>
              <input
                type="datetime-local"
                value={generatedDate}
                onChange={(e) => setGeneratedDate(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-800 focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => setGeneratedDate(toDateTimeLocalValue(new Date()))}
                className="mt-2 rounded-lg bg-gray-700 px-3 py-2 text-sm text-white hover:bg-gray-800"
              >
                Use Current Date
              </button>
              <p className="text-xs text-gray-500 mt-2">
                This manual date is saved with every generated plan.
              </p>
            </div>
          </div>

            {/* Batch Selection */}
            <div className={`grid gap-4 ${selectedBatches.length > 0 ? 'xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]' : ''}`}>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Select Batches <span className="text-red-600">*</span>
                </label>
                {batches.length === 0 ? (
                  <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 text-sm">
                    {generationUnavailable.batches
                      ? 'Batch data is temporarily unavailable during the ongoing Supabase migration.'
                      : 'No batches available. Please create batches in Batch Management.'}
                  </div>
                ) : (
                  <div className="space-y-4 rounded-2xl border border-gray-300 bg-gradient-to-br from-white to-slate-50 p-5 shadow-sm">
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.15fr)]">
                      <div>
                        <label className="mb-2 block text-sm font-semibold text-gray-600">
                          Class
                        </label>
                        <select
                          value={selectedClassFilter}
                          onChange={(e) => {
                            setSelectedClassFilter(e.target.value);
                            setSelectedBatchOption('');
                          }}
                          className="w-full rounded-xl border border-gray-300 px-4 py-3.5 text-base font-medium text-gray-800 focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">All Classes</option>
                          {classOptions.map((className) => (
                            <option key={className} value={className}>
                              {className}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-semibold text-gray-600">
                          Batch
                        </label>
                        <div className="flex flex-col gap-3 sm:flex-row">
                          <select
                            value={selectedBatchOption}
                            onChange={(e) => setSelectedBatchOption(e.target.value)}
                            className="w-full rounded-xl border border-gray-300 px-4 py-3.5 text-base font-medium text-gray-800 focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="">Select Batch</option>
                            {selectableBatches.map((batch) => {
                              const display = buildBatchDisplay(batch);
                              return (
                                <option key={batch.id || batch.name} value={batch.name}>
                                  {display.compact}
                                </option>
                              );
                            })}
                          </select>
                          <button
                            type="button"
                            onClick={handleAddSelectedBatch}
                            disabled={(!selectedBatchOption && !selectedClassFilter) || generationUnavailable.batches || generationUnavailable.students}
                            className="min-w-[10.5rem] rounded-xl bg-blue-600 px-5 py-3.5 text-base font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                          >
                            {selectedBatchOption ? 'Add Batch' : selectedClassFilter ? 'Add Class' : 'Add'}
                          </button>
                        </div>
                      </div>
                    </div>
                    <p className="text-sm text-gray-500">
                      Batch choose karke single batch add karo, ya sirf class choose karke us class ke saare visible batches ek saath add karo.
                    </p>
                    {selectableBatches.length === 0 ? (
                      <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500">
                        {selectedClassFilter ? 'Is class ke liye koi batch available nahi hai.' : 'Koi batch available nahi hai.'}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
              {selectedBatches.length > 0 ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    Batch Summary
                  </label>
                  <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-4 shadow-sm">
                    <p className="mb-3 text-sm font-semibold text-blue-900">
                      {selectedBatches.length} selected batch(es)
                    </p>
                    <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                      {selectedBatches.map((batch) => {
                        const studentCount = generationUnavailable.students ? null : (studentsGroupedByBatch[batch]?.length || 0);
                        const display = getBatchDisplayByName(batch, batches);
                        return (
                          <div key={batch} className="flex items-start justify-between gap-3 rounded-xl bg-white/80 px-4 py-3 text-sm text-blue-900">
                            <div className="min-w-0">
                              <div className="font-semibold">{display.primary}</div>
                              {display.secondary ? <div className="mt-1 text-xs text-blue-700">{display.secondary}</div> : null}
                            </div>
                            <div className="flex shrink-0 items-center gap-3">
                              <span className="font-semibold">
                                {studentCount == null ? 'Data temporarily unavailable' : `${studentCount} students`}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleRemoveSelectedBatch(batch)}
                                className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-blue-900 ring-1 ring-blue-200 hover:bg-blue-100"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-3 flex justify-between border-t border-blue-200 pt-3 text-sm font-semibold text-blue-900">
                      <span>Total:</span>
                      <span>
                        {generationUnavailable.students
                          ? 'Data temporarily unavailable'
                          : `${totalSelectedStudents} students`}
                      </span>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* Same Test/Syllabus Batch Groups */}
          <div className="mb-6 grid gap-4 lg:grid-cols-[1.45fr_0.75fr]">
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
              <label className="block text-sm font-semibold text-yellow-900 mb-2">
                Same Test/Syllabus Batch Groups <span className="font-normal text-yellow-700">(Optional)</span>
              </label>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_auto]">
                <select
                  value={selectedConflictBatch}
                  onChange={(e) => setSelectedConflictBatch(e.target.value)}
                  className="rounded-lg border border-yellow-300 bg-white px-3 py-2 text-sm text-gray-800 focus:ring-2 focus:ring-yellow-500"
                >
                  <option value="">Select batch</option>
                  {selectableBatches.map((batch) => {
                    const batchName = batch.name || `Batch ${batch.id}`;
                    const display = buildBatchDisplay(batch);
                    return (
                      <option key={batch.id || batchName} value={batchName}>
                        {display.compact}
                      </option>
                    );
                  })}
                </select>
                <button
                  type="button"
                  onClick={handleAddBatchToConflictGroup}
                  className="rounded-lg bg-yellow-600 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-700"
                >
                  Add to Group
                </button>
                <button
                  type="button"
                  onClick={handleSaveConflictGroup}
                  className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-900"
                >
                  Save Group
                </button>
              </div>

              {currentConflictGroup.length > 0 && (
                <div className="mt-3">
                  <p className="mb-2 text-xs font-semibold text-yellow-900">Current group:</p>
                  <div className="flex flex-wrap gap-2">
                    {currentConflictGroup.map((batchName) => (
                      <button
                        key={batchName}
                        type="button"
                        onClick={() => handleRemoveBatchFromCurrentGroup(batchName)}
                        className="rounded-full bg-white px-3 py-1 text-xs font-medium text-yellow-900 ring-1 ring-yellow-300 hover:bg-yellow-100"
                      >
                        {getBatchDisplayByName(batchName, batches).primary} x
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {batchConflictGroups.length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-semibold text-yellow-900">Saved groups:</p>
                  {batchConflictGroups.map((group, index) => (
                    <div key={`${group.join('-')}-${index}`} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 ring-1 ring-yellow-200">
                      <span className="text-sm text-gray-800">
                        {group.map((batchName) => getBatchDisplayByName(batchName, batches).primary).join(', ')}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveConflictGroup(index)}
                        className="text-xs font-semibold text-red-600 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <p className="mt-2 text-xs text-yellow-800">
                Dropdown se same test/syllabus wale batches ko ek group mein save karo. Un batches ke students same bench, front/back, left/right benches par saath nahi baithenge.
              </p>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Plan Type
              </label>
              <div className="space-y-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    value="all_in_one"
                    checked={planType === 'all_in_one'}
                    readOnly
                    className="w-4 h-4"
                  />
                  <span className="text-gray-700">
                    <strong>All-in-One</strong> - Strict anti-cheat + compact practical seating
                  </span>
                </label>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Combined mode uses anti-cheat spacing, mixed batch shuffle, and better room utilization together.
              </p>
            </div>
          </div>

          {/* Room Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Select Rooms for Seating
            </label>
            {rooms.length === 0 ? (
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800">
                {generationUnavailable.rooms
                  ? 'Room data is temporarily unavailable during the ongoing Supabase migration.'
                  : 'No rooms configured. Please create rooms first in Room Configuration.'}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {rooms.map((room) => (
                  <label
                    key={room.id}
                    className="flex items-start gap-3 p-4 border border-gray-300 rounded-lg cursor-pointer hover:bg-blue-50 transition"
                  >
                    <input
                      type="checkbox"
                      checked={selectedRooms.includes(room.id)}
                      onChange={() => handleRoomToggle(room.id)}
                      disabled={generationUnavailable.rooms}
                      className="w-4 h-4 mt-1"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-800">{room.name}</p>
                        {selectedRooms.includes(room.id) && (
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                            #{selectedRooms.indexOf(room.id) + 1}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600">
                        Capacity: {room.capacity} | {room.length_feet}×{room.width_feet}ft
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            )}

          </div>

          {/* Generate Button */}
          <div className="mt-8">
            <button
              onClick={handleGeneratePlans}
              disabled={
                !selectedExam
                || selectedBatches.length === 0
                || selectedRooms.length === 0
                || loading
                || generationUnavailable.rooms
                || generationUnavailable.batches
                || generationUnavailable.students
              }
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-8 py-3 rounded-lg transition font-semibold"
            >
              <Zap className="w-5 h-5" />
              {loading ? 'Generating Plans...' : 'Generate Seating Plans'}
            </button>

            {message && (
              <p
                className={`mt-4 text-sm font-medium ${
                  message.startsWith('Successfully') || message.startsWith('Generated ') ? 'text-green-600' : 'text-red-600'
                }`}
              >
                {message}
              </p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-800">Generation Summary</h2>
            <p className="mt-1 text-sm text-gray-500">
              Seating Generation now creates plans only. Plan details, exports, archive, audit, and maintenance remain in Seating Plan Management.
            </p>
          </div>

          <div className="px-6 py-6">
            {generationSummary ? (
              <div className="space-y-5">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
                  <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Latest Run</p>
                  <h3 className="mt-2 text-2xl font-bold text-emerald-900">
                    {generationSummary.generatedCount} seating plan{generationSummary.generatedCount === 1 ? '' : 's'} generated successfully.
                  </h3>
                  <p className="mt-2 text-sm text-emerald-800">
                    Exam: {generationSummary.examName} | Students selected: {generationSummary.selectedStudentCount || 'N/A'} | Not seated: {generationSummary.unassignedCount}
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => navigate('/seating/plans')}
                    className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
                  >
                    View Generated Plans
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/admin-office')}
                    className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-5 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
                  >
                    Open Exam Planner
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-5 py-8 text-sm text-gray-600">
                Generate new seating plans to see the success summary here. Plan details, exports, archive, audit, and deletions are available in Seating Plan Management.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
