"use client";

import { useEffect, useState } from "react";
import type { RuleAction, ZoneState } from "@alonso/shared";
import type { AppStatus } from "@/lib/store";
import {
  type PendingCommand,
  pendingLabel,
  pendingSatisfied,
} from "@/lib/pending";
import { OfflineBanner } from "./OfflineBanner";
import { Spinner } from "./Spinner";

const IDLE_POLL_MS = 5000;
const BUSY_POLL_MS = 1500;

async function sendCommand(zoneId: string, action: RuleAction, durationMinutes?: number) {
  const res = await fetch("/api/commands", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ zoneId, action, durationMinutes }),
  });
  if (!res.ok) throw new Error("No se pudo enviar el comando");
}

function ZoneCard({
  zone,
  pending,
  onAction,
}: {
  zone: ZoneState;
  pending: PendingCommand | null;
  onAction: (action: RuleAction, durationMinutes?: number) => void;
}) {
  const busy = pending !== null;
  const label = pending ? pendingLabel(pending) : zone.on ? "ON" : "OFF";

  return (
    <article
      aria-busy={busy}
      className={`rounded-3xl bg-ink-900 p-5 ${zone.on ? "lamp-on" : "border border-white/5"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-medium">{zone.name}</p>
          <p className="text-xs text-stone-500">
            {zone.kind === "gpio" ? `GPIO ${zone.pin}` : `${zone.deviceId} · ch ${zone.channel}`}
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
            busy
              ? "bg-amber-glow/15 text-amber-glow"
              : zone.on
                ? "bg-amber-glow text-ink-950"
                : "bg-ink-800 text-stone-400"
          }`}
        >
          {busy ? <Spinner /> : null}
          {label}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <ActionButton
          disabled={busy}
          active={pending?.action === "on"}
          onClick={() => onAction("on")}
        >
          On
        </ActionButton>
        <ActionButton
          disabled={busy}
          active={pending?.action === "off"}
          onClick={() => onAction("off")}
        >
          Off
        </ActionButton>
        <ActionButton
          disabled={busy}
          active={pending?.action === "pulse"}
          onClick={() => onAction("pulse", 10)}
        >
          10 min
        </ActionButton>
      </div>
      {pending ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-amber-glow/90">
          <Spinner />
          {pending.phase === "sending"
            ? "Enviando comando…"
            : "En cola · la Pi lo toma en el próximo sync (~8 s)"}
        </p>
      ) : null}
    </article>
  );
}

function ActionButton({
  children,
  disabled,
  active,
  onClick,
}: {
  children: string;
  disabled: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-2xl bg-ink-800 py-2 text-sm disabled:opacity-40 ${
        active ? "ring-1 ring-amber-glow/60" : ""
      }`}
    >
      {active ? <Spinner className="text-amber-glow" /> : null}
      {children}
    </button>
  );
}

export function Dashboard({ initial }: { initial: AppStatus }) {
  const [status, setStatus] = useState(initial);
  const [pending, setPending] = useState<PendingCommand | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function pull() {
      const res = await fetch("/api/status");
      if (!res.ok) return;
      const data = (await res.json()) as AppStatus;
      if (!cancelled) setStatus(data);
    }

    const ms = pending ? BUSY_POLL_MS : IDLE_POLL_MS;
    if (pending?.phase === "queued") void pull();
    const id = setInterval(() => {
      void pull();
    }, ms);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pending]);

  useEffect(() => {
    if (!pending || pending.phase === "sending") return;
    const zone = status.zones.find((item) => item.id === pending.zoneId);
    const result = pendingSatisfied(pending, zone, status.lastSeen);
    if (result === "timeout") {
      setError("La Pi no confirmó el comando. Revisá Salud.");
      setPending(null);
    } else if (result === "done") {
      setPending(null);
    }
  }, [pending, status]);

  async function onAction(zoneId: string, action: RuleAction, durationMinutes?: number) {
    const zone = status.zones.find((item) => item.id === zoneId);
    setPending({
      zoneId,
      action,
      phase: "sending",
      since: Date.now(),
      initialOn: zone?.on ?? false,
    });
    setError(null);
    try {
      await sendCommand(zoneId, action, durationMinutes);
      setPending((curr) => (curr && curr.zoneId === zoneId ? { ...curr, phase: "queued" } : curr));
    } catch (err) {
      setPending(null);
      setError(err instanceof Error ? err.message : "Error");
    }
  }

  return (
    <div>
      <OfflineBanner online={status.online} lastSeen={status.lastSeen} usingMemory={status.usingMemory} />
      {error ? <p className="mb-4 text-sm text-red-300">{error}</p> : null}
      <section className="grid gap-4 sm:grid-cols-2">
        {status.zones.map((zone) => (
          <ZoneCard
            key={zone.id}
            zone={zone}
            pending={pending?.zoneId === zone.id ? pending : null}
            onAction={(action, durationMinutes) => void onAction(zone.id, action, durationMinutes)}
          />
        ))}
      </section>
      <p className="mt-6 text-xs text-stone-500" aria-live="polite">
        {pending
          ? "Comando en camino. El badge vuelve a ON/OFF cuando la Pi confirma."
          : "Los comandos se aplican en el próximo poll de la Pi (~8 s) si hay 4G. La agenda corre igual sin internet."}
      </p>
    </div>
  );
}
