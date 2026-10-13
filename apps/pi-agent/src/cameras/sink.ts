import fs from "node:fs";
import mqtt from "mqtt";
import { cameraTopic, type CameraMessage } from "@alonso/shared";
import { log, logError } from "../logger.js";

/** Destino de los mensajes de cámara. `publish` rechaza si no se pudo entregar (el outbox reintenta). */
export type CameraSink = {
  readonly name: string;
  /** Hay camino hacia el destino (MQTT conectado / último POST ok). */
  connected(): boolean;
  publish(message: CameraMessage): Promise<void>;
  close(): Promise<void>;
};

export type IotSinkOptions = {
  endpoint: string;
  clientId: string;
  certPath: string;
  keyPath: string;
  caPath: string;
};

/** AWS IoT Core: MQTT 3.1.1 sobre TLS 8883 con certificado X.509 (autenticación mutua). */
export function createIotSink(opts: IotSinkOptions): CameraSink {
  const client = mqtt.connect(`mqtts://${opts.endpoint}:8883`, {
    clientId: opts.clientId,
    key: fs.readFileSync(opts.keyPath),
    cert: fs.readFileSync(opts.certPath),
    ca: fs.readFileSync(opts.caPath),
    protocolVersion: 4,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 15_000,
    keepalive: 60,
  });
  let up = false;
  client.on("connect", () => {
    up = true;
    log(`AWS IoT conectado ${opts.endpoint} como ${opts.clientId}`);
  });
  client.on("close", () => {
    up = false;
  });
  client.on("error", (err) => {
    up = false;
    logError("AWS IoT", err);
  });

  return {
    name: "iot",
    connected: () => up,
    publish(message) {
      // Sin conexión mqtt.js encolaría en memoria y la perderíamos al reiniciar: preferimos el outbox.
      if (!client.connected) return Promise.reject(new Error("AWS IoT desconectado"));
      const kind = message.type === "event" ? "event" : "status";
      const topic = cameraTopic(message.cameraId, kind);
      return new Promise<void>((resolve, reject) => {
        client.publish(topic, JSON.stringify(message), { qos: 1, retain: false }, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
    close() {
      return new Promise<void>((resolve) => {
        client.end(false, {}, () => resolve());
      });
    },
  };
}

export type HttpSinkOptions = {
  cloudUrl: string;
  deviceToken: string;
  fetchImpl?: typeof fetch;
};

/** Directo al panel (`/api/device/camera-events`). Útil en desarrollo o sin AWS. */
export function createHttpSink(opts: HttpSinkOptions): CameraSink {
  const doFetch = opts.fetchImpl ?? fetch;
  let ok = false;
  return {
    name: "http",
    connected: () => ok,
    async publish(message) {
      try {
        const res = await doFetch(`${opts.cloudUrl}/api/device/camera-events`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${opts.deviceToken}`,
          },
          body: JSON.stringify(message),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`camera-events HTTP ${res.status}`);
        ok = true;
      } catch (err) {
        ok = false;
        throw err;
      }
    },
    async close() {},
  };
}

/** Solo registra en el log; no entrega nada (el outbox lo descarta como "enviado"). */
export function createLogSink(): CameraSink {
  return {
    name: "log",
    connected: () => true,
    async publish(message) {
      const extra =
        message.type === "event"
          ? `${message.kind}/${message.state}${message.snapshot ? ` +foto ${message.snapshot.b64.length}B64` : ""}`
          : `online=${message.online}`;
      log(`[cámaras:log] ${message.type} ${message.cameraId} ${extra}`);
    },
    async close() {},
  };
}
