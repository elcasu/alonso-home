import {
  COMMAND_TTL_MS,
  HEARTBEAT_STALE_MS,
  defaultSchedule,
  DEFAULT_ZONES,
  newerIso,
  type Command,
  type RuleAction,
  type Schedule,
  type SyncRequest,
  type SyncResponse,
  type ZoneState,
} from "@alonso/shared";
import { getMemoryStore } from "./memory";
import { getPostgresStore } from "./postgres";

export type LogEvent = {
  ts: string;
  message: string;
  zoneId: string | null;
};

export type HeartbeatRow = {
  lastSeen: string;
  mqttConnected: boolean | null;
};

export type AppStatus = {
  online: boolean;
  lastSeen: string | null;
  mqttConnected: boolean | null;
  usingMemory: boolean;
  zones: ZoneState[];
  schedule: Schedule;
  events: LogEvent[];
};

export type DataStore = {
  usingMemory: boolean;
  getZones(): Promise<ZoneState[]>;
  setZoneOn(id: string, on: boolean): Promise<void>;
  replaceZones(zones: ZoneState[]): Promise<void>;
  getSchedule(): Promise<Schedule>;
  setSchedule(schedule: Schedule): Promise<void>;
  enqueueCommand(command: Omit<Command, "createdAt" | "expiresAt"> & { durationMinutes?: number }): Promise<Command>;
  takeCommands(): Promise<Command[]>;
  setHeartbeat(ts: string, mqttConnected?: boolean): Promise<void>;
  getHeartbeat(): Promise<HeartbeatRow | null>;
  addEvent(message: string, zoneId?: string | null): Promise<void>;
  recentEvents(limit?: number): Promise<LogEvent[]>;
};

export async function getStore(): Promise<DataStore> {
  if (process.env.DATABASE_URL) {
    return getPostgresStore();
  }
  return getMemoryStore();
}

export function isOnline(lastSeen: string | null, now = Date.now()): boolean {
  if (!lastSeen) return false;
  return now - Date.parse(lastSeen) <= HEARTBEAT_STALE_MS;
}

export async function readStatus(): Promise<AppStatus> {
  const store = await getStore();
  const [zones, schedule, heartbeat, events] = await Promise.all([
    store.getZones(),
    store.getSchedule(),
    store.getHeartbeat(),
    store.recentEvents(30),
  ]);
  const lastSeen = heartbeat?.lastSeen ?? null;
  return {
    online: isOnline(lastSeen),
    lastSeen,
    mqttConnected: heartbeat?.mqttConnected ?? null,
    usingMemory: store.usingMemory,
    zones,
    schedule,
    events,
  };
}

export async function queueCommand(
  zoneId: string,
  action: RuleAction,
  durationMinutes?: number,
): Promise<Command> {
  const store = await getStore();
  const command = await store.enqueueCommand({
    id: crypto.randomUUID(),
    zoneId,
    action,
    durationMinutes,
  });
  await store.addEvent(`Comando ${action} → ${zoneId}`, zoneId);
  return command;
}

export async function saveSchedule(schedule: Schedule): Promise<Schedule> {
  const store = await getStore();
  const next: Schedule = { ...schedule, updatedAt: new Date().toISOString() };
  await store.setSchedule(next);
  await store.addEvent("Agenda actualizada");
  return next;
}

export async function handleDeviceSync(body: SyncRequest): Promise<SyncResponse> {
  const store = await getStore();
  await store.replaceZones(body.zones);
  await store.setHeartbeat(body.heartbeat.ts, body.heartbeat.mqttConnected);
  const cloud = await store.getSchedule();
  let outgoing: Schedule | undefined;
  if (newerIso(cloud.updatedAt, body.schedule.updatedAt)) {
    outgoing = cloud;
  } else if (newerIso(body.schedule.updatedAt, cloud.updatedAt)) {
    await store.setSchedule(body.schedule);
  }
  const commands = await store.takeCommands();
  return { commands, schedule: outgoing };
}

export function commandTtlMs(): number {
  return COMMAND_TTL_MS;
}

export { defaultSchedule, DEFAULT_ZONES };
