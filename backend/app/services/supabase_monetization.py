"""Revenue and monetization engine built on top of the existing finance schema."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from app.services.supabase_admin import get_supabase_admin_client

MODULE_KEY = "edupay"
FINANCE_SCHEMA = "finance"


def _client():
    return get_supabase_admin_client()


def _public_table(name: str):
    return _client().table(name)


def _finance_table(name: str):
    return _client().schema(FINANCE_SCHEMA).table(name)


def _normalize(value: Any) -> str:
    return str(value or "").strip()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_now_iso() -> str:
    return _utc_now().isoformat()


def _today() -> date:
    return _utc_now().date()


def _to_decimal(value: Any) -> Decimal:
    try:
        return Decimal(str(value or 0))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0")


def _to_float(value: Any) -> float:
    return float(_to_decimal(value))


def _safe_int(value: Any, fallback: int = 0) -> int:
    try:
        return int(value or fallback)
    except (TypeError, ValueError):
        return fallback


def _log_audit_entry(
    *,
    school_id: str | None,
    profile_id: str | None,
    action: str,
    payload: dict[str, Any] | None = None,
) -> None:
    _public_table("audit_logs").insert(
        {
            "school_id": school_id,
            "profile_id": profile_id,
            "action": action,
            "module_key": MODULE_KEY,
            "payload": payload or {},
        }
    ).execute()


def _school_scope_filter(query, school_id: str | None):
    if school_id:
        return query.eq("school_id", school_id)
    return query


@dataclass
class PaymentProviderAdapter:
    provider_key: str

    def create_order(
        self,
        *,
        order_id: str,
        amount: Decimal,
        currency: str,
        customer_reference: str | None,
        metadata: dict[str, Any],
    ) -> dict[str, Any]:
        provider_prefix = {
            "razorpay": "order_rzp",
            "stripe": "order_stp",
            "cashfree": "order_cfr",
        }.get(self.provider_key, "order_pay")
        return {
            "provider_key": self.provider_key,
            "provider_order_id": f"{provider_prefix}_{uuid4().hex[:18]}",
            "payment_link": f"https://payments.local/{self.provider_key}/{order_id}",
            "customer_reference": customer_reference,
            "currency": currency,
            "amount": round(float(amount), 2),
            "metadata": metadata,
            "mode": "provider_ready_mock",
        }

    def verify_payment(
        self,
        *,
        provider_order_id: str,
        provider_payment_id: str | None,
        signature: str | None,
        metadata: dict[str, Any],
    ) -> dict[str, Any]:
        verified = bool(_normalize(provider_order_id))
        return {
            "provider_key": self.provider_key,
            "provider_order_id": provider_order_id,
            "provider_payment_id": provider_payment_id or f"pay_{uuid4().hex[:16]}",
            "signature": signature or f"sig_{uuid4().hex[:12]}",
            "verified": verified,
            "mode": "provider_ready_mock",
            "metadata": metadata,
        }


def _provider_adapter(provider_key: str) -> PaymentProviderAdapter:
    normalized = _normalize(provider_key).lower()
    if normalized not in {"razorpay", "stripe", "cashfree"}:
        raise HTTPException(status_code=400, detail="Unsupported payment provider")
    return PaymentProviderAdapter(provider_key=normalized)


def _get_product(product_id: str, *, school_id: str | None = None) -> dict[str, Any]:
    rows = list(
        _finance_table("products")
        .select("*")
        .eq("id", product_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Product not found")
    product = dict(rows[0])
    product_school_id = _normalize(product.get("school_id")) or None
    owner_scope = _normalize(product.get("owner_scope")).lower()
    if school_id and product_school_id and product_school_id != school_id and owner_scope != "platform":
        raise HTTPException(status_code=403, detail="Product does not belong to the active school")
    return product


def _get_profile_student(school_id: str, profile_id: str | None) -> dict[str, Any] | None:
    if not school_id or not profile_id:
        return None
    rows = list(
        _public_table("students")
        .select("id,profile_id,full_name,batch_id,class_name")
        .eq("school_id", school_id)
        .eq("profile_id", profile_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
        .data
        or []
    )
    return dict(rows[0]) if rows else None


def _coupon_by_code(school_id: str | None, code: str) -> dict[str, Any] | None:
    normalized = _normalize(code)
    if not normalized:
        return None
    query = _finance_table("coupons").select("*").ilike("code", normalized).eq("is_active", True).limit(1)
    if school_id:
        query = query.eq("school_id", school_id)
    rows = list(query.execute().data or [])
    return dict(rows[0]) if rows else None


def _coupon_discount(coupon: dict[str, Any], order_amount: Decimal) -> Decimal:
    now = _utc_now()
    starts_at = _normalize(coupon.get("starts_at"))
    expires_at = _normalize(coupon.get("expires_at"))
    if starts_at and datetime.fromisoformat(starts_at.replace("Z", "+00:00")) > now:
        raise HTTPException(status_code=400, detail="Coupon is not active yet")
    if expires_at and datetime.fromisoformat(expires_at.replace("Z", "+00:00")) < now:
        raise HTTPException(status_code=400, detail="Coupon has expired")
    if _safe_int(coupon.get("usage_limit")) and _safe_int(coupon.get("used_count")) >= _safe_int(coupon.get("usage_limit")):
        raise HTTPException(status_code=400, detail="Coupon usage limit reached")
    if order_amount < _to_decimal(coupon.get("min_order_amount")):
        raise HTTPException(status_code=400, detail="Order does not meet coupon minimum amount")
    if _normalize(coupon.get("coupon_type")) == "percentage":
        discount = (order_amount * _to_decimal(coupon.get("discount_value"))) / Decimal("100")
    else:
        discount = _to_decimal(coupon.get("discount_value"))
    max_discount = _to_decimal(coupon.get("max_discount_amount"))
    if max_discount > 0:
        discount = min(discount, max_discount)
    return max(discount, Decimal("0"))


def _product_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "school_id": row.get("school_id"),
        "owner_scope": row.get("owner_scope"),
        "product_type": row.get("product_type"),
        "category": row.get("category"),
        "title": row.get("title"),
        "description": row.get("description"),
        "external_entity_id": row.get("external_entity_id"),
        "pricing_model": row.get("pricing_model"),
        "access_tier": row.get("access_tier"),
        "currency": row.get("currency"),
        "base_price": round(_to_float(row.get("base_price")), 2),
        "sale_price": round(_to_float(row.get("sale_price")), 2) if row.get("sale_price") is not None else None,
        "billing_interval": row.get("billing_interval"),
        "is_active": bool(row.get("is_active", True)),
        "metadata": row.get("metadata") or {},
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def create_seed_catalog_for_school(school_id: str, profile_id: str | None = None) -> list[dict[str, Any]]:
    existing = list(
        _finance_table("products")
        .select("*")
        .eq("school_id", school_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if existing:
        return [_product_payload(item) for item in existing]
    seed_rows = [
        {
            "school_id": school_id,
            "owner_scope": "school",
            "product_type": "course",
            "category": "paid_course",
            "title": "Foundation Science Mastery",
            "description": "One-time purchase course pack with recorded lessons and worksheets.",
            "pricing_model": "one_time",
            "access_tier": "paid",
            "currency": "INR",
            "base_price": 4999,
            "sale_price": 3999,
            "billing_interval": None,
            "metadata": {"source": "seed_catalog"},
        },
        {
            "school_id": school_id,
            "owner_scope": "school",
            "product_type": "test_series",
            "category": "neet_test_series",
            "title": "NEET Precision Test Series",
            "description": "Paid NEET mock package with analytics and solutions.",
            "pricing_model": "one_time",
            "access_tier": "premium",
            "currency": "INR",
            "base_price": 6999,
            "sale_price": 5499,
            "billing_interval": None,
            "metadata": {"source": "seed_catalog"},
        },
        {
            "school_id": school_id,
            "owner_scope": "school",
            "product_type": "subscription_plan",
            "category": "subscription_course",
            "title": "Premium Learning Pass",
            "description": "Subscription access to premium courses, live classes, and doubt solving.",
            "pricing_model": "monthly",
            "access_tier": "subscription",
            "currency": "INR",
            "base_price": 1499,
            "sale_price": 1299,
            "billing_interval": "monthly",
            "metadata": {"plan_name": "Premium", "source": "seed_catalog"},
        },
    ]
    inserted = _finance_table("products").insert(seed_rows).execute()
    _log_audit_entry(school_id=school_id, profile_id=profile_id, action="edupay.commerce.seed_catalog", payload={"count": len(seed_rows)})
    return [_product_payload(item) for item in list(inserted.data or [])]


def list_subscriptions(school_id: str, *, profile_id: str | None = None, include_school_scope: bool = False) -> list[dict[str, Any]]:
    query = _finance_table("subscriptions").select("*")
    query = _school_scope_filter(query, school_id)
    if profile_id and not include_school_scope:
        query = query.eq("profile_id", profile_id)
    rows = list(query.order("expiry_date", desc=True).execute().data or [])
    return [
        {
            "id": row.get("id"),
            "school_id": row.get("school_id"),
            "profile_id": row.get("profile_id"),
            "student_id": row.get("student_id"),
            "product_id": row.get("product_id"),
            "order_id": row.get("order_id"),
            "provider_key": row.get("provider_key"),
            "plan_name": row.get("plan_name"),
            "subscription_status": row.get("subscription_status"),
            "start_date": row.get("start_date"),
            "expiry_date": row.get("expiry_date"),
            "renewal_date": row.get("renewal_date"),
            "auto_renew": bool(row.get("auto_renew", False)),
            "renewal_count": _safe_int(row.get("renewal_count")),
            "amount": round(_to_float(row.get("amount")), 2),
            "currency": row.get("currency"),
            "metadata": row.get("metadata") or {},
        }
        for row in rows
    ]


def apply_coupon(school_id: str | None, *, code: str, order_amount: Any) -> dict[str, Any]:
    coupon = _coupon_by_code(school_id, code)
    if not coupon:
        raise HTTPException(status_code=404, detail="Coupon not found")
    order_decimal = _to_decimal(order_amount)
    discount = _coupon_discount(coupon, order_decimal)
    final_amount = max(order_decimal - discount, Decimal("0"))
    return {
        "coupon_id": coupon.get("id"),
        "code": coupon.get("code"),
        "coupon_type": coupon.get("coupon_type"),
        "discount_amount": round(float(discount), 2),
        "final_amount": round(float(final_amount), 2),
        "currency": "INR",
        "metadata": coupon.get("metadata") or {},
    }


def create_order(
    school_id: str | None,
    *,
    profile_id: str | None,
    provider_key: str,
    items: list[dict[str, Any]],
    coupon_code: str | None = None,
    referral_code: str | None = None,
    affiliate_code: str | None = None,
    credits_to_redeem: Any = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not items:
        raise HTTPException(status_code=400, detail="At least one order item is required")
    adapter = _provider_adapter(provider_key)
    normalized_items: list[dict[str, Any]] = []
    subtotal = Decimal("0")
    first_product_school_id = school_id
    for item in items:
        product = _get_product(_normalize(item.get("product_id")), school_id=school_id)
        if not first_product_school_id:
            first_product_school_id = _normalize(product.get("school_id")) or None
        quantity = max(_safe_int(item.get("quantity"), 1), 1)
        unit_price = _to_decimal(product.get("sale_price") if product.get("sale_price") is not None else product.get("base_price"))
        total_price = unit_price * quantity
        subtotal += total_price
        normalized_items.append({"product": product, "quantity": quantity, "unit_price": unit_price, "total_price": total_price})

    coupon_payload = apply_coupon(first_product_school_id, code=coupon_code, order_amount=subtotal) if coupon_code else None
    discount_amount = _to_decimal((coupon_payload or {}).get("discount_amount"))
    credits_redeemed = min(_to_decimal(credits_to_redeem), max(subtotal - discount_amount, Decimal("0"))) if credits_to_redeem is not None else Decimal("0")
    total_amount = max(subtotal - discount_amount - credits_redeemed, Decimal("0"))
    student = _get_profile_student(first_product_school_id or "", profile_id) if first_product_school_id and profile_id else None

    order_payload = {
        "school_id": first_product_school_id,
        "profile_id": profile_id,
        "student_id": (student or {}).get("id"),
        "provider_key": provider_key,
        "order_status": "pending",
        "currency": "INR",
        "subtotal_amount": float(subtotal),
        "discount_amount": float(discount_amount),
        "tax_amount": 0.0,
        "credits_redeemed": float(credits_redeemed),
        "total_amount": float(total_amount),
        "coupon_id": (coupon_payload or {}).get("coupon_id"),
        "metadata": {
            "referral_code": referral_code,
            "affiliate_code": affiliate_code,
            **(metadata or {}),
        },
        "expires_at": (_utc_now() + timedelta(minutes=30)).isoformat(),
    }
    order_response = _finance_table("orders").insert(order_payload).execute()
    order_rows = list(order_response.data or [])
    if not order_rows:
        raise HTTPException(status_code=500, detail="Failed to create order")
    order = dict(order_rows[0])
    provider_payload = adapter.create_order(
        order_id=_normalize(order.get("id")),
        amount=total_amount,
        currency="INR",
        customer_reference=profile_id,
        metadata=order_payload["metadata"],
    )
    _finance_table("orders").update({"provider_order_id": provider_payload["provider_order_id"], "metadata": {**(order.get("metadata") or {}), **provider_payload}}).eq("id", order.get("id")).execute()
    order_item_rows = []
    for item in normalized_items:
        inserted = _finance_table("order_items").insert(
            {
                "school_id": first_product_school_id,
                "order_id": order.get("id"),
                "product_id": item["product"].get("id"),
                "quantity": item["quantity"],
                "unit_price": float(item["unit_price"]),
                "total_price": float(item["total_price"]),
                "metadata": {"product_type": item["product"].get("product_type"), "title": item["product"].get("title")},
            }
        ).execute()
        order_item_rows.extend(list(inserted.data or []))
    _log_audit_entry(school_id=first_product_school_id, profile_id=profile_id, action="edupay.commerce.order_created", payload={"order_id": order.get("id"), "provider_key": provider_key, "total_amount": float(total_amount)})
    return {
        "order_id": order.get("id"),
        "school_id": first_product_school_id,
        "provider_key": provider_key,
        "provider_order_id": provider_payload["provider_order_id"],
        "payment_link": provider_payload["payment_link"],
        "subtotal_amount": round(float(subtotal), 2),
        "discount_amount": round(float(discount_amount), 2),
        "credits_redeemed": round(float(credits_redeemed), 2),
        "total_amount": round(float(total_amount), 2),
        "currency": "INR",
        "coupon": coupon_payload,
        "items": [
            {
                "product_id": item["product"].get("id"),
                "title": item["product"].get("title"),
                "quantity": item["quantity"],
                "unit_price": round(float(item["unit_price"]), 2),
                "total_price": round(float(item["total_price"]), 2),
                "product_type": item["product"].get("product_type"),
                "pricing_model": item["product"].get("pricing_model"),
            }
            for item in normalized_items
        ],
        "mode": provider_payload["mode"],
    }


def verify_order(
    school_id: str | None,
    *,
    profile_id: str | None,
    provider_key: str,
    order_id: str,
    provider_order_id: str,
    provider_payment_id: str | None,
    signature: str | None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    adapter = _provider_adapter(provider_key)
    rows = list(_finance_table("orders").select("*").eq("id", order_id).limit(1).execute().data or [])
    if not rows:
        raise HTTPException(status_code=404, detail="Order not found")
    order = dict(rows[0])
    order_school_id = _normalize(order.get("school_id")) or None
    if school_id and order_school_id and order_school_id != school_id:
        raise HTTPException(status_code=403, detail="Order does not belong to the active school")
    verification = adapter.verify_payment(
        provider_order_id=provider_order_id,
        provider_payment_id=provider_payment_id,
        signature=signature,
        metadata=metadata or {},
    )
    if not verification["verified"]:
        _finance_table("orders").update({"order_status": "failed", "provider_payment_id": verification["provider_payment_id"]}).eq("id", order_id).execute()
        raise HTTPException(status_code=400, detail="Payment verification failed")
    updated_metadata = {**(order.get("metadata") or {}), **verification, **(metadata or {})}
    _finance_table("orders").update(
        {
            "order_status": "paid",
            "provider_order_id": provider_order_id,
            "provider_payment_id": verification["provider_payment_id"],
            "provider_signature": verification["signature"],
            "verified_at": _utc_now_iso(),
            "paid_at": _utc_now_iso(),
            "metadata": updated_metadata,
        }
    ).eq("id", order_id).execute()
    order_items = list(_finance_table("order_items").select("*").eq("order_id", order_id).execute().data or [])
    subscriptions_created: list[dict[str, Any]] = []
    for item in order_items:
        product = _get_product(_normalize(item.get("product_id")), school_id=order_school_id)
        pricing_model = _normalize(product.get("pricing_model"))
        if pricing_model in {"monthly", "yearly"} or _normalize(product.get("product_type")) == "subscription_plan":
            product_metadata = product.get("metadata") if isinstance(product.get("metadata"), dict) else {}
            plan_name = _normalize(product_metadata.get("plan_name")) or ("Premium" if pricing_model == "monthly" else "Enterprise")
            expiry_date = _today() + timedelta(days=30 if pricing_model == "monthly" else 365)
            sub = _finance_table("subscriptions").insert(
                {
                    "school_id": order.get("school_id"),
                    "profile_id": order.get("profile_id"),
                    "student_id": order.get("student_id"),
                    "product_id": product.get("id"),
                    "order_id": order_id,
                    "provider_key": provider_key,
                    "plan_name": plan_name if plan_name in {"Basic", "Premium", "Enterprise"} else "Premium",
                    "subscription_status": "active",
                    "start_date": _today().isoformat(),
                    "expiry_date": expiry_date.isoformat(),
                    "renewal_date": expiry_date.isoformat(),
                    "amount": float(item.get("total_price") or 0),
                    "currency": "INR",
                    "metadata": {"product_title": product.get("title")},
                }
            ).execute()
            subscriptions_created.extend(list(sub.data or []))
    coupon_id = order.get("coupon_id")
    if coupon_id:
        coupon_rows = list(_finance_table("coupons").select("used_count").eq("id", coupon_id).limit(1).execute().data or [])
        if coupon_rows:
            _finance_table("coupons").update({"used_count": _safe_int(coupon_rows[0].get("used_count")) + 1}).eq("id", coupon_id).execute()
    _log_audit_entry(school_id=order.get("school_id"), profile_id=profile_id, action="edupay.commerce.order_verified", payload={"order_id": order_id, "provider_order_id": provider_order_id})
    return {
        "order_id": order_id,
        "status": "paid",
        "provider_payment_id": verification["provider_payment_id"],
        "subscriptions_created": len(subscriptions_created),
        "mode": verification["mode"],
        "verified_at": _utc_now_iso(),
    }


def revenue_dashboard(school_id: str | None) -> dict[str, Any]:
    if school_id:
        create_seed_catalog_for_school(school_id)
    products = list(_school_scope_filter(_finance_table("products").select("*"), school_id).eq("is_active", True).execute().data or [])
    orders = list(_school_scope_filter(_finance_table("orders").select("*"), school_id).execute().data or [])
    subscriptions = list(_school_scope_filter(_finance_table("subscriptions").select("*"), school_id).execute().data or [])
    affiliates = list(_school_scope_filter(_finance_table("affiliates").select("*"), school_id).execute().data or [])
    payouts = list(_school_scope_filter(_finance_table("payouts").select("*"), school_id).execute().data or [])
    order_items = list(_school_scope_filter(_finance_table("order_items").select("*"), school_id).execute().data or [])

    paid_orders = [row for row in orders if _normalize(row.get("order_status")) == "paid"]
    total_revenue = sum(_to_float(row.get("total_amount")) for row in paid_orders)
    month_start = _today().replace(day=1)
    year_start = _today().replace(month=1, day=1)
    mrr = sum(_to_float(row.get("amount")) for row in subscriptions if _normalize(row.get("subscription_status")) == "active" and _normalize(row.get("plan_name")) in {"Basic", "Premium", "Enterprise"})
    arr = round(mrr * 12, 2)
    monthly_revenue = sum(_to_float(row.get("total_amount")) for row in paid_orders if _normalize(row.get("paid_at"))[:10] >= month_start.isoformat())
    yearly_revenue = sum(_to_float(row.get("total_amount")) for row in paid_orders if _normalize(row.get("paid_at"))[:10] >= year_start.isoformat())

    product_map = {str(item.get("id")): item for item in products}
    course_sales = 0.0
    test_sales = 0.0
    top_counter: dict[str, float] = {}
    for item in order_items:
        order_row = next((row for row in paid_orders if str(row.get("id")) == str(item.get("order_id"))), None)
        if not order_row:
            continue
        product = product_map.get(str(item.get("product_id")), {})
        amount = _to_float(item.get("total_price"))
        title = _normalize(product.get("title")) or "Unknown"
        top_counter[title] = top_counter.get(title, 0.0) + amount
        if _normalize(product.get("product_type")) == "course":
            course_sales += amount
        if _normalize(product.get("product_type")) == "test_series":
            test_sales += amount

    top_products = sorted(top_counter.items(), key=lambda item: item[1], reverse=True)[:5]
    affiliate_sales = sum(_to_float(item.get("sales_amount")) for item in affiliates)
    affiliate_commissions = sum(_to_float(item.get("commissions_earned")) for item in affiliates)
    pending_payouts = sum(_to_float(item.get("amount")) for item in payouts if _normalize(item.get("payout_status")) in {"pending", "processing"})

    school_revenue_rows: dict[str, float] = {}
    for order in paid_orders:
        key = _normalize(order.get("school_id")) or "platform"
        school_revenue_rows[key] = school_revenue_rows.get(key, 0.0) + _to_float(order.get("total_amount"))

    return {
        "scope": "school" if school_id else "platform",
        "total_revenue": round(total_revenue, 2),
        "mrr": round(mrr, 2),
        "arr": round(arr, 2),
        "monthly_revenue": round(monthly_revenue, 2),
        "yearly_revenue": round(yearly_revenue, 2),
        "course_sales": round(course_sales, 2),
        "test_sales": round(test_sales, 2),
        "affiliate_sales": round(affiliate_sales, 2),
        "affiliate_commissions": round(affiliate_commissions, 2),
        "pending_payouts": round(pending_payouts, 2),
        "active_subscriptions": len([row for row in subscriptions if _normalize(row.get("subscription_status")) == "active"]),
        "orders_count": len(orders),
        "paid_orders_count": len(paid_orders),
        "product_catalog": [_product_payload(item) for item in products[:12]],
        "top_products": [{"title": title, "revenue": round(value, 2)} for title, value in top_products],
        "school_revenue": [{"school_id": key, "revenue": round(value, 2)} for key, value in school_revenue_rows.items()],
        "generated_at": _utc_now_iso(),
    }
