import { FormEvent, useEffect, useState } from 'react';
import { BadgePercent, CreditCard, IndianRupee, Package, RefreshCcw, Wallet } from 'lucide-react';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { CommerceOrderResponse, CommerceSubscriptionsResponse, RevenueDashboard } from '@types';

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm';

export default function CommercePage() {
  const [dashboard, setDashboard] = useState<RevenueDashboard | null>(null);
  const [subscriptions, setSubscriptions] = useState<CommerceSubscriptionsResponse | null>(null);
  const [order, setOrder] = useState<CommerceOrderResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [providerKey, setProviderKey] = useState('razorpay');
  const [productId, setProductId] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [couponAmount, setCouponAmount] = useState('4999');
  const [couponPreview, setCouponPreview] = useState<Record<string, unknown> | null>(null);

  const loadCommerce = async () => {
    try {
      setLoading(true);
      setError('');
      const [dashboardRes, subscriptionsRes] = await Promise.all([
        apiService.getRevenueDashboard(),
        apiService.listCommerceSubscriptions({ school_scope: true }),
      ]);
      setDashboard(dashboardRes.data);
      setSubscriptions(subscriptionsRes.data);
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Commerce dashboard load nahi hua.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCommerce();
  }, []);

  const submitOrder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!productId.trim()) {
      setError('Product UUID required hai.');
      return;
    }
    try {
      setLoading(true);
      setError('');
      const response = await apiService.createCommerceOrder({
        provider_key: providerKey,
        items: [{ product_id: productId.trim(), quantity: 1 }],
        coupon_code: couponCode.trim() || undefined,
      });
      setOrder(response.data);
      await loadCommerce();
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Order create nahi hua.'));
    } finally {
      setLoading(false);
    }
  };

  const previewCoupon = async () => {
    try {
      setError('');
      const response = await apiService.applyCommerceCoupon({
        code: couponCode.trim(),
        order_amount: Number(couponAmount || 0),
      });
      setCouponPreview(response.data as unknown as Record<string, unknown>);
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Coupon apply nahi hua.'));
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Revenue & Monetization</h1>
        <p className="mt-1 text-sm text-slate-600">
          Finance schema ke andar course commerce, test series sales, subscriptions, coupons, referrals, affiliates, aur revenue reporting ko manage karo.
        </p>
      </div>

      {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}

      {loading ? <LoadingSpinner message="Commerce data load ho raha hai..." /> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Revenue" value={dashboard ? `₹${dashboard.total_revenue.toFixed(2)}` : '--'} icon={IndianRupee} />
        <MetricCard title="MRR" value={dashboard ? `₹${dashboard.mrr.toFixed(2)}` : '--'} icon={RefreshCcw} />
        <MetricCard title="ARR" value={dashboard ? `₹${dashboard.arr.toFixed(2)}` : '--'} icon={Wallet} />
        <MetricCard title="Active Subs" value={dashboard ? `${dashboard.active_subscriptions}` : '--'} icon={Package} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <form onSubmit={submitOrder} className={cardClass}>
          <h2 className="text-lg font-semibold text-slate-900">Create Commerce Order</h2>
          <p className="mt-1 text-sm text-slate-500">Razorpay payment flow is available in the current release through the shared billing API contract.</p>
          <div className="mt-4 grid gap-3">
            <select value={providerKey} onChange={(event) => setProviderKey(event.target.value)} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm">
              <option value="razorpay">Razorpay</option>
            </select>
            <input value={productId} onChange={(event) => setProductId(event.target.value)} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" placeholder="Product UUID" />
            <input value={couponCode} onChange={(event) => setCouponCode(event.target.value)} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" placeholder="Coupon code" />
            <button className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800">
              <CreditCard className="h-4 w-4" />
              Create Order
            </button>
          </div>
          {order ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <div>Order ID: {order.order_id}</div>
              <div>Provider Order: {order.provider_order_id}</div>
              <div>Total: ₹{order.total_amount.toFixed(2)}</div>
              <div>Payment Link: {order.payment_link}</div>
            </div>
          ) : null}
        </form>

        <div className={cardClass}>
          <h2 className="text-lg font-semibold text-slate-900">Coupon & Subscription Snapshot</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Wallet className="h-4 w-4" />
                Coupon Preview
              </div>
              <input value={couponAmount} onChange={(event) => setCouponAmount(event.target.value)} className="mt-3 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm" placeholder="Order amount" />
              <button type="button" onClick={previewCoupon} className="mt-3 inline-flex items-center gap-2 rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100">
                <BadgePercent className="h-4 w-4" />
                Apply Coupon
              </button>
              {couponPreview ? (
                <div className="mt-3 text-sm text-slate-700">
                  <div>Discount: ₹{String(couponPreview.discount_amount || 0)}</div>
                  <div>Final: ₹{String(couponPreview.final_amount || 0)}</div>
                </div>
              ) : null}
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Package className="h-4 w-4" />
                Subscriptions
              </div>
              <div className="mt-3 space-y-2 text-sm text-slate-700">
                {(subscriptions?.subscriptions || []).slice(0, 5).map((item) => (
                  <div key={item.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    {item.plan_name} | {item.subscription_status} | ₹{item.amount}
                  </div>
                ))}
                {!(subscriptions?.subscriptions || []).length ? <div>No subscriptions found.</div> : null}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className={cardClass}>
          <h2 className="text-lg font-semibold text-slate-900">Top Products</h2>
          <div className="mt-4 space-y-2 text-sm text-slate-700">
            {(dashboard?.top_products || []).map((item) => (
              <div key={item.title} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                {item.title} | ₹{item.revenue.toFixed(2)}
              </div>
            ))}
            {!(dashboard?.top_products || []).length ? <div>No product sales yet.</div> : null}
          </div>
        </div>
        <div className={cardClass}>
          <h2 className="text-lg font-semibold text-slate-900">Revenue Split</h2>
          <div className="mt-4 space-y-2 text-sm text-slate-700">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">Course Sales: ₹{dashboard?.course_sales?.toFixed(2) || '0.00'}</div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">Test Sales: ₹{dashboard?.test_sales?.toFixed(2) || '0.00'}</div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">Affiliate Sales: ₹{dashboard?.affiliate_sales?.toFixed(2) || '0.00'}</div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">Pending Payouts: ₹{dashboard?.pending_payouts?.toFixed(2) || '0.00'}</div>
          </div>
        </div>
      </section>

      <section className={cardClass}>
        <h2 className="text-lg font-semibold text-slate-900">Product Catalog</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(dashboard?.product_catalog || []).map((item) => {
            const row = item as Record<string, unknown>;
            return (
              <div key={String(row.id)} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <div className="font-semibold text-slate-900">{String(row.title || 'Product')}</div>
                <div className="mt-1">{String(row.category || row.product_type || '')}</div>
                <div className="mt-1">Price: ₹{String(row.sale_price ?? row.base_price ?? 0)}</div>
                <div className="mt-1 break-all text-xs text-slate-500">{String(row.id || '')}</div>
              </div>
            );
          })}
          {!(dashboard?.product_catalog || []).length ? <div className="text-sm text-slate-500">No products available.</div> : null}
        </div>
      </section>
    </div>
  );
}

function MetricCard({ title, value, icon: Icon }: { title: string; value: string; icon: typeof IndianRupee }) {
  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-slate-500">{title}</div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{value}</div>
        </div>
        <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}
