import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, FileSpreadsheet, UploadCloud } from 'lucide-react';
import { apiService } from '@services/api';
import {
  STAFF_ADDED_INVIGILATOR_IDS_KEY,
  STAFF_ADDED_TEACHER_IDS_KEY,
  storeEntityId,
  upsertStaffDirectoryRecord,
  type StaffDirectoryRecord,
} from '@utils/staffDirectory';

type UploadRow = {
  staff_type: 'teaching' | 'non_teaching';
  staff_category: string;
  first_name: string;
  middle_name?: string;
  last_name?: string;
  employee_id?: string;
  subject?: string;
  department?: string;
  designation?: string;
  primary_mobile?: string;
  email?: string;
  joining_date?: string;
  shift_timing?: string;
  is_active?: string;
};

const templateHeaders = [
  'staff_type',
  'staff_category',
  'first_name',
  'middle_name',
  'last_name',
  'employee_id',
  'subject',
  'department',
  'designation',
  'primary_mobile',
  'email',
  'joining_date',
  'shift_timing',
  'is_active',
];

const templateRows = [
  ['teaching', 'Teacher', 'Aman', '', 'Sharma', 'T-101', 'Math', '', 'Teacher', '9876543210', 'aman@example.com', '2026-04-01', '8 AM - 3 PM', 'true'],
  ['non_teaching', 'Driver', 'Rakesh', '', 'Kumar', 'NT-201', '', 'Transport', 'Driver', '9876500000', 'rakesh@example.com', '2026-04-03', '7 AM - 4 PM', 'true'],
];

const parseCsvLine = (line: string) => {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result.map((item) => item.replace(/^"|"$/g, '').trim());
};

