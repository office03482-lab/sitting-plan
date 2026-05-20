from app.services.supabase_attendance import (
    get_integrated_overview,
    get_overview,
    get_student_marking,
    list_integrated_staff,
    list_integrated_students,
    list_staff,
    list_staff_records,
    list_student_records,
    list_students,
    list_subjects,
    get_staff_dashboard,
)


class NativeAttendanceService:
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

    def get_student_marking(self, *, school_id: str, date_value: str, class_name: str, section: str, subject_id: str, search: str | None = None):
        return get_student_marking(
            school_id,
            date_value=date_value,
            class_name=class_name,
            section=section,
            subject_id=subject_id,
            search=search,
        )

    def list_student_records(self, **kwargs):
        return list_student_records(**kwargs)

    def list_staff_records(self, **kwargs):
        return list_staff_records(**kwargs)

    def get_staff_dashboard(self, **kwargs):
        return get_staff_dashboard(**kwargs)

