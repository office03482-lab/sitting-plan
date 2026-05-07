import { useState, useEffect } from 'react';
import { Upload, Download, CheckCircle, XCircle, Eye, Users, MapPin, AlertTriangle, Trash2 } from 'lucide-react';
import { apiService } from '@services/api';
import type { RoomLayout, SeatingPlan, Student } from '@types';


interface ImportResult {
  success: boolean;
  imported_count: number;
  skipped_count: number;
  errors: Array<{row?: number, roll_no?: string, error: string}>;
  room_summary: Record<string, number>;
}

const extractBatchesFromPlanName = (planName: string) => {
  const labeledMatch = planName.match(/Batches:\s*(.+?)\s*-\s*Plan\s+[AB]\b/i);
  if (labeledMatch?.[1]) {
    return labeledMatch[1].trim();
  }

  const legacyMatch = planName.match(/Batches\s+(.+)$/i);
  return legacyMatch?.[1]?.trim() || '';
};

export default function SeatingPlanManagement() {
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [plans, setPlans] = useState<SeatingPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<SeatingPlan | null>(null);
  const [previewLayout, setPreviewLayout] = useState<RoomLayout | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [deleteAllConfirm, setDeleteAllConfirm] = useState(false);
  const [deletePlanConfirm, setDeletePlanConfirm] = useState<SeatingPlan | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [deletingPlan, setDeletingPlan] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadStudents();
    loadPlans();
  }, []);

  const loadStudents = async () => {
    setUploading(true);
    try {
      const response = await apiService.listStudents();
      setStudents(response.data);
    } catch (error) {
      console.error('Failed to load students:', error);
    } finally {
      setUploading(false);
    }
  };

  const loadPlans = async () => {
    try {
      const response = await apiService.listAllPlans();
      setPlans(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('Failed to load seating plans:', error);
      setMessage('Failed to load generated seating plans');
    }
  };

  const handlePreviewPlan = async (plan: SeatingPlan) => {
    setSelectedPlan(plan);
    setPreviewLoading(true);
    setMessage('');

    try {
      const response = await apiService.getPlanLayout(plan.id);
      setPreviewLayout(response.data);
    } catch (error: any) {
      console.error('Failed to load seating plan preview:', error);
      setPreviewLayout(null);
      setMessage(error?.response?.data?.detail || 'Failed to load seating plan preview');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDeleteAllPlans = async () => {
    if (!deleteAllConfirm) return;

    setDeletingAll(true);
    try {
      await apiService.deleteAllSeatingPlans(true);
      setPlans([]);
      setSelectedPlan(null);
      setPreviewLayout(null);
      setDeleteAllConfirm(false);
      setMessage('');
    } catch (error: any) {
      console.error('Failed to delete all seating plans:', error);
      setMessage(error?.response?.data?.detail || 'Failed to delete all seating plans');
    } finally {
      setDeletingAll(false);
    }
  };

  const handleDeletePlan = async () => {
    if (!deletePlanConfirm) return;

    setDeletingPlan(true);
    try {
      await apiService.deleteSeatingPlan(deletePlanConfirm.id);
      setPlans((current) => current.filter((plan) => plan.id !== deletePlanConfirm.id));
      if (selectedPlan?.id === deletePlanConfirm.id) {
        setSelectedPlan(null);
        setPreviewLayout(null);
      }
      setDeletePlanConfirm(null);
      setMessage('Seating plan deleted successfully');
    } catch (error: any) {
      console.error('Failed to delete seating plan:', error);
      setMessage(error?.response?.data?.detail || 'Failed to delete seating plan');
    } finally {
      setDeletingPlan(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.toLowerCase().endsWith('.xlsx')) {
        alert('Please select a valid Excel file (.xlsx)');
        return;
      }
      setSelectedFile(file);
      setImportResult(null);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const response = await fetch('/api/seating/template/download');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'seating_plan_template.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download template:', error);
      alert('Failed to download template. Please try again.');
    }
  };

  const handlePreview = async () => {
    if (!selectedFile) return;

    setUploading(true);
    try {
      // For now, we'll directly upload and get validation from backend
      // TODO: Add frontend Excel parsing with xlsx library
      const formData = new FormData();
      formData.append('file', selectedFile);

      // Try to import (this will validate and return errors if any)
      const response = await apiService.importSeatingPlan(formData);

      if (!response.data.success) {
        setImportResult(response.data);
        return;
      }

      // If successful, reload students and show success
      await loadStudents();
      await loadPlans();
      setImportResult(response.data);
      setSelectedFile(null);

    } catch (error: any) {
      console.error('Preview failed:', error);
      const errorMessage =
        error?.response?.data?.detail ||
        error?.response?.data?.errors?.[0]?.error ||
        error?.message ||
        'Failed to process file';
      setImportResult({
        success: false,
        imported_count: 0,
        skipped_count: 0,
        errors: [{ error: errorMessage }],
        room_summary: {}
      });
    } finally {
      setUploading(false);
    }
  };

  const SeatPreview = ({ seat }: { seat: RoomLayout['desks'][number]['seats'][number] }) => {
    const colorByBatch: Record<string, string> = {
      '11th': 'bg-blue-100 border-blue-300',
      '12th': 'bg-green-100 border-green-300',
      'Dropper 1': 'bg-yellow-100 border-yellow-300',
      'Dropper 2': 'bg-orange-100 border-orange-300',
      'Dropper 3': 'bg-red-100 border-red-300',
      'Dropper 4': 'bg-pink-100 border-pink-300',
      'Dropper 5': 'bg-indigo-100 border-indigo-300',
      'Dropper 6': 'bg-purple-100 border-purple-300',
      'Dropper 7': 'bg-cyan-100 border-cyan-300',
      'Dropper 8': 'bg-teal-100 border-teal-300',
      'Dropper 9': 'bg-lime-100 border-lime-300',
      'Dropper 10': 'bg-amber-100 border-amber-300',
    };

    if (!seat.is_occupied) {
      return (
        <div className="min-h-[72px] rounded border border-dashed border-gray-300 bg-white p-2 text-xs text-gray-400">
          Empty
        </div>
      );
    }

    return (
      <div className={`min-h-[72px] rounded border p-2 text-xs ${colorByBatch[seat.batch || ''] || 'bg-gray-100 border-gray-300'}`}>
        <p className="truncate font-bold text-gray-900">{seat.student_roll || 'No roll'}</p>
        <p className="truncate text-gray-800">{seat.student_name || 'Assigned student'}</p>
        <p className="truncate text-gray-600">{seat.batch || '-'}</p>
      </div>
    );
  };

  const SeatingPreview = ({ layout }: { layout: RoomLayout }) => {
    const maxCol = Math.max(...layout.desks.map((desk) => desk.col)) + 1;
    const maxRow = Math.max(...layout.desks.map((desk) => desk.row)) + 1;

    return (
      <div className="overflow-x-auto">
        <div
          className="inline-grid gap-2"
          style={{ gridTemplateColumns: `repeat(${maxCol}, minmax(128px, 1fr))` }}
        >
          {Array.from({ length: maxRow * maxCol }).map((_, index) => {
            const row = Math.floor(index / maxCol);
            const col = index % maxCol;
            const desk = layout.desks.find((item) => item.row === row && item.col === col);

            if (!desk) {
              return (
                <div
                  key={`${row}-${col}`}
                  className="min-h-[152px] rounded border border-dashed border-gray-200 bg-gray-50"
                />
              );
            }

            return (
              <div key={desk.desk_id} className="rounded border border-gray-300 bg-gray-50 p-2">
                <p className="mb-2 text-xs font-semibold text-gray-600">Desk {desk.desk_id}</p>
                <div className="grid gap-2">
                  {desk.seats.map((seat) => (
                    <SeatPreview key={seat.seat_id} seat={seat} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const getPlanRoom = (plan: SeatingPlan) => plan.room_name || `Room ${plan.room_id}`;
  const getPlanBatches = (plan: SeatingPlan) => {
    if (plan.batches && plan.batches.length > 0) {
      return plan.batches.join(', ');
    }

    const parsedBatches = extractBatchesFromPlanName(plan.name);
    return parsedBatches || 'Mixed / Legacy Plan';
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

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Seating Plan Management</h1>
          <p className="text-gray-600">Upload and manage student seating arrangements from Excel</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow-md p-5">
            <p className="text-sm text-gray-600">Available Students</p>
            <p className="text-2xl font-bold text-gray-900">{students.length}</p>
          </div>
          <div className="bg-white rounded-lg shadow-md p-5">
            <p className="text-sm text-gray-600">Batches</p>
            <p className="text-2xl font-bold text-gray-900">{new Set(students.map((student) => student.batch)).size}</p>
          </div>
          <div className="bg-white rounded-lg shadow-md p-5">
            <p className="text-sm text-gray-600">Seat Source</p>
            <p className="text-base font-semibold text-gray-900">Student Management Data</p>
          </div>
        </div>

        {message && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
            {message}
          </div>
        )}

        {/* Generated Seating Plan Preview */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-800">Generated Seating Plans</h2>
            <div className="flex gap-3">
              <button
                onClick={loadPlans}
                className="rounded-lg bg-gray-700 px-4 py-2 text-white hover:bg-gray-800"
              >
                Refresh
              </button>
              {plans.length > 0 && (
                <button
                  onClick={() => setDeleteAllConfirm(true)}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700"
                >
                  <AlertTriangle className="h-4 w-4" />
                  Delete All
                </button>
              )}
            </div>
          </div>

          {plans.length === 0 ? (
            <p className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
              No generated seating plans found. Generate plans first, then return here to preview them.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Room</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Batch</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Students</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Generated Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {plans.map((plan) => (
                    <tr key={plan.id} className={selectedPlan?.id === plan.id ? 'bg-blue-50' : ''}>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{getPlanRoom(plan)}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{getPlanBatches(plan)}</td>
                      <td className="px-4 py-3 text-sm capitalize text-gray-600">{plan.plan_type}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{plan.students_assigned}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{formatGeneratedDate(plan.created_at)}</td>
                      <td className="px-4 py-3 text-sm capitalize text-gray-600">{plan.status}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => handlePreviewPlan(plan)}
                            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
                          >
                            <Eye className="h-4 w-4" />
                            Preview
                          </button>
                          <button
                            onClick={() => setDeletePlanConfirm(plan)}
                            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700"
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(selectedPlan || previewLoading) && (
            <div className="mt-8 border-t border-gray-200 pt-6">
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  {selectedPlan ? `${getPlanRoom(selectedPlan)} - ${selectedPlan.plan_type}` : 'Seating Preview'}
                </h3>
                {previewLayout && (
                  <p className="text-sm text-gray-600">
                    Batch: {selectedPlan ? getPlanBatches(selectedPlan) : '-'} | Occupied: {previewLayout.occupied} / {previewLayout.capacity}
                  </p>
                )}
              </div>

              {previewLoading ? (
                <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">Loading preview...</p>
              ) : previewLayout ? (
                <SeatingPreview layout={previewLayout} />
              ) : (
                <p className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
                  Preview data is not available for this plan.
                </p>
              )}
            </div>
          )}
        </div>

        {deleteAllConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-lg">
              <h3 className="mb-2 text-lg font-semibold text-gray-900">Delete All Seating Plans?</h3>
              <p className="mb-6 text-sm text-gray-600">
                This will delete all generated seating plans. This action cannot be undone.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setDeleteAllConfirm(false)}
                  disabled={deletingAll}
                  className="rounded-lg bg-gray-100 px-4 py-2 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteAllPlans}
                  disabled={deletingAll}
                  className="rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {deletingAll ? 'Deleting...' : 'Delete All'}
                </button>
              </div>
            </div>
          </div>
        )}

        {deletePlanConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-lg">
              <h3 className="mb-2 text-lg font-semibold text-gray-900">Delete Seating Plan?</h3>
              <p className="mb-6 text-sm text-gray-600">
                {getPlanRoom(deletePlanConfirm)} ka selected seating plan permanently delete ho jayega.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setDeletePlanConfirm(null)}
                  disabled={deletingPlan}
                  className="rounded-lg bg-gray-100 px-4 py-2 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeletePlan}
                  disabled={deletingPlan}
                  className="rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {deletingPlan ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Upload Section */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-800">Upload Seating Plan</h2>
            <button
              onClick={handleDownloadTemplate}
              className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              <Download className="w-4 h-4 mr-2" />
              Download Template
            </button>
          </div>

          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
            <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <div className="mb-4">
              <label htmlFor="file-upload" className="cursor-pointer">
                <span className="text-blue-600 hover:text-blue-800 font-medium">Click to upload</span>
                <span className="text-gray-500"> or drag and drop</span>
              </label>
              <input
                id="file-upload"
                type="file"
                accept=".xlsx"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Only .xlsx Excel files are supported. Use the template format with columns: SR. NO, ROLL NO, CANDIDATE NAME, FATHER NAME, BATCH, ROOM NO
            </p>
            {selectedFile && (
              <div className="flex items-center justify-center space-x-2 text-green-600">
                <CheckCircle className="w-4 h-4" />
                <span>{selectedFile.name}</span>
              </div>
            )}
          </div>

          {selectedFile && (
            <div className="mt-6 flex space-x-4">
              <button
                onClick={handlePreview}
                disabled={uploading}
                className="flex items-center px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                <Eye className="w-4 h-4 mr-2" />
                {uploading ? 'Validating...' : 'Validate & Import'}
              </button>
            </div>
          )}
        </div>

        {/* Import Results */}
        {importResult && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-8">
            <h3 className="text-lg font-semibold mb-4 flex items-center">
              {importResult.success ? (
                <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
              ) : (
                <XCircle className="w-5 h-5 text-red-500 mr-2" />
              )}
              Import Results
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div className="bg-green-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-green-600">{importResult.imported_count}</div>
                <div className="text-sm text-green-800">Imported</div>
              </div>
              <div className="bg-yellow-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-yellow-600">{importResult.skipped_count}</div>
                <div className="text-sm text-yellow-800">Skipped</div>
              </div>
              <div className="bg-red-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-red-600">{importResult.errors.length}</div>
                <div className="text-sm text-red-800">Errors</div>
              </div>
            </div>

            {importResult.errors.length > 0 && (
              <div className="mt-4">
                <h4 className="font-medium text-red-800 mb-2">Errors:</h4>
                <div className="bg-red-50 border border-red-200 rounded p-4 max-h-40 overflow-y-auto">
                  {importResult.errors.map((error, index) => (
                    <div key={index} className="text-sm text-red-700 mb-1">
                      {error.row && `Row ${error.row}: `}{error.roll_no && `${error.roll_no}: `}{error.error}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {Object.keys(importResult.room_summary).length > 0 && (
              <div className="mt-4">
                <h4 className="font-medium text-blue-800 mb-2">Room Summary:</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {Object.entries(importResult.room_summary).map(([room, count]) => (
                    <div key={room} className="bg-blue-50 p-2 rounded text-center">
                      <div className="font-medium text-blue-800">{room}</div>
                      <div className="text-sm text-blue-600">{count} students</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Room-wise Summary */}
        {importResult?.room_summary && Object.keys(importResult.room_summary).length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Object.entries(importResult.room_summary).map(([room, count]) => (
              <div key={room} className="bg-white rounded-lg shadow-md p-6">
                <div className="flex items-center mb-4">
                  <MapPin className="w-5 h-5 text-blue-600 mr-2" />
                  <h3 className="text-lg font-semibold text-gray-800">{room}</h3>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <Users className="w-4 h-4 text-gray-500 mr-1" />
                    <span className="text-sm text-gray-600">{count} students</span>
                  </div>
                  <button
                    onClick={() => {/* TODO: Export room-wise PDF */}}
                    className="text-blue-600 hover:text-blue-800 text-sm"
                  >
                    Export PDF
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
