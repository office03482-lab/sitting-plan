import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  BookOpen,
  Boxes,
  Download,
  FileText,
  History,
  PackagePlus,
  Send,
  Truck,
  Package,
  X,
} from 'lucide-react';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { apiService } from '@services/api';
import { useAuth } from '@/contexts/AuthProvider';
import { useAuthStore } from '@store/auth';
import { useRefDataStore } from '@store/referenceData';
import type {
  Batch,
  InventoryCatalogSubject,
  InventoryDashboard,
  InventoryHistoryEntry,
  InventoryReportResponse,
  InventorySet,
  InventoryMaterialImportResponse,
  InventorySubject,
  InventoryVolume,
  MaterialItem,
  MaterialUnitType,
  Student,
  StockInEntry,
  StockInType,
  StockOutEntry,
  StudentIssueEntry,
  Supplier,
} from '@types';

type TabKey = 'dashboard' | 'materials' | 'suppliers' | 'stock-in' | 'stock-out' | 'reports';
type MasterTabKey = 'subjects' | 'sets' | 'volumes';

type MaterialFormState = {
  name: string;
  subject_id: string;
  set_id: string;
  volume_id: string;
  batch_names: string[];
  description: string;
  unit_type: MaterialUnitType;
  low_stock_threshold: number;
  is_active: boolean;
};

type SubjectFormState = {
  name: string;
  is_active: boolean;
};

type SetFormState = {
  subject_id: string;
  name: string;
  is_active: boolean;
};

type VolumeFormState = {
  subject_id: string;
  set_id: string;
  volume_number: string;
  is_active: boolean;
};

const initialMaterialForm: MaterialFormState = {
  name: '',
  subject_id: '',
  set_id: '',
  volume_id: '',
  batch_names: [],
  description: '',
  unit_type: 'book',
  low_stock_threshold: 10,
  is_active: true,
};

const initialSubjectForm: SubjectFormState = {
  name: '',
  is_active: true,
};

const initialSetForm: SetFormState = {
  subject_id: '',
  name: '',
  is_active: true,
};

const initialVolumeForm: VolumeFormState = {
  subject_id: '',
  set_id: '',
  volume_number: '',
  is_active: true,
};

const initialSupplierForm = {
  name: '',
  contact_person: '',
  phone: '',
  email: '',
  address: '',
  is_active: true,
};

const initialStockInForm = {
  date: new Date().toISOString().slice(0, 10),
  supplier_id: '',
  material_id: '',
  quantity_received: 1,
  entry_type: 'purchase' as StockInType,
  added_by: '',
  notes: '',
};

const initialStockOutForm = {
  date: new Date().toISOString().slice(0, 10),
  batch_ids: [] as string[],
  material_ids: [] as string[],
  quantity_issued: 1,
  issued_by: '',
  remarks: '',
};

const initialStudentIssueForm = {
  date: new Date().toISOString().slice(0, 10),
  batch_id: '',
  student_ids: [] as string[],
  material_ids: [] as string[],
  quantity_issued: 1,
  issued_by: '',
  remarks: '',
};

const initialReportFilters = {
  report_type: 'current_inventory',
  date_from: '',
  date_to: '',
  supplier_id: '',
  batch_id: '',
  student_id: '',
  material_id: '',
};

const unitTypeOptions: MaterialUnitType[] = ['book', 'notebook', 'material', 'other'];
const reportTypeOptions = [
  { value: 'stock_in', label: 'Stock In Report' },
  { value: 'batch_distribution', label: 'Batch Distribution Report' },
  { value: 'current_inventory', label: 'Current Inventory Report' },
  { value: 'low_stock', label: 'Low Stock Report' },
];

const primaryButtonClass = 'rounded-xl bg-gradient-to-r from-slate-800 to-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:from-slate-900 hover:to-black disabled:cursor-not-allowed disabled:bg-slate-300 disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none';
const successButtonClass = 'rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:from-emerald-600 hover:to-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none';
const infoButtonClass = 'rounded-lg bg-gradient-to-r from-blue-500 to-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:from-blue-600 hover:to-blue-700';
const warningButtonClass = 'rounded-lg bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-800 transition hover:bg-amber-200';
const dangerButtonClass = 'rounded-lg bg-rose-100 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-200';

const inventoryRequestLabels: Record<string, string> = {
  dashboard: 'dashboard',
  materials: 'materials',
  suppliers: 'suppliers',
  stockIn: 'stock-in',
  stockOut: 'stock-out',
  studentIssues: 'student-issues',
  batches: 'batches',
  students: 'students',
  subjects: 'subjects',
  sets: 'sets',
  volumes: 'volumes',
  catalog: 'catalog',
};

function OverlayPanel({
  open,
  title,
  description,
  onClose,
  children,
  mode = 'drawer',
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  mode?: 'drawer' | 'modal';
}) {
  if (!open) return null;

  const alignmentClass =
    mode === 'drawer'
      ? 'ml-auto flex h-full w-full max-w-2xl flex-col overflow-hidden bg-white shadow-2xl'
      : 'flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-[1.75rem] bg-white shadow-2xl';

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/55 p-4 backdrop-blur-sm">
      <div className={`flex h-full ${mode === 'drawer' ? 'justify-end' : 'items-center justify-center'}`}>
        <button type="button" aria-label="Close panel overlay" onClick={onClose} className="absolute inset-0 cursor-default" />
        <div className={`relative ${alignmentClass}`}>
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
            <div>
              <h3 className="text-xl font-bold text-slate-900">{title}</h3>
              {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        </div>
      </div>
    </div>
  );
}

const inventoryFeatureCards: Array<{
  key: TabKey;
  title: string;
  description: string;
  icon: typeof BookOpen;
  color: 'amber' | 'blue' | 'emerald' | 'slate' | 'red' | 'indigo';
}> = [
  {
    key: 'dashboard',
    title: 'Inventory Dashboard',
    description: 'Watch stock health, recent movements, and low stock alerts.',
    icon: Boxes,
    color: 'indigo',
  },
  {
    key: 'materials',
    title: 'Material Master',
    description: 'Manage categorized subjects, sets, volumes, and materials.',
    icon: BookOpen,
    color: 'amber',
  },
  {
    key: 'suppliers',
    title: 'Suppliers',
    description: 'Maintain supplier records for purchases and stock receipts.',
    icon: Truck,
    color: 'blue',
  },
  {
    key: 'stock-in',
    title: 'Stock In',
    description: 'Record purchased or incoming material quantities quickly.',
    icon: PackagePlus,
    color: 'emerald',
  },
  {
    key: 'stock-out',
    title: 'Batch Distribution',
    description: 'Issue books and materials to linked student batches.',
    icon: Send,
    color: 'red',
  },
  {
    key: 'reports',
    title: 'Reports & Export',
    description: 'Run inventory reports and export them to Excel or PDF.',
    icon: FileText,
    color: 'slate',
  },
];

