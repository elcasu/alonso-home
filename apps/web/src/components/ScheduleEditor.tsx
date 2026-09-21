"use client";

import { useState } from "react";
import { ALL_DAYS, type Schedule, type ScheduleRule } from "@alonso/shared";
import { Spinner } from "./Spinner";

const DAY_LABELS = ["D", "L", "M", "X", "J", "V", "S"];

function emptyRule(zoneId: string): ScheduleRule {
  return {
    id: crypto.randomUUID(),
    zoneId,
    action: "on",
    time: "18:00",
    days: ALL_DAYS,
    durationMinutes: 10,
    jitterMinutes: 8,
    enabled: true,
  };
}

export function ScheduleEditor({
  initial,
  zoneOptions,
}: {
  initial: Schedule;
  zoneOptions: { id: string; name: string }[];
}) {
  const [rules, setRules] = useState<ScheduleRule[]>(initial.rules);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const defaultZone = zoneOptions[0]?.id ?? "living";

  function update(id: string, patch: Partial<ScheduleRule>) {
    setRules((prev) => prev.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  }

  async function save() {
    setSaving(true);
    setStatus(null);
    const res = await fetch("/api/schedule", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...initial, rules }),
    });
    setSaving(false);
    if (!res.ok) {
      setStatus("No se pudo guardar");
      return;
    }
    setStatus("Agenda guardada. La Pi la toma en el próximo sync.");
  }

  return (
    <div className="space-y-4">
      {rules.map((rule) => (
        <article key={rule.id} className="rounded-3xl border border-white/5 bg-ink-900 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-stone-400">
              Zona
              <select
                className="mt-1 w-full rounded-xl bg-ink-800 px-3 py-2 text-sm text-white"
                value={rule.zoneId}
                onChange={(e) => update(rule.id, { zoneId: e.target.value })}
              >
                {zoneOptions.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-stone-400">
              Acción
              <select
                className="mt-1 w-full rounded-xl bg-ink-800 px-3 py-2 text-sm text-white"
                value={rule.action}
                onChange={(e) =>
                  update(rule.id, { action: e.target.value as ScheduleRule["action"] })
                }
              >
                <option value="on">Encender</option>
                <option value="off">Apagar</option>
                <option value="pulse">Pulse (enciende y apaga)</option>
              </select>
            </label>
            <label className="text-xs text-stone-400">
              Hora
              <input
                type="time"
                className="mt-1 w-full rounded-xl bg-ink-800 px-3 py-2 text-sm text-white"
                value={rule.time}
                onChange={(e) => update(rule.id, { time: e.target.value })}
              />
            </label>
            <label className="text-xs text-stone-400">
              Duración pulse (min)
              <input
                type="number"
                min={1}
                className="mt-1 w-full rounded-xl bg-ink-800 px-3 py-2 text-sm text-white"
                value={rule.durationMinutes ?? 10}
                onChange={(e) => update(rule.id, { durationMinutes: Number(e.target.value) })}
              />
            </label>
            <label className="text-xs text-stone-400">
              Jitter ± min
              <input
                type="number"
                min={0}
                className="mt-1 w-full rounded-xl bg-ink-800 px-3 py-2 text-sm text-white"
                value={rule.jitterMinutes ?? 0}
                onChange={(e) => update(rule.id, { jitterMinutes: Number(e.target.value) })}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-stone-300">
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={(e) => update(rule.id, { enabled: e.target.checked })}
              />
              Activa
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-1">
            {DAY_LABELS.map((label, index) => {
              const on = rule.days.includes(index);
              return (
                <button
                  key={label}
                  type="button"
                  className={`h-8 w-8 rounded-full text-xs ${on ? "bg-amber-glow text-ink-950" : "bg-ink-800 text-stone-500"}`}
                  onClick={() => {
                    const days = on ? rule.days.filter((d) => d !== index) : [...rule.days, index].sort();
                    update(rule.id, { days });
                  }}
                >
                  {label}
                </button>
              );
            })}
            <button
              type="button"
              className="ml-auto text-xs text-red-300"
              onClick={() => setRules((prev) => prev.filter((item) => item.id !== rule.id))}
            >
              Quitar
            </button>
          </div>
        </article>
      ))}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-2xl bg-ink-800 px-4 py-2 text-sm"
          onClick={() => setRules((prev) => [...prev, emptyRule(defaultZone)])}
        >
          Agregar regla
        </button>
        <button
          type="button"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-2xl bg-amber-glow px-4 py-2 text-sm font-semibold text-ink-950 disabled:opacity-40"
          onClick={() => void save()}
        >
          {saving ? <Spinner className="text-ink-950" /> : null}
          {saving ? "Guardando…" : "Guardar agenda"}
        </button>
      </div>
      {status ? <p className="text-sm text-stone-400">{status}</p> : null}
    </div>
  );
}
