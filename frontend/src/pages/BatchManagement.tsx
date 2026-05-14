import React, { useEffect, useRef, useState } from 'react';
import { apiService } from '@services/api';
import type { Batch, Student } from '@types';
import { Plus, Pencil, Trash2, AlertCircle, Search, Filter, X, ArrowUp, ArrowDown, ListOrdered } from 'lucide-react';

const detectStreamFromBatchName = (batchName: string): string => {
  const normalized = batchName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const medicalKeywords = ['med', 'medical', 'neet', 'pcb'];
  const nonMedicalKeywords = ['non medical', 'non med', 'nm', 'jee main', 'jee', 'adv', 'pcm'];
  const matchesKeyword = (keyword: string) => {
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`(^|\\s)${escapedKeyword}(\\s|$)`, 'i').test(normalized);
  };

  if (nonMedicalKeywords.some(matchesKeyword)) {
    return 'Non Medical';
  }

  if (medicalKeywords.some(matchesKeyword)) {
    return 'Medical';
  }

  return '';
};

const normalizeBatchText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const detectCourseFromBatchText = (value: string): string => {
  const normalized = normalizeBatchText(value);

  if (
    normalized.includes('ssb') ||
    normalized.includes('s s b') ||
    normalized.includes('sure selection') ||
    normalized.includes('sureselection')
  ) {
    return 'S.S.B';
  }
  if (normalized.includes('advance') || normalized.includes('adv')) return 'ADVANCE';
  if (normalized.includes('jee')) return 'JEE-MAIN';
  if (normalized.includes('neet')) return 'NEET';
  return 'General';
};

const parseBatchMeta = (batch: Pick<Batch, 'name' | 'syllabus'>) => {
  const syllabusText = (batch.syllabus || '').trim();
  const syllabusParts = syllabusText.split('|').map((part) => part.trim()).filter(Boolean);
  const normalized = normalizeBatchText(`${batch.name} ${syllabusText}`);

  const streamFromSyllabus = syllabusParts.find((part) => /medical|non medical/i.test(part)) || '';
  const courseFromSyllabusPart =
    syllabusParts.find((part) => /neet|jee|advance|adv|ssb|sure selection/i.test(part)) || '';

  const stream = streamFromSyllabus || detectStreamFromBatchName(batch.name);
  const course = courseFromSyllabusPart
    ? detectCourseFromBatchText(courseFromSyllabusPart)
    : detectCourseFromBatchText(normalized);

  let batchType = 'Regular';
  if (normalized.includes('dropper')) batchType = 'Dropper';
  else if (normalized.includes('11th') || normalized.includes('11')) batchType = '11th';
  else if (normalized.includes('12th') || normalized.includes('12')) batchType = '12th';

  return { stream: stream || '-', course, batchType };
};

const getBatchTypeRank = (batch: Pick<Batch, 'name' | 'syllabus'>) => {
  const batchType = parseBatchMeta(batch).batchType;
  if (batchType === '11th') return 0;
  if (batchType === '12th') return 1;
  if (batchType === 'Dropper') return 2;
  return 3;
};

const getEffectiveStream = (batch: Pick<Batch, 'name' | 'syllabus'>): string =>
  parseBatchMeta(batch).stream;

const getCourseFromBatch = (batch: Pick<Batch, 'name' | 'syllabus'>): string => {
  return parseBatchMeta(batch).course;
};

const naturalNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

const getClassSortKey = (value: string) => {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
  const compact = normalized.replace(/[^a-z0-9]/g, '');
  const aliasMap: Record<string, number> = {
    prenursery: -3,
    preprimary: -3,
    prenur: -3,
    nursery: -2,
    lkg: -1,
    ukg: 0,
    kg: 0,
  };
  const wordNumberMap: Record<string, number> = {
    one: 1,
    first: 1,
    two: 2,
    second: 2,
    three: 3,
    third: 3,
    four: 4,
    fourth: 4,
    five: 5,
    fifth: 5,
    six: 6,
    sixth: 6,
    seven: 7,
    seventh: 7,
    eight: 8,
    eighth: 8,
    nine: 9,
    ninth: 9,
    ten: 10,
    tenth: 10,
    eleven: 11,
    eleventh: 11,
    twelve: 12,
    twelfth: 12,
  };
  const romanMap: Record<string, number> = {
    i: 1,
    ii: 2,
    iii: 3,
    iv: 4,
    v: 5,
    vi: 6,
    vii: 7,
    viii: 8,
    ix: 9,
    x: 10,
    xi: 11,
    xii: 12,
  };

  if (compact in aliasMap) {
    return { rank: aliasMap[compact], section: '', label: normalized };
  }

  for (const [alias, rank] of Object.entries(aliasMap)) {
    if (compact.includes(alias)) {
      return { rank, section: '', label: normalized };
    }
  }

  const numericMatch = normalized.match(/\b(\d{1,2})(st|nd|rd|th)?\b/);
  if (numericMatch) {
    const rank = Number(numericMatch[1]);
    const section = normalized.replace(numericMatch[0], '').trim();
    return { rank, section, label: normalized };
  }

  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  for (const token of tokens) {
    if (token in wordNumberMap) {
      const section = normalized.replace(token, '').trim();
      return { rank: wordNumberMap[token], section, label: normalized };
    }
    if (token in romanMap) {
      const section = normalized.replace(token, '').trim();
      return { rank: romanMap[token], section, label: normalized };
    }
  }

  return { rank: Number.POSITIVE_INFINITY, section: '', label: normalized };
};

