/** Módulo de cámaras: mensajes que viajan Pi → AWS IoT (MQTT) → panel, y definiciones estáticas. */

export type CameraEventKind = "motion" | "tamper" | "snapshot";
/** `start`/`end` para eventos con duración (movimiento); `instant` para puntuales (foto manual). */
export type CameraEventState = "start" | "end" | "instant";

export type CameraSnapshot = {
  mime: "image/jpeg";
  /** JPEG en base64 (la cámara GT-N3 da ~25 KB a 800×448). */
  b64: string;
};

export type CameraEventMessage = {
  type: "event";
  /** UUID generado en la Pi. Sirve para deduplicar reintentos (IoT es at-least-once). */
  id: string;
  cameraId: string;
  kind: CameraEventKind;
  state: CameraEventState;
  ts: string;
  snapshot?: CameraSnapshot;
};

export type CameraStatusMessage = {
  type: "status";
  cameraId: string;
  ts: string;
  /** La Pi tiene la suscripción ONVIF activa con esa cámara. */
  online: boolean;
};

export type CameraMessage = CameraEventMessage | CameraStatusMessage;

/** Metadatos estáticos de cada cámara (nombre, ambiente). Las credenciales viven solo en la Pi. */
export type CameraDef = {
  id: string;
  name: string;
  /** Id de ambiente en el plano (`Room.id`). */
  roomId?: string;
};

export const DEFAULT_CAMERAS: CameraDef[] = [{ id: "entrada", name: "Entrada", roomId: "living" }];

/** Sin status en este tiempo → el panel muestra la cámara como offline. */
export const CAMERA_STATUS_STALE_MS = 90_000;
/** AWS IoT limita el payload MQTT a 128 KB; en base64 son ~4/3 del JPEG. */
export const CAMERA_SNAPSHOT_MAX_BYTES = 90_000;
/** Días que el panel conserva eventos con foto. */
export const CAMERA_RETENTION_DAYS = 14;

export const CAMERA_TOPIC_PREFIX = "alonso/home/camera";
/** Filtro para reglas y suscriptores: todos los eventos y status de todas las cámaras. */
export const CAMERA_TOPIC_FILTER = `${CAMERA_TOPIC_PREFIX}/+/+`;

export function cameraTopic(cameraId: string, kind: "event" | "status"): string {
  return `${CAMERA_TOPIC_PREFIX}/${cameraId}/${kind}`;
}

const CAMERA_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const EVENT_KINDS: readonly string[] = ["motion", "tamper", "snapshot"];
const EVENT_STATES: readonly string[] = ["start", "end", "instant"];
/** ~130 KB de base64 = 97 KB de JPEG; margen sobre CAMERA_SNAPSHOT_MAX_BYTES. */
const MAX_B64_LENGTH = 130_000;

export function isValidCameraId(value: unknown): value is string {
  return typeof value === "string" && CAMERA_ID_RE.test(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

/** Valida un mensaje que llega de la red (no confiamos en el formato). */
export function parseCameraMessage(input: unknown): CameraMessage | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  if (!isValidCameraId(raw.cameraId) || !isIsoDate(raw.ts)) return null;

  if (raw.type === "status") {
    if (typeof raw.online !== "boolean") return null;
    return { type: "status", cameraId: raw.cameraId, ts: raw.ts, online: raw.online };
  }

  if (raw.type === "event") {
    if (typeof raw.id !== "string" || raw.id.length < 8 || raw.id.length > 64) return null;
    if (typeof raw.kind !== "string" || !EVENT_KINDS.includes(raw.kind)) return null;
    if (typeof raw.state !== "string" || !EVENT_STATES.includes(raw.state)) return null;
    const message: CameraEventMessage = {
      type: "event",
      id: raw.id,
      cameraId: raw.cameraId,
      kind: raw.kind as CameraEventKind,
      state: raw.state as CameraEventState,
      ts: raw.ts,
    };
    if (raw.snapshot !== undefined && raw.snapshot !== null) {
      const snap = raw.snapshot as Record<string, unknown>;
      if (
        snap.mime !== "image/jpeg" ||
        typeof snap.b64 !== "string" ||
        snap.b64.length === 0 ||
        snap.b64.length > MAX_B64_LENGTH
      ) {
        return null;
      }
      message.snapshot = { mime: "image/jpeg", b64: snap.b64 };
    }
    return message;
  }

  return null;
}

export function cameraEventLabel(kind: CameraEventKind, state: CameraEventState): string {
  if (kind === "motion") return state === "end" ? "Fin del movimiento" : "Movimiento";
  if (kind === "tamper") return state === "end" ? "Fin de sabotaje" : "Sabotaje / obstrucción";
  return "Foto manual";
}
