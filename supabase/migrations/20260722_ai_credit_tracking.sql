-- =====================================================================
-- AI credit tracking for premium features
-- =====================================================================
-- All 3 AI endpoints (ai-summary, ai-embed, generate-register) call
-- consume_ai_credit() before executing. A monthly cap per tenant-user
-- pair prevents runaway token burn while being generous enough for
-- legitimate daily use.
--
-- Limits (editable in the endpoint code):
--   summary  500 / month  ($0.09 estimated max cost)
--   embed  5,000 / month  ($0.05)
--   register  50 / month  ($0.001)
-- =====================================================================

CREATE TABLE IF NOT EXISTS ai_credit_usage (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  user_id     uuid NOT NULL,
  endpoint    text NOT NULL,               -- 'summary' | 'embed' | 'register'
  month       text NOT NULL,               -- 'YYYY-MM'
  count       integer NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (tenant_id, user_id, endpoint, month)
);

ALTER TABLE ai_credit_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_credit_usage_select_member ON ai_credit_usage
  FOR SELECT TO authenticated
  USING (tenant_id = get_my_tenant_id());

-- Grant insert/update access since the RPC writes on behalf of the user
CREATE POLICY ai_credit_usage_insert_member ON ai_credit_usage
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id());

CREATE POLICY ai_credit_usage_update_member ON ai_credit_usage
  FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- =====================================================================
-- consume_ai_credit(p_endpoint, p_max) → boolean
-- Returns true if credit was consumed (within limit).
-- Returns false if limit exceeded OR user/tenant not resolved.
-- =====================================================================
CREATE OR REPLACE FUNCTION consume_ai_credit(
  p_endpoint text,
  p_max      integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id      uuid;
  v_user_id        uuid;
  v_month          text;
  v_current_count  integer;
BEGIN
  v_tenant_id := get_my_tenant_id();
  v_user_id   := auth.uid();
  v_month     := to_char(now(), 'YYYY-MM');

  IF v_tenant_id IS NULL OR v_user_id IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO ai_credit_usage (tenant_id, user_id, endpoint, month, count)
  VALUES (v_tenant_id, v_user_id, p_endpoint, v_month, 1)
  ON CONFLICT (tenant_id, user_id, endpoint, month)
  DO UPDATE SET count = ai_credit_usage.count + 1
  WHERE ai_credit_usage.count < p_max
  RETURNING count INTO v_current_count;

  RETURN FOUND;
END;
$$;
