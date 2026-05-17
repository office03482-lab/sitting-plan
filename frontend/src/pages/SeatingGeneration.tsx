import { useEffect, useState } from 'react';
import { Zap, Download, PlusCircle, Trash2, AlertTriangle, ArrowUp, ArrowDown, Pencil } from 'lucide-react';
import { useAppStore } from '@store/app';
import { apiService } from '@services/api';
import type { SeatingPlan, Exam, Batch, Student, Room, RoomLayout } from '@types';

const toDateTimeLocalValue = (date: Date) => {
  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

const toArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const extractBatchesFromPlanName = (planName: string) => {
  const labeledMatch = planName.match(/Batches:\s*(.+?)\s*-\s*Plan\s+[AB]\b/i);
  if (labeledMatch?.[1]) {
    return labeledMatch[1].trim();
  }

  const legacyMatch = planName.match(/Batches\s+(.+)$/i);
  return legacyMatch?.[1]?.trim() || '';
};

interface RoomBatchSummary {
  planId: number;
  roomId: string | number;
  roomName: string;
  totalStudents: number;
  totalBatches: number;
  batches: Array<{
    batchName: string;
    studentCount: number;
  }>;
}

const buildRoomBatchSummary = (plan: SeatingPlan, layout: RoomLayout): RoomBatchSummary => {
  const batchCounts = new Map<string, number>();

  layout.desks.forEach((desk) => {
    desk.seats.forEach((seat) => {
      if (!seat.is_occupied) return;
      const batchName = String(seat.batch || 'Unknown').trim() || 'Unknown';
      batchCounts.set(batchName, (batchCounts.get(batchName) || 0) + 1);
    });
  });

  const batches = Array.from(batchCounts.entries())
    .map(([batchName, studentCount]) => ({ batchName, studentCount }))
    .sort((a, b) => {
      if (b.studentCount !== a.studentCount) return b.studentCount - a.studentCount;
      return a.batchName.localeCompare(b.batchName);
    });

  return {
    planId: plan.id,
    roomId: plan.room_id,
    roomName: plan.room_name || layout.room_name || `Room ${plan.room_id}`,
    totalStudents: batches.reduce((sum, batch) => sum + batch.studentCount, 0),
    totalBatches: batches.length,
    batches,
  };
};

const buildRoomBatchSummaryFromPlan = (plan: SeatingPlan): RoomBatchSummary | null => {
  const planBatchDistribution = toArray<{ batch?: string; count?: number }>(plan.batch_distribution)
    .map((item) => ({
      batchName: String(item?.batch || '').trim(),
      studentCount: Number(item?.count || 0),
    }))
    .filter((item) => item.batchName && item.studentCount > 0)
    .sort((a, b) => {
      if (b.studentCount !== a.studentCount) return b.studentCount - a.studentCount;
      return a.batchName.localeCompare(b.batchName);
    });

  if (planBatchDistribution.length === 0) {
    return null;
  }

  return {
    planId: plan.id,
    roomId: plan.room_id,
    roomName: plan.room_name || `Room ${plan.room_id}`,
    totalStudents: planBatchDistribution.reduce((sum, batch) => sum + batch.studentCount, 0),
    totalBatches: planBatchDistribution.length,
    batches: planBatchDistribution,
  };
};

export default function SeatingGeneration() {
  const { rooms, setRooms, setSeatingPlans } = useAppStore();
  const [loading, setLoading] = useState(false);
  const [selectedExam, setSelectedExam] = useState<number | null>(null);
  const [selectedBatches, setSelectedBatches] = useState<string[]>([]);
  const [selectedRooms, setSelectedRooms] = useState<Array<string | number>>([]);
  const [planType] = useState<'all_in_one'>('all_in_one');
  const [generatedDate, setGeneratedDate] = useState(toDateTimeLocalValue(new Date()));
  const [batchConflictGroups, setBatchConflictGroups] = useState<string[][]>([]);
  const [currentConflictGroup, setCurrentConflictGroup] = useState<string[]>([]);
  const [selectedConflictBatch, setSelectedConflictBatch] = useState('');
  const [generatedPlans, setGeneratedPlans] = useState<SeatingPlan[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [message, setMessage] = useState('');
  const [showExamForm, setShowExamForm] = useState(false);
  const [examForm, setExamForm] = useState({ name: '' });
  const [editingExamId, setEditingExamId] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ planId: number; planName: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteAllConfirm, setDeleteAllConfirm] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [deletingExam, setDeletingExam] = useState(false);
  const [studentsByBatch, setStudentsByBatch] = useState<{ [batch: string]: any[] }>({});
  const [loadingBatchStudents, setLoadingBatchStudents] = useState(false);
  const [roomBatchSummaries, setRoomBatchSummaries] = useState<Record<number, RoomBatchSummary>>({});
  const [loadingRoomBatchSummaries, setLoadingRoomBatchSummaries] = useState(false);
  const [expandedSummaryPlanId, setExpandedSummaryPlanId] = useState<number | null>(null);

  const selectedExamDetails = exams.find((exam) => exam.id === selectedExam);
  const getPlanBatches = (plan: SeatingPlan) => {
    if (plan.batches && plan.batches.length > 0) {
      return plan.batches.join(', ');
    }

    return extractBatchesFromPlanName(plan.name) || selectedBatches.join(', ') || 'Mixed / Legacy Plan';
  };

  const getPlanRoom = (plan: SeatingPlan) => {
    return roomBatchSummaries[plan.id]?.roomName || plan.room_name || `Room ${plan.room_id}`;
  };

  const getExamLabel = (plan: SeatingPlan) => {
    const exam = exams.find((item) => item.id === plan.exam_id);
    return plan.exam_name || exam?.name || `Exam ${plan.exam_id}`;
  };

  const getPlanTypeLabel = (type: SeatingPlan['plan_type'] | 'all_in_one') => {
    if (type === 'all_in_one') return 'All-in-One';
    if (type === 'strict') return 'Strict Anti-Cheat';
    return 'Compact';
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    void loadPlansForExam(selectedExam ?? undefined);
  }, [selectedExam]);

  // Load students for selected batches
  useEffect(() => {
    if (selectedBatches.length > 0) {
      loadStudentsForBatches(selectedBatches);
    } else {
      setStudentsByBatch({});
    }
  }, [selectedBatches]);

  useEffect(() => {
    if (generatedPlans.length === 0) {
      setRoomBatchSummaries({});
      setLoadingRoomBatchSummaries(false);
      return;
    }

    let isCancelled = false;

    const loadRoomBatchSummaries = async () => {
      setLoadingRoomBatchSummaries(true);
      try {
        const summaryEntries = await Promise.all(
          generatedPlans.map(async (plan) => {
            const planLevelSummary = buildRoomBatchSummaryFromPlan(plan);
            if (planLevelSummary) {
              return [plan.id, planLevelSummary] as const;
            }

            try {
              const response = await apiService.getPlanLayout(plan.id);
              return [plan.id, buildRoomBatchSummary(plan, response.data)] as const;
            } catch (error) {
              console.error(`Failed to load layout summary for seating plan ${plan.id}:`, error);
              return null;
            }
          })
        );

        if (isCancelled) return;

        const nextSummaries = summaryEntries.reduce<Record<number, RoomBatchSummary>>((accumulator, entry) => {
          if (!entry) return accumulator;
          const [planId, summary] = entry;
          accumulator[planId] = summary;
          return accumulator;
        }, {});

        setRoomBatchSummaries(nextSummaries);
      } finally {
        if (!isCancelled) {
          setLoadingRoomBatchSummaries(false);
        }
      }
    };

    void loadRoomBatchSummaries();

    return () => {
      isCancelled = true;
    };
  }, [generatedPlans]);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      const dataSources = [
        { key: 'rooms', required: true, request: apiService.listRooms() },
        { key: 'exams', required: true, request: apiService.listExams() },
        { key: 'batches', required: true, request: apiService.listBatches(1) },
        { key: 'students', required: true, request: apiService.listStudents(1, 0, 10000) },
      ] as const;

      const results = await Promise.allSettled(dataSources.map((item) => item.request));
      const resultMap = Object.fromEntries(
        dataSources.map((item, index) => [item.key, results[index]])
      ) as Record<string, PromiseSettledResult<any>>;

      const roomsData = resultMap.rooms?.status === 'fulfilled' ? toArray<Room>(resultMap.rooms.value.data) : [];
      const examsData = resultMap.exams?.status === 'fulfilled' ? toArray<Exam>(resultMap.exams.value.data) : [];
      const batchesData = resultMap.batches?.status === 'fulfilled' ? toArray<Batch>(resultMap.batches.value.data) : [];
      const studentsData = resultMap.students?.status === 'fulfilled' ? toArray<Student>(resultMap.students.value.data) : [];

      const batchByName = new Map<string, Batch>();
      batchesData.forEach((batch: Batch) => batchByName.set(batch.name, batch));
      studentsData.forEach((student: Student) => {
        if (student.batch && !batchByName.has(student.batch)) {
          batchByName.set(student.batch, {
            id: -batchByName.size - 1,
            name: student.batch,
            school_id: 1,
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

      const requiredFailures = dataSources.filter((item, index) => item.required && results[index].status === 'rejected');
      const optionalFailures = dataSources.filter((item, index) => !item.required && results[index].status === 'rejected');

      if (requiredFailures.length > 0 || optionalFailures.length > 0) {
        console.error('Some data failed to load. Results:', {
          dataSources: dataSources.map((item, index) => ({
            key: item.key,
            required: item.required,
            status: results[index].status,
          })),
          results,
        });
      }

      if (requiredFailures.length > 0) {
        const failedSource = requiredFailures[0];
        const failedResult = resultMap[failedSource.key];
        const detail =
          failedResult?.status === 'rejected'
            ? failedResult.reason?.response?.data?.detail || failedResult.reason?.message
            : '';
        setMessage(detail || `Failed to load ${requiredFailures.map((item) => item.key).join(', ')}.`);
      } else if (optionalFailures.length > 0) {
        setMessage('');
      }
    } catch (error) {
      console.error('Failed to load data:', error);
      setMessage((error as any)?.response?.data?.detail || (error as any)?.message || 'Failed to load seating generation data');
    } finally {
      setLoading(false);
    }
  };

  const loadPlansForExam = async (examId?: number) => {
    try {
      const plansResponse = await apiService.listAllPlans(examId);
      const plans = toArray<SeatingPlan>(plansResponse.data);
      setGeneratedPlans(plans);
      setSeatingPlans(plans);
    } catch (error) {
      console.error('Failed to load seating plans for exam:', error);
      setGeneratedPlans([]);
      setSeatingPlans([]);
      setMessage((error as any)?.response?.data?.detail || (error as any)?.message || 'Failed to load generated seating plans');
    }
  };

  const handleRoomToggle = (roomId: string | number) => {
    setSelectedRooms((prev) =>
      prev.includes(roomId) ? prev.filter((id) => id !== roomId) : [...prev, roomId]
    );
  };

  const moveSelectedRoom = (roomId: string | number, direction: 'up' | 'down') => {
    setSelectedRooms((prev) => {
      const currentIndex = prev.indexOf(roomId);
      if (currentIndex === -1) return prev;

      const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;

      const nextRooms = [...prev];
      [nextRooms[currentIndex], nextRooms[nextIndex]] = [nextRooms[nextIndex], nextRooms[currentIndex]];
      return nextRooms;
    });
  };

  const handleBatchToggle = (batchName: string) => {
    setSelectedBatches((prev) =>
      prev.includes(batchName) ? prev.filter((name) => name !== batchName) : [...prev, batchName]
    );
  };

  const loadStudentsForBatches = async (batchNames: string[]) => {
    setLoadingBatchStudents(true);
    try {
      const studentData: { [batch: string]: any[] } = {};
      
      // Fetch students for each selected batch
      for (const batchName of batchNames) {
        try {
          const response = await apiService.listStudents(1, 0, 10000, batchName);
          studentData[batchName] = response.data || [];
        } catch (error) {
          console.warn(`Failed to load students for batch ${batchName}:`, error);
          studentData[batchName] = [];
        }
      }
      
      setStudentsByBatch(studentData);
    } catch (error) {
      console.error('Error loading batch students:', error);
    } finally {
      setLoadingBatchStudents(false);
    }
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
      const generatedIds = new Set<number>();
      toArray<number>(response.data?.plan_ids).forEach((id) => {
        if (typeof id === 'number') generatedIds.add(id);
      });
      toArray(response.data?.plans).forEach((item: any) => {
        toArray<number>(item?.plan_ids).forEach((id) => {
          if (typeof id === 'number') generatedIds.add(id);
        });
        if (typeof item?.plan_a_id === 'number') generatedIds.add(item.plan_a_id);
        if (typeof item?.plan_b_id === 'number') generatedIds.add(item.plan_b_id);
      });
      const plansForBatches = allExamPlans.filter((plan) => generatedIds.has(plan.id));
      const unassignedCount = Number(response.data?.unassigned_count || 0);
      const selectedStudentCount = Number(response.data?.selected_student_count || 0);

      setGeneratedPlans(plansForBatches);
      setSeatingPlans(plansForBatches);
      setMessage(
        unassignedCount > 0
          ? `Generated ${plansForBatches.length} seating plans. Selected students: ${selectedStudentCount || 'N/A'}, not seated: ${unassignedCount}.`
          : `Successfully generated ${plansForBatches.length} seating plans for ${selectedBatches.length} batches`
      );
    } catch (error: any) {
      console.error('Failed to generate plans:', error);
      setMessage(error?.response?.data?.error || error?.response?.data?.detail || 'Failed to generate seating plans');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateExam = async () => {
    if (!examForm.name.trim()) {
      setMessage('Exam name is required');
      return;
    }

    try {
      if (editingExamId) {
        const response = await apiService.updateExam(editingExamId, examForm);
        const updatedExam = response.data;
        setExams((prev) => prev.map((exam) => (exam.id === editingExamId ? updatedExam : exam)));
        setSelectedExam(updatedExam.id);
        setMessage('Exam updated successfully');
      } else {
        const response = await apiService.createExam(examForm);
        const createdExam = response.data;
        setExams((prev) => [...prev, createdExam]);
        setSelectedExam(createdExam.id);
        setMessage('Exam created successfully');
      }
      setExamForm({ name: '' });
      setShowExamForm(false);
      setEditingExamId(null);
    } catch (error: any) {
      console.error('Failed to create exam:', error);
      setMessage(error?.response?.data?.error || error?.response?.data?.detail || error?.message || 'Failed to save exam');
    }
  };

  const handleEditExam = (exam: Exam) => {
    setEditingExamId(exam.id);
    setExamForm({
      name: exam.name || '',
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
      setGeneratedPlans([]);
      setSeatingPlans([]);
      setShowExamForm(false);
      setEditingExamId(null);
      setExamForm({ name: '' });
      setMessage('Exam deleted successfully');
    } catch (error: any) {
      console.error('Failed to delete exam:', error);
      setMessage(error?.response?.data?.detail || 'Failed to delete exam');
    } finally {
      setDeletingExam(false);
    }
  };

  const handleExportPDF = async (planId: number) => {
    try {
      const response = await apiService.exportPDF(planId);
      const url = window.URL.createObjectURL(response.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `seating-plan-${planId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Failed to export PDF:', error);
      setMessage('Failed to export PDF');
    }
  };

  const handleExportExcel = async (planId: number) => {
    try {
      const response = await apiService.exportExcel(planId);
      const url = window.URL.createObjectURL(response.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `seating-plan-${planId}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Failed to export Excel:', error);
      setMessage('Failed to export Excel');
    }
  };

  const handleExportAllRoomsExcel = async () => {
    if (!selectedExam) {
      setMessage('Please select an exam first');
      return;
    }

    try {
      const response = await apiService.exportAllRoomsExcel(selectedExam, planType);
      const url = window.URL.createObjectURL(response.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `seating-plan-all-rooms-exam-${selectedExam}-${planType}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Failed to export all-room Excel:', error);
      setMessage('Failed to export all rooms Excel');
    }
  };

  const handleDeleteAllPlans = async () => {
    if (!deleteAllConfirm) return;

    setDeletingAll(true);
    try {
      await apiService.deleteAllSeatingPlans(true); // is_admin=true
      setGeneratedPlans([]);
      setSeatingPlans([]);
      setDeleteAllConfirm(false);
      setMessage('All seating plans deleted successfully');
    } catch (error: any) {
      console.error('Failed to delete all plans:', error);
      setMessage(error?.response?.data?.detail || 'Failed to delete all seating plans');
    } finally {
      setDeletingAll(false);
    }
  };

  const handleDeletePlan = async (planId: number) => {
    if (!deleteConfirm) return;

    setDeleting(true);
    try {
      await apiService.deleteSeatingPlan(planId);
      setGeneratedPlans((prev) => prev.filter((plan) => plan.id !== planId));
      setMessage('Seating plan deleted successfully');
      setDeleteConfirm(null);
    } catch (error: any) {
      console.error('Failed to delete plan:', error);
      setMessage(error?.response?.data?.error || error?.response?.data?.detail || 'Failed to delete seating plan');
    } finally {
      setDeleting(false);
    }
  };

  const formatGeneratedDate = (value?: string) => {
    if (!value) return '-';
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
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

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
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
                      setExamForm({ name: '' });
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
                onChange={(e) => setSelectedExam(e.target.value ? parseInt(e.target.value) : null)}
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
                      setExamForm({ name: '' });
                    }}
                    className="ml-2 rounded-lg bg-gray-200 px-4 py-2 text-gray-800 hover:bg-gray-300"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {/* Batch Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Select Batches <span className="text-red-600">*</span>
              </label>
              {batches.length === 0 ? (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 text-sm">
                  No batches available. Please create batches in Batch Management.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-48 overflow-y-auto border border-gray-300 rounded-lg p-3">
                  {batches.map((batch) => (
                    <label
                      key={batch.id || batch.name}
                      className="flex items-center gap-3 cursor-pointer hover:bg-blue-50 p-2 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={selectedBatches.includes(batch.name)}
                        onChange={() => handleBatchToggle(batch.name)}
                        className="w-4 h-4"
                      />
                      <span className="text-gray-700 font-medium">
                        {batch.name}
                        {batch.is_active === false ? ' (Inactive)' : ''}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {selectedBatches.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs text-green-600 mb-2">
                    Selected {selectedBatches.length} batch(es): {selectedBatches.join(', ')}
                  </p>
                  {loadingBatchStudents ? (
                    <p className="text-xs text-gray-500 italic">Loading students for selected batches...</p>
                  ) : (
                    <div className="bg-blue-50 border border-blue-200 rounded p-3 mt-2">
                      <p className="text-xs font-semibold text-blue-900 mb-2">Batch Summary:</p>
                      <div className="space-y-1">
                        {selectedBatches.map((batch) => {
                          const studentCount = studentsByBatch[batch]?.length || 0;
                          return (
                            <div key={batch} className="text-xs text-blue-800 flex justify-between">
                              <span>{batch}:</span>
                              <span className="font-semibold">{studentCount} students</span>
                            </div>
                          );
                        })}
                        <div className="border-t border-blue-200 pt-1 mt-1 font-semibold text-blue-900 flex justify-between">
                          <span>Total:</span>
                          <span>
                            {Object.values(studentsByBatch).reduce((sum, students) => sum + (students?.length || 0), 0)} students
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Plan Type Selection */}
            <div>
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
              <p className="text-xs text-gray-500 mt-2">
                Combined mode uses anti-cheat spacing, mixed batch shuffle, and better room utilization together.
              </p>
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

          {/* Same Test/Syllabus Batch Groups */}
          <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
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
                {batches.map((batch) => {
                  const batchName = batch.name || `Batch ${batch.id}`;
                  return (
                    <option key={batch.id || batchName} value={batchName}>
                      {batchName}
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
                      {batchName} x
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
                    <span className="text-sm text-gray-800">{group.join(', ')}</span>
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

          {/* Room Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Select Rooms for Seating
            </label>
            {rooms.length === 0 ? (
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800">
                No rooms configured. Please create rooms first in Room Configuration.
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

            {selectedRooms.length > 0 && (
              <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-4">
                <p className="mb-3 text-sm font-semibold text-blue-900">Room Sequence</p>
                <div className="space-y-2">
                  {selectedRooms.map((roomId, index) => {
                    const room = rooms.find((item) => item.id === roomId);
                    return (
                      <div key={roomId} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 ring-1 ring-blue-100">
                        <span className="text-sm font-medium text-gray-800">
                          {index + 1}. {room?.name || `Room ${roomId}`}
                        </span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => moveSelectedRoom(roomId, 'up')}
                            disabled={index === 0}
                            className="rounded bg-gray-100 p-2 text-gray-700 hover:bg-gray-200 disabled:opacity-40"
                            title="Move up"
                          >
                            <ArrowUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveSelectedRoom(roomId, 'down')}
                            disabled={index === selectedRooms.length - 1}
                            className="rounded bg-gray-100 p-2 text-gray-700 hover:bg-gray-200 disabled:opacity-40"
                            title="Move down"
                          >
                            <ArrowDown className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-3 text-xs text-blue-800">
                  Students pehle sequence #1 room mein assign honge, phir #2, phir next rooms.
                </p>
              </div>
            )}
          </div>

          {/* Generate Button */}
          <div className="mt-8">
            <button
              onClick={handleGeneratePlans}
              disabled={!selectedExam || selectedBatches.length === 0 || selectedRooms.length === 0 || loading}
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

        {/* Generated Plans Section */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-800">
                {selectedExam
                  ? `Generated Plans For ${selectedExamDetails?.name || 'Selected Exam'} (${generatedPlans.length})`
                  : `All Generated Plans (${generatedPlans.length})`}
              </h2>
              {generatedPlans.length > 0 && (
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleExportAllRoomsExcel}
                    className="flex items-center px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition"
                    title={`Export all ${planType} seating plans for this exam`}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Export All Rooms (All-in-One)
                  </button>
                  <button
                    onClick={() => setDeleteAllConfirm(true)}
                    className="flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
                  >
                    <AlertTriangle className="w-4 h-4 mr-2" />
                    Delete All
                  </button>
                </div>
              )}
            </div>

            {generatedPlans.length === 0 ? (
              <div className="px-6 py-10 text-sm text-gray-500">
                Is exam ke liye abhi koi seating plan available nahi hai. Exam select karke generate karoge to yahan show hoga.
              </div>
            ) : (
              <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-700">Room</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-700">Plan</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-700">Exam</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-700">Batches</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-700">Type</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-700">Students</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-700">Date</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-700">Status</th>
                        <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-700">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {generatedPlans.map((plan) => {
                        const summary = roomBatchSummaries[plan.id];
                        const isExpanded = expandedSummaryPlanId === plan.id;
                        return [
                            <tr key={plan.id} className="border-b border-gray-200 hover:bg-gray-50">
                              <td className="px-4 py-3 text-xs">
                                <button
                                  type="button"
                                  onClick={() => setExpandedSummaryPlanId(isExpanded ? null : plan.id)}
                                  className="inline-flex max-w-[12rem] items-center gap-2 rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-200"
                                  title={summary ? 'Click to show room summary' : 'Summary loading'}
                                >
                                  <span className="truncate">{getPlanRoom(plan)}</span>
                                  <span className="text-[10px] text-slate-500">{isExpanded ? 'Hide' : 'Show'}</span>
                                </button>
                              </td>
                              <td className="px-4 py-3 text-xs font-medium text-gray-900">
                                <div className="max-w-[14rem] truncate">{plan.name}</div>
                              </td>
                              <td className="px-4 py-3 text-xs text-gray-600">
                                <div className="max-w-[10rem] truncate font-medium text-gray-800">{getExamLabel(plan)}</div>
                              </td>
                              <td className="px-4 py-3 text-xs text-gray-600">
                                <div className="max-w-[12rem] truncate">{getPlanBatches(plan)}</div>
                              </td>
                              <td className="px-4 py-3 text-xs text-gray-600">
                                <span
                                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium ${
                                    plan.plan_type === 'strict'
                                      ? 'bg-red-100 text-red-800'
                                      : plan.plan_type === 'compact'
                                        ? 'bg-green-100 text-green-800'
                                        : 'bg-blue-100 text-blue-800'
                                  }`}
                                >
                                  {getPlanTypeLabel(plan.plan_type)}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-xs font-semibold text-gray-700">{plan.students_assigned}</td>
                              <td className="px-4 py-3 text-xs text-gray-600">{formatGeneratedDate(plan.created_at)}</td>
                              <td className="px-4 py-3 text-xs text-gray-600">
                                <span
                                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium ${
                                    plan.status === 'finalized'
                                      ? 'bg-green-100 text-green-800'
                                      : plan.status === 'reviewed'
                                        ? 'bg-blue-100 text-blue-800'
                                        : plan.status === 'draft'
                                          ? 'bg-yellow-100 text-yellow-800'
                                          : 'bg-gray-100 text-gray-800'
                                  }`}
                                >
                                  {plan.status}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <div className="flex justify-center gap-2">
                                  <button
                                    onClick={() => handleExportPDF(plan.id)}
                                    className="rounded p-1.5 text-purple-600 hover:bg-purple-50 hover:text-purple-700"
                                    title="Export as PDF"
                                  >
                                    <Download className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => handleExportExcel(plan.id)}
                                    className="rounded p-1.5 text-green-600 hover:bg-green-50 hover:text-green-700"
                                    title="Export as Excel"
                                  >
                                    <Download className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => setDeleteConfirm({ planId: plan.id, planName: plan.name })}
                                    className="rounded p-1.5 text-red-600 hover:bg-red-50 hover:text-red-700"
                                    title="Delete plan"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>,
                            isExpanded ? (
                              <tr key={`${plan.id}-summary`} className="border-b border-gray-200 bg-slate-50/70">
                                <td colSpan={9} className="px-4 py-3">
                                  {summary ? (
                                    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                                      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-100 px-3 py-2">
                                        <div className="flex items-center gap-2">
                                          <span className="rounded-full bg-blue-600 px-2.5 py-1 text-[10px] font-semibold text-white">
                                            {summary.roomName}
                                          </span>
                                          <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[10px] font-semibold text-slate-700">
                                            {summary.totalStudents} students
                                          </span>
                                          <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[10px] font-semibold text-slate-700">
                                            {summary.totalBatches} batches
                                          </span>
                                        </div>
                                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                          Room Summary Sheet
                                        </span>
                                      </div>

                                      <div className="overflow-x-auto">
                                        <table className="min-w-full text-xs">
                                          <thead className="bg-slate-50">
                                            <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-600">
                                              <th className="px-3 py-2 text-left font-semibold">S.No.</th>
                                              <th className="px-3 py-2 text-left font-semibold">Batch Name</th>
                                              <th className="px-3 py-2 text-left font-semibold">Students</th>
                                              <th className="px-3 py-2 text-left font-semibold">Share</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {summary.batches.map((batch, index) => (
                                              <tr
                                                key={`${summary.planId}-${batch.batchName}`}
                                                className={index % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}
                                              >
                                                <td className="px-3 py-2 text-slate-500">{index + 1}</td>
                                                <td className="px-3 py-2 font-medium text-slate-800">{batch.batchName}</td>
                                                <td className="px-3 py-2">
                                                  <span className="inline-flex min-w-8 items-center justify-center rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                                                    {batch.studentCount}
                                                  </span>
                                                </td>
                                                <td className="px-3 py-2 text-slate-600">
                                                  {summary.totalStudents > 0
                                                    ? `${((batch.studentCount / summary.totalStudents) * 100).toFixed(1)}%`
                                                    : '0%'}
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  ) : loadingRoomBatchSummaries ? (
                                    <p className="text-xs text-slate-500">Room summary load ho rahi hai...</p>
                                  ) : (
                                    <p className="text-xs text-slate-500">Is room ke liye summary available nahi hai.</p>
                                  )}
                                </td>
                              </tr>
                            ) : null,
                        ];
                      })}
                    </tbody>
                  </table>
              </div>
            )}
          </div>

        {/* Delete Confirmation Modal */}
        {deleteConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-lg p-6 max-w-sm">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Seating Plan?</h3>
              <p className="text-gray-600 mb-6">
                Are you sure you want to delete <strong>{deleteConfirm.planName}</strong>? This action cannot be undone.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  disabled={deleting}
                  className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDeletePlan(deleteConfirm.planId)}
                  disabled={deleting}
                  className="px-4 py-2 text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg transition flex items-center gap-2"
                >
                  {deleting ? 'Deleting...' : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete All Confirmation Modal */}
        {deleteAllConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-lg p-6 max-w-sm">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete All Seating Plans?</h3>
              <p className="text-gray-600 mb-6">
                Are you sure you want to delete all records? This action cannot be undone.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setDeleteAllConfirm(false)}
                  disabled={deletingAll}
                  className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteAllPlans}
                  disabled={deletingAll}
                  className="px-4 py-2 text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg transition flex items-center gap-2"
                >
                  {deletingAll ? 'Deleting...' : (
                    <>
                      <AlertTriangle className="w-4 h-4" />
                      Delete All
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
