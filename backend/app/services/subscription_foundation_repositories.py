"""Supabase repositories for Phase 0 subscription, entitlement, and AI credit foundation."""

from __future__ import annotations

from typing import Any

from app.schemas.subscription_entitlement import (
    AICreditIdempotencyKeyCreate,
    AICreditIdempotencyKeyResponse,
    AICreditIdempotencyKeyUpdate,
    AICreditLedgerCreate,
    AICreditProductCreate,
    AICreditProductUpdate,
    AICreditWalletCreate,
    AICreditWalletUpdate,
    EntitlementRuleCreate,
    EntitlementRuleUpdate,
    PlanChangeRequestCreate,
    PlanChangeRequestUpdate,
    PlanFeatureOverrideCreate,
    PlanFeatureOverrideUpdate,
    SchoolPlanCreate,
    SchoolPlanUpdate,
    UsageSnapshotCreate,
    UsageSnapshotResponse,
    UsageSnapshotUpdate,
)
from app.services.supabase_admin import get_supabase_admin_client


def _client():
    return get_supabase_admin_client()


def _public_table(name: str):
    return _client().table(name)


def _dump(model: Any) -> dict[str, Any]:
    return model.model_dump(exclude_none=True) if hasattr(model, "model_dump") else dict(model or {})


class EntitlementRuleRepository:
    table_name = "entitlement_rule"

    def list_rules(self, *, plan_tier: str | None = None) -> list[dict[str, Any]]:
        query = _public_table(self.table_name).select("*").order("plan_tier").order("resource_key")
        if plan_tier:
            query = query.eq("plan_tier", plan_tier)
        return list(query.execute().data or [])

    def create_rule(self, payload: EntitlementRuleCreate) -> dict[str, Any]:
        rows = _public_table(self.table_name).insert(_dump(payload)).execute().data or []
        return dict(rows[0]) if rows else {}

    def update_rule(self, rule_id: str, payload: EntitlementRuleUpdate) -> dict[str, Any]:
        rows = _public_table(self.table_name).update(_dump(payload)).eq("id", rule_id).execute().data or []
        return dict(rows[0]) if rows else {}


class SchoolPlanRepository:
    table_name = "school_plans"

    def get_plan(self, school_id: str) -> dict[str, Any] | None:
        rows = _public_table(self.table_name).select("*").eq("school_id", school_id).limit(1).execute().data or []
        return dict(rows[0]) if rows else None

    def list_plans(self) -> list[dict[str, Any]]:
        return list(_public_table(self.table_name).select("*").order("created_at", desc=True).execute().data or [])

    def create_plan(self, payload: SchoolPlanCreate) -> dict[str, Any]:
        rows = _public_table(self.table_name).insert(_dump(payload)).execute().data or []
        return dict(rows[0]) if rows else {}

    def update_plan(self, school_id: str, payload: SchoolPlanUpdate) -> dict[str, Any]:
        rows = _public_table(self.table_name).update(_dump(payload)).eq("school_id", school_id).execute().data or []
        return dict(rows[0]) if rows else {}


class PlanFeatureOverrideRepository:
    table_name = "plan_feature_overrides"

    def list_overrides(self, school_id: str) -> list[dict[str, Any]]:
        return list(
            _public_table(self.table_name)
            .select("*")
            .eq("school_id", school_id)
            .order("resource_key")
            .execute()
            .data
            or []
        )

    def create_override(self, payload: PlanFeatureOverrideCreate) -> dict[str, Any]:
        rows = _public_table(self.table_name).insert(_dump(payload)).execute().data or []
        return dict(rows[0]) if rows else {}

    def update_override(self, override_id: str, payload: PlanFeatureOverrideUpdate) -> dict[str, Any]:
        rows = _public_table(self.table_name).update(_dump(payload)).eq("id", override_id).execute().data or []
        return dict(rows[0]) if rows else {}

    def delete_override(self, override_id: str) -> None:
        _public_table(self.table_name).delete().eq("id", override_id).execute()


class UsageSnapshotRepository:
    table_name = "usage_snapshots"

    def create_snapshot(self, payload: UsageSnapshotCreate) -> UsageSnapshotResponse:
        rows = _public_table(self.table_name).insert(_dump(payload)).execute().data or []
        return UsageSnapshotResponse.model_validate(rows[0])

    def get_snapshot(self, snapshot_id: str) -> UsageSnapshotResponse | None:
        rows = _public_table(self.table_name).select("*").eq("id", snapshot_id).limit(1).execute().data or []
        return UsageSnapshotResponse.model_validate(rows[0]) if rows else None

    def get_snapshot_by_school_date(self, school_id: str, snapshot_date: str) -> UsageSnapshotResponse | None:
        rows = (
            _public_table(self.table_name)
            .select("*")
            .eq("school_id", school_id)
            .eq("snapshot_date", snapshot_date)
            .limit(1)
            .execute()
            .data
            or []
        )
        return UsageSnapshotResponse.model_validate(rows[0]) if rows else None

    def list_snapshots(self, school_id: str, *, limit: int = 30) -> list[UsageSnapshotResponse]:
        rows = (
            _public_table(self.table_name)
            .select("*")
            .eq("school_id", school_id)
            .order("snapshot_date", desc=True)
            .limit(limit)
            .execute()
            .data
            or []
        )
        return [UsageSnapshotResponse.model_validate(row) for row in rows]

    def update_snapshot(self, snapshot_id: str, payload: UsageSnapshotUpdate) -> UsageSnapshotResponse | None:
        rows = _public_table(self.table_name).update(_dump(payload)).eq("id", snapshot_id).execute().data or []
        return UsageSnapshotResponse.model_validate(rows[0]) if rows else None

    def delete_snapshot(self, snapshot_id: str) -> None:
        _public_table(self.table_name).delete().eq("id", snapshot_id).execute()


