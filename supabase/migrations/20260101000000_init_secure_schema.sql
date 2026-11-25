CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code text NOT NULL UNIQUE,
  pin_hash text NOT NULL,
  service_id text NOT NULL,
  service_name text NOT NULL,
  country_code text NOT NULL,
  country_name text NOT NULL,
  supplier_cost_idr bigint NOT NULL CHECK (supplier_cost_idr >= 0),
  sell_price_idr bigint NOT NULL CHECK (sell_price_idr > 0),
  amount_due_idr bigint NOT NULL CHECK (amount_due_idr >= 0),
  voucher_applied_idr bigint NOT NULL DEFAULT 0 CHECK (voucher_applied_idr >= 0),
  voucher_restored_at timestamptz,
  payment_status text NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'paid', 'expired', 'cancelled')),
  fulfillment_status text NOT NULL DEFAULT 'waiting_payment'
    CHECK (fulfillment_status IN ('waiting_payment', 'processing', 'completed', 'refunded', 'failed')),
  midtrans_transaction_id text,
  supplier_order_id bigint,
  fulfillment_claimed_at timestamptz,
  phone_number text,
  otp_code text,
  qris_payload text,
  voucher_code text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX orders_created_at_idx ON public.orders (created_at DESC);
CREATE INDEX orders_payment_status_idx ON public.orders (payment_status, fulfillment_status);

CREATE TABLE public.financial_ledger (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id),
  entry_type text NOT NULL CHECK (entry_type IN ('payment_gross', 'qris_mdr', 'supplier_cost', 'voucher_redeemed', 'voucher_issued')),
  amount_idr bigint NOT NULL,
  reference text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, entry_type, reference)
);

CREATE TABLE public.refund_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id),
  voucher_code text NOT NULL UNIQUE,
  amount_idr bigint NOT NULL CHECK (amount_idr > 0),
  remaining_amount_idr bigint NOT NULL CHECK (remaining_amount_idr >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'spent', 'expired')),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 year',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.webhook_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id text NOT NULL,
  transaction_status text NOT NULL,
  order_code text NOT NULL,
  gross_amount text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transaction_id, transaction_status)
);

CREATE TABLE public.rate_limits (
  key_hash text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count >= 0)
);

CREATE TABLE public.admin_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY orders_deny_client ON public.orders
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY financial_ledger_deny_client ON public.financial_ledger
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY refund_vouchers_deny_client ON public.refund_vouchers
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY webhook_logs_deny_client ON public.webhook_logs
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY rate_limits_deny_client ON public.rate_limits
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY admin_users_deny_client ON public.admin_users
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.prevent_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'financial ledger is immutable';
END;
$$;

CREATE TRIGGER financial_ledger_immutable
  BEFORE UPDATE OR DELETE ON public.financial_ledger
  FOR EACH ROW EXECUTE FUNCTION public.prevent_ledger_mutation();
CREATE TRIGGER financial_ledger_no_truncate
  BEFORE TRUNCATE ON public.financial_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_ledger_mutation();