type BatchCourse = '' | 'NEET' | 'JEE-MAIN' | 'ADVANCE' | 'S.S.B' | 'General';
type BatchProgram = '' | 'Medical' | 'Non Medical';
type BatchTypeValue = '' | 'Dropper' | '11th' | '12th' | 'Regular';

const buildBatchNameFromMeta = (course: BatchCourse, program: BatchProgram, batchType: BatchTypeValue) => {
  const parts = [batchType, program, course].filter(Boolean);
  return parts.join(' ').trim();
};

const buildBatchSyllabusFromMeta = (course: BatchCourse, program: BatchProgram, batchType: BatchTypeValue) => {
  const parts = [program, course, batchType].filter(Boolean);
  return parts.join(' | ').trim();
};

const toBatchFormState = (batch?: Pick<Batch, 'name' | 'syllabus' | 'is_active'>) => {
  const meta = batch ? parseBatchMeta(batch) : { course: '', stream: '', batchType: '' };
  return {
    name: batch?.name || '',
    syllabus: batch?.syllabus || '',
    course: (meta.course === 'General' ? '' : meta.course) as BatchCourse,
    program: (meta.stream === '-' ? '' : meta.stream) as BatchProgram,
    batchType: (meta.batchType === 'Regular' ? '' : meta.batchType) as BatchTypeValue,
    is_active: batch?.is_active ?? true,
  };
};

type BatchFormState = ReturnType<typeof toBatchFormState>;

const normalizeStudent = (student: any): Student => ({
  ...student,
  id: Number(student?.id ?? 0),
  name: String(student?.name ?? '').trim(),
  roll_number: String(student?.roll_number ?? student?.rollNo ?? student?.roll_no ?? '').trim(),
  father_name: String(student?.father_name ?? student?.fatherName ?? '').trim() || undefined,
  batch: String(student?.batch ?? '').trim(),
  class_name: String(student?.class_name ?? student?.className ?? '').trim() || undefined,
  section: String(student?.section ?? '').trim() || undefined,
  phone: String(student?.phone ?? '').trim() || undefined,
  email: String(student?.email ?? '').trim() || undefined,
  is_active: Boolean(student?.is_active ?? student?.isActive ?? true),
});

