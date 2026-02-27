"use client";

// app/app/components/AlertsPageClient.tsx
// Client component for /alerts page — handles tab switching + rules management.

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AlertRow = {
  ticker:       string;
  title:        string;
  event_type:   string | null;
  impact_score: number;
  published_at: string | null;
  created_at:   string;
};

type AlertRule = {
  id:                 number;
  rule_name:          string;
  rule_type:          string;
  threshold_value:    number | null;
  threshold_operator: string | null;
  ticker:             string | null;
  is_active:          boolean;
  telegram_enabled:   boolean;
  cooldown_hours:     number | null;
  conditions:         Array<{ field: string; op: string; value: unknown }> | null;
  created_at:         string;
};

type Tab = "historia" | "reguly";

const RULE_TYPES = [
  "impact_score", "price_change", "health_score",
  "red_flags", "insider_buy", "new_recommendation",
] as const;

const OPERATORS = [">", "<", ">=", "<=", "="] as const;

const RULE_TYPE_LABELS: Record<string, string> = {
  impact_score:       "Impact Score",
  price_change:       "Zmiana ceny",
  health_score:       "Health Score",
  red_flags:          "Red Flags",
  insider_buy:        "Insider Buy",
  new_recommendation: "Rekomendacja",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pl-PL", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function ImpactBadge({ score }: { score: number }) {
  const cls = score >= 7
    ? "bg-red-500/15 text-red-400 border border-red-500/25"
    : score >= 4
      ? "bg-yellow-500/15 text-yellow-400 border border-yellow-500/25"
      : "bg-gray-500/15 text-gray-400 border border-gray-500/25";
  return (
    <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full tabular-nums ${cls}`}>
      {score}
    </span>
  );
}

// ─── Rules Management Tab ─────────────────────────────────────────────────────

function RulesTab() {
  const [rules, setRules]     = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [editingId, setEditingId]     = useState<number | null>(null);
  const [editValue, setEditValue]     = useState<string>("");
  const [showAdd, setShowAdd]         = useState(false);
  const [saving, setSaving]           = useState(false);

  const [newRule, setNewRule] = useState({
    rule_name:          "",
    rule_type:          "impact_score",
    threshold_value:    "",
    threshold_operator: ">=",
    ticker:             "",
    telegram_enabled:   true,
    cooldown_hours:     "24",
  });

  const fetchRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch("/api/alert-rules");
      const json = await res.json() as { ok: boolean; rules?: AlertRule[]; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Błąd pobierania reguł");
      setRules(json.rules ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchRules(); }, [fetchRules]);

  async function toggleActive(rule: AlertRule) {
    const res  = await fetch("/api/alert-rules", {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ id: rule.id, is_active: !rule.is_active }),
    });
    const json = await res.json() as { ok: boolean; rule?: AlertRule };
    if (json.ok && json.rule) {
      setRules(prev => prev.map(r => r.id === rule.id ? json.rule! : r));
    }
  }

  async function toggleTelegram(rule: AlertRule) {
    const res  = await fetch("/api/alert-rules", {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ id: rule.id, telegram_enabled: !rule.telegram_enabled }),
    });
    const json = await res.json() as { ok: boolean; rule?: AlertRule };
    if (json.ok && json.rule) {
      setRules(prev => prev.map(r => r.id === rule.id ? json.rule! : r));
    }
  }

  async function saveThreshold(rule: AlertRule) {
    const val = parseFloat(editValue);
    if (isNaN(val)) { setEditingId(null); return; }
    const res  = await fetch("/api/alert-rules", {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ id: rule.id, threshold_value: val }),
    });
    const json = await res.json() as { ok: boolean; rule?: AlertRule };
    if (json.ok && json.rule) {
      setRules(prev => prev.map(r => r.id === rule.id ? json.rule! : r));
    }
    setEditingId(null);
  }

  async function deleteRule(id: number) {
    if (!confirm("Usunąć regułę?")) return;
    const res  = await fetch("/api/alert-rules", {
      method:  "DELETE",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ id }),
    });
    const json = await res.json() as { ok: boolean };
    if (json.ok) setRules(prev => prev.filter(r => r.id !== id));
  }

  async function addRule(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res  = await fetch("/api/alert-rules", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          rule_name:          newRule.rule_name.trim(),
          rule_type:          newRule.rule_type,
          threshold_value:    newRule.threshold_value ? parseFloat(newRule.threshold_value) : null,
          threshold_operator: newRule.threshold_operator || null,
          ticker:             newRule.ticker.trim() || null,
          telegram_enabled:   newRule.telegram_enabled,
          cooldown_hours:     newRule.cooldown_hours ? parseInt(newRule.cooldown_hours) : 24,
        }),
      });
      const json = await res.json() as { ok: boolean; rule?: AlertRule; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Błąd zapisu");
      if (json.rule) setRules(prev => [...prev, json.rule!]);
      setShowAdd(false);
      setNewRule({ rule_name: "", rule_type: "impact_score", threshold_value: "", threshold_operator: ">=", ticker: "", telegram_enabled: true, cooldown_hours: "24" });
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return (
    <div className="space-y-3">
      {[1,2,3].map(i => (
        <div key={i} className="rounded-xl border border-gray-800 bg-gray-900/40 px-5 py-4 animate-pulse h-16" />
      ))}
    </div>
  );

  if (error) return (
    <div className="rounded-xl border border-red-800/40 bg-red-900/10 px-5 py-4 text-red-400 text-sm">
      {error}
      <button onClick={fetchRules} className="ml-3 underline text-red-300">Odśwież</button>
    </div>
  );

  return (
    <div className="space-y-4">

      {/* Rules list */}
      <div className="rounded-xl border border-gray-800 overflow-hidden">
        {rules.length === 0 ? (
          <div className="py-10 text-center text-gray-500 text-sm">Brak reguł alertów</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/60">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Nazwa</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Typ</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Próg</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3 hidden sm:table-cell">Ticker</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3 hidden lg:table-cell">Cooldown</th>
                <th className="text-center text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Aktywna</th>
                <th className="text-center text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Telegram</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-b border-gray-800/50 last:border-b-0 hover:bg-gray-900/40 transition-colors">
                  <td className="px-4 py-3 text-sm text-gray-200 font-medium">{rule.rule_name}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400 font-mono">
                      {RULE_TYPE_LABELS[rule.rule_type] ?? rule.rule_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-gray-300">
                    {editingId === rule.id ? (
                      <span className="flex items-center gap-1">
                        <span className="text-gray-500">{rule.threshold_operator}</span>
                        <input
                          type="number"
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onBlur={() => saveThreshold(rule)}
                          onKeyDown={e => { if (e.key === "Enter") void saveThreshold(rule); if (e.key === "Escape") setEditingId(null); }}
                          className="w-20 bg-gray-800 border border-gray-600 rounded px-1 py-0.5 text-xs text-white focus:outline-none focus:border-blue-500"
                          autoFocus
                        />
                      </span>
                    ) : (
                      <button
                        onClick={() => { setEditingId(rule.id); setEditValue(String(rule.threshold_value ?? "")); }}
                        className="hover:text-blue-400 transition-colors"
                        title="Kliknij aby edytować próg"
                      >
                        {rule.threshold_value !== null
                          ? `${rule.threshold_operator} ${rule.threshold_value}`
                          : <span className="text-gray-600">—</span>
                        }
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell text-xs text-gray-500 font-mono">
                    {rule.ticker ?? <span className="text-gray-700">wszystkie</span>}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-xs text-gray-500 tabular-nums">
                    {rule.cooldown_hours !== null ? `${rule.cooldown_hours}h` : "—"}
                    {(rule.conditions?.length ?? 0) > 0 && (
                      <span className="ml-1 text-[10px] text-blue-500 font-mono" title={JSON.stringify(rule.conditions)}>
                        +{rule.conditions!.length}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => void toggleActive(rule)}
                      className={`w-10 h-5 rounded-full transition-colors relative ${rule.is_active ? "bg-green-600" : "bg-gray-700"}`}
                      title={rule.is_active ? "Dezaktywuj" : "Aktywuj"}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${rule.is_active ? "left-5" : "left-0.5"}`} />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => void toggleTelegram(rule)}
                      className={`w-10 h-5 rounded-full transition-colors relative ${rule.telegram_enabled ? "bg-blue-600" : "bg-gray-700"}`}
                      title={rule.telegram_enabled ? "Wyłącz Telegram" : "Włącz Telegram"}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${rule.telegram_enabled ? "left-5" : "left-0.5"}`} />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => void deleteRule(rule.id)}
                      className="text-xs text-gray-600 hover:text-red-400 transition-colors"
                      title="Usuń regułę"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add new rule */}
      {showAdd ? (
        <form onSubmit={addRule} className="rounded-xl border border-gray-700 bg-gray-900/60 px-5 py-5 space-y-4">
          <h3 className="text-sm font-semibold text-white">Nowa reguła alertu</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Nazwa *</label>
              <input
                type="text"
                required
                placeholder="np. Wysoki impact score"
                value={newRule.rule_name}
                onChange={e => setNewRule(p => ({ ...p, rule_name: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Typ reguły *</label>
              <select
                value={newRule.rule_type}
                onChange={e => setNewRule(p => ({ ...p, rule_type: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              >
                {RULE_TYPES.map(t => (
                  <option key={t} value={t}>{RULE_TYPE_LABELS[t] ?? t}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Operator</label>
                <select
                  value={newRule.threshold_operator}
                  onChange={e => setNewRule(p => ({ ...p, threshold_operator: e.target.value }))}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  {OPERATORS.map(op => <option key={op} value={op}>{op}</option>)}
                </select>
              </div>
              <div className="flex-1">
                <label className="text-xs text-gray-500 mb-1 block">Próg</label>
                <input
                  type="number"
                  step="any"
                  placeholder="np. 7"
                  value={newRule.threshold_value}
                  onChange={e => setNewRule(p => ({ ...p, threshold_value: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Ticker (opcjonalnie — puste = wszystkie)</label>
              <input
                type="text"
                placeholder="np. CDR"
                value={newRule.ticker}
                onChange={e => setNewRule(p => ({ ...p, ticker: e.target.value.toUpperCase() }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Cooldown (godziny)</label>
              <input
                type="number"
                min="1"
                max="720"
                placeholder="24"
                value={newRule.cooldown_hours}
                onChange={e => setNewRule(p => ({ ...p, cooldown_hours: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white tabular-nums focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={newRule.telegram_enabled}
                onChange={e => setNewRule(p => ({ ...p, telegram_enabled: e.target.checked }))}
                className="accent-blue-500"
              />
              <span className="text-xs text-gray-400">Wyślij przez Telegram</span>
            </label>
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition-colors"
            >
              {saving ? "Zapisywanie..." : "Dodaj regułę"}
            </button>
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors"
            >
              Anuluj
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          className="w-full rounded-xl border border-dashed border-gray-700 hover:border-gray-500 py-4 text-sm text-gray-500 hover:text-gray-300 transition-colors"
        >
          + Dodaj nową regułę
        </button>
      )}
    </div>
  );
}

// ─── Main Client Component ─────────────────────────────────────────────────────

export default function AlertsPageClient({ alerts }: { alerts: AlertRow[] }) {
  const [activeTab, setActiveTab] = useState<Tab>("historia");

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-10">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Alerty</h1>
          <p className="text-sm text-gray-500 mt-1">
            Monitorowanie wysokich impact score · powiadomienia Telegram
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 mb-6 border-b border-gray-800">
          {(["historia", "reguly"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? "border-blue-500 text-blue-400"
                  : "border-transparent text-gray-500 hover:text-gray-300"
              }`}
            >
              {tab === "historia" ? "Historia alertów" : "Reguły alertów"}
            </button>
          ))}
        </div>

        {/* Historia tab */}
        {activeTab === "historia" && (
          <>
            <p className="text-xs text-gray-600 mb-4">
              {alerts.length} alert{alerts.length !== 1 ? "y" : ""} · ostatnie 7 dni · impact score ≥ 7
            </p>
            {alerts.length === 0 ? (
              <div className="rounded-xl border border-gray-800 bg-gray-900/40 py-20 text-center text-gray-500">
                Brak alertów z impact score ≥ 7 w ostatnich 7 dniach
              </div>
            ) : (
              <div className="rounded-xl border border-gray-800 overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800 bg-gray-900/60">
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Data</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Ticker</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Tytuł</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3 hidden sm:table-cell">Typ</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.map((a, i) => (
                      <tr key={i} className="border-b border-gray-800/50 last:border-b-0 hover:bg-gray-900/60 transition-colors">
                        <td className="px-4 py-3 text-xs text-gray-500 tabular-nums whitespace-nowrap">
                          {formatDate(a.published_at || a.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/companies/${a.ticker}`}
                            className="font-mono font-bold text-blue-400 hover:text-blue-300 text-sm transition-colors"
                          >
                            {a.ticker}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-200 max-w-sm">
                          <div className="line-clamp-2">{a.title}</div>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400">
                            {a.event_type ?? "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <ImpactBadge score={a.impact_score} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Reguły tab */}
        {activeTab === "reguly" && <RulesTab />}

      </div>
    </div>
  );
}
