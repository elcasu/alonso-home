import {
  CAMERA_STATUS_STALE_MS,
  DEFAULT_CAMERAS,
  parseCameraMessage,
  type CameraDef,
} from "@alonso/shared";
import { getStore, type CameraEventRow } from "./store";

export type CameraView = CameraDef & {
  online: boolean;
  /** Último status recibido (la Pi lo manda cada ~30 s). */
  lastSeen: string | null;
  lastEvent: CameraEventRow | null;
  /** Id del último evento con foto: se muestra en `/api/camaras/snapshot/<id>`. */
  lastSnapshotEventId: string | null;
};

export type CamerasPayload = {
  cameras: CameraView[];
  events: CameraEventRow[];
  usingMemory: boolean;
};

const MAX_BATCH = 50;

export type IngestResult = { accepted: number; duplicates: number; rejected: number };

/** Acepta un mensaje o un arreglo. Cada mensaje se valida por separado: uno malo no tira el lote. */
export async function ingestCameraMessages(input: unknown): Promise<IngestResult> {
  const items = Array.isArray(input) ? input.slice(0, MAX_BATCH) : [input];
  const store = await getStore();
  const result: IngestResult = { accepted: 0, duplicates: 0, rejected: 0 };
  for (const item of items) {
    const message = parseCameraMessage(item);
    if (!message) {
      result.rejected += 1;
      continue;
    }
    if (message.type === "status") {
      await store.saveCameraStatus(message);
      result.accepted += 1;
    } else if (await store.saveCameraEvent(message)) {
      result.accepted += 1;
    } else {
      result.duplicates += 1;
    }
  }
  return result;
}

export async function readCameras(limit = 40, now = Date.now()): Promise<CamerasPayload> {
  const store = await getStore();
  const [statuses, events, snapshots] = await Promise.all([
    store.getCameraStatuses(),
    store.recentCameraEvents(limit),
    store.latestSnapshotEvents(),
  ]);

  const defs = new Map<string, CameraDef>(DEFAULT_CAMERAS.map((c) => [c.id, c]));
  // Cámaras que mandan datos pero todavía no están en DEFAULT_CAMERAS: se muestran igual.
  for (const id of [...statuses.map((s) => s.cameraId), ...events.map((e) => e.cameraId)]) {
    if (!defs.has(id)) defs.set(id, { id, name: id });
  }

  const cameras: CameraView[] = [...defs.values()].map((def) => {
    const status = statuses.find((s) => s.cameraId === def.id);
    const fresh = status ? now - Date.parse(status.lastSeen) <= CAMERA_STATUS_STALE_MS : false;
    return {
      ...def,
      online: Boolean(status?.online && fresh),
      lastSeen: status?.lastSeen ?? null,
      lastEvent: events.find((e) => e.cameraId === def.id) ?? null,
      lastSnapshotEventId: snapshots.find((s) => s.cameraId === def.id)?.id ?? null,
    };
  });

  return { cameras, events, usingMemory: store.usingMemory };
}
