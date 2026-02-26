"use client";
// app/app/settings/SettingsClient.tsx
// Client-side settings page: localStorage preferences + system info display.

import { useEffect, useState } from "react";

interface SystemInfo {
  ok:      boolean;
  version: string;
  stats:   Record<string, number>;
  pipeline: {
    last_espi_fetch:     string | null;
    last_price_update:   string | null;
    last_telegram_alert: string | null;
    espi_status:         "ok" | "stale" | "error";
    price_status:        "ok" | "stale" | "error";
  };
}

interface Settings {
  alertSoundEnabled:  boolean;
  impactThreshold:    number;
  defaultTab:         string;
  emailNotifications: boolean;
  alertEmail:         string;
  compactMode:        boolean;
}

const DEFAULTS: Settings = {
  alertSoundEnabled:  false,
  impactThreshold:    7,
  defaultTab:         "Przegląd",
  emailNotifications: false,
  alertEmail:         "",
  compactMode:        false,
};

function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const stored = localStorage.getItem("gielda_settings");
    return stored ? { ...DEFAULTS, ...JSON.parse(stored) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

function saveSettings(s: Settings) {
  if (typeof window === "undefined") return;
  localStorage.setItem("gielda_settings", JSON.stringify(s));
}

function StatusDot({ status }: { status: "ok" | "stale" | "error" | undefined }) {
  const cls = status === "ok" ? "bg-green-400"
            : status === "stale" ? "bg-yellow-400"
            : "bg-red-400";
  const label = status === "ok" ? "OK" : status === "stale" ? "Stale" : "Error";
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block w-2 h-2 rounded-full ${cls}`} />
      <span className="text-sm font-mono">{label}</span>
    </span>
  );
}

export default function SettingsClient() {
  const [settings,    setSettings]    = useState<Settings>(DEFAULTS);
  const [systemInfo,  setSystemInfo]  = useState<SystemInfo | null>(null);
  const [loadingSys,  setLoadingSys]  = useState(true);
  const [saved,       setSaved]       = useState(false);

  useEffect(() => {
    setSettings(loadSettings());
    fetch("/api/health")
      .then(r => r.json())
      .then((d: SystemInfo) => { setSystemInfo(d); setLoadingSys(false); })
      .catch(() => setLoadingSys(false));
  }, []);

  function update<K extends keyof Settings>(key: K, val: Settings[K]) {
    setSettings(prev => ({ ...prev, [key]: val }));
  }

  function handleSave() {
    saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleClearFavorites() {
    if (typeof window === "undefined") return;
    localStorage.removeItem("gielda_favorites");
    localStorage.removeItem("gielda_recent");
    alert("Ulubione i ostatnio odwiedzone zostały wyczyszczone.");
  }

  function handleClearSettings() {
    if (typeof window === "undefined") return;
    localStorage.removeItem("gielda_settings");
    setSettings(DEFAULTS);
    setSaved(false);
  }

  const pl = systemInfo?.pipeline;

  return (
    <div className="space-y-8">

      {/* Notifications */}
      <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-6">
        <h2 className="text-sm font-semibold text-gray-300 mb-4">Powiadomienia</h2>
        <div className="space-y-4">

          <label className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm text-gray-200">Próg impaktu alertów</div>
              <div className="text-xs text-gray-500 mt-0.5">Alerty Telegram wysyłane dla eventów ≥ progu</div>
            </div>
            <select
              value={settings.impactThreshold}
              onChange={e => update("impactThreshold", Number(e.target.value))}
              className="bg-gray-800 border border-gray-700 text-white rounded-md px-3 py-1.5 text-sm"
            >
              {[5, 6, 7, 8, 9, 10].map(v => (
                <option key={v} value={v}>{v}/10</option>
              ))}
            </select>
          </label>

          <label className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm text-gray-200">Powiadomienia email</div>
              <div className="text-xs text-gray-500 mt-0.5">
                Email via Resend (wymaga RESEND_API_KEY + ALERT_EMAIL w secrets)
              </div>
            </div>
            <input
              type="checkbox"
              checked={settings.emailNotifications}
              onChange={e => update("emailNotifications", e.target.checked)}
              className="w-4 h-4 accent-blue-500"
            />
          </label>

          {settings.emailNotifications && (
            <label className="flex items-center justify-between gap-4 pl-4">
              <div className="text-xs text-gray-400">Adres email dla alertów</div>
              <input
                type="email"
                value={settings.alertEmail}
                onChange={e => update("alertEmail", e.target.value)}
                placeholder="twoj@email.com"
                className="bg-gray-800 border border-gray-700 text-white rounded-md px-3 py-1.5 text-sm w-56"
              />
            </label>
          )}

        </div>
      </section>

      {/* Interface */}
      <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-6">
        <h2 className="text-sm font-semibold text-gray-300 mb-4">Interfejs</h2>
        <div className="space-y-4">

          <label className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm text-gray-200">Domyślna zakładka</div>
              <div className="text-xs text-gray-500 mt-0.5">Zakładka widoczna przy otwieraniu profilu spółki</div>
            </div>
            <select
              value={settings.defaultTab}
              onChange={e => update("defaultTab", e.target.value)}
              className="bg-gray-800 border border-gray-700 text-white rounded-md px-3 py-1.5 text-sm"
            >
              {["Przegląd", "Finanse", "Eventy", "AI Chat"].map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>

          <label className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm text-gray-200">Tryb kompaktowy</div>
              <div className="text-xs text-gray-500 mt-0.5">Mniejsze karty, zagęszczony widok list</div>
            </div>
            <input
              type="checkbox"
              checked={settings.compactMode}
              onChange={e => update("compactMode", e.target.checked)}
              className="w-4 h-4 accent-blue-500"
            />
          </label>

        </div>
      </section>

      {/* Data & Export */}
      <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-6">
        <h2 className="text-sm font-semibold text-gray-300 mb-4">Dane i eksport</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { href: "/api/export?type=events",     label: "Eksportuj Eventy" },
            { href: "/api/export?type=prices",     label: "Eksportuj Ceny" },
            { href: "/api/export?type=financials", label: "Eksportuj Finanse" },
            { href: "/api/export?type=watchlist",  label: "Eksportuj Watchlist" },
          ].map(({ href, label }) => (
            <a
              key={href}
              href={href}
              download
              className="text-center text-xs px-3 py-2 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors border border-gray-700"
            >
              ⬇ {label}
            </a>
          ))}
        </div>
        <div className="mt-4 flex gap-3">
          <button
            onClick={handleClearFavorites}
            className="text-xs px-3 py-2 rounded-md bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-800/50 transition-colors"
          >
            Wyczyść ulubione i historię
          </button>
          <button
            onClick={handleClearSettings}
            className="text-xs px-3 py-2 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-400 border border-gray-700 transition-colors"
          >
            Przywróć ustawienia domyślne
          </button>
        </div>
      </section>

      {/* System Info */}
      <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-6">
        <h2 className="text-sm font-semibold text-gray-300 mb-4">Status systemu</h2>
        {loadingSys ? (
          <div className="h-24 bg-gray-800 animate-pulse rounded-lg" />
        ) : systemInfo ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Object.entries(systemInfo.stats ?? {}).map(([key, val]) => (
                <div key={key} className="rounded-lg bg-gray-800/50 px-3 py-2.5">
                  <div className="text-[10px] text-gray-600 font-mono uppercase">{key.replace(/_/g, " ")}</div>
                  <div className="text-lg font-bold text-white tabular-nums">{val.toLocaleString("pl-PL")}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs text-gray-400">
              <div className="flex justify-between">
                <span>ESPI pipeline:</span>
                <StatusDot status={pl?.espi_status} />
              </div>
              <div className="flex justify-between">
                <span>Ceny pipeline:</span>
                <StatusDot status={pl?.price_status} />
              </div>
              <div className="flex justify-between">
                <span>Ostatni ESPI fetch:</span>
                <span className="font-mono">{pl?.last_espi_fetch?.slice(0, 16) ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span>Ostatni Telegram alert:</span>
                <span className="font-mono">{pl?.last_telegram_alert?.slice(0, 16) ?? "—"}</span>
              </div>
            </div>
            <p className="text-[10px] text-gray-700 font-mono">version: {systemInfo.version}</p>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Błąd pobierania statusu systemu.</p>
        )}
      </section>

      {/* Save */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
        >
          Zapisz ustawienia
        </button>
        {saved && (
          <span className="text-sm text-green-400">✓ Zapisano lokalnie</span>
        )}
        <span className="text-xs text-gray-600">
          Ustawienia przechowywane w localStorage (tylko w tej przeglądarce).
        </span>
      </div>

    </div>
  );
}
