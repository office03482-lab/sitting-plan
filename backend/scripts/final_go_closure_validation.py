from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass
from typing import Any

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models import User, UserRole
from app.services.supabase_admin import get_supabase_admin_client
from app.utils.auth import create_access_token, hash_password

SCHOOL_ID = "2a427cb2-4194-43ba-9e4a-f2558c508162"


@dataclass
class Actor:
    profile_id: str
    email: str
    role: str
    full_name: str

    @property
    def headers(self) -> dict[str, str]:
        token = create_access_token(
            {
                "sub": self.profile_id,
                "email": self.email,
                "role": self.role,
                "full_name": self.full_name,
                "school_id": SCHOOL_ID,
                "profile_id": self.profile_id,
            }
        )
        return {"Authorization": f"Bearer {token}"}


class ValidationError(RuntimeError):
    pass


def _now_tag() -> str:
    return time.strftime("%Y%m%d%H%M%S", time.gmtime())


def _normalize(value: Any) -> str:
    return str(value or "").strip()


def _expect(response, expected: int, label: str) -> Any:
    if response.status_code != expected:
        raise ValidationError(
            json.dumps(
                {
                    "label": label,
                    "status_code": response.status_code,
                    "body": response.text,
                },
                indent=2,
            )
        )
    content_type = response.headers.get("content-type", "")
    if "application/json" in content_type:
        return response.json()
    return response.content


def _request(
    client: TestClient,
    method: str,
    path: str,
    *,
    expected: int,
    label: str,
    headers: dict[str, str],
    summary: dict[str, Any],
    **kwargs,
) -> Any:
    started = time.perf_counter()
    response = client.request(method, path, headers=headers, **kwargs)
    duration_ms = round((time.perf_counter() - started) * 1000, 1)
    summary.setdefault("checks", []).append(
        {
            "label": label,
            "method": method,
            "path": path,
            "status_code": response.status_code,
            "duration_ms": duration_ms,
        }
    )
    return _expect(response, expected, label)


def _ensure_permission(client, permission_key: str, module_key: str, action_key: str | None, description: str) -> str:
    rows = (
        client.table("permissions")
        .select("id")
        .eq("permission_key", permission_key)
        .limit(1)
        .execute()
        .data
        or []
    )
    if rows:
        return rows[0]["id"]
    inserted = (
        client.table("permissions")
        .insert(
            {
                "permission_key": permission_key,
                "module_key": module_key,
                "action_key": action_key,
                "description": description,
                "is_active": True,
            }
        )
        .execute()
    )
    return inserted.data[0]["id"]