export default function InventoryManagement() {
  const navigate = useNavigate();
  const location = useLocation();
  const { authReady, sessionReady, schoolContextReady, session } = useAuth();
  const canRunRequests = authReady && sessionReady && schoolContextReady && !!session;
  const user = useAuthStore((state) => state.user);
  const currentSchoolId = user?.school_id;
  const canManageInventory = user?.role === 'admin' || user?.role === 'store_manager';

  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [alert, setAlert] = useState<{ type: 'success' | 'error' | 'warning' | 'info'; message: string } | null>(null);

  const [dashboard, setDashboard] = useState<InventoryDashboard | null>(null);
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [stockInEntries, setStockInEntries] = useState<StockInEntry[]>([]);
  const [stockOutEntries, setStockOutEntries] = useState<StockOutEntry[]>([]);
  const [studentIssueEntries, setStudentIssueEntries] = useState<StudentIssueEntry[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [reportData, setReportData] = useState<InventoryReportResponse | null>(null);
  const [historyEntries, setHistoryEntries] = useState<InventoryHistoryEntry[]>([]);
  const [historyMaterialId, setHistoryMaterialId] = useState<string | number | null>(null);
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | number | null>(null);

  const [inventorySubjects, setInventorySubjects] = useState<InventorySubject[]>([]);
  const [inventorySets, setInventorySets] = useState<InventorySet[]>([]);
  const [inventoryVolumes, setInventoryVolumes] = useState<InventoryVolume[]>([]);
  const [catalog, setCatalog] = useState<InventoryCatalogSubject[]>([]);

  const [materialSearch, setMaterialSearch] = useState('');
  const [materialSubjectFilter, setMaterialSubjectFilter] = useState('');
  const [materialBatchFilter, setMaterialBatchFilter] = useState('');
  const [selectedCatalogSubjectId, setSelectedCatalogSubjectId] = useState<string | number | null>(null);
  const [selectedCatalogSetId, setSelectedCatalogSetId] = useState<string | number | null>(null);
  const [materialForm, setMaterialForm] = useState<MaterialFormState>(initialMaterialForm);
  const [editingMaterialId, setEditingMaterialId] = useState<string | number | null>(null);
  const [materialImportFile, setMaterialImportFile] = useState<File | null>(null);
  const [materialImporting, setMaterialImporting] = useState(false);
  const [materialImportResult, setMaterialImportResult] = useState<InventoryMaterialImportResponse | null>(null);

  const [subjectForm, setSubjectForm] = useState<SubjectFormState>(initialSubjectForm);
  const [editingSubjectId, setEditingSubjectId] = useState<string | number | null>(null);
  const [setForm, setSetForm] = useState<SetFormState>(initialSetForm);
  const [editingSetId, setEditingSetId] = useState<string | number | null>(null);
  const [volumeForm, setVolumeForm] = useState<VolumeFormState>(initialVolumeForm);
  const [editingVolumeId, setEditingVolumeId] = useState<string | number | null>(null);

  const [supplierForm, setSupplierForm] = useState(initialSupplierForm);
  const [editingSupplierId, setEditingSupplierId] = useState<string | number | null>(null);

  const [stockInForm, setStockInForm] = useState(initialStockInForm);
  const [stockOutForm, setStockOutForm] = useState(initialStockOutForm);
  const [studentIssueForm, setStudentIssueForm] = useState(initialStudentIssueForm);
  const [reportFilters, setReportFilters] = useState(initialReportFilters);
  const [activeMasterTab, setActiveMasterTab] = useState<MasterTabKey>('subjects');
  const [activeMaterialOverlay, setActiveMaterialOverlay] = useState<null | 'material' | 'upload' | 'history'>(null);
  const [distributionMode, setDistributionMode] = useState<'batch' | 'student'>('batch');
  const [selectedStudentIssueDetail, setSelectedStudentIssueDetail] = useState<any | null>(null);
  const [loadedTabs, setLoadedTabs] = useState<Record<TabKey, boolean>>({
    dashboard: false,
    materials: false,
    suppliers: false,
    'stock-in': false,
    'stock-out': false,
    reports: false,
  });

  useEffect(() => {
    const hash = location.hash.toLowerCase();

    switch (hash) {
      case '#materials':
        setActiveTab('materials');
        break;
      case '#materials-subjects':
        setActiveTab('materials');
        setActiveMasterTab('subjects');
        break;
      case '#materials-sets':
        setActiveTab('materials');
        setActiveMasterTab('sets');
        break;
      case '#materials-volumes':
        setActiveTab('materials');
        setActiveMasterTab('volumes');
        break;
      case '#suppliers':
        setActiveTab('suppliers');
        break;
      case '#stock-in':
        setActiveTab('stock-in');
        break;
      case '#stock-out':
        setActiveTab('stock-out');
        break;
      case '#reports':
        setActiveTab('reports');
        break;
      case '#dashboard':
      case '':
        setActiveTab('dashboard');
        break;
      default:
        setActiveTab('dashboard');
        break;
    }
  }, [location.hash]);

  useEffect(() => {
    if (!canRunRequests) return;
    void loadInventoryData(true, 'dashboard', true);
  }, [canRunRequests]);

  useEffect(() => {
    const normalizedHash = location.hash.replace(/^#/, '').trim().toLowerCase();
    if (!normalizedHash) return;

    const tabMap: Record<string, TabKey> = {
      dashboard: 'dashboard',
      materials: 'materials',
      'materials-subjects': 'materials',
      'materials-sets': 'materials',
      'materials-volumes': 'materials',
      suppliers: 'suppliers',
      'stock-in': 'stock-in',
      'stock-out': 'stock-out',
      reports: 'reports',
    };

    const masterMap: Record<string, MasterTabKey> = {
      'materials-subjects': 'subjects',
      'materials-sets': 'sets',
      'materials-volumes': 'volumes',
    };

    const nextTab = tabMap[normalizedHash];
    if (nextTab) {
      setActiveTab(nextTab);
    }

    const nextMaster = masterMap[normalizedHash];
    if (nextMaster) {
      setActiveMasterTab(nextMaster);
    }
  }, [location.hash]);

  useEffect(() => {
    if (!canRunRequests) return;
    if (!loadedTabs[activeTab]) {
      void loadInventoryData(false, activeTab, true);
    }
  }, [activeTab, canRunRequests, loadedTabs]);

  const getApiErrorMessage = (error: any, fallback: string) =>
    error?.response?.data?.detail ||
    error?.response?.data?.error ||
    error?.details ||
    error?.hint ||
    error?.message ||
    fallback;

  const sameId = (left: string | number | null | undefined, right: string | number | null | undefined) =>
    String(left ?? '') === String(right ?? '');

  const buildInventoryFailureMessage = (failedEntries: Array<{ key: string; reason: any }>) => {
    if (!failedEntries.length) {
      return 'Failed to load inventory module data.';
    }

    const failedLabels = failedEntries
      .map((entry) => inventoryRequestLabels[entry.key] || entry.key)
      .filter(Boolean);
    const primaryFailure = failedEntries[0];
    const reason = getApiErrorMessage(primaryFailure.reason, 'Unknown error');
    const normalizedReason = String(reason || '');
    const lowerReason = normalizedReason.toLowerCase();

    if (
      lowerReason.includes('406') ||
      lowerReason.includes('not acceptable') ||
      lowerReason.includes('schema') ||
      lowerReason.includes('relation') ||
      lowerReason.includes('column')
    ) {
      return `Inventory schema/data issue detected. Failed: ${failedLabels.join(', ')}. ${normalizedReason}`;
    }

    if (
      lowerReason.includes('row-level security') ||
      lowerReason.includes('permission denied') ||
      lowerReason.includes('policy')
    ) {
      return `Inventory permission issue detected. Failed: ${failedLabels.join(', ')}. ${normalizedReason}`;
    }

    return `Failed to load inventory module data (${failedLabels.join(', ')}). ${normalizedReason}`;
  };

  const loadInventoryData = async (initial = false, targetTab: TabKey = activeTab, force = false) => {
    if (!canRunRequests) {
      return;
    }
    try {
      initial ? setLoading(true) : setRefreshing(true);
      const requests: Array<{ key: string; request: Promise<any> }> = [];
      const requestKeys = new Set<string>();
      const addRequest = (key: string, request: Promise<any>) => {
        if (!requestKeys.has(key)) {
          requestKeys.add(key);
          requests.push({ key, request });
        }
      };

      addRequest('dashboard', apiService.getInventoryDashboard());

      if (targetTab === 'dashboard') {
        addRequest('stockIn', apiService.listStockIn({ school_id: currentSchoolId }));
        addRequest('stockOut', apiService.listStockOut({ school_id: currentSchoolId }));
        addRequest('studentIssues', apiService.listStudentIssues({ school_id: currentSchoolId }));
      }

      if (targetTab === 'materials') {
        addRequest('materials', apiService.listMaterials({ school_id: currentSchoolId }));
        addRequest('subjects', apiService.listInventorySubjects({ school_id: currentSchoolId }));
        addRequest('sets', apiService.listInventorySets({ school_id: currentSchoolId }));
        addRequest('volumes', apiService.listInventoryVolumes({ school_id: currentSchoolId }));
        addRequest('catalog', apiService.getInventoryCatalog({ school_id: currentSchoolId, include_inactive: true }));
        addRequest('batches', useRefDataStore.getState().getBatches(currentSchoolId).then((d) => ({ data: d })));
        addRequest('students', useRefDataStore.getState().getStudents(currentSchoolId).then((d) => ({ data: d })));
      }

      if (targetTab === 'suppliers') {
        addRequest('suppliers', apiService.listSuppliers({ school_id: currentSchoolId }));
        addRequest('stockIn', apiService.listStockIn({ school_id: currentSchoolId }));
      }

      if (targetTab === 'stock-in') {
        addRequest('materials', apiService.listMaterials({ school_id: currentSchoolId }));
        addRequest('suppliers', apiService.listSuppliers({ school_id: currentSchoolId }));
        addRequest('stockIn', apiService.listStockIn({ school_id: currentSchoolId }));
      }

      if (targetTab === 'stock-out') {
        addRequest('materials', apiService.listMaterials({ school_id: currentSchoolId }));
        addRequest('stockOut', apiService.listStockOut({ school_id: currentSchoolId }));
        addRequest('studentIssues', apiService.listStudentIssues({ school_id: currentSchoolId }));
        addRequest('batches', useRefDataStore.getState().getBatches(currentSchoolId).then((d) => ({ data: d })));
        addRequest('students', useRefDataStore.getState().getStudents(currentSchoolId).then((d) => ({ data: d })));
      }

      if (targetTab === 'reports') {
        addRequest('materials', apiService.listMaterials({ school_id: currentSchoolId }));
        addRequest('suppliers', apiService.listSuppliers({ school_id: currentSchoolId }));
        addRequest('batches', useRefDataStore.getState().getBatches(currentSchoolId).then((d) => ({ data: d })));
        addRequest('students', useRefDataStore.getState().getStudents(currentSchoolId).then((d) => ({ data: d })));
      }

      const results = await Promise.allSettled(requests.map((entry) => entry.request));
      const failures = results
        .map((result, index) =>
          result.status === 'rejected'
            ? { key: requests[index]?.key || `request_${index}`, reason: result.reason }
            : null
        )
        .filter(Boolean) as Array<{ key: string; reason: any }>;
      if (failures.length === results.length && requests.length > 0) {
        throw new Error(buildInventoryFailureMessage(failures));
      }

      const resultMap = new Map<string, PromiseSettledResult<any>>();
      requests.forEach((entry, index) => resultMap.set(entry.key, results[index]));

      const dashboardRes = resultMap.get('dashboard');
      if (dashboardRes?.status === 'fulfilled') setDashboard(dashboardRes.value.data);

      const materialsRes = resultMap.get('materials');
      if (materialsRes?.status === 'fulfilled') setMaterials(materialsRes.value.data);

      const suppliersRes = resultMap.get('suppliers');
      if (suppliersRes?.status === 'fulfilled') setSuppliers(suppliersRes.value.data);

      const stockInRes = resultMap.get('stockIn');
      if (stockInRes?.status === 'fulfilled') setStockInEntries(stockInRes.value.data);

      const stockOutRes = resultMap.get('stockOut');
      if (stockOutRes?.status === 'fulfilled') setStockOutEntries(stockOutRes.value.data);

      const studentIssuesRes = resultMap.get('studentIssues');
      if (studentIssuesRes?.status === 'fulfilled') setStudentIssueEntries(studentIssuesRes.value.data);

      const batchesRes = resultMap.get('batches');
      if (batchesRes?.status === 'fulfilled') setBatches(batchesRes.value.data);

      const studentsRes = resultMap.get('students');
      if (studentsRes?.status === 'fulfilled') setStudents(studentsRes.value.data);

      const subjectsRes = resultMap.get('subjects');
      if (subjectsRes?.status === 'fulfilled') setInventorySubjects(subjectsRes.value.data);

      const setsRes = resultMap.get('sets');
      if (setsRes?.status === 'fulfilled') setInventorySets(setsRes.value.data);

      const volumesRes = resultMap.get('volumes');
      if (volumesRes?.status === 'fulfilled') setInventoryVolumes(volumesRes.value.data);

      const catalogRes = resultMap.get('catalog');
      if (catalogRes?.status === 'fulfilled') setCatalog(catalogRes.value.data);

      if (force || !loadedTabs[targetTab]) {
        setLoadedTabs((current) => ({ ...current, [targetTab]: true }));
      }

      if (failures.length > 0) {
        setAlert({
          type: 'warning',
          message: `Inventory loaded partially. Failed sections: ${failures
            .map((entry) => inventoryRequestLabels[entry.key] || entry.key)
            .join(', ')}.`,
        });
      }
    } catch (error) {
      console.error('Failed to load inventory data:', error);
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Failed to load inventory module data.') });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const refreshMaterials = async () => {
    const results = await Promise.allSettled([
      apiService.getInventoryDashboard(),
      apiService.listMaterials({
        school_id: currentSchoolId,
        search: materialSearch || undefined,
        subject: materialSubjectFilter || undefined,
        batch_name: materialBatchFilter || undefined,
      }),
      apiService.listStockIn({ school_id: currentSchoolId }),
      apiService.listStockOut({ school_id: currentSchoolId }),
      apiService.listStudentIssues({ school_id: currentSchoolId }),
      apiService.listInventorySubjects({ school_id: currentSchoolId }),
      apiService.listInventorySets({ school_id: currentSchoolId }),
      apiService.listInventoryVolumes({ school_id: currentSchoolId }),
      apiService.getInventoryCatalog({ school_id: currentSchoolId, include_inactive: true }),
    ]);

    const [dashboardRes, materialsRes, stockInRes, stockOutRes, studentIssuesRes, subjectsRes, setsRes, volumesRes, catalogRes] = results;

    if (dashboardRes.status === 'fulfilled') setDashboard(dashboardRes.value.data);
    if (materialsRes.status === 'fulfilled') setMaterials(materialsRes.value.data);
    if (stockInRes.status === 'fulfilled') setStockInEntries(stockInRes.value.data);
    if (stockOutRes.status === 'fulfilled') setStockOutEntries(stockOutRes.value.data);
    if (studentIssuesRes.status === 'fulfilled') setStudentIssueEntries(studentIssuesRes.value.data);
    if (subjectsRes.status === 'fulfilled') setInventorySubjects(subjectsRes.value.data);
    if (setsRes.status === 'fulfilled') setInventorySets(setsRes.value.data);
    if (volumesRes.status === 'fulfilled') setInventoryVolumes(volumesRes.value.data);
    if (catalogRes.status === 'fulfilled') setCatalog(catalogRes.value.data);

    if (results.every((result) => result.status === 'rejected')) {
      throw new Error('Failed to refresh inventory data');
    }

    setLoadedTabs((current) => ({ ...current, materials: true }));
  };

  const filteredMaterials = useMemo(
    () =>
      materials.filter((item) => {
        const batchText = (item.batch_names || []).join(', ').toLowerCase();
        const searchText = materialSearch.toLowerCase();
        const matchesSearch =
          !materialSearch ||
          item.name.toLowerCase().includes(searchText) ||
          (item.subject || '').toLowerCase().includes(searchText) ||
          (item.set_name || '').toLowerCase().includes(searchText) ||
          (item.volume_name || '').toLowerCase().includes(searchText) ||
          batchText.includes(searchText);
        const matchesSubject = !materialSubjectFilter || (item.subject || '') === materialSubjectFilter;
        const matchesBatch = !materialBatchFilter || (item.batch_names || []).includes(materialBatchFilter);
        return matchesSearch && matchesSubject && matchesBatch;
      }),
    [materials, materialSearch, materialSubjectFilter, materialBatchFilter]
  );

  const materialSubjects = useMemo(
    () => Array.from(new Set(materials.map((item) => item.subject).filter(Boolean) as string[])).sort(),
    [materials]
  );

  const materialBatches = useMemo(
    () => Array.from(new Set(materials.flatMap((item) => item.batch_names || []).filter(Boolean))).sort(),
    [materials]
  );

  const setWiseInventorySummary = useMemo(() => {
    const summary = new Map<string, { setName: string; subjectName: string; totalStock: number; materialCount: number }>();

    filteredMaterials.forEach((item) => {
      const setName = (item.set_name || 'Unassigned Set').trim() || 'Unassigned Set';
      const subjectName = (item.subject || '').trim();
      const existing = summary.get(setName);

      if (existing) {
        existing.totalStock += Number(item.current_stock || 0);
        existing.materialCount += 1;
        if (!existing.subjectName && subjectName) {
          existing.subjectName = subjectName;
        }
        return;
      }

      summary.set(setName, {
        setName,
        subjectName,
        totalStock: Number(item.current_stock || 0),
        materialCount: 1,
      });
    });

    return Array.from(summary.values()).sort(
      (a, b) => b.totalStock - a.totalStock || a.setName.localeCompare(b.setName)
    );
  }, [filteredMaterials]);

  const connectedBatchOptions = useMemo(() => {
    const batchMap = new Map<string, Batch>();

    batches.forEach((batch) => {
      batchMap.set(batch.name, batch);
    });

    Array.from(new Set(students.map((student) => student.batch).filter(Boolean))).forEach((batchName, index) => {
      if (!batchMap.has(batchName)) {
        batchMap.set(batchName, {
          id: -index - 1,
          name: batchName,
          school_id: currentSchoolId,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          student_count: students.filter((student) => student.batch === batchName).length,
        });
      }
    });

    return Array.from(batchMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [batches, students]);

  const selectedDistributionBatches = connectedBatchOptions.filter((batch) =>
    stockOutForm.batch_ids.includes(String(batch.id))
  );

  const selectedStudentIssueBatch = connectedBatchOptions.find((batch) => String(batch.id) === studentIssueForm.batch_id) ?? null;
  const studentIssueBatchStudents = useMemo(
    () => students.filter((student) => student.is_active && selectedStudentIssueBatch && student.batch === selectedStudentIssueBatch.name),
    [students, selectedStudentIssueBatch]
  );
  const selectedStudentIssueStudents = studentIssueBatchStudents.filter((student) =>
    studentIssueForm.student_ids.includes(String(student.id))
  );

  const stockOutMaterialOptions = useMemo(() => {
    if (!selectedDistributionBatches.length) {
      return materials.filter((item) => item.is_active);
    }
    return materials.filter(
      (item) =>
        item.is_active &&
        ((item.batch_names || []).length === 0 ||
          selectedDistributionBatches.some((batch) => (item.batch_names || []).includes(batch.name)))
    );
  }, [materials, selectedDistributionBatches]);

  const studentIssueMaterialOptions = useMemo(() => {
    const activeMaterialList = materials.filter((item) => item.is_active);
    if (!selectedStudentIssueBatch) {
      return activeMaterialList;
    }
    const mappedMaterials = activeMaterialList.filter(
      (item) =>
        ((item.batch_names || []).length === 0 ||
          (item.batch_names || []).includes(selectedStudentIssueBatch.name))
    );
    return mappedMaterials.length ? mappedMaterials : activeMaterialList;
  }, [materials, selectedStudentIssueBatch]);

  const reportStudentOptions = useMemo(() => {
    if (!reportFilters.batch_id) {
      return students.filter((student) => student.is_active);
    }
    const selectedBatch = connectedBatchOptions.find((batch) => String(batch.id) === reportFilters.batch_id);
    if (!selectedBatch) {
      return students.filter((student) => student.is_active);
    }
    return students.filter((student) => student.is_active && student.batch === selectedBatch.name);
  }, [students, connectedBatchOptions, reportFilters.batch_id]);

  const studentIssueSummaries = useMemo(() => {
    const grouped = new Map<string, any>();

    studentIssueEntries.forEach((entry) => {
      const key = `${entry.student_id}-${entry.batch_id ?? entry.batch_name ?? 'no-batch'}`;
      const entryDateValue = entry.date ? new Date(entry.date).getTime() : 0;
      const current = grouped.get(key);

      if (!current) {
        grouped.set(key, {
          key,
          student_id: entry.student_id,
          student_name: entry.student_name,
          batch_id: entry.batch_id,
          batch_name: entry.batch_name,
          total_books: Number(entry.quantity_issued || 0),
          latest_date: entry.date,
          latest_date_value: entryDateValue,
          latest_issued_by: entry.issued_by,
          entries: [entry],
        });
        return;
      }

      current.total_books += Number(entry.quantity_issued || 0);
      current.entries.push(entry);

      if (entryDateValue >= current.latest_date_value) {
        current.latest_date = entry.date;
        current.latest_date_value = entryDateValue;
        current.latest_issued_by = entry.issued_by;
      }
    });

    return Array.from(grouped.values())
      .map((item) => ({
        ...item,
        total_titles: new Set(item.entries.map((entry: StudentIssueEntry) => entry.material_name).filter(Boolean)).size,
        entries: [...item.entries].sort(
          (a: StudentIssueEntry, b: StudentIssueEntry) =>
            new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime() || String(b.id).localeCompare(String(a.id)),
        ),
      }))
      .sort((a, b) => (b.latest_date_value || 0) - (a.latest_date_value || 0) || a.student_name.localeCompare(b.student_name));
  }, [studentIssueEntries]);

  const activeSubjects = useMemo(
    () => inventorySubjects.filter((item) => item.is_active || sameId(item.id, materialForm.subject_id)),
    [inventorySubjects, materialForm.subject_id]
  );

  const filteredSetOptions = useMemo(
    () =>
      inventorySets.filter(
        (item) =>
          (!materialForm.subject_id || sameId(item.subject_id, materialForm.subject_id)) &&
          (item.is_active || sameId(item.id, materialForm.set_id))
      ),
    [inventorySets, materialForm.subject_id, materialForm.set_id]
  );

  const filteredVolumeOptions = useMemo(
    () =>
      inventoryVolumes.filter(
        (item) =>
          (!materialForm.set_id || sameId(item.set_id, materialForm.set_id)) &&
          (item.is_active || sameId(item.id, materialForm.volume_id))
      ),
    [inventoryVolumes, materialForm.set_id, materialForm.volume_id]
  );

  const groupedCatalog = useMemo(
    () =>
      catalog.filter(
        (subject) =>
          !materialSubjectFilter || subject.name === materialSubjectFilter
      ),
    [catalog, materialSubjectFilter]
  );

  useEffect(() => {
    if (!groupedCatalog.length) {
      setSelectedCatalogSubjectId(null);
      setSelectedCatalogSetId(null);
      return;
    }

    if (!groupedCatalog.some((subject) => sameId(subject.id, selectedCatalogSubjectId))) {
      const nextSubject = groupedCatalog[0];
      setSelectedCatalogSubjectId(nextSubject.id);
      setSelectedCatalogSetId(nextSubject.sets[0]?.id ?? null);
    }
  }, [groupedCatalog, selectedCatalogSubjectId]);

  const selectedCatalogSubject = useMemo(
    () => groupedCatalog.find((subject) => sameId(subject.id, selectedCatalogSubjectId)) ?? groupedCatalog[0] ?? null,
    [groupedCatalog, selectedCatalogSubjectId]
  );

  useEffect(() => {
    if (!selectedCatalogSubject) {
      setSelectedCatalogSetId(null);
      return;
    }

    if (!selectedCatalogSubject.sets.some((inventorySet) => sameId(inventorySet.id, selectedCatalogSetId))) {
      setSelectedCatalogSetId(selectedCatalogSubject.sets[0]?.id ?? null);
    }
  }, [selectedCatalogSetId, selectedCatalogSubject]);

  const selectedCatalogSet = useMemo(
    () => selectedCatalogSubject?.sets.find((inventorySet) => sameId(inventorySet.id, selectedCatalogSetId)) ?? selectedCatalogSubject?.sets[0] ?? null,
    [selectedCatalogSetId, selectedCatalogSubject]
  );

  const scopedMaterials = useMemo(() => {
    return filteredMaterials.filter((item) => {
      if (selectedCatalogSubject && !sameId(item.subject_id, selectedCatalogSubject.id)) return false;
      if (selectedCatalogSet && !sameId(item.set_id, selectedCatalogSet.id)) return false;
      return true;
    });
  }, [filteredMaterials, selectedCatalogSet, selectedCatalogSubject]);

  useEffect(() => {
    if (!filteredMaterials.length) {
      setSelectedMaterialId(null);
      return;
    }

    if (!filteredMaterials.some((item) => sameId(item.id, selectedMaterialId))) {
      setSelectedMaterialId(filteredMaterials[0].id);
    }
  }, [filteredMaterials, selectedMaterialId]);

  const materialMasterStats = useMemo(
    () => ({
      subjects: groupedCatalog.length,
      materials: filteredMaterials.length,
      sets: setWiseInventorySummary.length,
      stock: filteredMaterials.reduce((sum, item) => sum + Number(item.current_stock || 0), 0),
    }),
    [filteredMaterials, groupedCatalog.length, setWiseInventorySummary.length]
  );

  const supplierMaterialSummary = useMemo(() => {
    const summary = new Map<string, {
      totalQuantity: number;
      totalEntries: number;
      totalCurrentStock: number;
      materials: Array<{ materialId: string | number | null; materialName: string; quantity: number; entries: number; currentStock: number }>;
    }>();
    const materialMap = new Map(
      materials.map((item) => [String(item.id), item])
    );

    stockInEntries.forEach((entry) => {
      const supplierId = String(entry.supplier_id ?? '');
      if (!summary.has(supplierId)) {
        summary.set(supplierId, {
          totalQuantity: 0,
          totalEntries: 0,
          totalCurrentStock: 0,
          materials: [],
        });
      }

      const supplierData = summary.get(supplierId)!;
      supplierData.totalQuantity += Number(entry.quantity_received || 0);
      supplierData.totalEntries += 1;

      const normalizedMaterialId = String(entry.material_id ?? '');
      const linkedMaterial = normalizedMaterialId ? materialMap.get(normalizedMaterialId) : undefined;
      const materialBaseName = (linkedMaterial?.name || entry.material_name || 'Unknown Material').trim() || 'Unknown Material';
      const materialSubject = (linkedMaterial?.subject || '').trim();
      const materialSet = (linkedMaterial?.set_name || '').trim();
      const normalizedMaterialName = [materialSubject, materialSet, materialBaseName]
        .filter(Boolean)
        .join(' - ');
      const existingMaterial = supplierData.materials.find((item) =>
        item.materialId !== null && Number.isFinite(normalizedMaterialId)
          ? item.materialId === normalizedMaterialId
          : item.materialName === normalizedMaterialName
      );
      if (existingMaterial) {
        existingMaterial.quantity += Number(entry.quantity_received || 0);
        existingMaterial.entries += 1;
        existingMaterial.currentStock = linkedMaterial?.current_stock ?? existingMaterial.currentStock;
      } else {
        supplierData.materials.push({
          materialId: normalizedMaterialId || null,
          materialName: normalizedMaterialName,
          quantity: Number(entry.quantity_received || 0),
          entries: 1,
          currentStock: linkedMaterial?.current_stock ?? 0,
        });
      }
    });

    summary.forEach((value) => {
      value.materials.sort((a, b) => b.quantity - a.quantity || a.materialName.localeCompare(b.materialName));
      value.totalCurrentStock = value.materials.reduce((sum, item) => sum + Number(item.currentStock || 0), 0);
    });

    return summary;
  }, [materials, stockInEntries]);

  const selectedHistoryMaterial = materials.find((item) => item.id === historyMaterialId);
  const selectedSidebarMaterial = materials.find((item) => sameId(item.id, selectedMaterialId)) ?? filteredMaterials[0] ?? null;
  const selectedCatalogSetStock = scopedMaterials.reduce((sum, item) => sum + Number(item.current_stock || 0), 0);
  const recentStockInPreview = [...stockInEntries]
    .sort((a, b) => new Date(b.date || '').getTime() - new Date(a.date || '').getTime())
    .slice(0, 4);
  const reportColumns = reportData?.rows[0] ? Object.keys(reportData.rows[0].values) : [];

  const resetMaterialForm = () => {
    setMaterialForm(initialMaterialForm);
    setEditingMaterialId(null);
  };

  const resetSubjectForm = () => {
    setSubjectForm(initialSubjectForm);
    setEditingSubjectId(null);
  };

  const resetSetForm = () => {
    setSetForm(initialSetForm);
    setEditingSetId(null);
  };

  const resetVolumeForm = () => {
    setVolumeForm(initialVolumeForm);
    setEditingVolumeId(null);
  };

  const resetSupplierForm = () => {
    setSupplierForm(initialSupplierForm);
    setEditingSupplierId(null);
  };

  const toggleMaterialBatch = (batchName: string) => {
    setMaterialForm((current) => ({
      ...current,
      batch_names: current.batch_names.includes(batchName)
        ? current.batch_names.filter((name) => name !== batchName)
        : [...current.batch_names, batchName],
    }));
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  const handleDownloadMaterialTemplate = async () => {
    try {
      const response = await apiService.downloadInventoryMaterialTemplate();
      downloadBlob(response.data, 'inventory-material-upload-template.xlsx');
      setAlert({ type: 'success', message: 'Material upload template downloaded successfully' });
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Failed to download material template') });
    }
  };

  const handleMaterialImportFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setMaterialImportFile(file);
    setMaterialImportResult(null);
  };

  const handleImportMaterials = async () => {
    if (!canManageInventory || !materialImportFile) return;
    const formData = new FormData();
    formData.append('file', materialImportFile);
    setMaterialImporting(true);
    try {
      const response = await apiService.importInventoryMaterials(formData);
      setMaterialImportResult(response.data);
      setMaterialImportFile(null);
      await refreshMaterials();
      setAlert({ type: 'success', message: response.data.message || 'Materials imported successfully' });
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Failed to import materials from Excel') });
    } finally {
      setMaterialImporting(false);
    }
  };

  const handleSaveSubject = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManageInventory) return;
    try {
      if (editingSubjectId) {
        await apiService.updateInventorySubject(editingSubjectId, subjectForm);
        setAlert({ type: 'success', message: 'Subject updated successfully' });
      } else {
        await apiService.createInventorySubject(subjectForm);
        setAlert({ type: 'success', message: 'Subject added successfully' });
      }
      resetSubjectForm();
      await refreshMaterials();
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Failed to save subject') });
    }
  };

  const handleEditSubject = (subject: InventorySubject) => {
    setEditingSubjectId(subject.id);
    setSubjectForm({
      name: subject.name,
      is_active: subject.is_active,
    });
  };

  const handleDeleteSubject = async (subjectId: string | number) => {
    if (!canManageInventory || !window.confirm('Delete this subject?')) return;
    try {
      await apiService.deleteInventorySubject(subjectId);
      if (sameId(editingSubjectId, subjectId)) resetSubjectForm();
      setAlert({ type: 'success', message: 'Subject deleted successfully' });
      await refreshMaterials();
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Failed to delete subject') });
    }
  };

  const handleSaveSet = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManageInventory) return;
    try {
      const payload = {
        subject_id: setForm.subject_id,
        name: setForm.name,
        is_active: setForm.is_active,
      };
      if (editingSetId) {
        await apiService.updateInventorySet(editingSetId, payload);
        setAlert({ type: 'success', message: 'Set updated successfully' });
      } else {
        await apiService.createInventorySet(payload);
        setAlert({ type: 'success', message: 'Set added successfully' });
      }
      resetSetForm();
      await refreshMaterials();
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Failed to save set') });
    }
  };

  const handleEditSet = (inventorySet: InventorySet) => {
    setEditingSetId(inventorySet.id);
    setSetForm({
      subject_id: String(inventorySet.subject_id),
      name: inventorySet.name,
      is_active: inventorySet.is_active,
    });
  };

  const handleDeleteSet = async (setId: string | number) => {
    if (!canManageInventory || !window.confirm('Delete this set?')) return;
    try {
      await apiService.deleteInventorySet(setId);
      if (sameId(editingSetId, setId)) resetSetForm();
      setAlert({ type: 'success', message: 'Set deleted successfully' });
      await refreshMaterials();
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Failed to delete set') });
    }
  };

  const handleSaveVolume = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManageInventory) return;
    try {
      const payload = {
        set_id: volumeForm.set_id,
        name: `Volume ${Number(volumeForm.volume_number)}`,
        volume_number: Number(volumeForm.volume_number),
        is_active: volumeForm.is_active,
      };
      if (editingVolumeId) {
        await apiService.updateInventoryVolume(editingVolumeId, payload);
        setAlert({ type: 'success', message: 'Volume updated successfully' });
      } else {
        await apiService.createInventoryVolume(payload);
        setAlert({ type: 'success', message: 'Volume added successfully' });
      }
      resetVolumeForm();
      await refreshMaterials();
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Failed to save volume') });
    }
  };

  const handleEditVolume = (volume: InventoryVolume) => {
    setEditingVolumeId(volume.id);
    setVolumeForm({
      subject_id: String(volume.subject_id),
      set_id: String(volume.set_id),
      volume_number: String(volume.volume_number),
      is_active: volume.is_active,
    });
  };

  const handleDeleteVolume = async (volumeId: string | number) => {
    if (!canManageInventory || !window.confirm('Delete this volume?')) return;
    try {
      await apiService.deleteInventoryVolume(volumeId);
      if (sameId(editingVolumeId, volumeId)) resetVolumeForm();
      setAlert({ type: 'success', message: 'Volume deleted successfully' });
      await refreshMaterials();
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Failed to delete volume') });
    }
  };

  const handleSaveMaterial = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManageInventory) return;
    try {
      const payload = {
        name: materialForm.name,
        subject_id: materialForm.subject_id || null,
        set_id: materialForm.set_id || null,
        volume_id: materialForm.volume_id || null,
        volume_name: materialForm.volume_id ? undefined : null,
        volume_number: materialForm.volume_id ? undefined : null,
        set_part_name: materialForm.volume_id ? undefined : null,
        batch_names: materialForm.batch_names,
        description: materialForm.description,
        unit_type: materialForm.unit_type,
        low_stock_threshold: Number(materialForm.low_stock_threshold),
        is_active: materialForm.is_active,
      };
      if (editingMaterialId) {
        await apiService.updateMaterial(editingMaterialId, payload);
        setAlert({ type: 'success', message: 'Material updated successfully' });
      } else {
        await apiService.createMaterial(payload);
        setAlert({ type: 'success', message: 'Material added successfully' });
      }
      resetMaterialForm();
      setActiveMaterialOverlay(null);
      await refreshMaterials();
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Failed to save material') });
    }
  };

  const handleEditMaterial = (item: MaterialItem) => {
    setEditingMaterialId(item.id);
    setMaterialForm({
      name: item.name,
      subject_id: item.subject_id ? String(item.subject_id) : '',
      set_id: item.set_id ? String(item.set_id) : '',
      volume_id: item.volume_id ? String(item.volume_id) : '',
      batch_names: item.batch_names || [],
      description: item.description || '',
      unit_type: item.unit_type,
      low_stock_threshold: item.low_stock_threshold,
      is_active: item.is_active,
    });
    setActiveTab('materials');
    setActiveMaterialOverlay('material');
  };

  const handleDeleteMaterial = async (materialId: string | number) => {
    if (!canManageInventory || !window.confirm('Delete this material master entry?')) return;
    try {
      await apiService.deleteMaterial(materialId);
      if (sameId(editingMaterialId, materialId)) resetMaterialForm();
      if (sameId(historyMaterialId, materialId)) {
        setHistoryMaterialId(null);
        setHistoryEntries([]);
      }
      setAlert({ type: 'success', message: 'Material deleted successfully' });
      await refreshMaterials();
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Failed to delete material') });
    }
  };

  const handleLoadHistory = async (materialId: string | number) => {
    try {
      const response = await apiService.getMaterialHistory(materialId);
      setHistoryEntries(response.data);
      setHistoryMaterialId(materialId);
      setActiveMaterialOverlay('history');
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Failed to load stock history') });
    }
  };

  const handleSaveSupplier = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManageInventory) return;
    try {
      if (editingSupplierId) {
        await apiService.updateSupplier(editingSupplierId, supplierForm);
        setAlert({ type: 'success', message: 'Supplier updated successfully' });
      } else {
        await apiService.createSupplier(supplierForm);
        setAlert({ type: 'success', message: 'Supplier added successfully' });
      }
      resetSupplierForm();
      const response = await apiService.listSuppliers({ school_id: currentSchoolId });
      setSuppliers(response.data);
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Failed to save supplier') });
    }
  };

  const handleDeleteSupplier = async (supplierId: string | number) => {
    if (!canManageInventory || !window.confirm('Delete this supplier?')) return;
    try {
      await apiService.deleteSupplier(supplierId);
      if (sameId(editingSupplierId, supplierId)) resetSupplierForm();
      setAlert({ type: 'success', message: 'Supplier deleted successfully' });
      const response = await apiService.listSuppliers({ school_id: currentSchoolId });
      setSuppliers(response.data);
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Failed to delete supplier') });
    }
  };

  const handleStockIn = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManageInventory) return;
    try {
      const response = await apiService.createStockIn({
        date: `${stockInForm.date}T00:00:00`,
        supplier_id: stockInForm.supplier_id,
        material_id: stockInForm.material_id,
        quantity_received: Number(stockInForm.quantity_received),
        entry_type: stockInForm.entry_type,
        added_by: stockInForm.added_by || user?.full_name || 'Administrator',
        notes: stockInForm.notes,
      });
      setStockInEntries((current) => [response.data, ...current]);
      setStockInForm(initialStockInForm);
      setAlert({ type: 'success', message: 'Stock added successfully' });
      await refreshMaterials();
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Failed to add stock') });
    }
  };

  const handleDeleteStockIn = async (entryId: string | number) => {
    if (!canManageInventory || !window.confirm('Delete this stock-in entry?')) return;
    try {
      await apiService.deleteStockIn(entryId);
      setAlert({ type: 'success', message: 'Stock-in entry deleted successfully' });
      await refreshMaterials();
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Failed to delete stock-in entry') });
    }
  };

  const handleStockOut = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManageInventory) return;
    const selectedBatches = connectedBatchOptions.filter((batch) =>
      stockOutForm.batch_ids.includes(String(batch.id))
    );
    const selectedMaterialIds = stockOutForm.material_ids.filter(Boolean);
    if (!selectedBatches.length) {
      setAlert({ type: 'warning', message: 'Please select at least one valid batch' });
      return;
    }
    if (!selectedMaterialIds.length) {
      setAlert({ type: 'warning', message: 'Please select at least one material' });
      return;
    }
    try {
      for (const materialId of selectedMaterialIds) {
        await apiService.createStockOut({
          date: `${stockOutForm.date}T00:00:00`,
          batch_ids: selectedBatches.map((batch) => batch.id),
          batch_name: selectedBatches[0].name,
          material_id: materialId,
          quantity_issued: Number(stockOutForm.quantity_issued),
          issued_by: stockOutForm.issued_by || user?.full_name || 'Administrator',
          remarks: stockOutForm.remarks,
        });
      }
      setStockOutForm(initialStockOutForm);
      setAlert({ type: 'success', message: `Distribution recorded for ${selectedMaterialIds.length} material(s) across ${selectedBatches.length} batch(es)` });
      await refreshMaterials();
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Failed to distribute stock') });
    }
  };

  const handleDeleteStockOut = async (entryId: string | number) => {
    if (!canManageInventory || !window.confirm('Delete this distribution entry?')) return;
    try {
      await apiService.deleteStockOut(entryId);
      setAlert({ type: 'success', message: 'Distribution entry deleted successfully' });
      await refreshMaterials();
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Failed to delete distribution entry') });
    }
  };

  const handleStudentIssue = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManageInventory) return;
    if (!studentIssueForm.batch_id) {
      setAlert({ type: 'warning', message: 'Please select one batch for student-wise issue' });
      return;
    }
    if (!selectedStudentIssueStudents.length) {
      setAlert({ type: 'warning', message: 'Please select at least one student' });
      return;
    }
    const selectedMaterialIds = studentIssueForm.material_ids.filter(Boolean);
    if (!selectedMaterialIds.length) {
      setAlert({ type: 'warning', message: 'Please select at least one material' });
      return;
    }
    try {
      for (const materialId of selectedMaterialIds) {
        await apiService.createStudentIssues({
          date: `${studentIssueForm.date}T00:00:00`,
          batch_id: studentIssueForm.batch_id,
          student_ids: selectedStudentIssueStudents.map((student) => student.id),
          material_id: materialId,
          quantity_issued: Number(studentIssueForm.quantity_issued),
          issued_by: studentIssueForm.issued_by || user?.full_name || 'Administrator',
          remarks: studentIssueForm.remarks,
        });
      }
      setStudentIssueForm(initialStudentIssueForm);
      setAlert({ type: 'success', message: `Student-wise issue recorded for ${selectedMaterialIds.length} material(s) to ${selectedStudentIssueStudents.length} student(s)` });
      await refreshMaterials();
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Failed to issue stock to students') });
    }
  };

  const handleDeleteStudentIssue = async (entryId: string | number) => {
    if (!canManageInventory || !window.confirm('Delete this student issue entry?')) return;
    try {
      await apiService.deleteStudentIssue(entryId);
      if (selectedStudentIssueDetail) {
        const remainingEntries = selectedStudentIssueDetail.entries.filter((entry: StudentIssueEntry) => !sameId(entry.id, entryId));
        if (!remainingEntries.length) {
          setSelectedStudentIssueDetail(null);
        } else {
          const latestEntry = [...remainingEntries].sort(
            (a: StudentIssueEntry, b: StudentIssueEntry) =>
                new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime() || String(b.id).localeCompare(String(a.id)),
          )[0];
          setSelectedStudentIssueDetail({
            ...selectedStudentIssueDetail,
            entries: remainingEntries,
            total_books: remainingEntries.reduce((sum: number, entry: StudentIssueEntry) => sum + Number(entry.quantity_issued || 0), 0),
            total_titles: new Set(remainingEntries.map((entry: StudentIssueEntry) => entry.material_name).filter(Boolean)).size,
            latest_date: latestEntry?.date,
            latest_date_value: latestEntry?.date ? new Date(latestEntry.date).getTime() : 0,
            latest_issued_by: latestEntry?.issued_by,
          });
        }
      }
      setAlert({ type: 'success', message: 'Student issue entry deleted successfully' });
      await refreshMaterials();
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Failed to delete student issue entry') });
    }
  };

  const handleRunReport = async () => {
    try {
      const response = await apiService.getInventoryReport({
        report_type: reportFilters.report_type,
        school_id: currentSchoolId,
        date_from: reportFilters.date_from ? `${reportFilters.date_from}T00:00:00` : undefined,
        date_to: reportFilters.date_to ? `${reportFilters.date_to}T23:59:59` : undefined,
        supplier_id: reportFilters.supplier_id || undefined,
        batch_id: reportFilters.batch_id || undefined,
        student_id: reportFilters.student_id || undefined,
        material_id: reportFilters.material_id || undefined,
      });
      setReportData(response.data);
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Failed to load report') });
    }
  };

  const handleExportReport = async (exportFormat: 'excel' | 'pdf') => {
    try {
      const response = await apiService.exportInventoryReport({
        report_type: reportFilters.report_type,
        export_format: exportFormat,
        school_id: currentSchoolId,
        date_from: reportFilters.date_from ? `${reportFilters.date_from}T00:00:00` : undefined,
        date_to: reportFilters.date_to ? `${reportFilters.date_to}T23:59:59` : undefined,
        supplier_id: reportFilters.supplier_id || undefined,
        batch_id: reportFilters.batch_id || undefined,
        student_id: reportFilters.student_id || undefined,
        material_id: reportFilters.material_id || undefined,
      });
      downloadBlob(response.data, `${reportFilters.report_type}.${exportFormat === 'excel' ? 'xlsx' : 'pdf'}`);
      setAlert({ type: 'success', message: 'Report exported successfully' });
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Failed to export report') });
    }
  };

  if (loading) {
    return <LoadingSpinner message="Loading inventory workspace..." />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50 p-3 md:p-5">
      <div className="mx-auto max-w-[1380px] space-y-5">
        <div className="rounded-[1.75rem] bg-white p-6 shadow-xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-indigo-600">Inventory Control</p>
              <h1 className="mt-3 text-4xl font-bold text-slate-900">Inventory Operations Hub</h1>
              <p className="mt-4 max-w-3xl text-slate-600">
                Organize materials subject-wise, set-wise, and volume-wise while keeping supplier handling, stock movement, and reporting in one polished workspace.
              </p>
            </div>
            <div className="rounded-[1.75rem] bg-indigo-50 p-5 text-center text-indigo-700 shadow-sm">
              <Package className="mx-auto h-10 w-10" />
              <p className="mt-4 text-lg font-semibold">{user?.full_name || 'Administrator'}</p>
              <p className="text-sm uppercase tracking-wide">{user?.role || 'admin'}</p>
            </div>
          </div>
        </div>

        {alert && <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />}
        {!canManageInventory && (
          <Alert
            type="info"
            message="You have read-only access. Only Admin or Store Manager can add stock, distribute items, or manage categorized material masters."
          />
        )}

        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
          <StatCard label="Registered Items" value={dashboard?.total_materials_registered || 0} icon={BookOpen} tone="amber" />
          <StatCard label="Total Stock In" value={dashboard?.total_books_in_inventory || 0} icon={PackagePlus} tone="blue" />
          <StatCard label="Distributed" value={dashboard?.total_books_distributed || 0} icon={Send} tone="emerald" />
          <StatCard label="Current Stock" value={dashboard?.current_stock_available || 0} icon={Boxes} tone="slate" />
          <StatCard label="Low Stock Alerts" value={dashboard?.low_stock_alert_count || 0} icon={AlertTriangle} tone="red" />
        </div>

        <div className="space-y-5">
          <section className="rounded-[1.5rem] bg-white p-4 shadow-xl">
            <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-indigo-600">Inventory Functions</p>
                <h2 className="mt-1 text-2xl font-bold text-slate-900">Top Section Bar</h2>
                <p className="text-sm text-slate-500">Section select karo, aur content neeche khulega.</p>
              </div>
              <button
                type="button"
                onClick={() => loadInventoryData(false)}
                className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 transition hover:bg-amber-100"
              >
                {refreshing ? 'Refreshing...' : 'Refresh Data'}
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
              {inventoryFeatureCards.map((feature) => {
                const Icon = feature.icon;
                const colors = getFeatureColorClasses(feature.color);
                const active = activeTab === feature.key;

                return (
                  <button
                    key={feature.key}
                    type="button"
                    onClick={() => setActiveTab(feature.key)}
                    className={`rounded-[1.25rem] border p-4 text-left shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${
                      active
                        ? 'border-slate-900 bg-white ring-2 ring-slate-900'
                        : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`${colors.bg} rounded-2xl p-3`}>
                        <Icon className={`${colors.text} h-5 w-5`} />
                      </div>
                      <div>
                        <h2 className="text-sm font-semibold text-slate-900">{feature.title}</h2>
                        <p className="mt-1 text-xs text-slate-500">{feature.description}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="min-w-0 space-y-5">
        {activeTab === 'dashboard' && (
          <div className="grid gap-6 xl:grid-cols-[1.4fr,1fr]">
            <section className="rounded-[1.5rem] bg-white p-5 shadow-xl">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-red-100 p-3 text-red-600">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">Low Stock Watchlist</h2>
                  <p className="text-sm text-slate-500">Items at or below threshold need attention.</p>
                </div>
              </div>
              <div className="mt-6 space-y-3">
                {dashboard?.low_stock_items?.length ? (
                  dashboard.low_stock_items.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-rose-100 bg-rose-50 p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="font-semibold text-slate-900">{item.name}</p>
                          <p className="text-sm text-slate-600">
                            {(item.subject || 'No subject')} | {(item.volume_name && item.volume_number) ? `Volume ${item.volume_number} - ${item.volume_name}` : 'No volume'}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-rose-700">{item.current_stock}</p>
                          <p className="text-xs uppercase tracking-wide text-rose-500">Threshold {item.low_stock_threshold}</p>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl bg-emerald-50 p-5 text-emerald-700">No low stock alerts right now.</div>
                )}
              </div>
            </section>

            <section className="rounded-[1.5rem] bg-white p-5 shadow-xl">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                  <History className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">Recent Movements</h2>
                  <p className="text-sm text-slate-500">Latest stock in and distribution activity.</p>
                </div>
              </div>
              <div className="mt-6 space-y-3">
                {[
                  ...stockInEntries.map((entry) => ({ ...entry, kind: 'in' as const })),
                  ...stockOutEntries.map((entry) => ({ ...entry, kind: 'out' as const })),
                ]
                  .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                  .slice(0, 6)
                  .map((entry) => (
                    <div key={`${entry.kind}-${entry.id}`} className="rounded-2xl border border-slate-200 p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="font-semibold text-slate-900">{entry.material_name}</p>
                          <p className="text-sm text-slate-500">
                            {entry.kind === 'in' ? `From ${entry.supplier_name}` : `To ${entry.batch_name}`}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className={`text-lg font-bold ${entry.kind === 'in' ? 'text-emerald-600' : 'text-amber-600'}`}>
                            {entry.kind === 'in' ? '+' : '-'}{entry.kind === 'in' ? entry.quantity_received : entry.quantity_issued}
                          </p>
                          <p className="text-xs text-slate-500">{new Date(entry.date).toLocaleDateString()}</p>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'materials' && (
          <div className="grid gap-6 xl:grid-cols-[1.18fr,0.82fr]">
            <section className="space-y-6">
              <section className="rounded-[1.7rem] border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-indigo-50 p-5 shadow-xl">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="max-w-3xl">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700">Material Master</p>
                    <h2 className="mt-1.5 text-2xl font-bold text-slate-900">Organized Material Workspace</h2>
                    <p className="mt-2 text-xs text-slate-600">
                      Subject, set, volume, aur material stock ko clean cards aur structured browsing flow mein arrange kiya gaya hai.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => loadInventoryData(false)}
                    className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                  >
                    {refreshing ? 'Refreshing...' : 'Refresh Data'}
                  </button>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <MiniActionCard title="Subjects" description={`${materialMasterStats.subjects} subject groups`} actionLabel="Browse" tone="indigo" />
                  <MiniActionCard title="Materials" description={`${materialMasterStats.materials} filtered records`} actionLabel="Registry" tone="amber" />
                  <MiniActionCard title="Sets" description={`${materialMasterStats.sets} set summaries`} actionLabel="Structure" tone="blue" />
                  <MiniActionCard title="Stock" description={`${materialMasterStats.stock} total visible units`} actionLabel="Live Count" tone="emerald" />
                </div>

                <div className="mt-4 grid gap-3 xl:grid-cols-3">
                  <div className="rounded-[1.25rem] border border-slate-200 bg-white p-3 shadow-sm">
                    <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Search Material</label>
                    <input
                      value={materialSearch}
                      onChange={(e) => setMaterialSearch(e.target.value)}
                      placeholder="Search material, set, subject, volume"
                      className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                    />
                  </div>
                  <div className="rounded-[1.25rem] border border-slate-200 bg-white p-3 shadow-sm">
                    <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Subject Filter</label>
                    <select value={materialSubjectFilter} onChange={(e) => setMaterialSubjectFilter(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm">
                      <option value="">All subjects</option>
                      {materialSubjects.map((subject) => (
                        <option key={subject} value={subject}>{subject}</option>
                      ))}
                    </select>
                  </div>
                  <div className="rounded-[1.25rem] border border-slate-200 bg-white p-3 shadow-sm">
                    <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Batch Filter</label>
                    <select value={materialBatchFilter} onChange={(e) => setMaterialBatchFilter(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm">
                      <option value="">All batches</option>
                      {materialBatches.map((batchName) => (
                        <option key={batchName} value={batchName}>{batchName}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>

              <section className="rounded-[1.7rem] border border-slate-200 bg-white p-4 shadow-xl">
                <div className="grid gap-4 xl:grid-cols-[0.34fr,0.24fr,0.42fr]">
                  <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Browse Catalog</p>
                        <p className="text-xs text-slate-500">Subject list se set aur materials ko quickly open karo.</p>
                      </div>
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                        {groupedCatalog.length} subject(s)
                      </span>
                    </div>
                    <div className="mt-3 space-y-2">
                      {groupedCatalog.map((subject) => (
                        <button
                          key={subject.id}
                          type="button"
                          onClick={() => {
                            setSelectedCatalogSubjectId(subject.id);
                            setSelectedCatalogSetId(subject.sets[0]?.id ?? null);
                          }}
                          className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                            selectedCatalogSubject?.id === subject.id
                              ? 'border-slate-900 bg-slate-900 text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-semibold">{subject.name}</p>
                            <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                              selectedCatalogSubject?.id === subject.id ? 'bg-white/15 text-slate-100' : 'bg-slate-100 text-slate-600'
                            }`}>
                              {subject.sets.length}
                            </span>
                          </div>
                          <p className={`mt-1 text-xs ${selectedCatalogSubject?.id === subject.id ? 'text-slate-200' : 'text-slate-500'}`}>
                            {subject.sets.length} set(s) available
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-3">
                    <p className="text-sm font-semibold text-slate-900">Selected Details</p>
                    <div className="mt-3 space-y-3">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Subject</p>
                        <p className="mt-1 font-semibold text-slate-900">{selectedCatalogSubject?.name || 'No subject selected'}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Set</p>
                        <p className="mt-1 font-semibold text-slate-900">{selectedCatalogSet?.name || 'No set selected'}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Material</p>
                        <p className="mt-1 font-semibold text-slate-900">{selectedSidebarMaterial?.name || 'No material selected'}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Records</p>
                        <p className="mt-1 font-semibold text-slate-900">{scopedMaterials.length} available</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Stock</p>
                        <p className="mt-1 text-xl font-bold text-blue-700">{selectedCatalogSetStock}</p>
                      </div>
                    </div>
                    {selectedSidebarMaterial && (
                      <div className="mt-3 grid gap-2">
                        <button type="button" onClick={() => handleEditMaterial(selectedSidebarMaterial)} className={warningButtonClass}>
                          Edit Selected
                        </button>
                        <button type="button" onClick={() => handleLoadHistory(selectedSidebarMaterial.id)} className={infoButtonClass}>
                          Open History
                        </button>
                        {canManageInventory && (
                          <button type="button" onClick={() => handleDeleteMaterial(selectedSidebarMaterial.id)} className={dangerButtonClass}>
                            Delete Selected
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="rounded-[1.25rem] border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Material Entry Panel</p>
                        <p className="text-xs text-slate-500">Add ya edit material overlay drawer mein open hoga.</p>
                      </div>
                      {editingMaterialId ? (
                        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                          Editing Mode
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-3 space-y-3">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Selection Flow</p>
                        <p className="mt-2 text-sm font-medium text-slate-700">Subject {'->'} Set {'->'} Volume {'->'} Material</p>
                        <p className="mt-2 text-xs text-slate-500">
                          Form ab page ke andar squeeze nahi hoga. Proper overlay panel mein open karke kaam hoga.
                        </p>
                      </div>

                      <div className="grid gap-2">
                        <button
                          type="button"
                          disabled={!canManageInventory}
                          onClick={() => {
                            if (!editingMaterialId) resetMaterialForm();
                            setActiveMaterialOverlay('material');
                          }}
                          className={primaryButtonClass}
                        >
                          {editingMaterialId ? 'Open Edit Material Panel' : 'Open Add Material Panel'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveMaterialOverlay('upload')}
                          className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                        >
                          Open Bulk Upload Panel
                        </button>
                        <button
                          type="button"
                          disabled={!selectedSidebarMaterial}
                          onClick={() => selectedSidebarMaterial && handleLoadHistory(selectedSidebarMaterial.id)}
                          className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Open Stock Trail Panel
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="grid items-start gap-3 xl:grid-cols-[1.22fr,0.78fr]">
                <div className="grid gap-3 self-start">
                  <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-xl">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Material Registry</p>
                        <h3 className="mt-1.5 text-lg font-bold text-slate-900">Full Material List</h3>
                      </div>
                      <div className="rounded-2xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
                        {filteredMaterials.length} records
                      </div>
                    </div>
                    <div className="mt-4 overflow-hidden rounded-[1.25rem] border border-slate-200">
                      <div className="max-h-[20rem] overflow-auto">
                        <table className="min-w-full text-xs">
                          <thead className="sticky top-0 bg-white">
                            <tr className="border-b border-slate-200 text-left text-slate-500">
                              <th className="px-3 py-2.5">Material Name</th>
                              <th className="px-3 py-2.5">Subject</th>
                              <th className="px-3 py-2.5">Set</th>
                              <th className="px-3 py-2.5">Volume</th>
                              <th className="px-3 py-2.5">Current Stock</th>
                              <th className="px-3 py-2.5">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredMaterials.length ? (
                              filteredMaterials.map((item) => (
                                <tr
                                  key={item.id}
                                  onClick={() => setSelectedMaterialId(item.id)}
                                  className={`cursor-pointer border-b border-slate-100 ${selectedSidebarMaterial?.id === item.id ? 'bg-blue-50/70' : 'hover:bg-slate-50'}`}
                                >
                                  <td className="px-3 py-3 font-semibold text-slate-900">{item.name}</td>
                                  <td className="px-3 py-3">{item.subject || '-'}</td>
                                  <td className="px-3 py-3">{item.set_name || '-'}</td>
                                  <td className="px-3 py-3">{item.volume_name && item.volume_number ? `V${item.volume_number}` : '-'}</td>
                                  <td className="px-3 py-3">
                                    <span className={item.current_stock <= item.low_stock_threshold ? 'font-semibold text-rose-600' : 'font-semibold text-emerald-600'}>
                                      {item.current_stock}
                                    </span>
                                  </td>
                                  <td className="px-3 py-3">
                                    <div className="flex flex-wrap gap-2">
                                      <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedMaterialId(item.id); handleLoadHistory(item.id); }} className={infoButtonClass}>
                                        Open
                                      </button>
                                      {canManageInventory && (
                                        <>
                                          <button type="button" onClick={(e) => { e.stopPropagation(); handleEditMaterial(item); }} className={warningButtonClass}>
                                            Edit
                                          </button>
                                          <button type="button" onClick={(e) => { e.stopPropagation(); handleDeleteMaterial(item.id); }} className={dangerButtonClass}>
                                            Delete
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={6} className="px-3 py-6 text-center text-slate-500">No materials matched the current filters.</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-[1fr,1fr]">
                    <div className="grid gap-3">
                      <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-xl">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Low Stock Alerts</p>
                        <h3 className="mt-1.5 text-base font-bold text-slate-900">Threshold Watchlist</h3>
                        <div className="mt-3 space-y-2.5">
                          {(dashboard?.low_stock_items || []).slice(0, 4).map((item) => (
                            <div key={item.id} className="rounded-xl border border-rose-100 bg-rose-50 p-3">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="font-semibold text-slate-900">{item.name}</p>
                                  <p className="text-xs text-slate-500">{item.subject || '-'} | {item.set_name || '-'}</p>
                                </div>
                                <div className="text-right">
                                  <p className="font-bold text-rose-700">{item.current_stock}</p>
                                  <p className="text-xs text-rose-500">Low</p>
                                </div>
                              </div>
                            </div>
                          ))}
                          {!(dashboard?.low_stock_items || []).length && (
                            <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">No low stock alerts right now.</div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-xl">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Recent Stock In</p>
                      <h3 className="mt-1.5 text-base font-bold text-slate-900">Latest Entries</h3>
                      <div className="mt-3 space-y-2.5">
                        {recentStockInPreview.map((entry) => (
                          <div key={entry.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="font-semibold text-slate-900">{entry.material_name}</p>
                                <p className="text-xs text-slate-500">{entry.supplier_name}</p>
                              </div>
                              <div className="text-right">
                                <p className="font-bold text-emerald-700">{entry.quantity_received}</p>
                                <p className="text-xs text-slate-500">{new Date(entry.date || '').toLocaleDateString()}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                        {!recentStockInPreview.length && (
                          <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No stock-in entries available yet.</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4">
                  <div className="grid gap-4">
                    <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-xl">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Set-wise Stock Count</p>
                          <h3 className="mt-1.5 text-base font-bold text-slate-900">Set Summary</h3>
                          <p className="mt-1 text-xs text-slate-500">Har set ka total stock aur material entries ek hi jagah.</p>
                        </div>
                        <div className="rounded-2xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
                          {setWiseInventorySummary.length} set(s)
                        </div>
                      </div>
                      <div className="mt-3 max-h-[22rem] space-y-2.5 overflow-y-auto pr-1">
                        {setWiseInventorySummary.length ? setWiseInventorySummary.slice(0, 4).map((item) => (
                          <div key={`${item.subjectName}-${item.setName}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-semibold text-slate-900">{item.setName}</p>
                                <p className="mt-1 text-xs text-slate-500">{item.subjectName || 'No subject mapped'}</p>
                              </div>
                              <div className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                                {item.materialCount} material(s)
                              </div>
                            </div>
                            <div className="mt-2.5 flex items-end justify-between gap-3 rounded-xl bg-white px-3 py-2.5">
                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Current Stock</p>
                                <p className="mt-1 text-xl font-bold text-blue-700">{item.totalStock}</p>
                              </div>
                              <p className="text-xs text-slate-500">Set total visible count</p>
                            </div>
                          </div>
                        )) : (
                          <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Abhi set-wise stock summary available nahi hai.</div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-xl">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Stock History</p>
                          <h3 className="mt-1.5 text-base font-bold text-slate-900">Selected Material Trail</h3>
                          <p className="mt-1 text-xs text-slate-500">
                            {selectedSidebarMaterial ? `${selectedSidebarMaterial.name} ke latest movements` : 'Kisi material ko open karte hi uska trail yahan dikhega.'}
                          </p>
                        </div>
                        <div className="rounded-2xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
                          {historyEntries.length} entries
                        </div>
                      </div>
                      <div className="mt-2">
                        <button
                          type="button"
                          disabled={!selectedSidebarMaterial}
                          onClick={() => selectedSidebarMaterial && handleLoadHistory(selectedSidebarMaterial.id)}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Open Trail Panel
                        </button>
                      </div>
                      <div className="mt-3 max-h-[22rem] space-y-2.5 overflow-y-auto pr-1">
                        {historyEntries.length ? historyEntries.slice(0, 4).map((entry) => (
                          <div key={`${entry.entry_kind}-${entry.entry_id}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex gap-3">
                                <div className={`mt-1 h-2.5 w-2.5 rounded-full ${entry.entry_kind === 'stock_in' ? 'bg-emerald-500' : entry.entry_kind === 'student_issue' ? 'bg-blue-500' : 'bg-amber-500'}`} />
                                <div>
                                  <p className="font-semibold text-slate-900">{entry.entry_kind === 'stock_in' ? 'Stock In' : entry.entry_kind === 'student_issue' ? 'Student Issue' : 'Stock Out'}</p>
                                  <p className="mt-1 text-xs text-slate-500">{entry.counterparty}</p>
                                  <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-400">
                                    {entry.date ? new Date(entry.date).toLocaleDateString() : 'No date'}
                                  </p>
                                </div>
                              </div>
                              <div className="text-right">
                                <p className={`text-base font-bold ${entry.entry_kind === 'stock_in' ? 'text-emerald-600' : entry.entry_kind === 'student_issue' ? 'text-blue-600' : 'text-amber-600'}`}>
                                  {entry.entry_kind === 'stock_in' ? '+' : '-'}{entry.quantity}
                                </p>
                                <p className="text-[11px] text-slate-400">units</p>
                              </div>
                            </div>
                          </div>
                        )) : (
                          <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Choose a material to view its trail.</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </section>

            </section>

            <aside className="xl:sticky xl:top-5 xl:self-start">
              <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-xl">
                <div className="border-b border-slate-100 px-6 py-5">
                  <div className="flex items-start gap-3">
                    <div className="rounded-2xl bg-amber-100 p-3 text-amber-700">
                      <BookOpen className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">Material Master</h3>
                      <p className="mt-1 text-sm text-slate-500">Subjects, sets, aur volumes ko yahin se manage karo.</p>
                    </div>
                  </div>
                </div>

                <div className="px-6 py-5">
                  <div className="flex gap-2 rounded-2xl bg-slate-50 p-1">
                    {[
                      { key: 'subjects' as const, label: 'Subjects' },
                      { key: 'sets' as const, label: 'Sets' },
                      { key: 'volumes' as const, label: 'Volumes' },
                    ].map((tab) => {
                      const active = activeMasterTab === tab.key;
                      return (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => setActiveMasterTab(tab.key)}
                          className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                            active ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-5 space-y-5">
                    {activeMasterTab === 'subjects' && (
                      <>
                        <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                          <h4 className="text-lg font-semibold text-slate-900">{editingSubjectId ? 'Edit Subject' : 'Add New Subject'}</h4>
                          <form onSubmit={handleSaveSubject} className="mt-4 grid gap-3">
                            <input required disabled={!canManageInventory} value={subjectForm.name} onChange={(e) => setSubjectForm({ ...subjectForm, name: e.target.value })} placeholder="Enter subject name" className="rounded-xl border border-slate-200 bg-white px-4 py-3" />
                            <label className="flex items-center gap-3 text-sm text-slate-600">
                              <input disabled={!canManageInventory} type="checkbox" checked={subjectForm.is_active} onChange={(e) => setSubjectForm({ ...subjectForm, is_active: e.target.checked })} />
                              Active subject
                            </label>
                            <button disabled={!canManageInventory} className={primaryButtonClass}>
                              {editingSubjectId ? 'Update Subject' : 'Add Subject'}
                            </button>
                          </form>
                        </div>

                        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4">
                          <div className="flex items-center justify-between gap-3">
                            <h4 className="text-lg font-semibold text-slate-900">Subject List</h4>
                            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                              {inventorySubjects.length}
                            </span>
                          </div>
                          <div className="mt-4 space-y-2">
                            {inventorySubjects.map((subject) => (
                              <div key={subject.id} className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3">
                                <div>
                                  <p className="font-semibold text-slate-900">{subject.name}</p>
                                  <p className="text-xs text-slate-500">{subject.is_active ? 'Active' : 'Inactive'}</p>
                                </div>
                                {canManageInventory && (
                                  <div className="flex gap-2">
                                    <button type="button" onClick={() => handleEditSubject(subject)} className={warningButtonClass}>Edit</button>
                                    <button type="button" onClick={() => handleDeleteSubject(subject.id)} className={dangerButtonClass}>Delete</button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}

                    {activeMasterTab === 'sets' && (
                      <>
                        <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                          <h4 className="text-lg font-semibold text-slate-900">{editingSetId ? 'Edit Set' : 'Add New Set'}</h4>
                          <form onSubmit={handleSaveSet} className="mt-4 grid gap-3">
                            <select required disabled={!canManageInventory} value={setForm.subject_id} onChange={(e) => setSetForm({ ...setForm, subject_id: e.target.value })} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                              <option value="">Select subject</option>
                              {inventorySubjects.map((subject) => (
                                <option key={subject.id} value={subject.id}>{subject.name}</option>
                              ))}
                            </select>
                            <input required disabled={!canManageInventory} value={setForm.name} onChange={(e) => setSetForm({ ...setForm, name: e.target.value })} placeholder="Enter set name" className="rounded-xl border border-slate-200 bg-white px-4 py-3" />
                            <label className="flex items-center gap-3 text-sm text-slate-600">
                              <input disabled={!canManageInventory} type="checkbox" checked={setForm.is_active} onChange={(e) => setSetForm({ ...setForm, is_active: e.target.checked })} />
                              Active set
                            </label>
                            <button disabled={!canManageInventory} className={primaryButtonClass}>
                              {editingSetId ? 'Update Set' : 'Add Set'}
                            </button>
                          </form>
                        </div>

                        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4">
                          <div className="flex items-center justify-between gap-3">
                            <h4 className="text-lg font-semibold text-slate-900">Set List</h4>
                            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                              {inventorySets.length}
                            </span>
                          </div>
                          <div className="mt-4 max-h-[26rem] space-y-2 overflow-y-auto pr-1">
                            {inventorySets.map((inventorySet) => {
                              const matchingMaterials = materials.filter((item) => item.set_id === inventorySet.id);
                              const setStock = matchingMaterials.reduce((sum, item) => sum + Number(item.current_stock || 0), 0);
                              return (
                                <div key={inventorySet.id} className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3">
                                  <div>
                                    <p className="font-semibold text-slate-900">{inventorySet.name}</p>
                                    <p className="text-xs text-slate-500">{inventorySet.subject_name}</p>
                                    <p className="mt-1 text-xs font-semibold text-blue-700">{setStock} in stock</p>
                                  </div>
                                  {canManageInventory && (
                                    <div className="flex gap-2">
                                      <button type="button" onClick={() => handleEditSet(inventorySet)} className={warningButtonClass}>Edit</button>
                                      <button type="button" onClick={() => handleDeleteSet(inventorySet.id)} className={dangerButtonClass}>Delete</button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </>
                    )}

                    {activeMasterTab === 'volumes' && (
                      <>
                        <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                          <h4 className="text-lg font-semibold text-slate-900">{editingVolumeId ? 'Edit Volume' : 'Add New Volume'}</h4>
                          <form onSubmit={handleSaveVolume} className="mt-4 grid gap-3">
                            <select required disabled={!canManageInventory} value={volumeForm.subject_id} onChange={(e) => setVolumeForm({ ...volumeForm, subject_id: e.target.value, set_id: '' })} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                              <option value="">Select subject</option>
                              {inventorySubjects.map((subject) => (
                                <option key={subject.id} value={subject.id}>{subject.name}</option>
                              ))}
                            </select>
                            <select required disabled={!canManageInventory} value={volumeForm.set_id} onChange={(e) => setVolumeForm({ ...volumeForm, set_id: e.target.value })} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                              <option value="">Select set</option>
                              {inventorySets.filter((item) => !volumeForm.subject_id || sameId(item.subject_id, volumeForm.subject_id)).map((inventorySet) => (
                                <option key={inventorySet.id} value={inventorySet.id}>{inventorySet.name}</option>
                              ))}
                            </select>
                            <input required disabled={!canManageInventory} type="number" min="1" value={volumeForm.volume_number} onChange={(e) => setVolumeForm({ ...volumeForm, volume_number: e.target.value })} placeholder="Volume number" className="rounded-xl border border-slate-200 bg-white px-4 py-3" />
                            <label className="flex items-center gap-3 text-sm text-slate-600">
                              <input disabled={!canManageInventory} type="checkbox" checked={volumeForm.is_active} onChange={(e) => setVolumeForm({ ...volumeForm, is_active: e.target.checked })} />
                              Active volume
                            </label>
                            <button disabled={!canManageInventory} className={primaryButtonClass}>
                              {editingVolumeId ? 'Update Volume' : 'Add Volume'}
                            </button>
                          </form>
                        </div>

                        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4">
                          <div className="flex items-center justify-between gap-3">
                            <h4 className="text-lg font-semibold text-slate-900">Volume List</h4>
                            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                              {inventoryVolumes.length}
                            </span>
                          </div>
                          <div className="mt-4 max-h-[26rem] space-y-2 overflow-y-auto pr-1">
                            {inventoryVolumes.map((volume) => (
                              <div key={volume.id} className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3">
                                <div>
                                  <p className="font-semibold text-slate-900">Volume {volume.volume_number}</p>
                                  <p className="text-xs text-slate-500">{volume.subject_name} / {volume.set_name}</p>
                                </div>
                                {canManageInventory && (
                                  <div className="flex gap-2">
                                    <button type="button" onClick={() => handleEditVolume(volume)} className={warningButtonClass}>Edit</button>
                                    <button type="button" onClick={() => handleDeleteVolume(volume.id)} className={dangerButtonClass}>Delete</button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </aside>

            <OverlayPanel
              open={activeMaterialOverlay === 'material'}
              mode="drawer"
              title={editingMaterialId ? 'Edit Material' : 'Add Material'}
              description="Subject, set, volume, batches, aur stock threshold yahin se manage karo."
              onClose={() => {
                setActiveMaterialOverlay(null);
                if (!editingMaterialId) resetMaterialForm();
              }}
            >
              <form onSubmit={handleSaveMaterial} className="grid gap-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <select required disabled={!canManageInventory} value={materialForm.subject_id} onChange={(e) => setMaterialForm({ ...materialForm, subject_id: e.target.value, set_id: '', volume_id: '' })} className="rounded-xl border border-slate-200 px-4 py-3 text-sm">
                    <option value="">Select subject</option>
                    {activeSubjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>{subject.name}</option>
                    ))}
                  </select>
                  <select required disabled={!canManageInventory || !materialForm.subject_id} value={materialForm.set_id} onChange={(e) => setMaterialForm({ ...materialForm, set_id: e.target.value, volume_id: '' })} className="rounded-xl border border-slate-200 px-4 py-3 text-sm">
                    <option value="">Select set</option>
                    {filteredSetOptions.map((inventorySet) => (
                      <option key={inventorySet.id} value={inventorySet.id}>{inventorySet.name}</option>
                    ))}
                  </select>
                  <select disabled={!canManageInventory || !materialForm.set_id} value={materialForm.volume_id} onChange={(e) => setMaterialForm({ ...materialForm, volume_id: e.target.value })} className="rounded-xl border border-slate-200 px-4 py-3 text-sm">
                    <option value="">Select volume</option>
                    {filteredVolumeOptions.map((volume) => (
                      <option key={volume.id} value={volume.id}>Volume {volume.volume_number}</option>
                    ))}
                  </select>
                </div>

                <input required disabled={!canManageInventory} value={materialForm.name} onChange={(e) => setMaterialForm({ ...materialForm, name: e.target.value })} placeholder="Material name" className="rounded-xl border border-slate-200 px-4 py-3 text-sm" />

                <div className="grid gap-3 md:grid-cols-[1.15fr,0.85fr]">
                  <textarea disabled={!canManageInventory} value={materialForm.description} onChange={(e) => setMaterialForm({ ...materialForm, description: e.target.value })} placeholder="Description" className="min-h-[120px] rounded-xl border border-slate-200 px-4 py-3 text-sm" />
                  <div className="grid gap-3">
                    <select disabled={!canManageInventory} value={materialForm.unit_type} onChange={(e) => setMaterialForm({ ...materialForm, unit_type: e.target.value as MaterialUnitType })} className="rounded-xl border border-slate-200 px-4 py-3 text-sm">
                      {unitTypeOptions.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                    <input disabled={!canManageInventory} type="number" min="0" value={materialForm.low_stock_threshold} onChange={(e) => setMaterialForm({ ...materialForm, low_stock_threshold: Number(e.target.value) })} placeholder="Low stock threshold" className="rounded-xl border border-slate-200 px-4 py-3 text-sm" />
                    <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-600">
                      <input disabled={!canManageInventory} type="checkbox" checked={materialForm.is_active} onChange={(e) => setMaterialForm({ ...materialForm, is_active: e.target.checked })} />
                      Active material
                    </label>
                  </div>
                </div>

                <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Connected Batches</p>
                      <p className="text-xs text-slate-500">Optional batch mapping for issue filtering.</p>
                    </div>
                    <button type="button" onClick={() => navigate('/batches')} className={infoButtonClass}>
                      Manage Batches
                    </button>
                  </div>
                  <div className="mt-3 flex max-h-36 flex-wrap gap-2 overflow-y-auto">
                    {connectedBatchOptions.filter((batch) => batch.is_active).map((batch) => {
                      const selected = materialForm.batch_names.includes(batch.name);
                      return (
                        <button
                          key={batch.id}
                          type="button"
                          disabled={!canManageInventory}
                          onClick={() => toggleMaterialBatch(batch.name)}
                          className={`rounded-full border px-3 py-2 text-xs font-medium transition ${
                            selected
                              ? 'border-slate-900 bg-slate-900 text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
                          }`}
                        >
                          {batch.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveMaterialOverlay(null);
                      resetMaterialForm();
                    }}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                  >
                    Cancel
                  </button>
                  <button disabled={!canManageInventory} className={primaryButtonClass}>
                    {editingMaterialId ? 'Update Material' : 'Add Material'}
                  </button>
                </div>
              </form>
            </OverlayPanel>

            <OverlayPanel
              open={activeMaterialOverlay === 'upload'}
              mode="modal"
              title="Bulk Material Upload"
              description="Template download karo, file choose karo, aur import result yahin dekho."
              onClose={() => setActiveMaterialOverlay(null)}
            >
              <div className="grid gap-4 md:grid-cols-[1.05fr,0.95fr]">
                <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Upload File</p>
                      <p className="text-xs text-slate-500">Excel template use karke direct import karo.</p>
                    </div>
                    <button type="button" onClick={handleDownloadMaterialTemplate} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                      Download
                    </button>
                  </div>
                  <input
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    disabled={!canManageInventory || materialImporting}
                    onChange={handleMaterialImportFileChange}
                    className="mt-4 block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-white"
                  />
                  <p className="mt-3 text-xs text-slate-500">
                    {materialImportFile ? `Selected: ${materialImportFile.name}` : 'Template choose karke file select karo.'}
                  </p>
                  <button
                    type="button"
                    disabled={!canManageInventory || !materialImportFile || materialImporting}
                    onClick={handleImportMaterials}
                    className={`${successButtonClass} mt-4 w-full`}
                  >
                    {materialImporting ? 'Importing...' : 'Import Excel'}
                  </button>
                </div>

                <div className="rounded-[1.25rem] border border-slate-200 bg-white p-4">
                  <p className="text-sm font-semibold text-slate-900">Import Result</p>
                  {materialImportResult ? (
                    <div className="mt-4 space-y-3">
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-xl bg-emerald-50 px-3 py-3">
                          <p className="text-xl font-bold text-emerald-700">{materialImportResult.imported_count}</p>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">Imported</p>
                        </div>
                        <div className="rounded-xl bg-amber-50 px-3 py-3">
                          <p className="text-xl font-bold text-amber-700">{materialImportResult.updated_count}</p>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-600">Updated</p>
                        </div>
                        <div className="rounded-xl bg-slate-100 px-3 py-3">
                          <p className="text-xl font-bold text-slate-700">{materialImportResult.skipped_count}</p>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Skipped</p>
                        </div>
                      </div>
                      <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                        {materialImportResult.message || 'Import completed successfully.'}
                      </div>
                      <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-600">
                        Errors: {materialImportResult.errors.length}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-xl bg-slate-50 px-4 py-5 text-sm text-slate-500">
                      Import ke baad yahan imported, updated, skipped, aur errors ka summary show hoga.
                    </div>
                  )}
                </div>
              </div>
            </OverlayPanel>

            <OverlayPanel
              open={activeMaterialOverlay === 'history'}
              mode="modal"
              title={selectedHistoryMaterial ? `${selectedHistoryMaterial.name} Trail` : 'Stock Trail'}
              description="Selected material ka latest stock-in aur stock-out movement."
              onClose={() => setActiveMaterialOverlay(null)}
            >
              <div className="space-y-3">
                {historyEntries.length ? historyEntries.map((entry) => (
                  <div key={`${entry.entry_kind}-${entry.entry_id}`} className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex gap-3">
                        <div className={`mt-1 h-3 w-3 rounded-full ${entry.entry_kind === 'stock_in' ? 'bg-emerald-500' : entry.entry_kind === 'student_issue' ? 'bg-blue-500' : 'bg-amber-500'}`} />
                        <div>
                          <p className="font-semibold text-slate-900">{entry.entry_kind === 'stock_in' ? 'Stock In' : entry.entry_kind === 'student_issue' ? 'Student Issue' : 'Stock Out'}</p>
                          <p className="mt-1 text-sm text-slate-500">{entry.counterparty}</p>
                          <p className="mt-1 text-xs uppercase tracking-wide text-slate-400">
                            {entry.date ? new Date(entry.date).toLocaleDateString() : 'No date'}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`text-lg font-bold ${entry.entry_kind === 'stock_in' ? 'text-emerald-600' : entry.entry_kind === 'student_issue' ? 'text-blue-600' : 'text-amber-600'}`}>
                          {entry.entry_kind === 'stock_in' ? '+' : '-'}{entry.quantity}
                        </p>
                        <p className="text-xs text-slate-400">units</p>
                      </div>
                    </div>
                  </div>
                )) : (
                  <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Choose a material to view its trail.</div>
                )}
              </div>
            </OverlayPanel>
          </div>
        )}

        {activeTab === 'suppliers' && (
          <div className="grid gap-6 xl:grid-cols-[0.9fr,1.1fr]">
            <section className="rounded-[1.5rem] bg-white p-5 shadow-xl">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">{editingSupplierId ? 'Edit Supplier' : 'Supplier Master'}</h2>
                  <p className="text-sm text-slate-500">Maintain supplier details for purchase and incoming material records.</p>
                </div>
                {editingSupplierId && (
                  <button type="button" onClick={resetSupplierForm} className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">Cancel</button>
                )}
              </div>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <MiniActionCard
                  title="Quick Add"
                  description="Create a supplier for purchase and stock-in use."
                  tone="blue"
                  actionLabel={editingSupplierId ? 'Editing Mode' : 'Ready to Add'}
                />
                <MiniActionCard
                  title="Directory Count"
                  description={`${suppliers.length} supplier record(s) available in inventory.`}
                  tone="amber"
                  actionLabel="Live Status"
                />
              </div>
              <form onSubmit={handleSaveSupplier} className="mt-6 grid gap-4">
                <input required disabled={!canManageInventory} value={supplierForm.name} onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })} placeholder="Supplier Name" className="rounded-xl border border-slate-200 px-4 py-3" />
                <input disabled={!canManageInventory} value={supplierForm.contact_person} onChange={(e) => setSupplierForm({ ...supplierForm, contact_person: e.target.value })} placeholder="Contact Person" className="rounded-xl border border-slate-200 px-4 py-3" />
                <div className="grid gap-4 md:grid-cols-2">
                  <input disabled={!canManageInventory} value={supplierForm.phone} onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })} placeholder="Phone" className="rounded-xl border border-slate-200 px-4 py-3" />
                  <input disabled={!canManageInventory} value={supplierForm.email} onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })} placeholder="Email" className="rounded-xl border border-slate-200 px-4 py-3" />
                </div>
                <textarea disabled={!canManageInventory} value={supplierForm.address} onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })} placeholder="Address" className="min-h-[100px] rounded-xl border border-slate-200 px-4 py-3" />
                <label className="flex items-center gap-3 text-sm text-slate-600">
                  <input disabled={!canManageInventory} type="checkbox" checked={supplierForm.is_active} onChange={(e) => setSupplierForm({ ...supplierForm, is_active: e.target.checked })} />
                  Active status
                </label>
                <button disabled={!canManageInventory} className={primaryButtonClass}>
                  {editingSupplierId ? 'Update Supplier' : 'Add Supplier'}
                </button>
              </form>
            </section>

            <section className="rounded-[1.5rem] bg-white p-5 shadow-xl">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-blue-100 p-3 text-blue-600">
                  <Truck className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-slate-900">Supplier Directory</h3>
                  <p className="text-sm text-slate-500">Used in stock-in dropdowns and reports.</p>
                </div>
              </div>
              <div className="mt-6 space-y-3">
                {suppliers.map((supplier) => (
                  <div key={supplier.id} className="rounded-2xl border border-slate-200 p-4">
                    {(() => {
                      const supplierSummary = supplierMaterialSummary.get(String(supplier.id));
                      return (
                        <>
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="font-semibold text-slate-900">{supplier.name}</p>
                        <p className="text-sm text-slate-500">{supplier.contact_person || 'No contact person'} | {supplier.phone || 'No phone'}</p>
                        <p className="text-sm text-slate-500">{supplier.email || 'No email'}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {canManageInventory && (
                          <>
                            <button type="button" onClick={() => { setEditingSupplierId(supplier.id); setSupplierForm({ name: supplier.name, contact_person: supplier.contact_person || '', phone: supplier.phone || '', email: supplier.email || '', address: supplier.address || '', is_active: supplier.is_active }); }} className={warningButtonClass}>
                              Edit
                            </button>
                            <button type="button" onClick={() => handleDeleteSupplier(supplier.id)} className={dangerButtonClass}>
                              Delete
                            </button>
                          </>
                        )}
                        <span className={`rounded-full px-3 py-2 text-xs font-semibold ${supplier.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                          {supplier.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 lg:grid-cols-[0.7fr,1.3fr]">
                      <div className="rounded-2xl bg-slate-50 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Supplier Summary</p>
                        <p className="mt-2 text-2xl font-bold text-slate-900">{supplierSummary?.totalCurrentStock || 0}</p>
                        <p className="text-sm text-slate-600">Total books/material currently in stock</p>
                        <p className="mt-2 text-sm text-slate-700">
                          Received total: <span className="font-semibold text-emerald-700">{supplierSummary?.totalQuantity || 0}</span>
                        </p>
                        <p className="mt-2 text-xs text-slate-500">
                          {supplierSummary?.materials.length || 0} material type(s) across {supplierSummary?.totalEntries || 0} stock-in entr{(supplierSummary?.totalEntries || 0) === 1 ? 'y' : 'ies'}.
                        </p>
                      </div>
                      <div className="rounded-2xl bg-blue-50/60 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">Material-wise Stock Count</p>
                            <p className="text-xs text-slate-500">Example: Physics - PCB 50, Chemistry - PCB 50, Biology - PCB 50 = total 150.</p>
                          </div>
                        </div>
                        {supplierSummary?.materials.length ? (
                          <div className="mt-3 grid max-h-72 gap-2 overflow-auto pr-1">
                            {supplierSummary.materials.map((item) => (
                              <div key={`${supplier.id}-${item.materialName}`} className="flex items-center justify-between rounded-xl border border-white/70 bg-white/80 px-3 py-2">
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">{item.materialName}</p>
                                  <p className="text-xs text-slate-500">{item.entries} stock-in entr{item.entries === 1 ? 'y' : 'ies'}</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-lg font-bold text-blue-700">{item.currentStock}</p>
                                  <p className="text-xs text-slate-500">in stock</p>
                                  <p className="mt-1 text-xs font-semibold text-emerald-700">{item.quantity} received</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-3 rounded-xl bg-white/80 px-3 py-3 text-sm text-slate-500">
                            Is supplier ke against abhi tak koi stock-in entry record nahi hui hai.
                          </div>
                        )}
                      </div>
                    </div>
                        </>
                      );
                    })()}
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'stock-in' && (
          <div className="grid gap-6 xl:grid-cols-[0.95fr,1.05fr]">
            <section className="rounded-[1.5rem] bg-white p-5 shadow-xl">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-emerald-100 p-3 text-emerald-600">
                  <PackagePlus className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">Stock In</h2>
                  <p className="text-sm text-slate-500">Record purchase or incoming material from suppliers.</p>
                </div>
              </div>
              <div className="mt-6 grid gap-4 md:grid-cols-3">
                <MiniActionCard
                  title="Active Suppliers"
                  description={`${suppliers.filter((supplier) => supplier.is_active).length} supplier(s) ready for stock entry.`}
                  tone="blue"
                  actionLabel="Source Ready"
                />
                <MiniActionCard
                  title="Active Materials"
                  description={`${materials.filter((item) => item.is_active).length} material(s) available for receiving.`}
                  tone="emerald"
                  actionLabel="Stock Targets"
                />
                <MiniActionCard
                  title="Recent Log"
                  description={`${stockInEntries.length} stock-in record(s) available in history.`}
                  tone="amber"
                  actionLabel="History Synced"
                />
              </div>
              <form onSubmit={handleStockIn} className="mt-6 grid gap-4">
                <input required disabled={!canManageInventory} type="date" value={stockInForm.date} onChange={(e) => setStockInForm({ ...stockInForm, date: e.target.value })} className="rounded-xl border border-slate-200 px-4 py-3" />
                <select required disabled={!canManageInventory} value={stockInForm.supplier_id} onChange={(e) => setStockInForm({ ...stockInForm, supplier_id: e.target.value })} className="rounded-xl border border-slate-200 px-4 py-3">
                  <option value="">Supplier Name</option>
                  {suppliers.filter((supplier) => supplier.is_active).map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                  ))}
                </select>
                <select required disabled={!canManageInventory} value={stockInForm.material_id} onChange={(e) => setStockInForm({ ...stockInForm, material_id: e.target.value })} className="rounded-xl border border-slate-200 px-4 py-3">
                  <option value="">Book / Material Name</option>
                  {materials.filter((item) => item.is_active).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} {item.volume_number && item.volume_name ? `(Volume ${item.volume_number} - ${item.volume_name})` : ''}
                    </option>
                  ))}
                </select>
                <div className="grid gap-4 md:grid-cols-2">
                  <input required disabled={!canManageInventory} type="number" min="1" value={stockInForm.quantity_received} onChange={(e) => setStockInForm({ ...stockInForm, quantity_received: Number(e.target.value) })} placeholder="Quantity Received" className="rounded-xl border border-slate-200 px-4 py-3" />
                  <select disabled={!canManageInventory} value={stockInForm.entry_type} onChange={(e) => setStockInForm({ ...stockInForm, entry_type: e.target.value as StockInType })} className="rounded-xl border border-slate-200 px-4 py-3">
                    <option value="purchase">Purchase</option>
                    <option value="incoming_material">Incoming Material</option>
                  </select>
                </div>
                <input disabled={!canManageInventory} value={stockInForm.added_by} onChange={(e) => setStockInForm({ ...stockInForm, added_by: e.target.value })} placeholder="Added By" className="rounded-xl border border-slate-200 px-4 py-3" />
                <textarea disabled={!canManageInventory} value={stockInForm.notes} onChange={(e) => setStockInForm({ ...stockInForm, notes: e.target.value })} placeholder="Notes" className="min-h-[100px] rounded-xl border border-slate-200 px-4 py-3" />
                <button disabled={!canManageInventory} className={successButtonClass}>
                  Record Stock In
                </button>
              </form>
            </section>

            <section className="rounded-[1.5rem] bg-white p-5 shadow-xl">
              <h3 className="text-xl font-semibold text-slate-900">Recent Stock In Entries</h3>
              <div className="mt-6 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Supplier</th>
                      <th className="px-4 py-3">Material</th>
                      <th className="px-4 py-3">Qty</th>
                      <th className="px-4 py-3">Added By</th>
                      <th className="px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockInEntries.map((entry) => (
                      <tr key={entry.id} className="border-b border-slate-100">
                        <td className="px-4 py-4">{new Date(entry.date).toLocaleDateString()}</td>
                        <td className="px-4 py-4">{entry.supplier_name}</td>
                        <td className="px-4 py-4">{entry.material_name}</td>
                        <td className="px-4 py-4 font-semibold text-emerald-600">{entry.quantity_received}</td>
                        <td className="px-4 py-4">{entry.added_by}</td>
                        <td className="px-4 py-4">
                          {canManageInventory && (
                            <button type="button" onClick={() => handleDeleteStockIn(entry.id)} className={dangerButtonClass}>
                              Delete
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'stock-out' && (
          <div className="grid gap-6 xl:grid-cols-[0.95fr,1.05fr]">
            <section className="rounded-[1.5rem] bg-white p-5 shadow-xl">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-amber-100 p-3 text-amber-700">
                  <Send className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">Batch Distribution</h2>
                  <p className="text-sm text-slate-500">Issue books or materials to existing student batches connected from Admin Office Batch Management.</p>
                </div>
              </div>
              <div className="mt-4 rounded-2xl bg-blue-50 p-4 text-sm text-blue-800">
                Connected batch names: <span className="font-semibold">{connectedBatchOptions.length}</span>
                {' '}from Batch Management and student records.
                <button
                  type="button"
                  onClick={() => navigate('/batches')}
                  className={`ml-3 ${infoButtonClass}`}
                >
                  Go to Batch Management
                </button>
              </div>
              <div className="mt-6 grid gap-4 md:grid-cols-3">
                <MiniActionCard
                  title="Connected Batches"
                  description={`${connectedBatchOptions.length} batch option(s) linked from Admin Office.`}
                  tone="blue"
                  actionLabel="Batch Sync"
                />
                <MiniActionCard
                  title="Issuable Materials"
                  description={`${stockOutMaterialOptions.length} material(s) currently match selected batches.`}
                  tone="amber"
                  actionLabel="Filtered List"
                />
                <MiniActionCard
                  title="Distribution Log"
                  description={`${stockOutEntries.length + studentIssueEntries.length} batch + student issue record(s) captured in outgoing history.`}
                  tone="red"
                  actionLabel="Live Trail"
                />
              </div>
              <div className="mt-6 flex gap-2 rounded-2xl bg-slate-100 p-1">
                {[
                  { key: 'batch' as const, label: 'Batch-wise Issue' },
                  { key: 'student' as const, label: 'Student-wise Issue' },
                ].map((mode) => (
                  <button
                    key={mode.key}
                    type="button"
                    onClick={() => setDistributionMode(mode.key)}
                    className={`flex-1 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                      distributionMode === mode.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>

              {distributionMode === 'batch' ? (
                <form onSubmit={handleStockOut} className="mt-6 grid gap-4">
                  <input required disabled={!canManageInventory} type="date" value={stockOutForm.date} onChange={(e) => setStockOutForm({ ...stockOutForm, date: e.target.value })} className="rounded-xl border border-slate-200 px-4 py-3" />
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <p className="text-sm font-semibold text-slate-900">Batch Names</p>
                    <p className="mt-1 text-xs text-slate-500">Multiple batches select kar sakte ho. Entered quantity har selected batch ke liye apply hogi.</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {connectedBatchOptions.filter((batch) => batch.is_active).map((batch) => {
                        const selected = stockOutForm.batch_ids.includes(String(batch.id));
                        return (
                          <button
                            key={batch.id}
                            type="button"
                            disabled={!canManageInventory}
                            onClick={() =>
                              setStockOutForm((current) => ({
                                ...current,
                                material_ids: [],
                                batch_ids: selected
                                  ? current.batch_ids.filter((id) => id !== String(batch.id))
                                  : [...current.batch_ids, String(batch.id)],
                              }))
                            }
                            className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                              selected
                                ? 'border-amber-600 bg-amber-600 text-white'
                                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
                            }`}
                          >
                            {batch.name}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-3 text-xs text-slate-500">
                      Selected batches: {selectedDistributionBatches.length ? selectedDistributionBatches.map((batch) => batch.name).join(', ') : 'No batch selected'}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <p className="text-sm font-semibold text-slate-900">Books / Materials</p>
                    <p className="mt-1 text-xs text-slate-500">Multiple materials select kar sakte ho. Quantity har selected material ke liye har selected batch par apply hogi.</p>
                    <div className="mt-4 flex max-h-40 flex-wrap gap-2 overflow-y-auto">
                      {stockOutMaterialOptions.map((item) => {
                        const selected = stockOutForm.material_ids.includes(String(item.id));
                        return (
                          <button
                            key={item.id}
                            type="button"
                            disabled={!canManageInventory}
                            onClick={() =>
                              setStockOutForm((current) => ({
                                ...current,
                                material_ids: selected
                                  ? current.material_ids.filter((id) => id !== String(item.id))
                                  : [...current.material_ids, String(item.id)],
                              }))
                            }
                            className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                              selected
                                ? 'border-emerald-600 bg-emerald-600 text-white'
                                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
                            }`}
                          >
                            {item.name} ({item.current_stock})
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-3 text-xs text-slate-500">
                      Selected materials: {stockOutForm.material_ids.length
                        ? stockOutMaterialOptions
                            .filter((item) => stockOutForm.material_ids.includes(String(item.id)))
                            .map((item) => item.name)
                            .join(', ')
                        : 'No material selected'}
                    </p>
                  </div>
                  <input required disabled={!canManageInventory} type="number" min="1" value={stockOutForm.quantity_issued} onChange={(e) => setStockOutForm({ ...stockOutForm, quantity_issued: Number(e.target.value) })} placeholder="Quantity Issued" className="rounded-xl border border-slate-200 px-4 py-3" />
                  {selectedDistributionBatches.length > 0 && stockOutForm.material_ids.length > 0 && (
                    <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      Total stock needed: <span className="font-semibold">{selectedDistributionBatches.length * Number(stockOutForm.quantity_issued || 0) * stockOutForm.material_ids.length}</span>
                      {' '}({stockOutForm.quantity_issued} each x {selectedDistributionBatches.length} batches x {stockOutForm.material_ids.length} materials)
                    </div>
                  )}
                  <input disabled={!canManageInventory} value={stockOutForm.issued_by} onChange={(e) => setStockOutForm({ ...stockOutForm, issued_by: e.target.value })} placeholder="Issued By" className="rounded-xl border border-slate-200 px-4 py-3" />
                  <textarea disabled={!canManageInventory} value={stockOutForm.remarks} onChange={(e) => setStockOutForm({ ...stockOutForm, remarks: e.target.value })} placeholder="Remarks" className="min-h-[100px] rounded-xl border border-slate-200 px-4 py-3" />
                  <button disabled={!canManageInventory} className={successButtonClass}>
                    Record Batch Distribution
                  </button>
                </form>
              ) : (
                <form onSubmit={handleStudentIssue} className="mt-6 grid gap-4">
                  <input required disabled={!canManageInventory} type="date" value={studentIssueForm.date} onChange={(e) => setStudentIssueForm({ ...studentIssueForm, date: e.target.value })} className="rounded-xl border border-slate-200 px-4 py-3" />
                  <select
                    required
                    disabled={!canManageInventory}
                    value={studentIssueForm.batch_id}
                    onChange={(e) =>
                      setStudentIssueForm({
                        ...studentIssueForm,
                        batch_id: e.target.value,
                        material_ids: [],
                        student_ids: [],
                      })
                    }
                    className="rounded-xl border border-slate-200 px-4 py-3"
                  >
                    <option value="">Select Batch</option>
                    {connectedBatchOptions.filter((batch) => batch.is_active).map((batch) => (
                      <option key={batch.id} value={batch.id}>{batch.name}</option>
                    ))}
                  </select>
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <p className="text-sm font-semibold text-slate-900">Students in Selected Batch</p>
                    <p className="mt-1 text-xs text-slate-500">Yahin se choose karo kis student ko kaunsa material/set issue hua.</p>
                    <div className="mt-4 flex max-h-48 flex-wrap gap-2 overflow-y-auto">
                      {studentIssueBatchStudents.length ? studentIssueBatchStudents.map((student) => {
                        const selected = studentIssueForm.student_ids.includes(String(student.id));
                        return (
                          <button
                            key={student.id}
                            type="button"
                            disabled={!canManageInventory}
                            onClick={() =>
                              setStudentIssueForm((current) => ({
                                ...current,
                                student_ids: selected
                                  ? current.student_ids.filter((id) => id !== String(student.id))
                                  : [...current.student_ids, String(student.id)],
                              }))
                            }
                            className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                              selected
                                ? 'border-blue-600 bg-blue-600 text-white'
                                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
                            }`}
                          >
                            {student.name}
                          </button>
                        );
                      }) : (
                        <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">Batch select karte hi students yahan show honge.</div>
                      )}
                    </div>
                    <p className="mt-3 text-xs text-slate-500">
                      Selected students: {selectedStudentIssueStudents.length ? selectedStudentIssueStudents.map((student) => student.name).join(', ') : 'No student selected'}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <p className="text-sm font-semibold text-slate-900">Books / Materials</p>
                    <p className="mt-1 text-xs text-slate-500">Yahan multiple materials select ho sakte hain. Same quantity har selected student aur har selected material par apply hogi.</p>
                    <div className="mt-4 flex max-h-40 flex-wrap gap-2 overflow-y-auto">
                      {studentIssueMaterialOptions.map((item) => {
                        const selected = studentIssueForm.material_ids.includes(String(item.id));
                        return (
                          <button
                            key={item.id}
                            type="button"
                            disabled={!canManageInventory}
                            onClick={() =>
                              setStudentIssueForm((current) => ({
                                ...current,
                                material_ids: selected
                                  ? current.material_ids.filter((id) => id !== String(item.id))
                                  : [...current.material_ids, String(item.id)],
                              }))
                            }
                            className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                              selected
                                ? 'border-blue-600 bg-blue-600 text-white'
                                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
                            }`}
                          >
                            {item.name} ({item.current_stock})
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-3 text-xs text-slate-500">
                      Selected materials: {studentIssueForm.material_ids.length
                        ? studentIssueMaterialOptions
                            .filter((item) => studentIssueForm.material_ids.includes(String(item.id)))
                            .map((item) => item.name)
                            .join(', ')
                        : 'No material selected'}
                    </p>
                  </div>
                  <input required disabled={!canManageInventory} type="number" min="1" value={studentIssueForm.quantity_issued} onChange={(e) => setStudentIssueForm({ ...studentIssueForm, quantity_issued: Number(e.target.value) })} placeholder="Quantity per Student" className="rounded-xl border border-slate-200 px-4 py-3" />
                  {selectedStudentIssueStudents.length > 0 && studentIssueForm.material_ids.length > 0 && (
                    <div className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-800">
                      Total stock needed: <span className="font-semibold">{selectedStudentIssueStudents.length * Number(studentIssueForm.quantity_issued || 0) * studentIssueForm.material_ids.length}</span>
                      {' '}({studentIssueForm.quantity_issued} each x {selectedStudentIssueStudents.length} students x {studentIssueForm.material_ids.length} materials)
                    </div>
                  )}
                  <input disabled={!canManageInventory} value={studentIssueForm.issued_by} onChange={(e) => setStudentIssueForm({ ...studentIssueForm, issued_by: e.target.value })} placeholder="Issued By" className="rounded-xl border border-slate-200 px-4 py-3" />
                  <textarea disabled={!canManageInventory} value={studentIssueForm.remarks} onChange={(e) => setStudentIssueForm({ ...studentIssueForm, remarks: e.target.value })} placeholder="Remarks" className="min-h-[100px] rounded-xl border border-slate-200 px-4 py-3" />
                  <button disabled={!canManageInventory} className={successButtonClass}>
                    Record Student-wise Issue
                  </button>
                </form>
              )}
            </section>

            <section className="rounded-[1.5rem] bg-white p-5 shadow-xl">
              <h3 className="text-xl font-semibold text-slate-900">Distribution Log</h3>
              <div className="mt-6 space-y-6">
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="text-base font-semibold text-slate-900">Batch-wise Log</h4>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{stockOutEntries.length} records</span>
                  </div>
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-500">
                          <th className="px-4 py-3">Date</th>
                          <th className="px-4 py-3">Batch</th>
                          <th className="px-4 py-3">Material</th>
                          <th className="px-4 py-3">Qty</th>
                          <th className="px-4 py-3">Issued By</th>
                          <th className="px-4 py-3">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stockOutEntries.map((entry) => (
                          <tr key={entry.id} className="border-b border-slate-100">
                            <td className="px-4 py-4">{new Date(entry.date).toLocaleDateString()}</td>
                            <td className="px-4 py-4">{entry.batch_name}</td>
                            <td className="px-4 py-4">{entry.material_name}</td>
                            <td className="px-4 py-4 font-semibold text-amber-600">{entry.quantity_issued}</td>
                            <td className="px-4 py-4">{entry.issued_by}</td>
                            <td className="px-4 py-4">
                              {canManageInventory && (
                                <button type="button" onClick={() => handleDeleteStockOut(entry.id)} className={dangerButtonClass}>
                                  Delete
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                        {!stockOutEntries.length && (
                          <tr>
                            <td colSpan={6} className="px-4 py-6 text-center text-slate-500">No batch-wise distribution records yet.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="text-base font-semibold text-slate-900">Student-wise Log</h4>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{studentIssueSummaries.length} students</span>
                  </div>
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-500">
                          <th className="px-4 py-3">Batch</th>
                          <th className="px-4 py-3">Student</th>
                          <th className="px-4 py-3">Books</th>
                          <th className="px-4 py-3">Titles</th>
                          <th className="px-4 py-3">Latest Issue</th>
                          <th className="px-4 py-3">Issued By</th>
                        </tr>
                      </thead>
                      <tbody>
                        {studentIssueSummaries.map((entry) => (
                          <tr key={entry.key} className="border-b border-slate-100">
                            <td className="px-4 py-4">{entry.batch_name || '-'}</td>
                            <td className="px-4 py-4 font-medium text-slate-900">
                              <button
                                type="button"
                                onClick={() => setSelectedStudentIssueDetail(entry)}
                                className="inline-flex items-center gap-2 transition hover:text-blue-600 hover:underline"
                              >
                                <span>{entry.student_name}</span>
                                <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
                                  {entry.total_books}
                                </span>
                              </button>
                            </td>
                            <td className="px-4 py-4 font-semibold text-blue-600">{entry.total_books}</td>
                            <td className="px-4 py-4">{entry.total_titles}</td>
                            <td className="px-4 py-4">{entry.latest_date ? new Date(entry.latest_date).toLocaleDateString() : '-'}</td>
                            <td className="px-4 py-4">{entry.latest_issued_by || '-'}</td>
                          </tr>
                        ))}
                        {!studentIssueSummaries.length && (
                          <tr>
                            <td colSpan={6} className="px-4 py-6 text-center text-slate-500">No student-wise issue records yet.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </section>
            </div>
          )}

        <OverlayPanel
          open={Boolean(selectedStudentIssueDetail)}
          title={selectedStudentIssueDetail ? `${selectedStudentIssueDetail.student_name} Book Details` : 'Student Book Details'}
          description={
            selectedStudentIssueDetail
              ? `${selectedStudentIssueDetail.batch_name || 'No Batch'} · ${selectedStudentIssueDetail.total_books} book(s) issued`
              : undefined
          }
          onClose={() => setSelectedStudentIssueDetail(null)}
          mode="modal"
        >
          {selectedStudentIssueDetail ? (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl bg-blue-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">Books</p>
                  <p className="mt-2 text-2xl font-bold text-slate-900">{selectedStudentIssueDetail.total_books}</p>
                </div>
                <div className="rounded-2xl bg-amber-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">Titles</p>
                  <p className="mt-2 text-2xl font-bold text-slate-900">{selectedStudentIssueDetail.total_titles}</p>
                </div>
                <div className="rounded-2xl bg-emerald-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Latest Issue</p>
                  <p className="mt-2 text-base font-bold text-slate-900">
                    {selectedStudentIssueDetail.latest_date ? new Date(selectedStudentIssueDetail.latest_date).toLocaleDateString() : '-'}
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-500">
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Book / Material</th>
                      <th className="px-4 py-3">Qty</th>
                      <th className="px-4 py-3">Issued By</th>
                      <th className="px-4 py-3">Remarks</th>
                      <th className="px-4 py-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedStudentIssueDetail.entries.map((entry: StudentIssueEntry) => (
                      <tr key={entry.id} className="border-b border-slate-100">
                        <td className="px-4 py-4">{entry.date ? new Date(entry.date).toLocaleDateString() : '-'}</td>
                        <td className="px-4 py-4 font-medium text-slate-900">{entry.material_name || '-'}</td>
                        <td className="px-4 py-4 font-semibold text-blue-600">{entry.quantity_issued}</td>
                        <td className="px-4 py-4">{entry.issued_by || '-'}</td>
                        <td className="px-4 py-4">{entry.remarks || '-'}</td>
                        <td className="px-4 py-4">
                          {canManageInventory ? (
                            <button type="button" onClick={() => handleDeleteStudentIssue(entry.id)} className={dangerButtonClass}>
                              Delete
                            </button>
                          ) : (
                            <span className="text-slate-400">View only</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </OverlayPanel>

        {activeTab === 'reports' && (
          <div className="space-y-6">
            <section className="rounded-[1.5rem] bg-white p-5 shadow-xl">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-indigo-100 p-3 text-indigo-600">
                  <FileText className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">Inventory Reports & Export</h2>
                  <p className="text-sm text-slate-500">Filter by supplier, batch, material, or date range and export to Excel or PDF.</p>
                </div>
              </div>
              <div className="mt-6 grid gap-4 md:grid-cols-3">
                <MiniActionCard
                  title="Export Excel"
                  description="Generate spreadsheet-ready inventory snapshots."
                  tone="emerald"
                  actionLabel="Excel Ready"
                />
                <MiniActionCard
                  title="Export PDF"
                  description="Create printable inventory summaries for review."
                  tone="red"
                  actionLabel="PDF Ready"
                />
                <MiniActionCard
                  title="Preview Data"
                  description={reportData ? `${reportData.total_records} row(s) loaded in preview.` : 'Run a report to load preview rows.'}
                  tone="indigo"
                  actionLabel="Preview Panel"
                />
              </div>
              <div className="mt-6 grid gap-4 md:grid-cols-3 xl:grid-cols-7">
                <select value={reportFilters.report_type} onChange={(e) => setReportFilters({ ...reportFilters, report_type: e.target.value })} className="rounded-xl border border-slate-200 px-4 py-3">
                  {reportTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <input type="date" value={reportFilters.date_from} onChange={(e) => setReportFilters({ ...reportFilters, date_from: e.target.value })} className="rounded-xl border border-slate-200 px-4 py-3" />
                <input type="date" value={reportFilters.date_to} onChange={(e) => setReportFilters({ ...reportFilters, date_to: e.target.value })} className="rounded-xl border border-slate-200 px-4 py-3" />
                <select value={reportFilters.supplier_id} onChange={(e) => setReportFilters({ ...reportFilters, supplier_id: e.target.value })} className="rounded-xl border border-slate-200 px-4 py-3">
                  <option value="">All suppliers</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                  ))}
                </select>
                <select value={reportFilters.batch_id} onChange={(e) => setReportFilters({ ...reportFilters, batch_id: e.target.value, student_id: '' })} className="rounded-xl border border-slate-200 px-4 py-3">
                  <option value="">All batches</option>
                  {connectedBatchOptions.map((batch) => (
                    <option key={batch.id} value={batch.id}>{batch.name}</option>
                  ))}
                </select>
                <select value={reportFilters.student_id} onChange={(e) => setReportFilters({ ...reportFilters, student_id: e.target.value })} className="rounded-xl border border-slate-200 px-4 py-3">
                  <option value="">All students</option>
                  {reportStudentOptions.map((student) => (
                    <option key={student.id} value={student.id}>{student.name}</option>
                  ))}
                </select>
                <select value={reportFilters.material_id} onChange={(e) => setReportFilters({ ...reportFilters, material_id: e.target.value })} className="rounded-xl border border-slate-200 px-4 py-3">
                  <option value="">All materials</option>
                  {materials.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <button type="button" onClick={handleRunReport} className={primaryButtonClass}>
                  Run Report
                </button>
                <button type="button" onClick={() => handleExportReport('excel')} className={successButtonClass}>
                  <span className="inline-flex items-center gap-2"><Download className="h-4 w-4" />Export Excel</span>
                </button>
                <button type="button" onClick={() => handleExportReport('pdf')} className="rounded-xl bg-gradient-to-r from-rose-500 to-red-600 px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:from-rose-600 hover:to-red-700">
                  <span className="inline-flex items-center gap-2"><FileText className="h-4 w-4" />Export PDF</span>
                </button>
              </div>
            </section>

            <section className="rounded-[2rem] bg-white p-6 shadow-xl">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-semibold text-slate-900">Report Preview</h3>
                  <p className="text-sm text-slate-500">{reportData ? `${reportData.total_records} records found` : 'Run a report to preview results.'}</p>
                </div>
              </div>
              <div className="mt-6 overflow-x-auto">
                {reportData && reportColumns.length > 0 ? (
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-slate-500">
                        {reportColumns.map((column) => (
                          <th key={column} className="px-4 py-3 capitalize">{column.replace(/_/g, ' ')}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.rows.map((row, index) => (
                        <tr key={index} className="border-b border-slate-100">
                          {reportColumns.map((column) => (
                            <td key={column} className="px-4 py-4">{String(row.values[column] ?? '')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="rounded-2xl bg-slate-50 p-5 text-slate-500">No report data available yet.</div>
                )}
              </div>
            </section>
          </div>
        )}
          </div>

        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof BookOpen;
  tone: 'amber' | 'blue' | 'emerald' | 'slate' | 'red';
}) {
  const toneMap = {
    amber: 'bg-amber-100 text-amber-700',
    blue: 'bg-blue-100 text-blue-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    slate: 'bg-slate-100 text-slate-700',
    red: 'bg-rose-100 text-rose-700',
  };

  return (
    <div className="rounded-[1.75rem] bg-white p-5 shadow-lg">
      <div className="flex items-center gap-4">
        <div className={`rounded-2xl p-3 ${toneMap[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
        </div>
      </div>
    </div>
  );
}


function MiniActionCard({
  title,
  description,
  actionLabel,
  tone,
}: {
  title: string;
  description: string;
  actionLabel: string;
  tone: 'amber' | 'blue' | 'emerald' | 'slate' | 'red' | 'indigo';
}) {
  const colors = getFeatureColorClasses(tone);

  return (
    <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold text-slate-900">{title}</h4>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${colors.bg} ${colors.text}`}>
          {actionLabel}
        </span>
      </div>
    </div>
  );
}

function getFeatureColorClasses(color: 'amber' | 'blue' | 'emerald' | 'slate' | 'red' | 'indigo') {
  const colors = {
    amber: {
      bg: 'bg-amber-100',
      text: 'text-amber-700',
      button: 'bg-gradient-to-r from-amber-500 to-orange-500',
    },
    blue: {
      bg: 'bg-blue-100',
      text: 'text-blue-600',
      button: 'bg-gradient-to-r from-blue-500 to-blue-600',
    },
    emerald: {
      bg: 'bg-emerald-100',
      text: 'text-emerald-600',
      button: 'bg-gradient-to-r from-emerald-500 to-emerald-600',
    },
    slate: {
      bg: 'bg-slate-100',
      text: 'text-slate-700',
      button: 'bg-gradient-to-r from-slate-600 to-slate-700',
    },
    red: {
      bg: 'bg-rose-100',
      text: 'text-rose-600',
      button: 'bg-gradient-to-r from-rose-500 to-red-600',
    },
    indigo: {
      bg: 'bg-indigo-100',
      text: 'text-indigo-600',
      button: 'bg-gradient-to-r from-indigo-500 to-indigo-600',
    },
  };

  return colors[color];
}
