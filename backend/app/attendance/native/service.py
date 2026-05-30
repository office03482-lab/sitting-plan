from app.services.supabase_attendance import (
    delete_all_student_records,
    delete_student_record,
    get_batch_current_class,
    get_attendance_settings,
    get_integrated_overview,
    get_overview,
    get_staff_marking,
    get_student_dashboard,
    get_student_marking,
    get_student_calendar,
    list_integrated_staff,
    list_integrated_students,
    list_leaves,
    list_staff,
    list_staff_records,
    list_student_records,
    list_students,
    list_subjects,
    save_staff_marking,
    save_student_marking,
    get_staff_dashboard,
    list_batch_day_classes,
    update_attendance_settings,
)


class NativeAttendanceService:
    def get_batch_current_class(
        self,
        *,
        school_id: str,
        class_name: str,
        section: str,
        batch_name: str | None = None,
        target_date: str | None = None,
        current_time: str | None = None,
    ):
        return get_batch_current_class(
            school_id,
            class_name=class_name,
            section=section,
            batch_name=batch_name,
            target_date=target_date,
            current_time=current_time,
        )

    def list_batch_day_classes(
        self,
        *,
        school_id: str,
        class_name: str,
        section: str,
        batch_name: str | None = None,
        target_date: str | None = None,
        current_time: str | None = None,
    ):
        return list_batch_day_classes(
            school_id,
            class_name=class_name,
            section=section,
            batch_name=batch_name,
            target_date=target_date,
            current_time=current_time,
        )

    def get_overview(self, *, school_id: str):
        return get_overview(school_id)

    def get_integrated_overview(self, *, school_id: str):
        return get_integrated_overview(school_id)

    def list_students(self, *, school_id: str, skip: int = 0, limit: int = 100, search: str | None = None):
        return list_students(school_id, skip=skip, limit=limit, search=search)

    def list_integrated_students(
        self,
        *,
        school_id: str,
        skip: int = 0,
        limit: int = 100,
        search: str | None = None,
        batch: str | None = None,
    ):
        return list_integrated_students(school_id, skip=skip, limit=limit, search=search, batch=batch)

    def list_staff(self, *, school_id: str, skip: int = 0, limit: int = 100, search: str | None = None, department: str | None = None, source: str | None = None):
        return list_staff(school_id, skip=skip, limit=limit, search=search, department=department, source=source)

    def list_integrated_staff(
        self,
        *,
        school_id: str,
        skip: int = 0,
        limit: int = 100,
        search: str | None = None,
        department: str | None = None,
        source: str | None = None,
    ):
        return list_integrated_staff(
            school_id,
            skip=skip,
            limit=limit,
            search=search,
            department=department,
            source=source,
        )

    def list_subjects(self, *, school_id: str):
        return list_subjects(school_id)

    def get_settings(self, *, school_id: str):
        return get_attendance_settings(school_id)

    def update_settings(
        self,
        *,
        school_id: str,
        minimum_attendance_threshold: float,
        working_hours_start: str,
        working_hours_end: str,
    ):
        return update_attendance_settings(
            school_id,
            minimum_attendance_threshold=minimum_attendance_threshold,
            working_hours_start=working_hours_start,
            working_hours_end=working_hours_end,
        )

    def get_student_marking(self, *, school_id: str, date_value: str, class_name: str, section: str, subject_id: str | None = None, search: str | None = None):
        return get_student_marking(
            school_id,
            date_value=date_value,
            class_name=class_name,
            section=section,
            subject_id=subject_id,
            search=search,
        )

    def get_staff_marking(self, *, school_id: str, date_value: str, department: str, search: str | None = None):
        return get_staff_marking(
            school_id,
            date_value=date_value,
            department=department,
            search=search,
        )

    def save_student_marking(
        self,
        *,
        school_id: str,
        date_value: str,
        subject_id: str | None = None,
        marked_by: str | None = None,
        entries: list[dict] | None = None,
    ):
        return save_student_marking(
            school_id,
            date_value=date_value,
            subject_id=subject_id,
            marked_by=marked_by,
            entries=entries or [],
        )

    def save_staff_marking(self, *, school_id: str, date_value: str, marked_by: str | None = None, entries: list[dict] | None = None):
        return save_staff_marking(
            school_id,
            date_value=date_value,
            marked_by=marked_by,
            entries=entries or [],
        )

    async def list_student_records(self, **kwargs):
        return await list_student_records(**kwargs)

    def get_student_dashboard(self, **kwargs):
        return get_student_dashboard(**kwargs)

    async def get_student_calendar(self, *, school_id: str, month: str | None = None, class_name: str | None = None, batch_name: str | None = None, scope: str | None = None):
        return await get_student_calendar(
            school_id,
            month=month,
            class_name=class_name,
            batch_name=batch_name,
            scope=scope,
        )

    def delete_student_record(self, *, school_id: str, record_id: str):
        return delete_student_record(school_id, record_id=record_id)

    def delete_all_student_records(self, **kwargs):
        return delete_all_student_records(**kwargs)

    def list_staff_records(self, **kwargs):
        return list_staff_records(**kwargs)

    def get_staff_dashboard(self, **kwargs):
        return get_staff_dashboard(**kwargs)

    def list_leaves(self, *, school_id: str, status_filter: str | None = None, actor: dict | None = None):
        return list_leaves(
            school_id,
            status_filter=status_filter,
            actor=actor,
        )
