from fastapi import HTTPException

from app.services import supabase_ai_agents


def test_list_ai_agent_recommendations_returns_empty_on_backend_disconnect(monkeypatch):
    class FailingQuery:
        def select(self, *_args, **_kwargs):
            return self

        def eq(self, *_args, **_kwargs):
            return self

        def is_(self, *_args, **_kwargs):
            return self

        def order(self, *_args, **_kwargs):
            return self

        def execute(self):
            raise RuntimeError("Server disconnected")

    monkeypatch.setattr(supabase_ai_agents, "_ai_table", lambda _name: FailingQuery())

    assert supabase_ai_agents.list_ai_agent_recommendations("school-1") == []


def test_get_ai_agents_dashboard_falls_back_to_empty_state(monkeypatch):
    monkeypatch.setattr(supabase_ai_agents, "_seed_agent_registry", lambda school_id: {"ai_principal": {"agent_key": "ai_principal", "agent_name": "AI Principal", "domain_key": "leadership", "approval_scope": "admin", "source_modules": []}})
    monkeypatch.setattr(supabase_ai_agents, "list_ai_agent_recommendations", lambda school_id: [])

    def _boom(*_args, **_kwargs):
        raise HTTPException(status_code=503, detail="AI command center temporarily unavailable")

    monkeypatch.setattr(supabase_ai_agents, "run_ai_agent_jobs", _boom)
    monkeypatch.setattr(supabase_ai_agents, "_log_audit_entry", lambda **_kwargs: None)

    result = supabase_ai_agents.get_ai_agents_dashboard("school-1", actor_profile_id="profile-1")

    assert result["summary"]["recommendations"] == 0
    assert result["critical_alerts"] == []
    assert result["pending_approvals"] == []
    assert result["agent_cards"][0]["agent_key"] == "ai_principal"


def test_run_ai_agent_jobs_maps_write_disconnect_to_503(monkeypatch):
    monkeypatch.setattr(supabase_ai_agents, "_seed_agent_registry", lambda school_id: {"ai_principal": {"id": "agent-1", "agent_key": "ai_principal", "agent_name": "AI Principal", "approval_scope": "admin", "source_modules": ["ai_agents"]}})
    monkeypatch.setattr(supabase_ai_agents, "_agent_recommendation_blueprints", lambda *_args, **_kwargs: {"ai_principal": [{"title": "Title", "summary": "Summary", "severity": "info", "recommendation_type": "manual_review"}]})
    monkeypatch.setattr(supabase_ai_agents, "_deactivate_agent_records", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(supabase_ai_agents, "_create_job", lambda *_args, **_kwargs: "job-1")
    monkeypatch.setattr(supabase_ai_agents, "_log_audit_entry", lambda **_kwargs: None)

    class InsertFailQuery:
        def insert(self, *_args, **_kwargs):
            return self

        def execute(self):
            raise RuntimeError("Server disconnected")

    monkeypatch.setattr(supabase_ai_agents, "_ai_table", lambda _name: InsertFailQuery())

    try:
        supabase_ai_agents.run_ai_agent_jobs("school-1", actor_profile_id="profile-1")
    except HTTPException as exc:
        assert exc.status_code == 503
        assert exc.detail == "AI command center temporarily unavailable"
    else:
        raise AssertionError("Expected HTTPException")
