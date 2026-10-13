import fs from "node:fs";
import type { AgentConfig } from "../config.js";
import type { AgentStore } from "../db.js";
import { log, logError } from "../logger.js";
import { startCameraService, type CameraService } from "./service.js";
import { createHttpSink, createIotSink, createLogSink, type CameraSink } from "./sink.js";

export type { CameraService } from "./service.js";

/** auto: AWS IoT si hay IOT_ENDPOINT; si no, HTTP al panel si hay CLOUD_URL; si no, solo log. */
export function resolveSink(config: AgentConfig): CameraSink {
  const cams = config.cameras;
  const hasIot = cams.iot.endpoint !== "";
  const hasHttp = config.cloudUrl !== "" && config.deviceToken !== "";
  const mode = cams.sink === "auto" ? (hasIot ? "iot" : hasHttp ? "http" : "log") : cams.sink;

  if (mode === "iot") {
    if (!hasIot) throw new Error("CAMERA_SINK=iot pero falta IOT_ENDPOINT");
    for (const file of [cams.iot.certPath, cams.iot.keyPath, cams.iot.caPath]) {
      if (!fs.existsSync(file)) throw new Error(`falta el archivo de AWS IoT: ${file}`);
    }
    return createIotSink(cams.iot);
  }
  if (mode === "http") {
    if (!hasHttp) throw new Error("CAMERA_SINK=http pero faltan CLOUD_URL o DEVICE_TOKEN");
    return createHttpSink({ cloudUrl: config.cloudUrl, deviceToken: config.deviceToken });
  }
  return createLogSink();
}

/**
 * Arranca el módulo de cámaras. Nunca tumba el agente de luces: ante cualquier problema
 * de configuración lo registra y devuelve `null`.
 */
export function startCameras(config: AgentConfig, store: AgentStore): CameraService | null {
  if (config.cameras.error) {
    logError("Cámaras desactivadas", new Error(config.cameras.error));
    return null;
  }
  if (config.cameras.devices.length === 0) {
    log("Cámaras: ninguna configurada (variable CAMERAS vacía)");
    return null;
  }
  try {
    const sink = resolveSink(config);
    return startCameraService({ config: config.cameras, store, sink });
  } catch (err) {
    logError("Cámaras desactivadas", err);
    return null;
  }
}