const BatchManagement: React.FC = () => {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [categoryTotals, setCategoryTotals] = useState({
    batch: 0,
    class: 0,
    batchStudents: 0,
    classStudents: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null);
  const [formData, setFormData] = useState(() => toBatchFormState());
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [streamManuallyChanged, setStreamManuallyChanged] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBatchFilter, setSelectedBatchFilter] = useState<'all' | string>('all');
  const [selectedCourseFilter, setSelectedCourseFilter] = useState<'all' | string>('all');
  const [selectedProgramFilter, setSelectedProgramFilter] = useState<'all' | string>('all');
  const [selectedBatchTypeFilter, setSelectedBatchTypeFilter] = useState<'all' | string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [showStudentsModal, setShowStudentsModal] = useState(false);
  const [studentOverlayBatch, setStudentOverlayBatch] = useState<Batch | null>(null);
  const [batchStudents, setBatchStudents] = useState<Student[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsError, setStudentsError] = useState<string | null>(null);
  const [reorderLoading, setReorderLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<'batch' | 'class'>('batch');
  const formDataRef = useRef<BatchFormState>(toBatchFormState());
  const streamManuallyChangedRef = useRef(false);

  const schoolId = 1; // TODO: Get from auth context

  useEffect(() => {
    loadBatches();
  }, [selectedCategory]);

  const loadBatches = async () => {
    try {
      setLoading(true);
      const [selectedResponse, otherCategoryResponse, studentsResponse] = await Promise.all([
        apiService.listBatches(schoolId, undefined, selectedCategory),
        apiService.listBatches(schoolId, undefined, selectedCategory === 'batch' ? 'class' : 'batch'),
        apiService.listStudents(schoolId, 0, 10000),
      ]);
      const selectedItems = Array.isArray(selectedResponse.data) ? selectedResponse.data : [];
      const otherItems = Array.isArray(otherCategoryResponse.data) ? otherCategoryResponse.data : [];
      const students = Array.isArray(studentsResponse.data)
        ? studentsResponse.data
            .map(normalizeStudent)
            .filter((student) => student.id > 0 && (student.name || student.roll_number))
        : [];
      const batchStudents = students.filter((student) => student.batch.trim()).length;
      const classStudents = students.filter((student) => (student.class_name || '').trim()).length;

      setBatches(selectedItems);
      setCategoryTotals(
        selectedCategory === 'batch'
          ? {
              batch: selectedItems.length,
              class: otherItems.length,
              batchStudents,
              classStudents,
            }
          : {
              batch: otherItems.length,
              class: selectedItems.length,
              batchStudents,
              classStudents,
            }
      );
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load batches');
    } finally {
      setLoading(false);
    }
  };

  const setFormState = (next: BatchFormState | ((current: BatchFormState) => BatchFormState)) => {
    setFormData((current) => {
      const resolved = typeof next === 'function' ? next(current) : next;
      formDataRef.current = resolved;
      return resolved;
    });
  };

  const setStreamManualState = (value: boolean) => {
    streamManuallyChangedRef.current = value;
    setStreamManuallyChanged(value);
  };

  const buildResolvedBatchPayload = (state: BatchFormState) => {
    const autoName = buildBatchNameFromMeta(
      state.course as BatchCourse,
      state.program as BatchProgram,
      state.batchType as BatchTypeValue
    );
    const autoSyllabus = buildBatchSyllabusFromMeta(
      state.course as BatchCourse,
      state.program as BatchProgram,
      state.batchType as BatchTypeValue
    );

    const name = selectedCategory === 'batch' ? (state.name.trim() || autoName.trim()) : state.name.trim();
    const syllabus = selectedCategory === 'batch'
      ? ((streamManuallyChangedRef.current ? state.syllabus : autoSyllabus || state.syllabus).trim() || undefined)
      : undefined;

    return {
      name,
      category: selectedCategory,
      syllabus,
      is_active: state.is_active,
    };
  };

  const resetForm = () => {
    setFormState(toBatchFormState());
    setStreamManualState(false);
  };

  const handleBatchNameChange = (value: string) => {
    const detectedStream = detectStreamFromBatchName(value);
    setFormState((current) => ({
      ...current,
      name: value,
      syllabus: streamManuallyChangedRef.current ? current.syllabus : detectedStream || current.syllabus,
    }));
  };

  const handleStreamChange = (value: string) => {
    setStreamManualState(true);
    setFormState((current) => ({ ...current, syllabus: value }));
  };

  const handleStructuredMetaChange = (patch: Partial<typeof formData>) => {
    setFormState((current) => {
      const next = { ...current, ...patch };
      const currentAutoName = buildBatchNameFromMeta(
        current.course as BatchCourse,
        current.program as BatchProgram,
        current.batchType as BatchTypeValue
      );
      const autoName = buildBatchNameFromMeta(next.course as BatchCourse, next.program as BatchProgram, next.batchType as BatchTypeValue);
      const autoSyllabus = buildBatchSyllabusFromMeta(next.course as BatchCourse, next.program as BatchProgram, next.batchType as BatchTypeValue);
      const shouldReplaceName = !current.name.trim() || current.name.trim() === currentAutoName.trim();

      return {
        ...next,
        name: shouldReplaceName ? autoName || next.name : next.name,
        syllabus: streamManuallyChangedRef.current ? next.syllabus : autoSyllabus || next.syllabus,
      };
    });
  };

  const handleAddBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = buildResolvedBatchPayload(formDataRef.current);
      if (!payload.name) {
        setError('Batch name cannot be empty');
        return;
      }

      await apiService.createBatch(payload, schoolId);
      resetForm();
      setShowAddModal(false);
      loadBatches();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to create batch');
    }
  };

  const handleUpdateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBatch) return;

    try {
      const payload = buildResolvedBatchPayload(formDataRef.current);
      if (!payload.name) {
        setError('Batch name cannot be empty');
        return;
      }

      await apiService.updateBatch(selectedBatch.id, payload, schoolId);
      resetForm();
      setShowEditModal(false);
      setSelectedBatch(null);
      loadBatches();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to update batch');
    }
  };

  const handleDeleteBatch = async () => {
    if (!selectedBatch) return;

    try {
      await apiService.deleteBatch(selectedBatch.id, schoolId);
      setShowDeleteModal(false);
      setDeleteError(null);
      setSelectedBatch(null);
      loadBatches();
    } catch (err: any) {
      setDeleteError(err.response?.data?.detail || 'Failed to delete batch');
    }
  };

  const openEditModal = (batch: Batch) => {
    setSelectedBatch(batch);
    setFormState(toBatchFormState(batch));
    setStreamManualState(false);
    setShowEditModal(true);
  };

  const openDeleteModal = (batch: Batch) => {
    setSelectedBatch(batch);
    setDeleteError(null);
    setShowDeleteModal(true);
  };

  const closeStudentsModal = () => {
    setShowStudentsModal(false);
    setStudentOverlayBatch(null);
    setBatchStudents([]);
    setStudentsError(null);
    setStudentsLoading(false);
  };

  const openStudentsModal = async (batch: Batch) => {
    try {
      setStudentOverlayBatch(batch);
      setShowStudentsModal(true);
      setStudentsLoading(true);
      setStudentsError(null);
      const response = selectedCategory === 'class'
        ? await apiService.listStudents(schoolId, 0, 10000)
        : await apiService.listStudents(schoolId, 0, 10000, batch.name);
      const students = (Array.isArray(response.data)
        ? response.data
            .map(normalizeStudent)
            .filter((student) => student.id > 0 && (student.name || student.roll_number))
        : [])
        .filter((student) => selectedCategory !== 'class' || student.class_name === batch.name);
      setBatchStudents(students);
    } catch (err: any) {
      setBatchStudents([]);
      setStudentsError(err.response?.data?.detail || 'Failed to load students for this batch');
    } finally {
      setStudentsLoading(false);
    }
  };

  const handleDeleteAllBatches = async () => {
    const confirmed = window.confirm(
      selectedCategory === 'class'
        ? 'Delete all classes? Ye tabhi hoga jab kisi class mein student assigned na ho.'
        : 'Delete all batches? Ye tabhi hoga jab kisi batch mein student assigned na ho.'
    );
    if (!confirmed) return;

    try {
      await apiService.deleteAllBatches(schoolId, selectedCategory);
      setDeleteError(null);
      setSelectedBatch(null);
      await loadBatches();
    } catch (err: any) {
      setDeleteError(err.response?.data?.detail || 'Failed to delete all batches');
      setError(err.response?.data?.detail || 'Failed to delete all batches');
    }
  };

  const batchFilterOptions = Array.from(new Set(batches.map((batch) => batch.name))).sort((a, b) =>
    a.localeCompare(b)
  );
  const courseFilterOptions = Array.from(new Set(batches.map((batch) => getCourseFromBatch(batch)))).sort((a, b) => a.localeCompare(b));
  const programFilterOptions = Array.from(new Set(batches.map((batch) => getEffectiveStream(batch)).filter(Boolean).filter((value) => value !== '-'))).sort((a, b) => a.localeCompare(b));
  const batchTypeFilterOptions = Array.from(new Set(batches.map((batch) => parseBatchMeta(batch).batchType))).sort((a, b) => a.localeCompare(b));

  const filteredBatches = batches.filter((batch) => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const batchMeta = parseBatchMeta(batch);
    const matchesSearch =
      !normalizedSearch ||
      batch.name.toLowerCase().includes(normalizedSearch) ||
      (selectedCategory === 'class' && (batch.syllabus || '').toLowerCase().includes(normalizedSearch)) ||
      batchMeta.stream.toLowerCase().includes(normalizedSearch) ||
      batchMeta.course.toLowerCase().includes(normalizedSearch) ||
      batchMeta.batchType.toLowerCase().includes(normalizedSearch) ||
      (batch.syllabus || '').toLowerCase().includes(normalizedSearch);
    const matchesBatch = selectedBatchFilter === 'all' || batch.name === selectedBatchFilter;
    const matchesCourse = selectedCategory === 'class' || selectedCourseFilter === 'all' || batchMeta.course === selectedCourseFilter;
    const matchesProgram = selectedCategory === 'class' || selectedProgramFilter === 'all' || batchMeta.stream === selectedProgramFilter;
    const matchesBatchType = selectedCategory === 'class' || selectedBatchTypeFilter === 'all' || batchMeta.batchType === selectedBatchTypeFilter;
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && batch.is_active) ||
      (statusFilter === 'inactive' && !batch.is_active);

    return matchesSearch && matchesBatch && matchesCourse && matchesProgram && matchesBatchType && matchesStatus;
  });

  const persistBatchOrder = async (nextBatches: Batch[]) => {
    try {
      setReorderLoading(true);
      const payload = nextBatches.map((batch, index) => ({
        batch_id: batch.id,
        display_order: index + 1,
      }));
      const response = await apiService.reorderBatches(payload, schoolId, selectedCategory);
      setBatches(Array.isArray(response.data) ? response.data : []);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Batch sequence save nahi ho payi');
      await loadBatches();
    } finally {
      setReorderLoading(false);
    }
  };

  const handleMoveBatch = async (batchId: string | number, direction: 'up' | 'down') => {
    const currentIndex = batches.findIndex((batch) => batch.id === batchId);
    if (currentIndex === -1) return;
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= batches.length) return;

    const nextBatches = [...batches];
    [nextBatches[currentIndex], nextBatches[targetIndex]] = [nextBatches[targetIndex], nextBatches[currentIndex]];
    await persistBatchOrder(nextBatches);
  };

  const handleAutoSequence = async () => {
    const nextBatches = [...batches].sort((a, b) => {
      if (selectedCategory === 'class') {
        const classA = getClassSortKey(a.name);
        const classB = getClassSortKey(b.name);
        if (classA.rank !== classB.rank) return classA.rank - classB.rank;
        if (classA.section !== classB.section) {
          return naturalNameCollator.compare(classA.section, classB.section);
        }
        return naturalNameCollator.compare(a.name, b.name);
      }

      const typeRankDiff = getBatchTypeRank(a) - getBatchTypeRank(b);
      if (typeRankDiff !== 0) return typeRankDiff;
      const courseDiff = getCourseFromBatch(a).localeCompare(getCourseFromBatch(b));
      if (courseDiff !== 0) return courseDiff;
      return naturalNameCollator.compare(a.name, b.name);
    });
    await persistBatchOrder(nextBatches);
  };

  return (
    <div className="bg-gradient-to-br from-slate-900 to-slate-800 p-4 md:p-6">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="mb-2 text-3xl font-bold text-white md:text-4xl">{selectedCategory === 'class' ? 'Class Management' : 'Batch Management'}</h1>
              <p className="text-slate-300">{selectedCategory === 'class' ? 'Create and manage school classes' : 'Create and manage exam batches'}</p>
            </div>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:min-w-[540px] sm:flex-row sm:items-center sm:justify-end">
              <div className="relative flex-1 sm:min-w-[260px]">
                <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={selectedCategory === 'class' ? 'Search class name' : 'Search batch, course, program, type'}
                  className="h-11 w-full rounded-xl border border-slate-600 bg-slate-900/80 py-2 pl-10 pr-4 text-sm text-white placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={handleDeleteAllBatches}
                disabled={loading || batches.length === 0}
                className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-red-500/50 bg-red-600/90 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Trash2 size={18} />
                Delete All
              </button>
              <button
                onClick={() => {
                  resetForm();
                  setError(null);
                  setShowAddModal(true);
                }}
                className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
              >
                <Plus size={18} />
                {selectedCategory === 'class' ? 'Add Class' : 'Add Batch'}
              </button>
            </div>
          </div>
          <div className="mt-5 rounded-2xl border border-slate-700 bg-slate-800/70 p-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="inline-flex rounded-xl border border-slate-700 bg-slate-900/70 p-1">
                <button
                  type="button"
                  onClick={() => setSelectedCategory('batch')}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${selectedCategory === 'batch' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
                >
                  Batches
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCategory('class')}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${selectedCategory === 'class' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
                >
                  Classes
                </button>
              </div>
              <div className="flex flex-wrap gap-3 xl:justify-end">
                <div className="min-w-[210px] rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">Total Batches</p>
                  <div className="mt-1 flex items-baseline justify-between gap-3">
                    <p className="text-2xl font-bold text-white">{categoryTotals.batch}</p>
                    <p className="text-xs text-slate-400">{categoryTotals.batchStudents} students</p>
                  </div>
                </div>
                <div className="min-w-[210px] rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">Total Classes</p>
                  <div className="mt-1 flex items-baseline justify-between gap-3">
                    <p className="text-2xl font-bold text-white">{categoryTotals.class}</p>
                    <p className="text-xs text-slate-400">{categoryTotals.classStudents} students</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 rounded-lg flex items-start gap-3">
            <AlertCircle size={20} className="text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-red-200 font-semibold">Error</p>
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="mb-6">
          <div className="rounded-2xl border border-slate-700 bg-slate-800/70 p-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-slate-400">Filters</p>
            <div className={`grid gap-2 ${selectedCategory === 'class' ? 'md:grid-cols-3 xl:grid-cols-[minmax(165px,1.15fr)_minmax(145px,0.95fr)_minmax(125px,0.85fr)_138px_158px]' : 'md:grid-cols-3 xl:grid-cols-[minmax(165px,1.25fr)_minmax(128px,0.85fr)_minmax(138px,0.95fr)_minmax(138px,0.95fr)_minmax(138px,0.95fr)_138px_158px]'} xl:items-center`}>
              <div className="relative">
                <Filter size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <select
                  value={selectedBatchFilter}
                  onChange={(e) => setSelectedBatchFilter(e.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-600 bg-slate-900/80 py-1.5 pl-9 pr-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="all">{selectedCategory === 'class' ? 'All Classes' : 'All Batch Names'}</option>
                  {batchFilterOptions.map((batchName) => (
                    <option key={batchName} value={batchName}>
                      {batchName}
                    </option>
                  ))}
                </select>
              </div>
              {selectedCategory === 'batch' ? (
                <>
                  <select
                    value={selectedCourseFilter}
                    onChange={(e) => setSelectedCourseFilter(e.target.value)}
                    className="h-9 w-full rounded-lg border border-slate-600 bg-slate-900/80 px-2.5 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
                  >
                    <option value="all">All Courses</option>
                    {courseFilterOptions.map((course) => (
                      <option key={course} value={course}>
                        {course}
                      </option>
                    ))}
                  </select>
                  <select
                    value={selectedProgramFilter}
                    onChange={(e) => setSelectedProgramFilter(e.target.value)}
                    className="h-9 w-full rounded-lg border border-slate-600 bg-slate-900/80 px-2.5 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
                  >
                    <option value="all">All Programs</option>
                    {programFilterOptions.map((program) => (
                      <option key={program} value={program}>
                        {program}
                      </option>
                    ))}
                  </select>
                  <select
                    value={selectedBatchTypeFilter}
                    onChange={(e) => setSelectedBatchTypeFilter(e.target.value)}
                    className="h-9 w-full rounded-lg border border-slate-600 bg-slate-900/80 px-2.5 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
                  >
                    <option value="all">All Batch Types</option>
                    {batchTypeFilterOptions.map((batchType) => (
                      <option key={batchType} value={batchType}>
                        {batchType}
                      </option>
                    ))}
                  </select>
                </>
              ) : null}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
                className="h-9 w-full rounded-lg border border-slate-600 bg-slate-900/80 px-2.5 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="all">All Status</option>
                <option value="active">Active Only</option>
                <option value="inactive">Inactive Only</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  setSearchTerm('');
                  setSelectedBatchFilter('all');
                  setSelectedCourseFilter('all');
                  setSelectedProgramFilter('all');
                  setSelectedBatchTypeFilter('all');
                  setStatusFilter('all');
                }}
                className="flex h-9 items-center justify-center gap-2 rounded-xl border border-slate-600 bg-transparent px-2.5 py-1.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700/70"
              >
                <X size={18} />
                Reset Filters
              </button>
              <button
                type="button"
                onClick={handleAutoSequence}
                disabled={reorderLoading || batches.length <= 1}
                className="flex h-9 items-center justify-center gap-2 rounded-xl border border-slate-600 bg-slate-900/80 px-2.5 py-1.5 text-sm font-medium text-white transition-colors hover:border-slate-500 hover:bg-slate-700/80 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <ListOrdered size={18} />
                {reorderLoading ? 'Saving Sequence...' : 'Auto Sequence'}
              </button>
            </div>
          </div>
        </div>

        {/* Batches Table */}
        {loading ? (
          <div className="text-center py-12">
            <p className="text-slate-300">Loading batches...</p>
          </div>
        ) : filteredBatches.length === 0 ? (
          <div className="text-center py-12 bg-slate-700/50 rounded-lg">
            <p className="text-slate-300">
              {batches.length === 0
                ? selectedCategory === 'class'
                  ? 'No classes found. Create your first class!'
                  : 'No batches found. Create your first batch!'
                : selectedCategory === 'class'
                  ? 'No classes match the current search/filter.'
                  : 'No batches match the current search/filter.'}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg bg-slate-700/50">
            <div className="max-h-[68vh] overflow-auto">
              <table className="w-full min-w-[980px]">
              <thead className="sticky top-0 z-10 bg-slate-600 shadow-sm">
                <tr>
                  <th className="px-6 py-3 text-left text-white font-semibold">Seq</th>
                  <th className="px-6 py-3 text-left text-white font-semibold">{selectedCategory === 'class' ? 'Class Name' : 'Batch Name'}</th>
                  <th className="px-6 py-3 text-left text-white font-semibold">Course</th>
                  <th className="px-6 py-3 text-left text-white font-semibold">Stream</th>
                  <th className="px-6 py-3 text-left text-white font-semibold">{selectedCategory === 'class' ? 'Type' : 'Batch Type'}</th>
                  <th className="px-6 py-3 text-left text-white font-semibold">Students</th>
                  <th className="px-6 py-3 text-left text-white font-semibold">Status</th>
                  <th className="px-6 py-3 text-left text-white font-semibold">Created</th>
                  <th className="px-6 py-3 text-left text-white font-semibold">Sequence</th>
                  <th className="px-6 py-3 text-left text-white font-semibold">Actions</th>
                </tr>
              </thead>
                <tbody>
                  {filteredBatches.map((batch) => {
                    const meta = parseBatchMeta(batch);
                    const actualIndex = batches.findIndex((item) => item.id === batch.id);
                    return (
                    <tr key={batch.id} className="border-t border-slate-600 hover:bg-slate-600/50 transition-colors">
                      <td className="px-6 py-4 text-slate-300">{(batch.display_order || actualIndex + 1 || 0)}</td>
                      <td className="px-6 py-4 text-white font-medium">
                        <button
                          type="button"
                          onClick={() => openStudentsModal(batch)}
                          className="text-left text-white transition hover:text-blue-300 hover:underline"
                          title={`${batch.name} ke students dekhein`}
                        >
                          {batch.name}
                        </button>
                        {selectedCategory === 'batch' && batch.syllabus ? <div className="mt-1 text-xs text-slate-400">{batch.syllabus}</div> : null}
                      </td>
                      <td className="px-6 py-4 text-slate-300">{selectedCategory === 'class' ? '-' : meta.course}</td>
                      <td className="px-6 py-4 text-slate-300">{selectedCategory === 'class' ? '-' : meta.stream}</td>
                      <td className="px-6 py-4 text-slate-300">{selectedCategory === 'class' ? 'Class' : meta.batchType}</td>
                      <td className="px-6 py-4 text-slate-300">{batch.student_count || 0}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-3 py-1 rounded-full text-sm font-medium ${
                            batch.is_active
                              ? 'bg-green-500/20 text-green-200'
                              : 'bg-gray-500/20 text-gray-200'
                          }`}
                        >
                          {batch.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-300">
                        {new Date(batch.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleMoveBatch(batch.id, 'up')}
                            disabled={reorderLoading || actualIndex <= 0}
                            className="rounded p-2 text-slate-300 transition-colors hover:bg-slate-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                            title="Move up"
                          >
                            <ArrowUp size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveBatch(batch.id, 'down')}
                            disabled={reorderLoading || actualIndex === -1 || actualIndex >= batches.length - 1}
                            className="rounded p-2 text-slate-300 transition-colors hover:bg-slate-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                            title="Move down"
                          >
                            <ArrowDown size={16} />
                          </button>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex gap-2">
                          <button
                            onClick={() => openEditModal(batch)}
                            className="p-2 text-slate-300 hover:text-white hover:bg-slate-600 rounded transition-colors"
                            title="Edit batch"
                          >
                            <Pencil size={18} />
                          </button>
                          <button
                            onClick={() => openDeleteModal(batch)}
                            className="p-2 text-red-300 hover:text-red-100 hover:bg-red-900/30 rounded transition-colors"
                            title="Delete batch"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Add Batch Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-700 rounded-lg p-6 max-w-md w-full">
            <h2 className="text-xl font-bold text-white mb-4">{selectedCategory === 'class' ? 'Add New Class' : 'Add New Batch'}</h2>
            <form onSubmit={handleAddBatch}>
              {selectedCategory === 'batch' ? (
              <div className="mb-4 grid gap-4 md:grid-cols-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-2">Course</label>
                  <select
                    value={formData.course}
                    onChange={(e) => handleStructuredMetaChange({ course: e.target.value as BatchCourse })}
                    className="w-full px-4 py-2 bg-slate-600 text-white rounded border border-slate-500 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Select course</option>
                    <option value="NEET">NEET</option>
                    <option value="JEE-MAIN">JEE-MAIN</option>
                    <option value="ADVANCE">ADVANCE</option>
                    <option value="S.S.B">S.S.B</option>
                    <option value="General">General</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-2">Program</label>
                  <select
                    value={formData.program}
                    onChange={(e) => handleStructuredMetaChange({ program: e.target.value as BatchProgram })}
                    className="w-full px-4 py-2 bg-slate-600 text-white rounded border border-slate-500 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Select program</option>
                    <option value="Medical">Medical</option>
                    <option value="Non Medical">Non Medical</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-2">Batch Type</label>
                  <select
                    value={formData.batchType}
                    onChange={(e) => handleStructuredMetaChange({ batchType: e.target.value as BatchTypeValue })}
                    className="w-full px-4 py-2 bg-slate-600 text-white rounded border border-slate-500 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Select type</option>
                    <option value="Dropper">Dropper</option>
                    <option value="11th">11th</option>
                    <option value="12th">12th</option>
                    <option value="Regular">Regular</option>
                  </select>
                </div>
              </div>
              ) : null}
              <div className="mb-4">
                <label className="block text-slate-300 font-medium mb-2">{selectedCategory === 'class' ? 'Class Name' : 'Batch Name'}</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => handleBatchNameChange(e.target.value)}
                  placeholder={selectedCategory === 'class' ? 'e.g., 6th, 7th, 8th, 9th, 10th' : 'e.g., Dropper Medical Alpha, 11th Non Medical Advance, 12th Medical SSB'}
                  className="w-full px-4 py-2 bg-slate-600 text-white rounded border border-slate-500 focus:border-blue-500 focus:outline-none"
                />
                {selectedCategory === 'batch' && !streamManuallyChanged && detectStreamFromBatchName(formData.name) ? (
                  <p className="mt-2 text-xs text-emerald-300">
                    Auto-detected stream: {detectStreamFromBatchName(formData.name)}
                  </p>
                ) : null}
              </div>
              {selectedCategory === 'batch' ? (
              <div className="mb-4">
                <label className="block text-slate-300 font-medium mb-2">Program / Course Metadata</label>
                <input
                  type="text"
                  value={formData.syllabus}
                  onChange={(e) => handleStreamChange(e.target.value)}
                  placeholder="e.g., Medical | NEET | Dropper"
                  className="w-full px-4 py-2 bg-slate-600 text-white rounded border border-slate-500 focus:border-blue-500 focus:outline-none"
                />
                <p className="mt-2 text-xs text-slate-400">
                  Course, program aur type select karoge to name aur metadata auto-fill ho jayega. Zarurat ho to manually bhi edit kar sakte ho.
                </p>
              </div>
              ) : null}
              <div className="mb-6 flex items-center">
                <input
                  type="checkbox"
                  id="add_is_active"
                  checked={formData.is_active}
                  onChange={(e) => setFormState((current) => ({ ...current, is_active: e.target.checked }))}
                  className="w-4 h-4 rounded"
                />
                <label htmlFor="add_is_active" className="ml-2 text-slate-300">
                  Active
                </label>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    resetForm();
                  }}
                  className="flex-1 px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                >
                  {selectedCategory === 'class' ? 'Add Class' : 'Add Batch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Batch Modal */}
      {showEditModal && selectedBatch && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-700 rounded-lg p-6 max-w-md w-full">
            <h2 className="text-xl font-bold text-white mb-4">{selectedCategory === 'class' ? 'Edit Class' : 'Edit Batch'}</h2>
            <form onSubmit={handleUpdateBatch}>
              {selectedCategory === 'batch' ? (
              <div className="mb-4 grid gap-4 md:grid-cols-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-2">Course</label>
                  <select
                    value={formData.course}
                    onChange={(e) => handleStructuredMetaChange({ course: e.target.value as BatchCourse })}
                    className="w-full px-4 py-2 bg-slate-600 text-white rounded border border-slate-500 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Select course</option>
                    <option value="NEET">NEET</option>
                    <option value="JEE-MAIN">JEE-MAIN</option>
                    <option value="ADVANCE">ADVANCE</option>
                    <option value="S.S.B">S.S.B</option>
                    <option value="General">General</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-2">Program</label>
                  <select
                    value={formData.program}
                    onChange={(e) => handleStructuredMetaChange({ program: e.target.value as BatchProgram })}
                    className="w-full px-4 py-2 bg-slate-600 text-white rounded border border-slate-500 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Select program</option>
                    <option value="Medical">Medical</option>
                    <option value="Non Medical">Non Medical</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-2">Batch Type</label>
                  <select
                    value={formData.batchType}
                    onChange={(e) => handleStructuredMetaChange({ batchType: e.target.value as BatchTypeValue })}
                    className="w-full px-4 py-2 bg-slate-600 text-white rounded border border-slate-500 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Select type</option>
                    <option value="Dropper">Dropper</option>
                    <option value="11th">11th</option>
                    <option value="12th">12th</option>
                    <option value="Regular">Regular</option>
                  </select>
                </div>
              </div>
              ) : null}
              <div className="mb-4">
                <label className="block text-slate-300 font-medium mb-2">{selectedCategory === 'class' ? 'Class Name' : 'Batch Name'}</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => handleBatchNameChange(e.target.value)}
                  placeholder={selectedCategory === 'class' ? 'e.g., 6th, 7th, 8th, 9th, 10th' : 'e.g., Dropper Medical Alpha, 11th Non Medical Advance, 12th Medical SSB'}
                  className="w-full px-4 py-2 bg-slate-600 text-white rounded border border-slate-500 focus:border-blue-500 focus:outline-none"
                />
                {selectedCategory === 'batch' && !streamManuallyChanged && detectStreamFromBatchName(formData.name) ? (
                  <p className="mt-2 text-xs text-emerald-300">
                    Auto-detected stream: {detectStreamFromBatchName(formData.name)}
                  </p>
                ) : null}
              </div>
              {selectedCategory === 'batch' ? (
              <div className="mb-4">
                <label className="block text-slate-300 font-medium mb-2">Program / Course Metadata</label>
                <input
                  type="text"
                  value={formData.syllabus}
                  onChange={(e) => handleStreamChange(e.target.value)}
                  placeholder="e.g., Medical | NEET | Dropper"
                  className="w-full px-4 py-2 bg-slate-600 text-white rounded border border-slate-500 focus:border-blue-500 focus:outline-none"
                />
                <p className="mt-2 text-xs text-slate-400">
                  Structured fields se batch naming aur metadata dono sync ho jayenge. Zarurat ho to manually correct kar sakte ho.
                </p>
              </div>
              ) : null}
              <div className="mb-6 flex items-center">
                <input
                  type="checkbox"
                  id="edit_is_active"
                  checked={formData.is_active}
                  onChange={(e) => setFormState((current) => ({ ...current, is_active: e.target.checked }))}
                  className="w-4 h-4 rounded"
                />
                <label htmlFor="edit_is_active" className="ml-2 text-slate-300">
                  Active
                </label>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditModal(false);
                    setSelectedBatch(null);
                    resetForm();
                  }}
                  className="flex-1 px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                >
                  Update
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && selectedBatch && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-700 rounded-lg p-6 max-w-md w-full">
            <h2 className="text-xl font-bold text-white mb-4">{selectedCategory === 'class' ? 'Delete Class?' : 'Delete Batch?'}</h2>
            {deleteError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/50 rounded text-red-300 text-sm">
                {deleteError}
              </div>
            )}
            {!deleteError && (
              <>
                <p className="text-slate-300 mb-4">
                  Are you sure you want to delete "{selectedBatch.name}"?
                </p>
                {selectedBatch.student_count! > 0 && (
                  <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/50 rounded text-yellow-300 text-sm">
                    This {selectedCategory === 'class' ? 'class' : 'batch'} contains {selectedBatch.student_count} student(s). Please reassign them before deleting.
                  </div>
                )}
              </>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setSelectedBatch(null);
                  resetForm();
                }}
                className="flex-1 px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteBatch}
                disabled={selectedBatch.student_count! > 0}
                className={`flex-1 px-4 py-2 rounded transition-colors ${
                  selectedBatch.student_count! > 0
                    ? 'bg-red-900/30 text-red-300 cursor-not-allowed'
                    : 'bg-red-600 hover:bg-red-700 text-white'
                }`}
              >
                {selectedBatch.student_count! > 0 ? 'Cannot Delete' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showStudentsModal && studentOverlayBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[85vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-slate-800 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-700 px-6 py-5">
              <div>
                <h2 className="text-2xl font-bold text-white">{studentOverlayBatch.name}</h2>
                <p className="mt-1 text-sm text-slate-300">
                  Is {selectedCategory === 'class' ? 'class' : 'batch'} ke students overlay mein yahan show ho rahe hain.
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  Total shown: {batchStudents.length}
                  {studentOverlayBatch.student_count != null ? ` / ${studentOverlayBatch.student_count}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={closeStudentsModal}
                className="rounded-full p-2 text-slate-300 transition hover:bg-slate-700 hover:text-white"
                title="Close"
              >
                <X size={20} />
              </button>
            </div>

            <div className="max-h-[calc(85vh-104px)] overflow-auto px-6 py-5">
              {studentsLoading ? (
                <div className="rounded-xl border border-slate-700 bg-slate-900/40 px-4 py-10 text-center text-slate-300">
                  Loading students...
                </div>
              ) : studentsError ? (
                <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-4 text-sm text-red-200">
                  {studentsError}
                </div>
              ) : batchStudents.length === 0 ? (
                <div className="rounded-xl border border-slate-700 bg-slate-900/40 px-4 py-10 text-center text-slate-300">
                  Is {selectedCategory === 'class' ? 'class' : 'batch'} mein abhi koi student available nahi hai.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-700">
                  <table className="w-full min-w-[900px]">
                    <thead className="bg-slate-700/80">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-white">Roll No</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-white">Student Name</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-white">Father Name</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-white">Class / Section</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-white">Phone</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-white">Email</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-white">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchStudents.map((student) => (
                        <tr key={student.id} className="border-t border-slate-700 bg-slate-800/80">
                          <td className="px-4 py-3 text-sm text-slate-200">{student.roll_number || '-'}</td>
                          <td className="px-4 py-3 text-sm font-medium text-white">{student.name || '-'}</td>
                          <td className="px-4 py-3 text-sm text-slate-300">{student.father_name || '-'}</td>
                          <td className="px-4 py-3 text-sm text-slate-300">{[student.class_name, student.section].filter(Boolean).join(' | ') || '-'}</td>
                          <td className="px-4 py-3 text-sm text-slate-300">{student.phone || '-'}</td>
                          <td className="px-4 py-3 text-sm text-slate-300">{student.email || '-'}</td>
                          <td className="px-4 py-3 text-sm text-slate-300">
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-medium ${
                                student.is_active
                                  ? 'bg-emerald-500/20 text-emerald-200'
                                  : 'bg-slate-500/20 text-slate-200'
                              }`}
                            >
                              {student.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BatchManagement;
