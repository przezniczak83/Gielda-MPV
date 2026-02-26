// app/app/settings/page.tsx
// Application settings page.

import SettingsClient from "./SettingsClient";

export const metadata = {
  title: "Ustawienia — Giełda Monitor",
};

export default function SettingsPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-3xl mx-auto px-6 py-10">

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Ustawienia</h1>
          <p className="text-sm text-gray-500 mt-1">
            Konfiguracja powiadomień, interfejsu i eksportu danych.
          </p>
        </div>

        <SettingsClient />

      </div>
    </div>
  );
}
