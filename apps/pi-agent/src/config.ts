import path from "node:path";
import { loadDotEnv } from "./env.js";

function env(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

export type AgentConfig = {
  cloudUrl: string;
  deviceToken: string;
  gpioMock: boolean;
  /** Relé típico = true. LED GPIO→GND = false. */
  gpioActiveLow: boolean;
  mqttEnabled: boolean;
  mqttUrl: string;
  mqttUser: string;
  mqttPassword: string;
  dataDir: string;
  dbPath: string;
  localApiPort: number;
  syncIntervalMs: number;
  schedulerIntervalMs: number;
  timezone: string;
};

export function loadConfig(cwd = process.cwd()): AgentConfig {
  loadDotEnv(cwd);
  const dataDir = path.resolve(cwd, env("DATA_DIR", "./data"));
  const gpioMock =
    envFlag("GPIO_MOCK", process.platform !== "linux") || process.platform !== "linux";
  return {
    cloudUrl: env("CLOUD_URL").replace(/\/$/, ""),
    deviceToken: env("DEVICE_TOKEN"),
    gpioMock,
    gpioActiveLow: envFlag("GPIO_ACTIVE_LOW", true),
    mqttEnabled: envFlag("MQTT_ENABLED", false),
    mqttUrl: env("MQTT_URL", "mqtt://127.0.0.1:1883"),
    mqttUser: env("MQTT_USER", "alonso"),
    mqttPassword: env("MQTT_PASSWORD", "alonso"),
    dataDir,
    dbPath: path.join(dataDir, "alonso.db"),
    localApiPort: Number(env("LOCAL_API_PORT", "3001")),
    syncIntervalMs: Number(env("SYNC_INTERVAL_MS", "8000")),
    schedulerIntervalMs: Number(env("SCHEDULER_INTERVAL_MS", "5000")),
    timezone: env("TZ", "America/Argentina/Buenos_Aires"),
  };
}
