import type { CameraEventKind, CameraEventState } from "@alonso/shared";
import type { CameraSignal } from "./onvif.js";

export type EventDraft = {
  kind: CameraEventKind;
  state: CameraEventState;
  /** Conviene sacar foto (solo en `start`, y no más seguido que el cooldown). */
  wantSnapshot: boolean;
};

export type TrackerOptions = {
  /** Mínimo entre dos `start` del mismo tipo. Evita ráfagas por árboles, sombras o un gato que va y viene. */
  startCooldownMs: number;
  now?: () => number;
};

/**
 * Convierte la secuencia cruda de señales ONVIF en eventos limpios:
 * - ONVIF manda MotionAlarm y CellMotionDetector a la vez → se deduplican por transición.
 * - Estado inicial al suscribirse: se registra sin emitir (salvo que ya haya movimiento activo).
 * - `start` dentro del cooldown se suprime, junto con su `end`.
 */
export function createTracker(opts: TrackerOptions) {
  const now = opts.now ?? Date.now;
  const active = new Map<CameraEventKind, boolean>();
  const lastStart = new Map<CameraEventKind, number>();
  const suppressed = new Set<CameraEventKind>();

  return {
    handle(signal: CameraSignal): EventDraft[] {
      const was = active.get(signal.kind) ?? false;
      if (signal.active === was) return [];
      active.set(signal.kind, signal.active);

      if (signal.active) {
        const last = lastStart.get(signal.kind);
        const t = now();
        if (last !== undefined && t - last < opts.startCooldownMs) {
          suppressed.add(signal.kind);
          return [];
        }
        lastStart.set(signal.kind, t);
        suppressed.delete(signal.kind);
        return [{ kind: signal.kind, state: "start", wantSnapshot: true }];
      }

      if (suppressed.delete(signal.kind)) return [];
      return [{ kind: signal.kind, state: "end", wantSnapshot: false }];
    },
    /** Al perder la conexión ONVIF no sabemos el estado real: se parte de cero. */
    reset(): void {
      active.clear();
      suppressed.clear();
    },
  };
}

export type Tracker = ReturnType<typeof createTracker>;