CREATE OR REPLACE FUNCTION public.allow_qris_request(p_ip_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_window timestamptz;
  v_count integer;
BEGIN
  IF p_ip_hash IS NULL OR length(p_ip_hash) < 32 THEN
    RETURN false;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_ip_hash, 0));
  SELECT window_started_at, request_count
    INTO v_window, v_count
    FROM public.rate_limits
    WHERE key_hash = p_ip_hash
    FOR UPDATE;

  IF NOT FOUND OR v_window <= now() - interval '1 minute' THEN
    INSERT INTO public.rate_limits (key_hash, window_started_at, request_count)
      VALUES (p_ip_hash, now(), 1)
      ON CONFLICT (key_hash) DO UPDATE
        SET window_started_at = EXCLUDED.window_started_at, request_count = 1;
    RETURN true;
  END IF;

  IF v_count >= 5 THEN
    RETURN false;
  END IF;

  UPDATE public.rate_limits SET request_count = request_count + 1 WHERE key_hash = p_ip_hash;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_secure_order(
  p_order_code text,
  p_pin text,
  p_service_id text,
  p_service_name text,
  p_country_code text,
  p_country_name text,
  p_supplier_cost_idr bigint,
  p_sell_price_idr bigint,
  p_expires_at timestamptz,
  p_voucher_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_voucher public.refund_vouchers%ROWTYPE;
  v_applied bigint := 0;
  v_due bigint := p_sell_price_idr;
BEGIN
  IF p_pin !~ '^[0-9]{6}$' OR p_sell_price_idr <= 0 OR p_supplier_cost_idr < 0 THEN
    RAISE EXCEPTION 'invalid order input';
  END IF;

  IF p_voucher_code IS NOT NULL AND length(trim(p_voucher_code)) > 0 THEN
    SELECT * INTO v_voucher FROM public.refund_vouchers
      WHERE voucher_code = upper(trim(p_voucher_code))
      FOR UPDATE;
    IF NOT FOUND OR v_voucher.status <> 'active' OR v_voucher.expires_at <= now() OR v_voucher.remaining_amount_idr <= 0 THEN
      RAISE EXCEPTION 'voucher tidak valid atau telah kedaluwarsa';
    END IF;
    v_applied := least(v_voucher.remaining_amount_idr, v_due);
    v_due := v_due - v_applied;
    UPDATE public.refund_vouchers
      SET remaining_amount_idr = remaining_amount_idr - v_applied,
          status = CASE WHEN remaining_amount_idr - v_applied = 0 THEN 'spent' ELSE 'active' END
      WHERE id = v_voucher.id;
  END IF;

  INSERT INTO public.orders (
    order_code, pin_hash, service_id, service_name, country_code, country_name,
    supplier_cost_idr, sell_price_idr, amount_due_idr, voucher_applied_idr,
    payment_status, fulfillment_status, expires_at
  ) VALUES (
    p_order_code, extensions.crypt(p_pin, extensions.gen_salt('bf', 12)),
    p_service_id, p_service_name, p_country_code, p_country_name,
    p_supplier_cost_idr, p_sell_price_idr, v_due, v_applied,
    CASE WHEN v_due = 0 THEN 'paid' ELSE 'pending' END,
    CASE WHEN v_due = 0 THEN 'processing' ELSE 'waiting_payment' END,
    p_expires_at
  ) RETURNING * INTO v_order;

  IF v_applied > 0 THEN
    INSERT INTO public.financial_ledger (order_id, entry_type, amount_idr, reference)
      VALUES (v_order.id, 'voucher_redeemed', v_applied, v_voucher.id::text);
  END IF;

  RETURN jsonb_build_object(
    'id', v_order.id,
    'order_code', v_order.order_code,
    'amount_due_idr', v_order.amount_due_idr,
    'voucher_applied_idr', v_order.voucher_applied_idr,
    'payment_status', v_order.payment_status,
    'fulfillment_status', v_order.fulfillment_status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_order_secure(p_order_code text, p_pin_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_voucher public.refund_vouchers%ROWTYPE;
BEGIN
  IF p_pin_hash !~ '^[0-9]{6}$' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_order FROM public.orders
    WHERE order_code = p_order_code
      AND pin_hash = extensions.crypt(p_pin_hash, pin_hash);
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_order.voucher_code IS NOT NULL THEN
    SELECT * INTO v_voucher FROM public.refund_vouchers
      WHERE order_id = v_order.id;
  END IF;

  RETURN jsonb_build_object(
    'order_code', v_order.order_code,
    'service_name', v_order.service_name,
    'country_name', v_order.country_name,
    'sell_price_idr', v_order.sell_price_idr,
    'amount_due_idr', v_order.amount_due_idr,
    'payment_status', v_order.payment_status,
    'fulfillment_status', v_order.fulfillment_status,
    'phone_number', v_order.phone_number,
    'otp_code', v_order.otp_code,
    'qris_payload', v_order.qris_payload,
    'voucher_code', v_voucher.voucher_code,
    'voucher_amount_idr', v_voucher.amount_idr,
    'expires_at', v_order.expires_at,
    'supplier_order_id', v_order.supplier_order_id,
    'service_id', v_order.service_id,
    'country_code', v_order.country_code,
    'midtrans_transaction_id', v_order.midtrans_transaction_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.save_qris_payload(p_order_code text, p_qris_payload text, p_transaction_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE order_code = p_order_code FOR UPDATE;
  IF NOT FOUND OR v_order.payment_status <> 'pending' THEN
    RETURN false;
  END IF;
  UPDATE public.orders SET qris_payload = p_qris_payload, midtrans_transaction_id = p_transaction_id,
    updated_at = now() WHERE id = v_order.id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_order_voucher_internal(p_order_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_voucher_reference text;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE order_code = p_order_code FOR UPDATE;
  IF NOT FOUND OR v_order.voucher_applied_idr = 0 OR v_order.voucher_restored_at IS NOT NULL
     OR v_order.payment_status NOT IN ('cancelled', 'expired') THEN
    RETURN;
  END IF;
  SELECT reference INTO v_voucher_reference FROM public.financial_ledger
    WHERE order_id = v_order.id AND entry_type = 'voucher_redeemed'
      AND reference NOT LIKE 'restore:%'
    LIMIT 1;
  IF v_voucher_reference IS NULL THEN
    RAISE EXCEPTION 'voucher ledger reference is missing';
  END IF;
  PERFORM 1 FROM public.refund_vouchers WHERE id = v_voucher_reference::uuid FOR UPDATE;
  UPDATE public.refund_vouchers
    SET remaining_amount_idr = remaining_amount_idr + v_order.voucher_applied_idr,
        status = 'active'
    WHERE id = v_voucher_reference::uuid;
  UPDATE public.orders SET voucher_restored_at = now(), updated_at = now() WHERE id = v_order.id;
  INSERT INTO public.financial_ledger (order_id, entry_type, amount_idr, reference)
    VALUES (v_order.id, 'voucher_redeemed', -v_order.voucher_applied_idr, 'restore:' || v_voucher_reference);
END;
$$;

CREATE OR REPLACE FUNCTION public.process_midtrans_event(
  p_transaction_id text,
  p_transaction_status text,
  p_status_code text,
  p_order_code text,
  p_gross_amount text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_inserted integer;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE order_code = p_order_code FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;
  IF p_gross_amount !~ '^[0-9]+(\.[0-9]{1,2})?$'
     OR p_gross_amount::numeric <> v_order.amount_due_idr::numeric THEN
    RETURN jsonb_build_object('result', 'amount_mismatch');
  END IF;

  INSERT INTO public.webhook_logs (transaction_id, transaction_status, order_code, gross_amount)
    VALUES (p_transaction_id, p_transaction_status, p_order_code, p_gross_amount)
    ON CONFLICT (transaction_id, transaction_status) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN jsonb_build_object('result', 'duplicate');
  END IF;

  IF p_transaction_status = 'settlement' THEN
    IF p_status_code <> '200' THEN
      RETURN jsonb_build_object('result', 'ignored');
    END IF;
    IF v_order.payment_status <> 'paid' THEN
      UPDATE public.orders SET payment_status = 'paid', fulfillment_status = 'processing',
        midtrans_transaction_id = p_transaction_id, updated_at = now() WHERE id = v_order.id;
      INSERT INTO public.financial_ledger (order_id, entry_type, amount_idr, reference)
        VALUES
          (v_order.id, 'payment_gross', v_order.amount_due_idr, p_transaction_id),
          (v_order.id, 'qris_mdr', -ceil(v_order.amount_due_idr * 0.007)::bigint, p_transaction_id);
      RETURN jsonb_build_object('result', 'fulfill');
    END IF;
    RETURN jsonb_build_object('result', 'already_paid');
  END IF;

  IF p_transaction_status IN ('expire', 'deny', 'cancel') AND v_order.payment_status = 'pending' THEN
    UPDATE public.orders SET payment_status = CASE WHEN p_transaction_status = 'expire' THEN 'expired' ELSE 'cancelled' END,
      fulfillment_status = 'failed', updated_at = now() WHERE id = v_order.id;
    PERFORM public.restore_order_voucher_internal(p_order_code);
    RETURN jsonb_build_object('result', 'failed');
  END IF;
  RETURN jsonb_build_object('result', 'ignored');
END;
$$;

CREATE OR REPLACE FUNCTION public.save_supplier_purchase(
  p_order_code text,
  p_supplier_order_id bigint,
  p_phone_number text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE order_code = p_order_code FOR UPDATE;
  IF NOT FOUND OR v_order.payment_status <> 'paid' OR v_order.fulfillment_status NOT IN ('processing', 'completed') THEN
    RETURN false;
  END IF;
  IF v_order.supplier_order_id IS NOT NULL THEN
    RETURN true;
  END IF;
  UPDATE public.orders SET supplier_order_id = p_supplier_order_id, phone_number = p_phone_number,
    fulfillment_status = 'processing', updated_at = now() WHERE id = v_order.id;
  INSERT INTO public.financial_ledger (order_id, entry_type, amount_idr, reference)
    VALUES (v_order.id, 'supplier_cost', -v_order.supplier_cost_idr, p_supplier_order_id::text)
    ON CONFLICT DO NOTHING;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_supplier_fulfillment(p_order_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE order_code = p_order_code FOR UPDATE;
  IF NOT FOUND OR v_order.payment_status <> 'paid'
     OR v_order.fulfillment_status <> 'processing'
     OR v_order.supplier_order_id IS NOT NULL
     OR v_order.fulfillment_claimed_at IS NOT NULL THEN
    RETURN false;
  END IF;
  UPDATE public.orders SET fulfillment_claimed_at = now(), updated_at = now() WHERE id = v_order.id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_order_otp(p_order_code text, p_otp_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE order_code = p_order_code FOR UPDATE;
  IF NOT FOUND OR v_order.payment_status <> 'paid' OR v_order.supplier_order_id IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.orders SET otp_code = p_otp_code, fulfillment_status = 'completed', updated_at = now()
    WHERE id = v_order.id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_refund_voucher(p_order_code text, p_voucher_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_voucher public.refund_vouchers%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE order_code = p_order_code FOR UPDATE;
  IF NOT FOUND OR v_order.payment_status <> 'paid' THEN
    RETURN jsonb_build_object('result', 'not_eligible');
  END IF;
  SELECT * INTO v_voucher FROM public.refund_vouchers WHERE order_id = v_order.id FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('result', 'existing', 'voucher_code', v_voucher.voucher_code);
  END IF;
  IF v_order.supplier_order_id IS NOT NULL
     OR v_order.fulfillment_status NOT IN ('processing', 'failed') THEN
    RETURN jsonb_build_object('result', 'not_eligible');
  END IF;

  INSERT INTO public.refund_vouchers (order_id, voucher_code, amount_idr, remaining_amount_idr)
    VALUES (v_order.id, upper(p_voucher_code), v_order.sell_price_idr, v_order.sell_price_idr)
    RETURNING * INTO v_voucher;
  UPDATE public.orders SET fulfillment_status = 'refunded', voucher_code = v_voucher.voucher_code,
    updated_at = now() WHERE id = v_order.id;
  INSERT INTO public.financial_ledger (order_id, entry_type, amount_idr, reference)
    VALUES (v_order.id, 'voucher_issued', -v_order.sell_price_idr, v_voucher.id::text);
  RETURN jsonb_build_object('result', 'issued', 'voucher_code', v_voucher.voucher_code);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_pending_order(p_order_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE order_code = p_order_code FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;
  IF v_order.payment_status <> 'pending' THEN
    RETURN jsonb_build_object('result', 'not_cancellable');
  END IF;
  UPDATE public.orders SET payment_status = 'cancelled', fulfillment_status = 'failed', updated_at = now()
    WHERE id = v_order.id;
  PERFORM public.restore_order_voucher_internal(p_order_code);
  RETURN jsonb_build_object('result', 'cancelled', 'transaction_id', v_order.midtrans_transaction_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = p_user_id);
$$;

CREATE OR REPLACE FUNCTION public.get_admin_financial_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'gross_payments_idr', COALESCE(sum(amount_idr) FILTER (WHERE entry_type = 'payment_gross'), 0),
    'qris_mdr_idr', COALESCE(sum(amount_idr * -1) FILTER (WHERE entry_type = 'qris_mdr'), 0),
    'supplier_cost_idr', COALESCE(sum(amount_idr * -1) FILTER (WHERE entry_type = 'supplier_cost'), 0),
    'net_profit_idr', COALESCE(sum(amount_idr), 0)
  )
  FROM public.financial_ledger;
$$;

REVOKE ALL ON FUNCTION public.allow_qris_request(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_secure_order(text, text, text, text, text, text, bigint, bigint, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_order_secure(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_qris_payload(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.restore_order_voucher_internal(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.process_midtrans_event(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_supplier_purchase(text, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_supplier_fulfillment(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_order_otp(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_refund_voucher(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_pending_order(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_admin_financial_summary() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.allow_qris_request(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_secure_order(text, text, text, text, text, text, bigint, bigint, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_order_secure(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_qris_payload(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_midtrans_event(text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_supplier_purchase(text, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_supplier_fulfillment(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_order_otp(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_refund_voucher(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_pending_order(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_financial_summary() TO service_role;
