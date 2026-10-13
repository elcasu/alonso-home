import path from "node:path";
import { isValidCameraId } from "@alonso/shared";

export type CameraDevice = {
  id: string;
  host: string;
  onvifPort: number;
  dvripPort: number;
  user: string;
  password: string;
};

export type SinkMode = "auto" | "iot" | "http" | "log";

export type CamerasConfig = {
  devices: CameraDevice[];
  /** Problema al leer `CAMERAS` (el agente de luces sigue funcionando igual). */
  error?: string;
  sink: SinkMode;
  iot: {
    endpoint: string;
    clientId: string;
    certPath: string;
    keyPath: string;
    caPath: string;
  };
  startCooldownMs: number;
  statusIntervalMs: number;
  outboxMaxAgeMs: number;
  outboxMaxRows: number;
};

/**
 * `CAMERAS` = JSON, por ejemplo:
 * [{"id":"entrada","host":"192.168.100.206","user":"admin","password":""}]
 * Opcionales por cámara: onvifPort (8899), dvripPort (34567).
 */
export function parseCameraDevices(raw: string | undefined): { devices: CameraDevice[]; error?: string } {
  if (!raw || !raw.trim()) return { devices: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { devices: [], error: `CAMERAS no es JSON válido: ${(err as Error).message}` };
  }
  if (!Array.isArray(parsed)) return { devices: [], error: "CAMERAS debe ser un arreglo JSON" };

  const devices: CameraDevice[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of parsed.entries()) {
    const item = entry as Record<string, unknown>;
    if (!isValidCameraId(item?.id)) {
      return { devices: [], error: `CAMERAS[${index}].id inválido (a-z, 0-9, _ y -; máx. 32)` };
    }
    if (typeof item.host !== "string" || !item.host.trim()) {
      return { devices: [], error: `CAMERAS[${index}].host falta` };
    }
    if (seen.has(item.id)) return { devices: [], error: `CAMERAS: id repetido "${item.id}"` };
    seen.add(item.id);
    devices.push({
      id: item.id,
      host: item.host.trim(),
      onvifPort: Number(item.onvifPort ?? 8899),
      dvripPort: Number(item.dvripPort ?? 34567),
      user: typeof item.user === "string" ? item.user : "admin",
      password: typeof item.password === "string" ? item.password : "",
    });
  }
  return { devices };
}

export function loadCamerasConfig(env: NodeJS.ProcessEnv, cwd: string): CamerasConfig {
  const { devices, error } = parseCameraDevices(env.CAMERAS);
  const certsDir = path.resolve(cwd, env.IOT_CERTS_DIR ?? "./certs");
  const mode = (env.CAMERA_SINK ?? "auto").toLowerCase();
  return {
    devices,
    error,
    sink: (["auto", "iot", "http", "log"].includes(mode) ? mode : "auto") as SinkMode,
    iot: {
      endpoint: env.IOT_ENDPOINT ?? "",
      clientId: env.IOT_CLIENT_ID ?? "alonso-pi",
      certPath: path.resolve(cwd, env.IOT_CERT ?? path.join(certsDir, "device.pem.crt")),
      keyPath: path.resolve(cwd, env.IOT_KEY ?? path.join(certsDir, "private.pem.key")),
      caPath: path.resolve(cwd, env.IOT_CA ?? path.join(certsDir, "AmazonRootCA1.pem")),
    },
    startCooldownMs: Number(env.CAMERA_START_COOLDOWN_MS ?? 20_000),
    statusIntervalMs: Number(env.CAMERA_STATUS_INTERVAL_MS ?? 30_000),
    outboxMaxAgeMs: Number(env.CAMERA_OUTBOX_MAX_AGE_MS ?? 6 * 60 * 60 * 1000),
    outboxMaxRows: Number(env.CAMERA_OUTBOX_MAX_ROWS ?? 300),
  };
}
