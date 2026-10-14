#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import { pathToFileURL } from "node:url";

export const USAGE =
  "uso: alonso status | on <zona> | off <zona> | pulse <zona> [minutos] | cameras | snap <id>";

const EVENT_LIMIT = 5;
const LABEL_WIDTH = 10;

export type Parsed =
  | { kind: "status" }
  | { kind: "cameras" }
  | { kind: "zone"; action: "on" | "off"; zoneId: string }
  | { kind: "pulse"; zoneId: string; minutes: number }
  | { kind: "snap"; cameraId: string };

export type ZoneView = { id: string; on: boolean; kind: string };

export type StatusBody = {
  zones?: ZoneView[];
  mqttConnected?: boolean;
  events?: { ts: string; message: string }[];
};

export type CameraView = { id: string; host: string; onvifConnected: boolean };

export type CamerasBody = {
  enabled?: boolean;
  cameras?: CameraView[];
  outbox?: number;
};

export type SnapBody = { ok?: boolean; bytes?: number; error?: string };

export type HttpInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

export type HttpResult = { status: number; body: unknown };

type CliIo = {
  env: NodeJS.ProcessEnv;
  /** Inyectable en tests. Por defecto usa node:http (no pasa por HTTP_PROXY). */
  request?: (url: string, init?: HttpInit) => Promise<HttpResult>;
};

type CliResult = { code: number; stdout: string; stderr: string };

export function parseArgs(argv: string[]): Parsed | { error: string } {
  const [cmd, a, b] = argv;
  if (!cmd || cmd === "help" || cmd === "-h" || cmd === "--help") return { error: USAGE };
  if (cmd === "status" && argv.length === 1) return { kind: "status" };
  if (cmd === "cameras" && argv.length === 1) return { kind: "cameras" };
  if ((cmd === "on" || cmd === "off") && a && argv.length === 2) {
    return { kind: "zone", action: cmd, zoneId: a };
  }
  if (cmd === "pulse" && a && argv.length === 2) return { kind: "pulse", zoneId: a, minutes: 10 };
  if (cmd === "pulse" && a && b && argv.length === 3) {
    if (!/^[1-9]\d*$/.test(b)) return { error: "los minutos tienen que ser un entero mayor a 0" };
    return { kind: "pulse", zoneId: a, minutes: Number(b) };
  }
  if (cmd === "snap" && a && argv.length === 2) return { kind: "snap", cameraId: a };
  return { error: USAGE };
}

function pad(label: string): string {
  return label.padEnd(LABEL_WIDTH);
}

function clock(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "--:--";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "--";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "--";
  return `${hour}:${minute}`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function formatStatus(body: StatusBody): string {
  const lines = (body.zones ?? []).map((zone) => {
    const state = (zone.on ? "ON" : "OFF").padEnd(3);
    return `${pad(zone.id)}${state}  ${zone.kind}`;
  });
  lines.push(`${pad("mqtt")}${body.mqttConnected ? "conectado" : "desconectado"}`);
  const events = (body.events ?? []).slice(0, EVENT_LIMIT);
  if (events.length > 0) {
    lines.push("");
    for (const event of events) lines.push(`${clock(event.ts)}  ${event.message}`);
  }
  return lines.join("\n");
}

export function formatZoneChange(zone: ZoneView, pulseMinutes?: number): string {
  const parts = [zone.id, zone.on ? "ON" : "OFF"];
  if (zone.kind === "esp32") parts.push("publicado");
  if (pulseMinutes) parts.push("pulse", String(pulseMinutes), "min");
  return parts.join(" ");
}

export function formatCameras(body: CamerasBody): string {
  if (body.enabled === false) return "cámaras desactivadas";
  const cameras = body.cameras ?? [];
  if (cameras.length === 0) return "sin cámaras";
  const lines = cameras.map(
    (camera) =>
      `${pad(camera.id)}${camera.host}  ${camera.onvifConnected ? "conectada" : "desconectada"}`,
  );
  if (body.outbox) lines.push(`${pad("outbox")}${body.outbox}`);
  return lines.join("\n");
}

export function formatSnap(id: string, body: SnapBody): { ok: boolean; text: string } {
  if (body.ok && typeof body.bytes === "number") {
    return { ok: true, text: `${id}  ok  ${formatBytes(body.bytes)}` };
  }
  return { ok: false, text: body.error || "la cámara no respondió" };
}

function errorText(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return fallback;
}

function apiPort(env: NodeJS.ProcessEnv): number {
  const parsed = Number(env.LOCAL_API_PORT ?? 3001);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 3001;
}

/** HTTP directo a loopback: no usa HTTP_PROXY (fetch/undici sí, y rompe el CLI por SSH). */
export function httpRequest(url: string, init: HttpInit = {}): Promise<HttpResult> {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: init.method ?? "GET",
        headers: init.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk as Buffer));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (!text) {
            resolve({ status: res.statusCode ?? 0, body: {} });
            return;
          }
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) as unknown });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: { error: text } });
          }
        });
      },
    );
    req.setTimeout(8_000, () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", (err) => {
      resolve({
        status: 0,
        body: { error: `no pude hablar con el agente en ${parsed.host}: ${err.message}` },
      });
    });
    if (init.body) req.write(init.body);
    req.end();
  });
}

function fail(text: string): CliResult {
  return { code: 1, stdout: "", stderr: text };
}

export async function runCli(argv: string[], io: CliIo): Promise<CliResult> {
  const parsed = parseArgs(argv);
  if ("error" in parsed) return fail(parsed.error);

  const port = apiPort(io.env);
  const base = `http://127.0.0.1:${port}`;
  const doRequest = io.request ?? httpRequest;

  if (parsed.kind === "status") {
    const { status, body } = await doRequest(`${base}/status`);
    if (status !== 200) return fail(errorText(body, "no pude leer el estado"));
    return { code: 0, stdout: formatStatus(body as StatusBody), stderr: "" };
  }

  if (parsed.kind === "cameras") {
    const { status, body } = await doRequest(`${base}/cameras`);
    if (status !== 200) return fail(errorText(body, "no pude leer las cámaras"));
    return { code: 0, stdout: formatCameras(body as CamerasBody), stderr: "" };
  }

  if (parsed.kind === "snap") {
    const { status, body } = await doRequest(
      `${base}/cameras/${encodeURIComponent(parsed.cameraId)}/snapshot`,
      { method: "POST" },
    );
    const snap = formatSnap(parsed.cameraId, (body ?? {}) as SnapBody);
    if (status !== 200 || !snap.ok) return fail(snap.text);
    return { code: 0, stdout: snap.text, stderr: "" };
  }

  const payload =
    parsed.kind === "pulse"
      ? { action: "pulse", durationMinutes: parsed.minutes }
      : { on: parsed.action === "on" };
  const { status, body } = await doRequest(`${base}/zones/${encodeURIComponent(parsed.zoneId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (status !== 200) return fail(errorText(body, "no pude cambiar la zona"));
  const zones = ((body ?? {}) as { zones?: ZoneView[] }).zones ?? [];
  const zone = zones.find((item) => item.id === parsed.zoneId);
  if (!zone) return fail("zona desconocida");
  return {
    code: 0,
    stdout: formatZoneChange(zone, parsed.kind === "pulse" ? parsed.minutes : undefined),
    stderr: "",
  };
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  runCli(process.argv.slice(2), { env: process.env }).then((result) => {
    if (result.stdout) process.stdout.write(`${result.stdout}\n`);
    if (result.stderr) process.stderr.write(`${result.stderr}\n`);
    process.exit(result.code);
  });
}
