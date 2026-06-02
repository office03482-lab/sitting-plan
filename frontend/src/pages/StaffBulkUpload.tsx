import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, FileSpreadsheet, UploadCloud } from 'lucide-react';
import { apiService, getRequestErrorMessage } from '@services/api';

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.URL.revokeObjectURL(url);
};

export default function StaffBulkUpload() {
  const navigate = useNavigate();
  const [fileName, setFileName] = useState('');
  const [summary, setSummary] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const instructions = useMemo(
    () => [
      'Template Add Staff form ke hisaab se aligned hai.',
      'File ko `.xlsx` format me hi upload karo.',
      '`STAFF TYPE` me `teaching` ya `non_teaching` use karo.',
      '`FIRST NAME` aur `EMPLOYEE ID` required hain.',
      'Teaching row ke liye `SUBJECT` ya `DEPARTMENT` dena zaroori hai.',
      'Source sheet ke extra columns upload ke waqt notes/metadata me preserve ho jayenge.',
    ],
    []
  );

  const downloadTemplate = async () => {
    try {
      setDownloading(true);
      setSummary('');
      setErrors([]);
      const response = await apiService.downloadStaffTemplate();
      downloadBlob(response.data, 'staff_data_template.xlsx');
    } catch (error: any) {
      setErrors([getRequestErrorMessage(error, 'Staff template download failed.')]);
    } finally {
      setDownloading(false);
    }
  };

  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setSummary('');
      setErrors(['Please select a valid Excel file (.xlsx).']);
      return;
    }

    setFileName(file.name);
    setErrors([]);
    setSummary('');

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append('file', file);
      const response = await apiService.importStaffWorkbook(formData);
      const data = response.data || {};
      setSummary(
        data.message
        || `Imported ${data.imported_count || 0} staff, updated ${data.updated_count || 0}, skipped ${data.skipped_count || 0}.`
      );
      setErrors(
        Array.isArray(data.errors)
          ? data.errors.map((item: any) => {
              if (typeof item === 'string') return item;
              const employeeId = item?.employee_id ? `Employee ID ${item.employee_id}: ` : '';
              return `${employeeId}${item?.error || 'Unknown row error'}`;
            })
          : []
      );
    } catch (error: any) {
      setErrors([getRequestErrorMessage(error, 'Staff import failed.')]);
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
              <p className="mt-2 text-sm text-slate-500">Form-aligned Excel template download karo, fill karo, aur direct `.xlsx` upload karo.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={downloadTemplate}
                disabled={downloading}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Download className="h-4 w-4" />
                {downloading ? 'Downloading...' : 'Download Template'}
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
                <p className="text-sm font-semibold text-slate-900">{uploading ? 'Uploading...' : 'Staff workbook choose karo'}</p>
                <p className="mt-1 text-xs text-slate-500">{fileName || 'Supported format: .xlsx'}</p>
              </div>
              <input type="file" accept=".xlsx" className="hidden" onChange={handleFileSelected} />
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
