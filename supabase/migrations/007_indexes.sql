-- ============================================================================
-- 007_indexes.sql — supporting indexes
-- ============================================================================

create index if not exists idx_dealers_status         on public.dealers(status);
create index if not exists idx_dealers_tier           on public.dealers(tier_id);
create index if not exists idx_apps_user_status        on public.dealer_applications(applicant_user_id, status);
create index if not exists idx_tier_prices_tier        on public.product_tier_prices(tier_id);
create index if not exists idx_dealer_prices_dealer    on public.product_dealer_prices(dealer_id);
create index if not exists idx_products_sku            on public.products(sku);
create index if not exists idx_orders_dealer_status    on public.orders(dealer_id, order_status);
create index if not exists idx_orders_payment_status   on public.orders(payment_status);
create index if not exists idx_order_items_order       on public.order_items(order_id);
create index if not exists idx_status_history_order    on public.order_status_history(order_id);
create index if not exists idx_notifications_recipient on public.notifications(recipient_id, is_read);
create index if not exists idx_audit_entity            on public.admin_audit_log(entity_type, entity_id);
