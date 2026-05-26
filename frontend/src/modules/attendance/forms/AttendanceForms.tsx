// @ts-nocheck
import { Search } from 'lucide-react';
import { SelectField } from '../components/AttendancePrimitives';
import { inputClass } from '../utils/attendanceUtils';

export function StudentMarkingFilters({ vm }: { vm: any }) {
  return (
    <>
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Date</p>
          <input
            type="date"
            value={vm.studentFilters.date}
            onChange={(e) => vm.setStudentFilters({ ...vm.studentFilters, date: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Batch</p>
          <SelectField
            value={vm.studentFilters.batch_name}
            onChange={(e) => vm.setStudentFilters({ ...vm.studentFilters, batch_name: e.target.value })}
          >
            <option value="">Batch</option>
            {vm.batchOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </SelectField>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Subject</p>
          <SelectField
            value={vm.studentFilters.subject_id}
            onChange={(e) => vm.setStudentFilters({ ...vm.studentFilters, subject_id: e.target.value })}
            disabled={!vm.studentFilters.batch_name || !vm.batchSubjectOptions.length}
          >
            <option value="">
              {!vm.studentFilters.batch_name
                ? 'Select batch first'
                : vm.batchSubjectOptions.length
                  ? 'Select subject'
                  : 'No subject available'}
            </option>
            {vm.batchSubjectOptions.map((item) => (
              <option key={item.id} value={String(item.id)}>
                {item.name}
              </option>
            ))}
          </SelectField>
        </div>
      </div>

      <div className="mt-4 flex gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={vm.studentFilters.search}
            onChange={(e) => vm.setStudentFilters({ ...vm.studentFilters, search: e.target.value })}
            className="w-full rounded-2xl border border-slate-300 bg-white py-3 pl-11 pr-4 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-200/70"
            placeholder="Search student by name"
          />
        </div>
        <button
          onClick={vm.loadStudentMarking}
          className="rounded-full bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          Load
        </button>
      </div>
    </>
  );
}

export function StudentRecordFilters({ vm }: { vm: any }) {
  const classOptions = vm.managedClassOptions || [];
  const batchOptions = vm.managedBatchOptions || [];
  return (
    <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      <SelectField
        value={vm.studentFilters.record_class_name}
        onChange={(e) => vm.setStudentFilters({ ...vm.studentFilters, record_class_name: e.target.value, record_batch_name: '' })}
      >
        <option value="">All Classes</option>
        {classOptions.map((item: string) => (
          <option key={item} value={item}>{item}</option>
        ))}
      </SelectField>
      <SelectField
        value={vm.studentFilters.record_batch_name}
        onChange={(e) => vm.setStudentFilters({ ...vm.studentFilters, record_batch_name: e.target.value })}
      >
        <option value="">All Batches</option>
        {batchOptions
          .filter((item: string) => !vm.studentFilters.record_class_name || item.startsWith(vm.studentFilters.record_class_name))
          .map((item: string) => (
          <option key={item} value={item}>{item}</option>
        ))}
      </SelectField>
      <input
        value={vm.studentFilters.recordStudentName}
        onChange={(e) => vm.setStudentFilters({ ...vm.studentFilters, recordStudentName: e.target.value })}
        className={inputClass}
        placeholder="Student name"
      />
      <input
        type="date"
        value={vm.studentFilters.date_from}
        onChange={(e) => vm.setStudentFilters({ ...vm.studentFilters, date_from: e.target.value })}
        className={inputClass}
      />
      <input
        type="date"
        value={vm.studentFilters.date_to}
        onChange={(e) => vm.setStudentFilters({ ...vm.studentFilters, date_to: e.target.value })}
        className={inputClass}
      />
    </div>
  );
}

export function StaffMarkingFilters({ vm }: { vm: any }) {
  return (
    <>
      <div className="mt-6 grid gap-4 md:grid-cols-4">
        <input
          type="date"
          value={vm.staffFilters.date}
          onChange={(e) => vm.setStaffFilters({ ...vm.staffFilters, date: e.target.value })}
          className={inputClass}
        />
        <SelectField
          value={vm.staffFilters.staffType}
          onChange={(e) =>
            vm.setStaffFilters({
              ...vm.staffFilters,
              staffType: e.target.value,
              department: '',
            })
          }
        >
          <option value="all">All Staff</option>
          <option value="teaching">Teaching</option>
          <option value="non_teaching">Non-Teaching</option>
        </SelectField>
        <SelectField
          value={vm.staffFilters.department}
          onChange={(e) => vm.setStaffFilters({ ...vm.staffFilters, department: e.target.value })}
        >
          <option value="">Department</option>
          {vm.markStaffDepartmentOptions.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </SelectField>
        <input
          value={vm.staffFilters.search}
          onChange={(e) => vm.setStaffFilters({ ...vm.staffFilters, search: e.target.value })}
          className={inputClass}
          placeholder="Search staff"
        />
      </div>
      <button
        onClick={vm.loadStaffMarking}
        className="mt-4 rounded-full bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700"
      >
        Load Staff
      </button>
    </>
  );
}

export function StaffRecordFilters({ vm }: { vm: any }) {
  return (
    <div className="mt-6 grid gap-4 md:grid-cols-3">
      <input
        value={vm.staffFilters.recordStaffName}
        onChange={(e) => vm.setStaffFilters({ ...vm.staffFilters, recordStaffName: e.target.value })}
        className={inputClass}
        placeholder={vm.isTeacherSelfView ? 'My name' : 'Staff name'}
      />
      {!vm.isTeacherSelfView ? (
        <SelectField
          value={vm.staffFilters.recordDepartment}
          onChange={(e) => vm.setStaffFilters({ ...vm.staffFilters, recordDepartment: e.target.value })}
        >
          <option value="">Department</option>
          {vm.departmentOptions.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </SelectField>
      ) : (
        <div />
      )}
      <input
        type="date"
        value={vm.staffFilters.recordDate}
        onChange={(e) => vm.setStaffFilters({ ...vm.staffFilters, recordDate: e.target.value })}
        className={inputClass}
      />
    </div>
  );
}

export function HolidayCreateForm({ vm }: { vm: any }) {
  return (
    <form onSubmit={vm.handleCreateHoliday} className="grid gap-3 md:grid-cols-3">
      <input
        value={vm.holidayForm.title}
        onChange={(e) => vm.setHolidayForm({ ...vm.holidayForm, title: e.target.value })}
        className={inputClass}
        placeholder="Holiday title"
      />
      <input
        type="date"
        value={vm.holidayForm.holiday_date}
        onChange={(e) => vm.setHolidayForm({ ...vm.holidayForm, holiday_date: e.target.value })}
        className={inputClass}
      />
      <input
        value={vm.holidayForm.description}
        onChange={(e) => vm.setHolidayForm({ ...vm.holidayForm, description: e.target.value })}
        className={inputClass}
        placeholder="Description"
      />
      <button className="rounded-full bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700 md:col-span-3">
        Add Holiday
      </button>
    </form>
  );
}

export function LeaveApplicationForm({ vm }: { vm: any }) {
  return (
    <form onSubmit={vm.handleCreateLeave} className="mt-6 grid gap-4">
      {vm.isTeacherSelfView ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Applying leave for:{' '}
          <span className="font-semibold text-slate-900">
            {vm.staffMembers[0]?.name || vm.user?.full_name || 'Teacher'}
          </span>
        </div>
      ) : (
        <SelectField
          value={vm.leaveForm.staff_member_id}
          onChange={(e) => vm.setLeaveForm({ ...vm.leaveForm, staff_member_id: e.target.value })}
        >
          <option value="">Staff Member</option>
          {vm.staffMembers.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </SelectField>
      )}
      <SelectField
        value={vm.leaveForm.leave_type}
        onChange={(e) => vm.setLeaveForm({ ...vm.leaveForm, leave_type: e.target.value })}
      >
        <option value="casual">Casual Leave</option>
        <option value="sick">Sick Leave</option>
        <option value="paid">Paid Leave</option>
        <option value="emergency">Emergency Leave</option>
      </SelectField>
      <div className="grid gap-4 md:grid-cols-2">
        <input
          type="date"
          value={vm.leaveForm.from_date}
          onChange={(e) => vm.setLeaveForm({ ...vm.leaveForm, from_date: e.target.value })}
          className={inputClass}
        />
        <input
          type="date"
          value={vm.leaveForm.to_date}
          onChange={(e) => vm.setLeaveForm({ ...vm.leaveForm, to_date: e.target.value })}
          className={inputClass}
        />
      </div>
      <textarea
        value={vm.leaveForm.reason}
        onChange={(e) => vm.setLeaveForm({ ...vm.leaveForm, reason: e.target.value })}
        className={`${inputClass} min-h-28`}
        placeholder="Reason"
      />
      <button className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800">
        Apply Leave
      </button>
    </form>
  );
}

export function ReportFiltersForm({ vm }: { vm: any }) {
  return (
    <div className="mt-6 grid gap-4">
      <SelectField
        value={vm.reportFilters.report_type}
        onChange={(e) => vm.setReportFilters({ ...vm.reportFilters, report_type: e.target.value })}
      >
        <option value="student_summary">Student Summary</option>
        <option value="staff_summary">Staff Summary</option>
        <option value="leave_summary">Leave Summary</option>
      </SelectField>
      {vm.reportFilters.report_type === 'student_summary' ? (
        <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-900">Select Batches</p>
            {vm.selectedReportBatchNames.length ? (
              <button
                type="button"
                onClick={() => vm.setReportFilters({ ...vm.reportFilters, batch_names: '' })}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
              >
                Clear
              </button>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {vm.selectedReportBatchNames.length
              ? `${vm.selectedReportBatchNames.length} batch selected`
              : 'Agar koi batch select nahi karte, to report all batches ke liye chalegi.'}
          </p>
          <div className="mt-3">
            <SelectField
              value={vm.reportBatchPicker}
              onChange={(e) => {
                const value = e.target.value;
                vm.setReportBatchPicker(value);
                vm.addReportBatchName(value);
              }}
            >
              <option value="">Choose batch</option>
              {vm.batchOptions.map((batchName) => (
                <option key={batchName} value={batchName} disabled={vm.selectedReportBatchNames.includes(batchName)}>
                  {batchName}
                </option>
              ))}
            </SelectField>
          </div>
          <div className="mt-3 flex max-h-40 flex-wrap gap-2 overflow-auto pr-1">
            {vm.selectedReportBatchNames.length ? (
              vm.selectedReportBatchNames.map((batchName) => (
                <button
                  key={batchName}
                  type="button"
                  onClick={() => vm.toggleReportBatchName(batchName)}
                  className="rounded-full border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:border-rose-200 hover:text-rose-700"
                >
                  {batchName} x
                </button>
              ))
            ) : vm.batchOptions.length ? null : (
              <p className="text-sm text-slate-500">Batch list load ho rahi hai ya abhi available nahi hai.</p>
            )}
          </div>
        </div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        {vm.reportFilters.report_type !== 'student_summary' ? (
          <SelectField
            value={vm.reportFilters.department}
            onChange={(e) => vm.setReportFilters({ ...vm.reportFilters, department: e.target.value })}
          >
            <option value="">Department</option>
            {vm.departmentOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </SelectField>
        ) : (
          <div />
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <input
            type="date"
            value={vm.reportFilters.date_from}
            onChange={(e) => vm.setReportFilters({ ...vm.reportFilters, date_from: e.target.value })}
            className={inputClass}
          />
          <input
            type="date"
            value={vm.reportFilters.date_to}
            onChange={(e) => vm.setReportFilters({ ...vm.reportFilters, date_to: e.target.value })}
            className={inputClass}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <button onClick={vm.handleRunReport} className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800">
          Run Report
        </button>
        <button onClick={() => vm.handleExportReport('excel')} className="rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-700">
          Export Excel
        </button>
        <button onClick={() => vm.handleExportReport('pdf')} className="rounded-full bg-rose-600 px-5 py-3 text-sm font-semibold text-white hover:bg-rose-700">
          Export PDF
        </button>
      </div>
    </div>
  );
}