class AICreditWalletRepository:
    table_name = "ai_credit_wallets"

    def get_wallet(self, wallet_id: str) -> dict[str, Any] | None:
        rows = _public_table(self.table_name).select("*").eq("id", wallet_id).limit(1).execute().data or []
        return dict(rows[0]) if rows else None

    def list_wallets(
        self,
        *,
        school_id: str | None = None,
        profile_id: str | None = None,
        wallet_type: str | None = None,
    ) -> list[dict[str, Any]]:
        query = _public_table(self.table_name).select("*").order("created_at", desc=True)
        if school_id:
            query = query.eq("school_id", school_id)
        if profile_id:
            query = query.eq("profile_id", profile_id)
        if wallet_type:
            query = query.eq("wallet_type", wallet_type)
        return list(query.execute().data or [])

    def create_wallet(self, payload: AICreditWalletCreate) -> dict[str, Any]:
        rows = _public_table(self.table_name).insert(_dump(payload)).execute().data or []
        return dict(rows[0]) if rows else {}

    def update_wallet(self, wallet_id: str, payload: AICreditWalletUpdate) -> dict[str, Any]:
        rows = _public_table(self.table_name).update(_dump(payload)).eq("id", wallet_id).execute().data or []
        return dict(rows[0]) if rows else {}

    def apply_wallet_change_atomic(
        self,
        *,
        profile_id: str,
        school_id: str,
        wallet_type: str,
        delta: int,
        transaction_type: str,
        feature: str | None = None,
        reference_type: str | None = None,
        reference_id: str | None = None,
        description: str | None = None,
        actor_profile_id: str | None = None,
        expires_at: str | None = None,
        metadata: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
        request_hash: str | None = None,
        allow_create: bool = True,
    ) -> dict[str, Any]:
        response = (
            _client()
            .rpc(
                "ai_credit_apply_wallet_change",
                {
                    "p_profile_id": profile_id,
                    "p_school_id": school_id,
                    "p_wallet_type": wallet_type,
                    "p_delta": delta,
                    "p_transaction_type": transaction_type,
                    "p_feature": feature,
                    "p_reference_type": reference_type,
                    "p_reference_id": reference_id,
                    "p_description": description,
                    "p_actor_profile_id": actor_profile_id,
                    "p_expires_at": expires_at,
                    "p_metadata": metadata or {},
                    "p_idempotency_key": idempotency_key,
                    "p_request_hash": request_hash,
                    "p_allow_create": allow_create,
                },
            )
            .execute()
        )
        payload = getattr(response, "data", None) or {}
        return dict(payload)

    def transfer_atomic(
        self,
        *,
        from_profile_id: str,
        from_school_id: str,
        from_wallet_type: str,
        to_profile_id: str,
        to_school_id: str,
        to_wallet_type: str,
        amount: int,
        actor_profile_id: str | None = None,
        description: str | None = None,
        metadata: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
        request_hash: str | None = None,
    ) -> dict[str, Any]:
        response = (
            _client()
            .rpc(
                "ai_credit_transfer_atomic",
                {
                    "p_from_profile_id": from_profile_id,
                    "p_from_school_id": from_school_id,
                    "p_from_wallet_type": from_wallet_type,
                    "p_to_profile_id": to_profile_id,
                    "p_to_school_id": to_school_id,
                    "p_to_wallet_type": to_wallet_type,
                    "p_amount": amount,
                    "p_actor_profile_id": actor_profile_id,
                    "p_description": description,
                    "p_metadata": metadata or {},
                    "p_idempotency_key": idempotency_key,
                    "p_request_hash": request_hash,
                },
            )
            .execute()
        )
        payload = getattr(response, "data", None) or {}
        return dict(payload)

    def debit_atomic(
        self,
        *,
        profile_id: str,
        school_id: str,
        amount: int,
        transaction_type: str,
        feature: str | None = None,
        wallet_type: str | None = None,
        reference_type: str | None = None,
        reference_id: str | None = None,
        description: str | None = None,
        actor_profile_id: str | None = None,
        metadata: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
        request_hash: str | None = None,
    ) -> dict[str, Any]:
        response = (
            _client()
            .rpc(
                "ai_credit_debit_atomic",
                {
                    "p_profile_id": profile_id,
                    "p_school_id": school_id,
                    "p_amount": amount,
                    "p_transaction_type": transaction_type,
                    "p_feature": feature,
                    "p_wallet_type": wallet_type,
                    "p_reference_type": reference_type,
                    "p_reference_id": reference_id,
                    "p_description": description,
                    "p_actor_profile_id": actor_profile_id,
                    "p_metadata": metadata or {},
                    "p_idempotency_key": idempotency_key,
                    "p_request_hash": request_hash,
                },
            )
            .execute()
        )
        payload = getattr(response, "data", None) or {}
        return dict(payload)


