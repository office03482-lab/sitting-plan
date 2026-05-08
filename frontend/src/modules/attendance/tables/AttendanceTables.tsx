// @ts-nocheck
import {
  deleteButtonClass,
  formatDate,
  staffCalendarShadeClass,
  staffStatusClass,
  statusButtonBase,
  studentCalendarShadeClass,
  studentRecordDeleteButtonClass,
  studentRecordStatusClass,
  studentStatusClass,
} from '../utils/attendanceUtils';

export function StudentMarkingTable({ vm }: { vm: any }) {
  return (
    <div className="mt-6 max-w-full overflow-x-auto overflow-y-auto rounded-[1.5rem] border border-slate-200">
      <div className="grid min-w-[46rem] w-max min-w-full grid-cols-[0.8fr_1.3fr_1.7fr] gap-4 bg-slate-50 px-4 py-3 text-xs uppercase tracking-[0.22em] text-slate-500">
        <span>Roll No</span>
        <span>Student Name</span>
        <span>Attendance Status / Remark</span>
      </div>
      <div className="divide-y divide-slate-100">
        {vm.studentMarking?.students?.length ? (
          vm.studentMarking.students.map((student) => (
            <div key={student.student_id} className="grid min-w-[46rem] w-max min-w-full grid-cols-[0.8fr_1.3fr_1.7fr] gap-4 px-4 py-4 text-sm text-slate-700">
              <span>{student.roll_no}</span>
              <span>{student.student_name}</span>
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {['present', 'absent'].map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() =>
                        vm.setStudentMarking((current) =>
                          current
                            ? {
                                ...current,
                                students: current.students.map((row) =>
                                  row.student_id === student.student_id
                                    ? {
                                        ...row,
                                        status,
                                        absence_reason: status === 'absent' ? row.absence_reason || '' : undefined,
                                      }
                                    : row
                                ),
                              }
                            : current
                        )
                      }
                      className={`${statusButtonBase} ${
                        student.status === status ? studentStatusClass(status) : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {status}
                    </button>
                  ))}
                </div>
                {student.status === 'absent' ? (
                  <input
                    value={student.absence_reason || ''}
                    onChange={(e) =>
                      vm.setStudentMarking((current) =>
                        current
                          ? {
                              ...current,
                              students: current.students.map((row) =>
                                row.student_id === student.student_id ? { ...row, absence_reason: e.target.value } : row
                              ),
                            }
                          : current
                      )
                    }
                    className="w-full rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-slate-700 outline-none focus:border-amber-400"
                    placeholder="Absent reason / remark"
                  />
                ) : null}
              </div>
            </div>
          ))
        ) : (
          <div className="px-4 py-8 text-center text-sm text-slate-500">
            Student attendance data load nahi hua. Batch select karke `Load` dabayein.
          </div>
        )}
      </div>
    </div>
  );
}

export function StudentRecordsTable({ vm }: { vm: any }) {
  return (
    <div className="mt-6 max-w-full overflow-x-auto overflow-y-auto rounded-[1.5rem] border border-slate-200">
      <div className="grid min-w-[52rem] w-max min-w-full grid-cols-[1.2fr_1fr_1fr_0.8fr_0.7fr] gap-4 bg-slate-50 px-4 py-3 text-xs uppercase tracking-[0.22em] text-slate-500">
        <span>Student</span>
        <span>Batch</span>
        <span>Date / Class</span>
        <span>Status</span>
        <span>Action</span>
      </div>
      <div className="divide-y divide-slate-100">
        {vm.filteredStudentRecords.map((record) => (
          <div key={record.id} className="grid min-w-[52rem] w-max min-w-full grid-cols-[1.2fr_1fr_1fr_0.8fr_0.7fr] gap-4 px-4 py-3 text-sm text-slate-700">
            <div>
              <p>{record.student_name}</p>
              {record.subject_name ? <p className="mt-1 text-xs text-slate-500">Subject: {record.subject_name}</p> : null}
              {record.marked_by ? <p className="mt-1 text-xs text-slate-500">Teacher: {record.marked_by}</p> : null}
              {record.absence_reason ? <p className="mt-1 text-xs text-amber-700">Remark: {record.absence_reason}</p> : null}
            </div>
            <span>
              {record.class_name} | {record.section}
            </span>
            <div>
              <p>{formatDate(record.date)}</p>
              <p className="mt-1 text-xs text-slate-500">
                {record.class_name} | {record.section}
              </p>
            </div>
            <span className={studentRecordStatusClass(record.status)}>{record.status}</span>
            <button type="button" onClick={() => vm.handleDeleteStudentRecord(record.id)} className={studentRecordDeleteButtonClass}>
              Delete
            </button>
          </div>
        ))}
        {!vm.filteredStudentRecords.length ? (
          <div className="px-4 py-5 text-sm text-slate-500">Selected filters ke hisaab se koi student record nahi mila.</div>
        ) : null}
      </div>
    </div>
  );
}

export function TodayBatchSummaryTable({ vm }: { vm: any }) {
  return (
    <div className="mt-6 max-w-full overflow-x-auto overflow-y-auto rounded-[1.5rem] border border-slate-200">
      <div className="grid min-w-[40rem] w-max min-w-full grid-cols-[1.2fr_0.6fr_0.6fr_0.6fr_0.6fr] gap-4 bg-slate-50 px-4 py-3 text-xs uppercase tracking-[0.22em] text-slate-500">
        <span>Batch</span>
        <span>Present</span>
        <span>Absent</span>
        <span>Late</span>
        <span>Total</span>
      </div>
      <div className="divide-y divide-slate-100">
        {vm.todayBatchWiseSummary.map((item) => (
          <div key={item.batch_name} className="grid min-w-[40rem] w-max min-w-full grid-cols-[1.2fr_0.6fr_0.6fr_0.6fr_0.6fr] gap-4 px-4 py-3 text-sm text-slate-700">
            <span>{item.batch_name}</span>
            <span>{item.present}</span>
            <span>{item.absent}</span>
            <span>{item.late}</span>
            <span>{item.total}</span>
          </div>
        ))}
        {!vm.todayBatchWiseSummary.length ? (
          <div className="px-4 py-5 text-sm text-slate-500">Selected date ke liye attendance data available nahi hai.</div>
        ) : null}
      </div>
    </div>
  );
}

export function StaffMarkingTable({ vm }: { vm: any }) {
  return (
    <div className="mt-6 max-w-full overflow-x-auto overflow-y-auto rounded-[1.5rem] border border-slate-200">
      <div className="grid min-w-[58rem] w-max min-w-full grid-cols-[0.9fr_1.2fr_1fr_1.1fr_0.8fr_0.8fr] gap-4 bg-slate-50 px-4 py-3 text-xs uppercase tracking-[0.22em] text-slate-500">
        <span>Staff ID</span>
        <span>Name</span>
        <span>Department</span>
        <span>Status</span>
        <span>Check-In</span>
        <span>Check-Out</span>
      </div>
      <div className="divide-y divide-slate-100">
        {vm.staffMarking?.staff?.length ? (
          vm.staffMarking.staff.map((member) => (
            <div key={member.staff_member_id} className="grid min-w-[58rem] w-max min-w-full grid-cols-[0.9fr_1.2fr_1fr_1.1fr_0.8fr_0.8fr] gap-4 px-4 py-4 text-sm text-slate-700">
              <span>{member.staff_id}</span>
              <span>{member.staff_name}</span>
              <div>
                <p>{member.department || 'N/A'}</p>
                <p className="text-xs text-slate-500">{member.designation || 'Staff'}</p>
                {member.is_on_approved_leave ? (
                  <p className="mt-1 text-xs font-medium text-sky-700">
                    Approved leave{member.leave_type ? `: ${String(member.leave_type).replace('_', ' ')}` : ''}
                    {member.leave_reason ? ` | ${member.leave_reason}` : ''}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {['present', 'absent', 'late', 'half_day'].map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() =>
                      vm.setStaffMarking((current) =>
                        current
                          ? {
                              ...current,
                              staff: current.staff.map((row) =>
                                row.staff_member_id === member.staff_member_id ? { ...row, status } : row
                              ),
                            }
                          : current
                      )
                    }
                    className={`${statusButtonBase} ${
                      member.status === status ? staffStatusClass(status) : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>
              <input
                value={member.check_in || ''}
                onChange={(e) =>
                  vm.setStaffMarking((current) =>
                    current
                      ? {
                          ...current,
                          staff: current.staff.map((row) =>
                            row.staff_member_id === member.staff_member_id ? { ...row, check_in: e.target.value } : row
                          ),
                        }
                      : current
                  )
                }
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                value={member.check_out || ''}
                onChange={(e) =>
                  vm.setStaffMarking((current) =>
                    current
                      ? {
                          ...current,
                          staff: current.staff.map((row) =>
                            row.staff_member_id === member.staff_member_id ? { ...row, check_out: e.target.value } : row
                          ),
                        }
                      : current
                  )
                }
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          ))
        ) : (
          <div className="px-4 py-8 text-center text-sm text-slate-500">
            Staff attendance data load nahi hua. Department select karke `Load Staff` dabayein.
          </div>
        )}
      </div>
    </div>
  );
}

export function StaffDepartmentSummaryTable({ vm }: { vm: any }) {
  return (
    <div className="mt-6 max-w-full overflow-x-auto overflow-y-auto rounded-[1.5rem] border border-slate-200">
      <div className="grid min-w-[52rem] w-max min-w-full grid-cols-[1.2fr_0.6fr_0.6fr_0.6fr_0.7fr_0.6fr] gap-4 bg-slate-50 px-4 py-3 text-xs uppercase tracking-[0.22em] text-slate-500">
        <span>Department</span>
        <span>Present</span>
        <span>Absent</span>
        <span>Late</span>
        <span>Half Day</span>
        <span>Total</span>
      </div>
      <div className="divide-y divide-slate-100">
        {vm.staffDepartmentWiseSummary.map((summary) => (
          <div key={summary.department} className="grid min-w-[52rem] w-max min-w-full grid-cols-[1.2fr_0.6fr_0.6fr_0.6fr_0.7fr_0.6fr] gap-4 px-4 py-3 text-sm text-slate-700">
            <span className="font-medium text-slate-900">{String(summary.department)}</span>
            <span>{String(summary.present)}</span>
            <span>{String(summary.absent)}</span>
            <span>{String(summary.late)}</span>
            <span>{String(summary.half_day)}</span>
            <span>{String(summary.total)}</span>
          </div>
        ))}
        {!vm.staffDepartmentWiseSummary.length ? (
          <div className="px-4 py-5 text-sm text-slate-500">
            Selected filters ke liye abhi department-wise staff attendance summary available nahi hai.
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function StaffRecordsTable({ vm }: { vm: any }) {
  return (
    <div className="mt-4 max-w-full overflow-x-auto overflow-y-auto rounded-[1.5rem] border border-slate-200">
      <div className="grid min-w-[46rem] w-max min-w-full grid-cols-[1fr_1fr_0.9fr_0.9fr_0.7fr] gap-4 bg-slate-50 px-4 py-3 text-xs uppercase tracking-[0.22em] text-slate-500">
        <span>Staff</span>
        <span>Department</span>
        <span>Date</span>
        <span>Status</span>
        <span>Action</span>
      </div>
      <div className="divide-y divide-slate-100">
        {vm.staffRecords.map((record) => (
          <div key={record.id} className="grid min-w-[46rem] w-max min-w-full grid-cols-[1fr_1fr_0.9fr_0.9fr_0.7fr] gap-4 px-4 py-3 text-sm text-slate-700">
            <span>{record.staff_name}</span>
            <span>{record.department}</span>
            <span>{formatDate(record.date)}</span>
            <span className={`inline-flex max-w-max rounded-full px-3 py-1 text-xs ${staffStatusClass(record.status)}`}>
              {record.status}
            </span>
            {!vm.isTeacherSelfView ? (
              <button type="button" onClick={() => vm.handleDeleteStaffRecord(record.id)} className={deleteButtonClass}>
                Delete
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function HolidayList({ vm }: { vm: any }) {
  return (
    <div className="max-h-56 overflow-auto rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <div className="space-y-2">
        {vm.holidays.map((item) => (
          <div key={item.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-900">{item.title}</p>
                <p className="text-xs text-slate-500">{formatDate(item.holiday_date)}</p>
                <p className="text-xs text-slate-600">{item.description || 'No description'}</p>
              </div>
              <button type="button" onClick={() => vm.handleDeleteHoliday(item.id)} className={deleteButtonClass}>
                Delete
              </button>
            </div>
          </div>
        ))}
        {!vm.holidays.length ? <p className="text-sm text-slate-500">No holidays added yet.</p> : null}
      </div>
    </div>
  );
}

export function StudentCalendarGrid({ vm }: { vm: any }) {
  if (!vm.calendarBatchLabel) {
    return (
      <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
        Calendar dekhne ke liye Mark Student Attendance me batch select karein.
      </div>
    );
  }

  return (
    <div className="mt-4 grid grid-cols-7 gap-2">
      {vm.studentCalendar.map((record) => (
        <div key={record.id} className={`rounded-2xl border p-3 text-center text-xs transition ${studentCalendarShadeClass(record.status)}`}>
          <p className="text-sm font-semibold">{record.day}</p>
          <p className="mt-1 capitalize">{record.status || 'N/A'}</p>
          {record.total ? (
            <p className="mt-1 text-[11px] opacity-80">
              {record.present}P / {record.absent}A
            </p>
          ) : (
            <p className="mt-1 text-[11px] opacity-70">No entry</p>
          )}
        </div>
      ))}
    </div>
  );
}

export function StaffCalendarGrid({ vm }: { vm: any }) {
  return (
    <div className="mt-4 grid grid-cols-7 gap-2">
      {vm.staffCalendar.map((record) => (
        <div key={record.id} className={`rounded-2xl border p-3 text-center text-xs transition ${staffCalendarShadeClass(record.status)}`}>
          <p className="text-sm font-semibold">{record.day}</p>
          <p className="mt-1 capitalize">{record.status || 'N/A'}</p>
          {record.total ? (
            <p className="mt-1 text-[11px] opacity-80">
              {record.present}P / {record.absent}A{record.leave ? ` / ${record.leave}L` : ''}
            </p>
          ) : (
            <p className="mt-1 text-[11px] opacity-70">No entry</p>
          )}
        </div>
      ))}
    </div>
  );
}

export function ReportPreviewTable({ vm }: { vm: any }) {
  return (
    <div className="mt-6 max-h-[34rem] overflow-auto rounded-[1.5rem] border border-slate-200">
      {vm.reportData && vm.reportData.rows.length ? (
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-slate-500">
              {Object.keys(vm.reportData.rows[0].values).map((column) => (
                <th key={column} className="px-4 py-3 capitalize">
                  {column.replace(/_/g, ' ')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vm.reportData.rows.map((row, index) => (
              <tr key={index} className="border-t border-slate-100 text-slate-700">
                {Object.keys(vm.reportData.rows[0].values).map((column) => (
                  <td key={column} className="px-4 py-3">
                    {String(row.values[column] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="p-6 text-sm text-slate-500">No report data available.</div>
      )}
    </div>
  );
}
