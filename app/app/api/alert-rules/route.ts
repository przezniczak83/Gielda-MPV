// app/api/alert-rules/route.ts
// GET  — list all alert rules
// POST { rule_name, rule_type, threshold_value, threshold_operator, ticker? } — create rule
// PATCH { id, is_active?, threshold_value? } — update rule

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const RULE_TYPES = [
  "impact_score", "price_change", "health_score",
  "red_flags", "insider_buy", "new_recommendation",
] as const;

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );
}

export async function GET() {
  const { data, error } = await supabase()
    .from("alert_rules")
    .select("id, rule_name, rule_type, threshold_value, threshold_operator, ticker, is_active, telegram_enabled, cooldown_hours, conditions, created_at")
    .order("id");

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, rules: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    rule_name:           string;
    rule_type:           string;
    threshold_value?:    number | null;
    threshold_operator?: string | null;
    ticker?:             string | null;
    telegram_enabled?:   boolean;
    cooldown_hours?:     number | null;
    conditions?:         unknown;
  };

  if (!body.rule_name?.trim()) {
    return Response.json({ ok: false, error: "rule_name required" }, { status: 400 });
  }
  if (!RULE_TYPES.includes(body.rule_type as typeof RULE_TYPES[number])) {
    return Response.json({ ok: false, error: `rule_type must be one of: ${RULE_TYPES.join(", ")}` }, { status: 400 });
  }

  const { data, error } = await supabase()
    .from("alert_rules")
    .insert({
      rule_name:           body.rule_name.trim(),
      rule_type:           body.rule_type,
      threshold_value:     body.threshold_value ?? null,
      threshold_operator:  body.threshold_operator ?? null,
      ticker:              body.ticker?.toUpperCase().trim() || null,
      telegram_enabled:    body.telegram_enabled ?? true,
      cooldown_hours:      body.cooldown_hours ?? 24,
      conditions:          body.conditions ?? [],
    })
    .select()
    .single();

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, rule: data });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json() as {
    id:                 number;
    is_active?:         boolean;
    threshold_value?:   number;
    telegram_enabled?:  boolean;
    cooldown_hours?:    number;
  };

  if (!body.id) {
    return Response.json({ ok: false, error: "id required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (body.is_active         !== undefined) updates.is_active         = body.is_active;
  if (body.threshold_value   !== undefined) updates.threshold_value   = body.threshold_value;
  if (body.telegram_enabled  !== undefined) updates.telegram_enabled  = body.telegram_enabled;
  if (body.cooldown_hours    !== undefined) updates.cooldown_hours    = body.cooldown_hours;

  if (Object.keys(updates).length === 0) {
    return Response.json({ ok: false, error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase()
    .from("alert_rules")
    .update(updates)
    .eq("id", body.id)
    .select()
    .single();

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, rule: data });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json() as { id: number };
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });

  const { error } = await supabase()
    .from("alert_rules")
    .delete()
    .eq("id", id);

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