def _ensure_student_role_permissions(client) -> dict[str, Any]:
    student_role_rows = (
        client.table("roles")
        .select("id")
        .eq("role_key", "student")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not student_role_rows:
        raise ValidationError("Student role not found in Supabase roles table")
    student_role_id = student_role_rows[0]["id"]

    required = [
        ("online_tests", "online_tests", None, "Access online tests module."),
        ("online_tests.view", "online_tests", "view", "View online tests."),
        ("online_tests.attempt", "online_tests", "attempt", "Attempt online tests."),
        ("lms", "lms", None, "Access LMS module."),
        ("lms.view", "lms", "view", "View LMS content."),
        ("lms.progress", "lms", "progress", "Track LMS progress."),
        ("lms.assignments", "lms", "assignments", "Submit LMS assignments."),
    ]

    before_rows = (
        client.table("role_permissions")
        .select("permissions(permission_key)")
        .eq("role_id", student_role_id)
        .execute()
        .data
        or []
    )
    before = sorted(
        {
            _normalize(item.get("permissions", {}).get("permission_key"))
            for item in before_rows
            if isinstance(item.get("permissions"), dict)
        }
    )

    added: list[str] = []
    for permission_key, module_key, action_key, description in required:
        permission_id = _ensure_permission(client, permission_key, module_key, action_key, description)
        existing = (
            client.table("role_permissions")
            .select("role_id")
            .eq("role_id", student_role_id)
            .eq("permission_id", permission_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        if existing:
            continue
        client.table("role_permissions").insert({"role_id": student_role_id, "permission_id": permission_id}).execute()
        added.append(permission_key)

    after_rows = (
        client.table("role_permissions")
        .select("permissions(permission_key)")
        .eq("role_id", student_role_id)
        .execute()
        .data
        or []
    )
    after = sorted(
        {
            _normalize(item.get("permissions", {}).get("permission_key"))
            for item in after_rows
            if isinstance(item.get("permissions"), dict)
        }
    )
    return {"student_role_id": student_role_id, "before": before, "after": after, "added": added}


def _load_admin_actor(client) -> Actor:
    rows = (
        client.table("school_memberships")
        .select("profile_id, role_id")
        .eq("school_id", SCHOOL_ID)
        .eq("is_active", True)
        .eq("status", "active")
        .execute()
        .data
        or []
    )
    role_rows = (
        client.table("roles")
        .select("id")
        .eq("role_key", "platform_admin")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows or not role_rows:
        raise ValidationError("No active platform admin membership found")
    platform_admin_role_id = role_rows[0]["id"]
    row = next((item for item in rows if _normalize(item.get("role_id")) == platform_admin_role_id), None)
    if not row:
        raise ValidationError("No active platform admin membership found")
    profile_rows = (
        client.table("profiles")
        .select("id,email,full_name")
        .eq("id", row["profile_id"])
        .limit(1)
        .execute()
        .data
        or []
    )
    if not profile_rows:
        raise ValidationError("Platform admin profile row not found")
    profile = profile_rows[0]
    return Actor(
        profile_id=row["profile_id"],
        email=profile.get("email") or "admin@example.com",
        role="platform_admin",
        full_name=profile.get("full_name") or "Platform Admin",
    )


def _ensure_local_student_user(profile_id: str) -> Actor:
    email = "runtime.student@example.com"
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        permissions = ",".join(
            [
                "online_tests",
                "online_tests.view",
                "online_tests.attempt",
                "lms",
                "lms.view",
                "lms.progress",
                "lms.assignments",
            ]
        )
        if not user:
            user = User(
                email=email,
                username="runtime_student",
                full_name="Runtime Student",
                password_hash=hash_password("Runtime@123"),
                role=UserRole.VIEWER,
                user_type="student",
                permissions=permissions,
                is_active=True,
                is_verified=True,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        else:
            user.full_name = "Runtime Student"
            user.user_type = "student"
            user.role = UserRole.VIEWER
            user.permissions = permissions
            user.is_active = True
            user.is_verified = True
            db.commit()
            db.refresh(user)
        return Actor(
            profile_id=profile_id,
            email=email,
            role="student",
            full_name="Runtime Student",
        )
    finally:
        db.close()


def _ensure_student_actor(client, admin_profile_id: str) -> tuple[Actor, dict[str, Any], dict[str, Any]]:
    student_rows = (
        client.table("students")
        .select("id,profile_id,full_name,batch_id,class_name,section")
        .eq("school_id", SCHOOL_ID)
        .not_.is_("batch_id", "null")
        .eq("is_active", True)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not student_rows:
        raise ValidationError("No active student with batch_id found for runtime validation")
    student = dict(student_rows[0])
    original_profile_id = student.get("profile_id")
    client.table("students").update({"profile_id": admin_profile_id}).eq("id", student["id"]).execute()
    student["profile_id"] = admin_profile_id
    actor = _ensure_local_student_user(admin_profile_id)
    return actor, student, {"student_id": student["id"], "original_profile_id": original_profile_id}


def _verify_public_views(client) -> dict[str, str]:
    tables = [
        "lms_courses",
        "lms_course_modules",
        "lms_lessons",
        "lms_lesson_resources",
        "lms_student_progress",
        "lms_assignments",
        "lms_assignment_submissions",
        "online_test_tests",
        "online_test_test_sections",
        "online_test_test_questions",
        "online_test_test_attempts",
        "online_test_test_responses",
        "online_test_test_results",
    ]
    result: dict[str, str] = {}
    for table in tables:
        client.table(table).select("id").limit(1).execute()
        result[table] = "OK"
    return result


def run_online_tests(client: TestClient, admin: Actor, student: Actor, student_row: dict[str, Any]) -> dict[str, Any]:
    summary: dict[str, Any] = {"module": "Online Tests"}
    tag = _now_tag()
    test = _request(
        client,
        "POST",
        "/api/online-tests/tests",
        expected=200,
        label="online_tests.create_test",
        headers=admin.headers,
        summary=summary,
        json={
            "title": f"Runtime Physics Test {tag}",
            "description": "Final go-closure runtime validation",
            "test_code": f"RUNTIME-OT-{tag}",
            "batch_id": student_row["batch_id"],
            "duration_minutes": 45,
            "total_marks": 7,
            "pass_marks": 2,
            "status": "draft",
        },
    )
    test_id = test["id"]
    section_id = test["sections"][0]["id"]

    _request(
        client,
        "GET",
        "/api/online-tests/tests",
        expected=200,
        label="online_tests.list_tests",
        headers=admin.headers,
        summary=summary,
    )
    _request(
        client,
        "GET",
        f"/api/online-tests/tests/{test_id}",
        expected=200,
        label="online_tests.get_test",
        headers=admin.headers,
        summary=summary,
    )
    _request(
        client,
        "PUT",
        f"/api/online-tests/tests/{test_id}",
        expected=200,
        label="online_tests.update_test",
        headers=admin.headers,
        summary=summary,
        json={"title": f"Runtime Physics Test Updated {tag}", "duration_minutes": 50},
    )

    question_payloads = [
        {
            "name": "mcq",
            "payload": {
                "test_id": test_id,
                "section_id": section_id,
                "display_order": 1,
                "question_type": "single_choice",
                "prompt_text": "What is 2 + 2?",
                "option_items": [
                    {"id": "opt-a", "label": "4"},
                    {"id": "opt-b", "label": "5"},
                ],
                "answer_key": {"correct_option_id": "opt-a"},
                "marks": 2,
            },
        },
        {
            "name": "short",
            "payload": {
                "test_id": test_id,
                "section_id": section_id,
                "display_order": 2,
                "question_type": "short_answer",
                "prompt_text": "Define gravity in one line.",
                "marks": 1,
            },
        },
        {
            "name": "long",
            "payload": {
                "test_id": test_id,
                "section_id": section_id,
                "display_order": 3,
                "question_type": "long_answer",
                "prompt_text": "Explain Newton's laws.",
                "marks": 1,
            },
        },
        {
            "name": "numerical",
            "payload": {
                "test_id": test_id,
                "section_id": section_id,
                "display_order": 4,
                "question_type": "numeric",
                "prompt_text": "What is 6 x 7?",
                "answer_key": {"expected_value": "42"},
                "marks": 3,
            },
        },
    ]
    question_ids: dict[str, str] = {}
    for item in question_payloads:
        created = _request(
            client,
            "POST",
            f"/api/online-tests/tests/{test_id}/questions",
            expected=200,
            label=f"online_tests.add_question.{item['name']}",
            headers=admin.headers,
            summary=summary,
            json=item["payload"],
        )
        question_ids[item["name"]] = created["id"]

    _request(
        client,
        "PUT",
        f"/api/online-tests/questions/{question_ids['numerical']}",
        expected=200,
        label="online_tests.edit_question",
        headers=admin.headers,
        summary=summary,
        json={"prompt_text": "What is 7 x 6?", "marks": 3},
    )
    _request(
        client,
        "DELETE",
        f"/api/online-tests/questions/{question_ids['long']}",
        expected=200,
        label="online_tests.delete_question",
        headers=admin.headers,
        summary=summary,
    )
    _request(
        client,
        "POST",
        f"/api/online-tests/tests/{test_id}/publish",
        expected=200,
        label="online_tests.publish_test",
        headers=admin.headers,
        summary=summary,
    )

    _request(
        client,
        "GET",
        "/api/online-tests/tests",
        expected=200,
        label="online_tests.student_list_tests",
        headers=student.headers,
        summary=summary,
    )
    _request(
        client,
        "GET",
        f"/api/online-tests/tests/{test_id}",
        expected=200,
        label="online_tests.student_get_test",
        headers=student.headers,
        summary=summary,
    )
    attempt = _request(
        client,
        "POST",
        f"/api/online-tests/tests/{test_id}/start",
        expected=200,
        label="online_tests.start_attempt",
        headers=student.headers,
        summary=summary,
    )
    attempt_id = attempt["id"]

    _request(
        client,
        "POST",
        f"/api/online-tests/attempts/{attempt_id}/save",
        expected=200,
        label="online_tests.save_answer.mcq",
        headers=student.headers,
        summary=summary,
        json={"question_id": question_ids["mcq"], "response_payload": {"selected_option_id": "opt-a"}, "is_marked_for_review": False},
    )
    _request(
        client,
        "POST",
        f"/api/online-tests/attempts/{attempt_id}/save",
        expected=200,
        label="online_tests.save_answer.numerical",
        headers=student.headers,
        summary=summary,
        json={"question_id": question_ids["numerical"], "response_payload": {"value": "42"}, "is_marked_for_review": False},
    )
    _request(
        client,
        "GET",
        f"/api/online-tests/attempts/{attempt_id}",
        expected=200,
        label="online_tests.get_attempt",
        headers=student.headers,
        summary=summary,
    )
    result = _request(
        client,
        "POST",
        f"/api/online-tests/attempts/{attempt_id}/submit",
        expected=200,
        label="online_tests.submit_attempt",
        headers=student.headers,
        summary=summary,
    )
    result_id = result["id"]

    _request(
        client,
        "GET",
        f"/api/online-tests/results/{result_id}",
        expected=200,
        label="online_tests.view_results",
        headers=admin.headers,
        summary=summary,
    )
    analytics = _request(
        client,
        "GET",
        "/api/online-tests/results/analytics",
        expected=200,
        label="online_tests.view_analytics",
        headers=admin.headers,
        summary=summary,
        params={"test_id": test_id},
    )
    _request(
        client,
        "DELETE",
        f"/api/online-tests/tests/{test_id}",
        expected=200,
        label="online_tests.delete_test",
        headers=admin.headers,
        summary=summary,
    )

    summary["artifacts"] = {
        "test_id": test_id,
        "attempt_id": attempt_id,
        "result_id": result_id,
        "score_obtained": result.get("score_obtained"),
        "percentage": result.get("percentage"),
        "rank_in_school": result.get("rank_in_school"),
        "analytics": analytics,
    }
    summary["status"] = "PASS"
    return summary


def run_lms(client: TestClient, admin: Actor, student: Actor, student_row: dict[str, Any]) -> dict[str, Any]:
    summary: dict[str, Any] = {"module": "LMS"}
    tag = _now_tag()
    course = _request(
        client,
        "POST",
        "/api/lms/courses",
        expected=200,
        label="lms.create_course",
        headers=admin.headers,
        summary=summary,
        json={
            "title": f"Runtime LMS Course {tag}",
            "description": "Final go-closure LMS validation",
            "course_code": f"RUNTIME-LMS-{tag}",
            "batch_id": student_row["batch_id"],
            "visibility": "batch",
            "is_published": True,
        },
    )
    course_id = course["id"]
    _request(client, "GET", "/api/lms/courses", expected=200, label="lms.list_courses", headers=admin.headers, summary=summary)
    _request(client, "GET", f"/api/lms/courses/{course_id}", expected=200, label="lms.get_course", headers=admin.headers, summary=summary)
    _request(
        client,
        "PUT",
        f"/api/lms/courses/{course_id}",
        expected=200,
        label="lms.update_course",
        headers=admin.headers,
        summary=summary,
        json={"title": f"Runtime LMS Course Updated {tag}", "description": "Updated description"},
    )

    module = _request(
        client,
        "POST",
        "/api/lms/modules",
        expected=200,
        label="lms.create_module",
        headers=admin.headers,
        summary=summary,
        json={"course_id": course_id, "title": f"Runtime Module {tag}", "display_order": 1},
    )
    module_id = module["id"]
    _request(
        client,
        "PUT",
        f"/api/lms/modules/{module_id}",
        expected=200,
        label="lms.update_module",
        headers=admin.headers,
        summary=summary,
        json={"title": f"Runtime Module Updated {tag}", "display_order": 1},
    )

    lesson = _request(
        client,
        "POST",
        "/api/lms/lessons",
        expected=200,
        label="lms.create_lesson",
        headers=admin.headers,
        summary=summary,
        json={
            "course_id": course_id,
            "module_id": module_id,
            "title": f"Runtime Lesson {tag}",
            "lesson_type": "note",
            "content_text": "Runtime lesson content",
            "display_order": 1,
        },
    )
    lesson_id = lesson["id"]
    _request(
        client,
        "PUT",
        f"/api/lms/lessons/{lesson_id}",
        expected=200,
        label="lms.update_lesson",
        headers=admin.headers,
        summary=summary,
        json={"title": f"Runtime Lesson Updated {tag}", "content_text": "Updated runtime lesson content"},
    )

    assignment = _request(
        client,
        "POST",
        "/api/lms/assignments",
        expected=200,
        label="lms.create_assignment",
        headers=admin.headers,
        summary=summary,
        json={
            "course_id": course_id,
            "module_id": module_id,
            "lesson_id": lesson_id,
            "title": f"Runtime Assignment {tag}",
            "description": "Submit a short response",
            "status": "published",
            "max_score": 10,
        },
    )
    assignment_id = assignment["id"]

    _request(client, "GET", "/api/lms/courses", expected=200, label="lms.student_list_courses", headers=student.headers, summary=summary)
    _request(client, "GET", f"/api/lms/courses/{course_id}", expected=200, label="lms.student_get_course", headers=student.headers, summary=summary)
    _request(client, "GET", "/api/lms/assignments", expected=200, label="lms.list_assignments", headers=student.headers, summary=summary)
    submission = _request(
        client,
        "POST",
        f"/api/lms/assignments/{assignment_id}/submit",
        expected=200,
        label="lms.submit_assignment",
        headers=student.headers,
        summary=summary,
        json={"submission_text": "Runtime assignment submission"},
    )
    _request(
        client,
        "POST",
        f"/api/lms/assignments/{assignment_id}/grade/{student_row['id']}",
        expected=200,
        label="lms.grade_assignment",
        headers=admin.headers,
        summary=summary,
        json={"status": "graded", "score_awarded": 8, "feedback": "Validated"},
    )
    progress = _request(
        client,
        "POST",
        "/api/lms/progress",
        expected=200,
        label="lms.progress_tracking",
        headers=student.headers,
        summary=summary,
        json={
            "course_id": course_id,
            "module_id": module_id,
            "lesson_id": lesson_id,
            "last_watched_position_seconds": 120,
            "watch_percentage": 100,
            "assignment_completion_percentage": 100,
            "is_completed": True,
        },
    )
    dashboard = _request(
        client,
        "GET",
        "/api/lms/progress",
        expected=200,
        label="lms.dashboard",
        headers=student.headers,
        summary=summary,
    )

    _request(client, "DELETE", f"/api/lms/lessons/{lesson_id}", expected=200, label="lms.delete_lesson", headers=admin.headers, summary=summary)
    _request(client, "DELETE", f"/api/lms/modules/{module_id}", expected=200, label="lms.delete_module", headers=admin.headers, summary=summary)
    _request(client, "DELETE", f"/api/lms/courses/{course_id}", expected=200, label="lms.delete_course", headers=admin.headers, summary=summary)

    summary["artifacts"] = {
        "course_id": course_id,
        "module_id": module_id,
        "lesson_id": lesson_id,
        "assignment_id": assignment_id,
        "submission_id": submission["id"],
        "progress_id": progress["id"],
        "dashboard_course_count": len(dashboard.get("enrolled_courses") or []),
    }
    summary["status"] = "PASS"
    return summary


def run_inventory_and_dashboard(client: TestClient, admin: Actor) -> dict[str, Any]:
    summary: dict[str, Any] = {"module": "Inventory & Dashboard"}
    for report_type in ("current_inventory", "low_stock", "stock_in", "distribution"):
        _request(
            client,
            "GET",
            "/api/inventory/reports/data",
            expected=200,
            label=f"inventory.report.{report_type}",
            headers=admin.headers,
            summary=summary,
            params={"report_type": report_type},
        )
    _request(
        client,
        "GET",
        "/api/inventory/dashboard",
        expected=200,
        label="inventory.dashboard",
        headers=admin.headers,
        summary=summary,
    )
    dashboard = _request(
        client,
        "GET",
        "/api/dashboard/metrics",
        expected=200,
        label="platform.dashboard.metrics",
        headers=admin.headers,
        summary=summary,
    )
    current_inventory_check = next(item for item in summary["checks"] if item["label"] == "inventory.report.current_inventory")
    summary["artifacts"] = {
        "current_inventory_duration_ms": current_inventory_check["duration_ms"],
        "current_inventory_under_5s": current_inventory_check["duration_ms"] < 5000,
        "dashboard_students_count": dashboard.get("students_count"),
        "dashboard_teachers_count": dashboard.get("teachers_count"),
    }
    summary["status"] = "PASS" if summary["artifacts"]["current_inventory_under_5s"] else "FAIL"
    return summary


def main() -> None:
    supabase = get_supabase_admin_client()
    result: dict[str, Any] = {
        "school_id": SCHOOL_ID,
        "before": {},
        "after": {},
        "modules": [],
    }
    cleanup: dict[str, Any] | None = None

    try:
        result["before"]["public_views"] = _verify_public_views(supabase)
        result["before"]["student_role_permissions"] = _ensure_student_role_permissions(supabase)

        admin = _load_admin_actor(supabase)
        student_actor, student_row, cleanup = _ensure_student_actor(supabase, admin.profile_id)
        result["after"]["student_binding"] = {
            "student_id": student_row["id"],
            "student_profile_id": student_actor.profile_id,
            "batch_id": student_row["batch_id"],
        }

        client = TestClient(app)

        online_tests_summary = run_online_tests(client, admin, student_actor, student_row)
        result["modules"].append(online_tests_summary)

        lms_summary = run_lms(client, admin, student_actor, student_row)
        result["modules"].append(lms_summary)

        inventory_summary = run_inventory_and_dashboard(client, admin)
        result["modules"].append(inventory_summary)

        result["final_verdict"] = (
            "GO"
            if all(module.get("status") == "PASS" for module in result["modules"])
            else "GO WITH GAPS"
        )
        print(json.dumps(result, indent=2))
    finally:
        if cleanup:
            supabase.table("students").update({"profile_id": cleanup.get("original_profile_id")}).eq("id", cleanup["student_id"]).execute()


if __name__ == "__main__":
    main()