const toCsv = (rows: string[][]) =>
  rows
    .map((row) =>
      row
        .map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`)
        .join(',')
    )
    .join('\n');

const normalizeKey = (value?: string) => (value || '').trim().toLowerCase();
const hasMeaningfulValue = (value?: string) => Boolean((value || '').trim());
const getErrorDetail = (error: any) => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const loc = Array.isArray(item.loc) ? item.loc.join('.') : '';
          const msg = item.msg || item.message || 'Invalid value';
          return loc ? `${loc}: ${msg}` : msg;
        }
        return String(item);
      })
      .join(', ');
  }
  return error?.message || 'save failed';
};

export default function StaffBulkUpload() {
  const navigate = useNavigate();
  const [fileName, setFileName] = useState('');
  const [summary, setSummary] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const instructions = useMemo(
    () => [
      'Template ko Excel mein open karo, rows fill karo, aur CSV format mein save karo.',
      '`staff_type` mein sirf `teaching` ya `non_teaching` use karo.',
      '`first_name` required hai. `last_name` optional hai, single-name staff bhi chalega.',
      'Teaching row ke liye `subject` required hai.',
      'Non-teaching row ke liye `employee_id` aur `staff_category` dena best rahega.',
    ],
    []
  );

  const downloadTemplate = () => {
    const csv = toCsv([templateHeaders, ...templateRows]);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'staff_bulk_upload_template.csv';
    anchor.click();
    window.URL.revokeObjectURL(url);
  };

  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setSummary('');
      setErrors(['Abhi bulk upload ke liye Excel-exported CSV file supported hai. File ko Excel se CSV mein save karke upload karo.']);
      return;
    }

    setFileName(file.name);
    setErrors([]);
    setSummary('');

    try {
      setUploading(true);
      const [teachersRes, invigilatorsRes] = await Promise.all([
        apiService.listTeachers(1, 0, 1000),
        apiService.listInvigilators(1, undefined, 0, 1000),
      ]);

      const existingTeacherKeys = new Set(
        teachersRes.data.map((item) => `${normalizeKey(item.name)}::${normalizeKey(item.subject)}`)
      );
      const existingInvigilatorIds = new Set(
        invigilatorsRes.data.map((item) => normalizeKey(item.staff_id))
      );
      const pendingTeacherKeys = new Set<string>();
      const pendingInvigilatorIds = new Set<string>();

      const content = await file.text();
      const lines = content.split(/\r?\n/).filter((item) => item.trim());
      if (lines.length < 2) {
        setErrors(['CSV file mein kam se kam 1 data row honi chahiye.']);
        return;
      }

      const headers = parseCsvLine(lines[0]).map((item) => item.toLowerCase().replace(/^\ufeff/, ''));
      const headerMap = new Map(headers.map((item, index) => [item, index]));

      const missingHeaders = templateHeaders.filter((header) => !headerMap.has(header));
      if (missingHeaders.length) {
        setErrors([`Missing columns: ${missingHeaders.join(', ')}`]);
        return;
      }

      let imported = 0;
      let skipped = 0;
      const rowErrors: string[] = [];

      for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
        const cells = parseCsvLine(lines[lineIndex]);
        const row = Object.fromEntries(
          templateHeaders.map((header) => [header, cells[headerMap.get(header) ?? -1] || ''])
        ) as UploadRow;

        const rowHasData = [
          row.staff_type,
          row.staff_category,
          row.first_name,
          row.middle_name,
          row.last_name,
          row.employee_id,
          row.subject,
          row.department,
          row.designation,
          row.primary_mobile,
          row.email,
          row.joining_date,
          row.shift_timing,
          row.is_active,
        ].some((value) => hasMeaningfulValue(value));

        if (!rowHasData) {
          continue;
        }

        const staffType = row.staff_type === 'teaching' ? 'teaching' : row.staff_type === 'non_teaching' ? 'non_teaching' : null;
        if (!staffType) {
          rowErrors.push(`Row ${lineIndex + 1}: invalid staff_type.`);
          continue;
        }
        if (!row.first_name) {
          rowErrors.push(`Row ${lineIndex + 1}: first_name required hai.`);
          continue;
        }
        if (staffType === 'teaching' && !row.subject) {
          rowErrors.push(`Row ${lineIndex + 1}: teaching row ke liye subject required hai.`);
          continue;
        }
        if (staffType === 'non_teaching' && !row.employee_id) {
          rowErrors.push(`Row ${lineIndex + 1}: non_teaching row ke liye employee_id required hai.`);
          continue;
        }

        const fullName = [row.first_name, row.middle_name, row.last_name].filter(Boolean).join(' ').trim();
        const isActive = String(row.is_active || 'true').toLowerCase() !== 'false';

        try {
          if (staffType === 'teaching') {
            const teacherKey = `${normalizeKey(fullName)}::${normalizeKey(row.subject)}`;
            if (existingTeacherKeys.has(teacherKey) || pendingTeacherKeys.has(teacherKey)) {
              skipped += 1;
              rowErrors.push(`Row ${lineIndex + 1}: teacher already exists, so row skipped.`);
              continue;
            }

            const createdTeacher = await apiService.createTeacher({
              name: fullName,
              subject: row.subject,
              email: row.email || undefined,
              phone: row.primary_mobile || undefined,
              is_active: isActive,
            });
            storeEntityId(STAFF_ADDED_TEACHER_IDS_KEY, createdTeacher.data.id);
            const record: StaffDirectoryRecord = {
              id: `teacher-${createdTeacher.data.id}-${Date.now()}-${lineIndex}`,
              backendId: createdTeacher.data.id,
              backendType: 'teaching',
              staffType: 'teaching',
              category: row.staff_category || 'Teacher',
              firstName: row.first_name,
              middleName: row.middle_name || undefined,
              lastName: row.last_name,
              fullName,
              employeeId: row.employee_id || undefined,
              subject: row.subject || undefined,
              designation: row.designation || row.staff_category || 'Teacher',
              phone: row.primary_mobile || undefined,
              email: row.email || undefined,
              joiningDate: row.joining_date || undefined,
              shiftTiming: row.shift_timing || undefined,
              isActive,
              createdAt: new Date().toISOString(),
            };
            upsertStaffDirectoryRecord(record);
            existingTeacherKeys.add(teacherKey);
            pendingTeacherKeys.add(teacherKey);
          } else {
            const staffIdKey = normalizeKey(row.employee_id);
            if (existingInvigilatorIds.has(staffIdKey) || pendingInvigilatorIds.has(staffIdKey)) {
              skipped += 1;
              rowErrors.push(`Row ${lineIndex + 1}: employee_id already exists, so row skipped.`);
              continue;
            }

            const createdStaff = await apiService.createInvigilator({
              staff_id: row.employee_id,
              name: fullName,
              email: row.email || undefined,
              phone: row.primary_mobile || undefined,
              department: row.department || row.staff_category || 'General Staff',
              designation: row.designation || row.staff_category || 'Non-Teaching Staff',
              is_active: isActive,
            });
            storeEntityId(STAFF_ADDED_INVIGILATOR_IDS_KEY, createdStaff.data.id);
            const record: StaffDirectoryRecord = {
              id: `staff-${createdStaff.data.id}-${Date.now()}-${lineIndex}`,
              backendId: createdStaff.data.id,
              backendType: 'non_teaching',
              staffType: 'non_teaching',
              category: row.staff_category || 'Non-Teaching Staff',
              firstName: row.first_name,
              middleName: row.middle_name || undefined,
              lastName: row.last_name,
              fullName,
              employeeId: row.employee_id || undefined,
              department: row.department || row.staff_category || 'General Staff',
              designation: row.designation || row.staff_category || 'Non-Teaching Staff',
              phone: row.primary_mobile || undefined,
              email: row.email || undefined,
              joiningDate: row.joining_date || undefined,
              shiftTiming: row.shift_timing || undefined,
              isActive,
              createdAt: new Date().toISOString(),
            };
            upsertStaffDirectoryRecord(record);
            existingInvigilatorIds.add(staffIdKey);
            pendingInvigilatorIds.add(staffIdKey);
          }

          imported += 1;
        } catch (error: any) {
          rowErrors.push(`Row ${lineIndex + 1}: ${getErrorDetail(error)}`);
        }
      }

      setSummary(`${imported} staff record(s) import ho gaye.${skipped ? ` ${skipped} duplicate row(s) skip hui.` : ''}`);
      setErrors(rowErrors);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-5xl">
        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Staff Bulk Upload</h1>
              <p className="mt-2 text-sm text-slate-500">Excel mein template fill karke CSV save karo, phir yahan upload karo.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={downloadTemplate}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                <Download className="h-4 w-4" />
                Download Template
              </button>
              <button
                type="button"
                onClick={() => navigate('/staff/directory')}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
              >
                <FileSpreadsheet className="h-4 w-4" />
                Open Directory
              </button>
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-3xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-900">Upload Instructions</h2>
          <div className="mt-4 space-y-2 text-sm text-slate-600">
            {instructions.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>

          <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-3 text-center">
              <div className="rounded-full bg-white p-4 shadow-sm">
                <UploadCloud className="h-6 w-6 text-indigo-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">{uploading ? 'Uploading...' : 'Excel-exported CSV choose karo'}</p>
                <p className="mt-1 text-xs text-slate-500">{fileName || 'Supported format: .csv'}</p>
              </div>
              <input type="file" accept=".csv" className="hidden" onChange={handleFileSelected} />
              <span className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
                Select File
              </span>
            </label>
          </div>

          {summary ? <div className="mt-4 rounded-xl bg-emerald-100 px-4 py-3 text-sm font-medium text-emerald-800">{summary}</div> : null}
          {errors.length ? (
            <div className="mt-4 rounded-xl bg-rose-100 px-4 py-3 text-sm text-rose-700">
              {errors.map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
