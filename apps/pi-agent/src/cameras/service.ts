import { randomUUID } from "node:crypto";
import {
  CAMERA_SNAPSHOT_MAX_BYTES,
  cameraEventLabel,
  type CameraEventKind,
  type CameraEventMessage,
  type CameraEventState,
  type CameraStatusMessage,
} from "@alonso/shared";
import type { AgentStore } from "../db.js";
import { log, logError } from "../logger.js";
import type { CameraDevice, CamerasConfig } from "./config.js";
import { takeSnapshot } from "./dvrip.js";
import { startOnvifWatcher, type OnvifWatcher } from "./onvif.js";
import type { CameraSink } from "./sink.js";
import { createTracker, type EventDraft } from "./tracker.js";

type OutboxStore = Pick<
  AgentStore,
  "outboxAdd" | "outboxPeek" | "outboxRemove" | "outboxCount" | "outboxPrune" | "addEvent"
>;

export type CameraServiceDeps = {
  config: CamerasConfig;
  store: OutboxStore;
  sink: CameraSink;
  /** Inyectables para tests. */
  snapshot?: (device: CameraDevice) => Promise<Buffer>;
  watch?: typeof startOnvifWatcher;
};

export type CameraRuntimeStatus = {
  id: string;
  host: string;
  onvifConnected: boolean;
  lastEventAt: string | null;
};

export type CameraService = {
  status(): {
    sink: string;
    sinkConnected: boolean;
    outbox: number;
    cameras: CameraRuntimeStatus[];
  };
  /** Saca una foto ahora y la manda como evento `snapshot`. */
  snapshotNow(cameraId: string): Promise<{ ok: boolean; bytes?: number; error?: string }>;
  /** Intenta vaciar el outbox ya (los tests lo usan; en producción corre solo). */
  flush(): Promise<void>;
  stop(): Promise<void>;
};

const FLUSH_BATCH = 20;
const FLUSH_INTERVAL_MS = 5000;
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;

