import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/widgets/app_section.dart';
import '../../../core/widgets/async_state_view.dart';
import '../../../core/widgets/stat_tile.dart';
import '../../portal/data/mobile_portal_repository.dart';
import '../../portal/presentation/portal_ui.dart';

class CommercePage extends ConsumerStatefulWidget {
  const CommercePage({
    this.title = 'Commerce',
    super.key,
  });

  final String title;

  @override
  ConsumerState<CommercePage> createState() => _CommercePageState();
}

class _CommercePageState extends ConsumerState<CommercePage> {
  final TextEditingController _productController = TextEditingController();
  final TextEditingController _couponController = TextEditingController();
  final TextEditingController _amountController = TextEditingController(text: '4999');
  String _provider = 'razorpay';
  bool _loading = false;
  String? _error;
  Map<String, dynamic>? _dashboard;
  Map<String, dynamic>? _subscriptions;
  Map<String, dynamic>? _order;
  Map<String, dynamic>? _coupon;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    _productController.dispose();
    _couponController.dispose();
    _amountController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: <Widget>[
        AppSection(
          title: widget.title,
          subtitle: 'Purchases, subscriptions, coupon redemption, and revenue visibility using the shared finance engine.',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              GridView.count(
                crossAxisCount: MediaQuery.of(context).size.width > 720 ? 4 : 2,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                crossAxisSpacing: 12,
                mainAxisSpacing: 12,
                childAspectRatio: 1.5,
                children: <Widget>[
                  StatTile(label: 'Revenue', value: '₹${displayValue(_dashboard?['total_revenue'], fallback: '0')}', helper: 'Total'),
                  StatTile(label: 'MRR', value: '₹${displayValue(_dashboard?['mrr'], fallback: '0')}', helper: 'Monthly recurring', color: const Color(0xFF7C3AED)),
                  StatTile(label: 'Subs', value: '${(_subscriptions?['subscriptions'] as List<dynamic>? ?? const <dynamic>[]).length}', helper: 'Subscriptions', color: const Color(0xFF0F766E)),
                  StatTile(label: 'Order', value: displayValue(_order?['provider_key'], fallback: 'Pending'), helper: 'Latest order', color: const Color(0xFFB45309)),
                ],
              ),
              const SizedBox(height: 16),
              DropdownButtonFormField<String>(
                value: _provider,
                items: const <DropdownMenuItem<String>>[
                  DropdownMenuItem(value: 'razorpay', child: Text('Razorpay')),
                ],
                onChanged: (String? value) => setState(() => _provider = value ?? 'razorpay'),
                decoration: const InputDecoration(labelText: 'Provider', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _productController,
                decoration: const InputDecoration(labelText: 'Product UUID', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _couponController,
                decoration: const InputDecoration(labelText: 'Coupon code', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _amountController,
                decoration: const InputDecoration(labelText: 'Order amount', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 16),
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: <Widget>[
                  FilledButton.icon(
                    onPressed: _loading ? null : _createOrder,
                    icon: const Icon(Icons.payment_outlined),
                    label: Text(_loading ? 'Processing...' : 'Create order'),
                  ),
                  OutlinedButton.icon(
                    onPressed: _loading ? null : _applyCoupon,
                    icon: const Icon(Icons.local_offer_outlined),
                    label: const Text('Apply coupon'),
                  ),
                ],
              ),
              if (_error != null) ...<Widget>[
                const SizedBox(height: 12),
                Text(_error!, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Colors.red.shade700)),
              ],
            ],
          ),
        ),
        const SizedBox(height: 16),
        if (_loading)
          const AsyncStateView(loading: true, child: SizedBox.shrink())
        else ...<Widget>[
          AppSection(
            title: 'Revenue snapshot',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text('Course sales: ₹${displayValue(_dashboard?['course_sales'], fallback: '0')}'),
                const SizedBox(height: 8),
                Text('Test sales: ₹${displayValue(_dashboard?['test_sales'], fallback: '0')}'),
                const SizedBox(height: 8),
                Text('Affiliate sales: ₹${displayValue(_dashboard?['affiliate_sales'], fallback: '0')}'),
              ],
            ),
          ),
          const SizedBox(height: 16),
          AppSection(
            title: 'Product catalog',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: (_dashboard?['product_catalog'] as List<dynamic>? ?? const <dynamic>[])
                  .take(6)
                  .map<Widget>((dynamic item) => Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Text(
                          '${displayValue((item as Map<String, dynamic>)['title'])} | ₹${displayValue(item['sale_price'] ?? item['base_price'])} | ${displayValue(item['id'])}',
                        ),
                      ))
                  .toList(),
            ),
          ),
          const SizedBox(height: 16),
          AppSection(
            title: 'Subscriptions',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: (_subscriptions?['subscriptions'] as List<dynamic>? ?? const <dynamic>[])
                  .take(5)
                  .map<Widget>((dynamic item) => Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Text(
                          '${displayValue((item as Map<String, dynamic>)['plan_name'])} | ${displayValue(item['subscription_status'])} | ₹${displayValue(item['amount'])}',
                        ),
                      ))
                  .toList(),
            ),
          ),
          if (_order != null) ...<Widget>[
            const SizedBox(height: 16),
            AppSection(
              title: 'Latest order',
              child: Text('Order ${displayValue(_order?['order_id'])} | ${displayValue(_order?['payment_link'])}'),
            ),
          ],
          if (_coupon != null) ...<Widget>[
            const SizedBox(height: 16),
            AppSection(
              title: 'Coupon result',
              child: Text('Discount ₹${displayValue(_coupon?['discount_amount'])} | Final ₹${displayValue(_coupon?['final_amount'])}'),
            ),
          ],
        ],
      ],
    );
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final repository = ref.read(mobilePortalRepositoryProvider);
      final dashboard = await repository.loadRevenueDashboard();
      final subscriptions = await repository.loadCommerceSubscriptions(schoolScope: true);
      if (!mounted) return;
      setState(() {
        _dashboard = dashboard;
        _subscriptions = subscriptions;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = '$error');
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _createOrder() async {
    if (_productController.text.trim().isEmpty) {
      setState(() => _error = 'Product UUID is required.');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final repository = ref.read(mobilePortalRepositoryProvider);
      final order = await repository.createCommerceOrder(<String, dynamic>{
        'provider_key': _provider,
        'items': <Map<String, dynamic>>[
          <String, dynamic>{'product_id': _productController.text.trim(), 'quantity': 1},
        ],
        if (_couponController.text.trim().isNotEmpty) 'coupon_code': _couponController.text.trim(),
      });
      if (!mounted) return;
      setState(() => _order = order);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = '$error');
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _applyCoupon() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final repository = ref.read(mobilePortalRepositoryProvider);
      final coupon = await repository.applyCommerceCoupon(<String, dynamic>{
        'code': _couponController.text.trim(),
        'order_amount': double.tryParse(_amountController.text.trim()) ?? 0,
      });
      if (!mounted) return;
      setState(() => _coupon = coupon);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = '$error');
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }
}
