import {
  COMMAND_TTL_MS,
  DEFAULT_ZONES,
  defaultSchedule,
  type Command,
  type Schedule,
  type ZoneState,
} from "@alonso/shared";
import type { DataStore, HeartbeatRow, LogEvent } from "./store";

type MemoryState = {
  version: number;
  zones: ZoneState[];
  schedule: Schedule;
  commands: Command[];
  heartbeat: HeartbeatRow | null;
  events: LogEvent[];
};

const SEED_VERSION = 2;

const globalForStore = globalThis as typeof globalThis & { __alonsoMemory?: MemoryState };

function seed(): MemoryState {
  return {
    version: SEED_VERSION,
    zones: DEFAULT_ZONES.map((zone) => ({ ...zone, on: false })),
    schedule: defaultSchedule(),
    commands: [],
    heartbeat: null,
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
  };
}