export function startCameraService(deps: CameraServiceDeps): CameraService {
  const { config, store, sink } = deps;
  const snap =
    deps.snapshot ??
    ((device: CameraDevice) =>
      takeSnapshot({
        host: device.host,
        port: device.dvripPort,
        user: device.user,
        password: device.password,
      }));
  const watch = deps.watch ?? startOnvifWatcher;

  type Runtime = {
    device: CameraDevice;
    watcher?: OnvifWatcher;
    connected: boolean;
    lastEventAt: string | null;
    chain: Promise<unknown>;
    errorLogged: boolean;
  };
  const runtimes = new Map<string, Runtime>();
  let stopped = false;

  async function emit(
    rt: Runtime,
    kind: CameraEventKind,
    state: CameraEventState,
    wantSnapshot: boolean,
  ): Promise<{ bytes?: number; error?: string }> {
    const message: CameraEventMessage = {
      type: "event",
      id: randomUUID(),
      cameraId: rt.device.id,
      kind,
      state,
      ts: new Date().toISOString(),
    };
    let bytes: number | undefined;
    let error: string | undefined;
    if (wantSnapshot) {
      try {
        const jpeg = await snap(rt.device);
        if (jpeg.length > CAMERA_SNAPSHOT_MAX_BYTES) {
          error = `foto de ${jpeg.length} B supera el máximo (${CAMERA_SNAPSHOT_MAX_BYTES}); se envía sin foto`;
          log(`Cámara ${rt.device.id}: ${error}`);
        } else {
          message.snapshot = { mime: "image/jpeg", b64: jpeg.toString("base64") };
          bytes = jpeg.length;
        }
      } catch (err) {
        error = (err as Error).message;
        logError(`Cámara ${rt.device.id}: snapshot falló (el evento se envía igual)`, err);
      }
    }
    rt.lastEventAt = message.ts;
    store.outboxAdd(message.id, JSON.stringify(message));
    store.addEvent(
      `Cámara ${rt.device.id}: ${cameraEventLabel(kind, state)}${message.snapshot ? " (con foto)" : ""}`,
    );
    log(`Cámara ${rt.device.id}: ${kind}/${state}${bytes ? ` foto ${bytes} B` : ""}`);
    void flush();
    return { bytes, error };
  }

  /** Serializa los eventos de una cámara para que `end` nunca pase a `start`. */
  function enqueue(rt: Runtime, draft: EventDraft): void {
    rt.chain = rt.chain
      .then(() => emit(rt, draft.kind, draft.state, draft.wantSnapshot))
      .catch((err) => logError(`Cámara ${rt.device.id}: evento`, err));
  }

  let flushing: Promise<void> | null = null;
  let flushBackoffUntil = 0;
  function flush(): Promise<void> {
    if (flushing) return flushing;
    if (Date.now() < flushBackoffUntil) return Promise.resolve();
    flushing = (async () => {
      for (;;) {
        const rows = store.outboxPeek(FLUSH_BATCH);
        if (rows.length === 0) return;
        for (const row of rows) {
          try {
            await sink.publish(JSON.parse(row.payload));
            store.outboxRemove(row.id);
          } catch (err) {
            flushBackoffUntil = Date.now() + 5000;
            if (!stopped) logError(`Cámaras: envío a ${sink.name} pendiente (se reintenta)`, err);
            return;
          }
        }
      }
    })().finally(() => {
      flushing = null;
    });
    return flushing;
  }

  let statusErrorLogged = false;
  function publishStatus(rt: Runtime): void {
    const message: CameraStatusMessage = {
      type: "status",
      cameraId: rt.device.id,
      ts: new Date().toISOString(),
      online: rt.connected,
    };
    sink.publish(message).then(
      () => {
        statusErrorLogged = false;
      },
      (err) => {
        if (!statusErrorLogged && !stopped) logError(`Cámaras: status no enviado a ${sink.name}`, err);
        statusErrorLogged = true;
      },
    );
  }

  for (const device of config.devices) {
    const rt: Runtime = {
      device,
      connected: false,
      lastEventAt: null,
      chain: Promise.resolve(),
      errorLogged: false,
    };
    const tracker = createTracker({ startCooldownMs: config.startCooldownMs });
    rt.watcher = watch({
      host: device.host,
      port: device.onvifPort,
      user: device.user,
      password: device.password,
      onSignal(signal) {
        for (const draft of tracker.handle(signal)) enqueue(rt, draft);
      },
      onConnection(connected) {
        rt.connected = connected;
        if (connected) {
          rt.errorLogged = false;
          log(`Cámara ${device.id}: ONVIF conectado (${device.host}:${device.onvifPort})`);
        } else {
          tracker.reset();
        }
        publishStatus(rt);
      },
      onError(message, err) {
        if (rt.errorLogged) return;
        rt.errorLogged = true;
        logError(`${message} (reintenta con backoff)`, err);
      },
    });
    runtimes.set(device.id, rt);
  }

  const statusTimer = setInterval(() => {
    for (const rt of runtimes.values()) publishStatus(rt);
  }, config.statusIntervalMs);
  const flushTimer = setInterval(() => {
    if (store.outboxCount() > 0) void flush();
  }, FLUSH_INTERVAL_MS);
  const pruneTimer = setInterval(() => {
    const removed = store.outboxPrune(config.outboxMaxAgeMs, config.outboxMaxRows);
    if (removed > 0) log(`Cámaras: se descartaron ${removed} eventos viejos del outbox`);
  }, PRUNE_INTERVAL_MS);
  for (const timer of [statusTimer, flushTimer, pruneTimer]) timer.unref();

  log(
    `Cámaras: ${runtimes.size} configurada(s), destino=${sink.name}, outbox pendiente=${store.outboxCount()}`,
  );
  void flush();

  return {
    status() {
      return {
        sink: sink.name,
        sinkConnected: sink.connected(),
        outbox: store.outboxCount(),
        cameras: [...runtimes.values()].map((rt) => ({
          id: rt.device.id,
          host: rt.device.host,
          onvifConnected: rt.connected,
          lastEventAt: rt.lastEventAt,
        })),
      };
    },
    async snapshotNow(cameraId) {
      const rt = runtimes.get(cameraId);
      if (!rt) return { ok: false, error: `cámara desconocida: ${cameraId}` };
      const result = await new Promise<{ bytes?: number; error?: string }>((resolve) => {
        rt.chain = rt.chain.then(() => emit(rt, "snapshot", "instant", true)).then(resolve, (err) => {
          resolve({ error: (err as Error).message });
        });
      });
      return result.bytes ? { ok: true, bytes: result.bytes } : { ok: false, error: result.error };
    },
    flush,
    async stop() {
      stopped = true;
      clearInterval(statusTimer);
      clearInterval(flushTimer);
      clearInterval(pruneTimer);
      for (const rt of runtimes.values()) rt.watcher?.stop();
      await sink.close();
    },
  };
}
