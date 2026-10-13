"use client";

import { useEffect, useState } from "react";
import { cameraEventLabel } from "@alonso/shared";
import type { CamerasPayload, CameraView } from "@/lib/cameras";
import type { CameraEventRow } from "@/lib/store";

const POLL_MS = 8000;

function ago(iso: string, now: number): string {
  const sec = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (sec < 60) return `hace ${sec} s`;
  if (sec < 3600) return `hace ${Math.round(sec / 60)} min`;
  if (sec < 86_400) return `hace ${Math.round(sec / 3600)} h`;
  return new Date(iso).toLocaleDateString("es-AR");
}

function clock(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function eventTone(event: CameraEventRow): string {
  if (event.kind === "tamper") return "bg-red-500/15 text-red-200";
  if (event.kind === "motion") return "bg-amber-glow/15 text-amber-glow";
  return "bg-ink-800 text-stone-300";
}

function CameraCard({ camera, now }: { camera: CameraView; now: number }) {
  return (
    <article className="overflow-hidden rounded-3xl bg-ink-900">
      <div className="relative aspect-video bg-ink-950">
        {camera.lastSnapshotEventId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/camaras/snapshot/${camera.lastSnapshotEventId}`}
            alt={`Última foto de ${camera.name}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-stone-600">
            Sin fotos todavía
          </div>
        )}
        <span
          className={`absolute left-3 top-3 rounded-full px-3 py-1 text-xs font-semibold ${
            camera.online ? "bg-emerald-400 text-ink-950" : "bg-ink-800/90 text-stone-400"
          }`}
        >
          {camera.online ? "En línea" : "Sin señal"}
        </span>
      </div>
      <div className="p-4">
        <p className="text-lg font-medium">{camera.name}</p>
        <p className="mt-0.5 text-sm text-stone-400">
          {camera.lastEvent
            ? `${cameraEventLabel(camera.lastEvent.kind, camera.lastEvent.state)} · ${ago(camera.lastEvent.ts, now)}`
            : "Sin eventos registrados"}
        </p>
        <p className="mt-0.5 text-xs text-stone-600">
          {camera.lastSeen ? `Último aviso ${ago(camera.lastSeen, now)}` : "Nunca reportó"}
        </p>
      </div>
    </article>
  );
}

export function CameraBoard({ initial }: { initial: CamerasPayload }) {
  const [data, setData] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [failed, setFailed] = useState(false);
  const names = new Map(data.cameras.map((c) => [c.id, c.name]));

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/camaras", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as CamerasPayload;
        if (alive) {
          setData(next);
          setFailed(false);
        }
      } catch {
        if (alive) setFailed(true);
      }
      if (alive) setNow(Date.now());
    };
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div>
      {failed ? (
        <div className="mb-5 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          No se pudo actualizar. Reintentando…
        </div>
      ) : null}
      {data.usingMemory ? (
        <div className="mb-5 rounded-2xl border border-amber-glow/20 bg-amber-glow/10 px-4 py-3 text-sm text-amber-100">
          Modo local (sin Postgres): los eventos y fotos se pierden al reiniciar el panel.
        </div>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2">
        {data.cameras.map((camera) => (
          <CameraCard key={camera.id} camera={camera} now={now} />
        ))}
      </section>

      <h2 className="mb-3 mt-8 text-sm font-medium text-stone-400">Eventos recientes</h2>
      {data.events.length === 0 ? (
        <p className="rounded-2xl bg-ink-900 px-4 py-3 text-sm text-stone-500">
          Todavía no llegó ningún evento.
        </p>
      ) : (
        <ul className="space-y-2">
          {data.events.map((event) => (
            <li key={event.id} className="flex items-center gap-3 rounded-2xl bg-ink-900 p-3 text-sm">
              {event.hasSnapshot ? (
                <a
                  href={`/api/camaras/snapshot/${event.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/camaras/snapshot/${event.id}`}
                    alt=""
                    loading="lazy"
                    className="h-14 w-24 rounded-lg object-cover"
                  />
                </a>
              ) : (
                <div className="h-14 w-24 shrink-0 rounded-lg bg-ink-800" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate">
                  <span className={`mr-2 rounded-full px-2 py-0.5 text-xs font-semibold ${eventTone(event)}`}>
                    {cameraEventLabel(event.kind, event.state)}
                  </span>
                  {names.get(event.cameraId) ?? event.cameraId}
                </p>
                <p className="text-xs text-stone-500">{clock(event.ts)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
