import {
  CAMERA_RETENTION_DAYS,
  COMMAND_TTL_MS,
  DEFAULT_ZONES,
  defaultSchedule,
  type Command,
  type Schedule,
  type ZoneState,
} from "@alonso/shared";
import type {
  CameraEventRow,
  CameraStatusRow,
  DataStore,
  HeartbeatRow,
  LogEvent,
} from "./store";

type MemoryCameraEvent = CameraEventRow & { snapshot?: Buffer };

type MemoryState = {
  version: number;
  zones: ZoneState[];
  schedule: Schedule;
  commands: Command[];
  heartbeat: HeartbeatRow | null;
  events: LogEvent[];
  cameraEvents: MemoryCameraEvent[];
  cameraStatus: Map<string, CameraStatusRow>;
};

const SEED_VERSION = 3;
const MEMORY_CAMERA_EVENTS_MAX = 200;

const globalForStore = globalThis as typeof globalThis & { __alonsoMemory?: MemoryState };

function seed(): MemoryState {
  return {
    version: SEED_VERSION,
    zones: DEFAULT_ZONES.map((zone) => ({ ...zone, on: false })),
    schedule: defaultSchedule(),
    commands: [],
    heartbeat: null,
    cameraEvents: [],
    cameraStatus: new Map(),
    events: [
      {
        ts: new Date().toISOString(),
        message: "Store en memoria (sin DATABASE_URL). Ideal para desarrollo local.",
        zoneId: null,
      },
    ],
  };
}

function state(): MemoryState {
  if (!globalForStore.__alonsoMemory || globalForStore.__alonsoMemory.version !== SEED_VERSION) {
    globalForStore.__alonsoMemory = seed();
  }
  return globalForStore.__alonsoMemory;
}

export function getMemoryStore(): DataStore {
  const mem = state();
  return {
    usingMemory: true,
    async getZones() {
      return mem.zones.map((z) => ({ ...z }));
    },
    async setZoneOn(id, on) {
      mem.zones = mem.zones.map((z) => (z.id === id ? { ...z, on } : z));
    },
    async replaceZones(zones) {
      mem.zones = zones.map((z) => ({ ...z }));
    },
    async getSchedule() {
      return structuredClone(mem.schedule);
    },
    async setSchedule(schedule) {
      mem.schedule = structuredClone(schedule);
    },
    async enqueueCommand(command) {
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + COMMAND_TTL_MS).toISOString();
      const full: Command = {
        id: command.id,
        zoneId: command.zoneId,
        action: command.action,
        durationMinutes: command.durationMinutes,
        createdAt,
        expiresAt,
      };
      mem.commands.push(full);
      return full;
    },
    async takeCommands() {
      const now = Date.now();
      const due = mem.commands.filter((c) => Date.parse(c.expiresAt) > now);
      mem.commands = [];
      return due;
    },
    async setHeartbeat(ts, mqttConnected) {
      mem.heartbeat = { lastSeen: ts, mqttConnected: mqttConnected ?? null };
    },
    async getHeartbeat() {
      return mem.heartbeat;
    },
    async addEvent(message, zoneId) {
      mem.events.unshift({ ts: new Date().toISOString(), message, zoneId: zoneId ?? null });
      mem.events = mem.events.slice(0, 100);
    },
    async recentEvents(limit = 30) {
      return mem.events.slice(0, limit);
    },
    async saveCameraEvent(message) {
      if (mem.cameraEvents.some((e) => e.id === message.id)) return false;
      const row: MemoryCameraEvent = {
        id: message.id,
        cameraId: message.cameraId,
        kind: message.kind,
        state: message.state,
        ts: new Date(message.ts).toISOString(),
        hasSnapshot: Boolean(message.snapshot),
        snapshot: message.snapshot ? Buffer.from(message.snapshot.b64, "base64") : undefined,
      };
      const cutoff = Date.now() - CAMERA_RETENTION_DAYS * 86_400_000;
      mem.cameraEvents.push(row);
      mem.cameraEvents = mem.cameraEvents
        .filter((e) => Date.parse(e.ts) >= cutoff)
        .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
        .slice(0, MEMORY_CAMERA_EVENTS_MAX);
      return true;
    },
    async saveCameraStatus(message) {
      mem.cameraStatus.set(message.cameraId, {
        cameraId: message.cameraId,
        online: message.online,
        lastSeen: new Date(message.ts).toISOString(),
      });
    },
    async recentCameraEvents(limit, cameraId) {
      return mem.cameraEvents
        .filter((e) => !cameraId || e.cameraId === cameraId)
        .slice(0, limit)
        .map(({ snapshot: _snapshot, ...row }) => row);
    },
    async latestSnapshotEvents() {
      const seen = new Set<string>();
      const out: CameraEventRow[] = [];
      for (const e of mem.cameraEvents) {
        if (!e.hasSnapshot || seen.has(e.cameraId)) continue;
        seen.add(e.cameraId);
        const { snapshot: _snapshot, ...row } = e;
        out.push(row);
      }
      return out;
    },
    async getCameraSnapshot(eventId) {
      const found = mem.cameraEvents.find((e) => e.id === eventId);
      return found?.snapshot ? { mime: "image/jpeg", data: found.snapshot } : null;
    },
    async getCameraStatuses() {
      return [...mem.cameraStatus.values()];
    },
  };
}