class AICreditLedgerRepository:
    table_name = "ai_credit_ledger"

    def get_entry(self, entry_id: str) -> dict[str, Any] | None:
        rows = _public_table(self.table_name).select("*").eq("id", entry_id).limit(1).execute().data or []
        return dict(rows[0]) if rows else None

    def create_entry(self, payload: AICreditLedgerCreate) -> dict[str, Any]:
        rows = _public_table(self.table_name).insert(_dump(payload)).execute().data or []
        return dict(rows[0]) if rows else {}

    def list_entries(
        self,
        *,
        wallet_id: str | None = None,
        school_id: str | None = None,
        profile_id: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        query = _public_table(self.table_name).select("*").order("created_at", desc=True)
        if wallet_id:
            query = query.eq("wallet_id", wallet_id)
        if school_id:
            query = query.eq("school_id", school_id)
        if profile_id:
            query = query.eq("profile_id", profile_id)
        query = query.range(offset, max(offset, offset + limit - 1))
        return list(query.execute().data or [])

    def list_entries_for_wallet(self, wallet_id: str) -> list[dict[str, Any]]:
        return list(
            _public_table(self.table_name)
            .select("*")
            .eq("wallet_id", wallet_id)
            .order("created_at")
            .execute()
            .data
            or []
        )


class AICreditIdempotencyRepository:
    table_name = "ai_credit_idempotency_keys"

    def get_key(self, idempotency_key: str, operation_key: str) -> AICreditIdempotencyKeyResponse | None:
        rows = (
            _public_table(self.table_name)
            .select("*")
            .eq("idempotency_key", idempotency_key)
            .eq("operation_key", operation_key)
            .limit(1)
            .execute()
            .data
            or []
        )
        return AICreditIdempotencyKeyResponse.model_validate(rows[0]) if rows else None

    def create_key(self, payload: AICreditIdempotencyKeyCreate) -> AICreditIdempotencyKeyResponse:
        rows = _public_table(self.table_name).insert(_dump(payload)).execute().data or []
        return AICreditIdempotencyKeyResponse.model_validate(rows[0])

    def update_key(self, idempotency_key: str, operation_key: str, payload: AICreditIdempotencyKeyUpdate) -> AICreditIdempotencyKeyResponse | None:
        rows = (
            _public_table(self.table_name)
            .update(_dump(payload))
            .eq("idempotency_key", idempotency_key)
            .eq("operation_key", operation_key)
            .execute()
            .data
            or []
        )
        return AICreditIdempotencyKeyResponse.model_validate(rows[0]) if rows else None


class AICreditProductRepository:
    table_name = "ai_credit_products"

    def list_products(self, *, active_only: bool = False) -> list[dict[str, Any]]:
        query = _public_table(self.table_name).select("*").order("credits")
        if active_only:
            query = query.eq("is_active", True)
        return list(query.execute().data or [])

    def create_product(self, payload: AICreditProductCreate) -> dict[str, Any]:
        rows = _public_table(self.table_name).insert(_dump(payload)).execute().data or []
        return dict(rows[0]) if rows else {}

    def update_product(self, product_id: str, payload: AICreditProductUpdate) -> dict[str, Any]:
        rows = _public_table(self.table_name).update(_dump(payload)).eq("id", product_id).execute().data or []
        return dict(rows[0]) if rows else {}


class PlanChangeRequestRepository:
    table_name = "plan_change_requests"

    def get_request(self, request_id: str) -> dict[str, Any] | None:
        rows = _public_table(self.table_name).select("*").eq("id", request_id).limit(1).execute().data or []
        return dict(rows[0]) if rows else None

    def list_requests(self, school_id: str | None = None) -> list[dict[str, Any]]:
        query = _public_table(self.table_name).select("*").order("created_at", desc=True)
        if school_id:
            query = query.eq("school_id", school_id)
        return list(query.execute().data or [])

    def create_request(self, payload: PlanChangeRequestCreate) -> dict[str, Any]:
        rows = _public_table(self.table_name).insert(_dump(payload)).execute().data or []
        return dict(rows[0]) if rows else {}

    def update_request(self, request_id: str, payload: PlanChangeRequestUpdate) -> dict[str, Any]:
        rows = _public_table(self.table_name).update(_dump(payload)).eq("id", request_id).execute().data or []
        return dict(rows[0]) if rows else {}
