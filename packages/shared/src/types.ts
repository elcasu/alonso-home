export type ZoneKind = "gpio" | "esp32";
export type RuleAction = "on" | "off" | "pulse";

export type Zone = {
  id: string;
  name: string;
  kind: ZoneKind;
  pin?: number;
  deviceId?: string;
  channel?: number;
  activeLow?: boolean;
};

export type ZoneState = Zone & { on: boolean };

export type ScheduleRule = {
  id: string;
  zoneId: string;
  action: RuleAction;
  time: string;
  days: number[];
  durationMinutes?: number;
  jitterMinutes?: number;
  enabled: boolean;
};

export type Schedule = {
  updatedAt: string;
  rules: ScheduleRule[];
};

export type Command = {
  id: string;
  zoneId: string;
  action: RuleAction;
  durationMinutes?: number;
  createdAt: string;
  expiresAt: string;
};

export type Heartbeat = {
  ts: string;
  zones: { id: string; on: boolean }[];
  scheduleUpdatedAt: string;
  mqttConnected?: boolean;
};

export type SyncRequest = {
  heartbeat: Heartbeat;
  schedule: Schedule;
  zones: ZoneState[];
};

export type SyncResponse = {
  commands: Command[];
  schedule?: Schedule;
};

export const COMMAND_TTL_MS = 2 * 60 * 1000;
export const HEARTBEAT_STALE_MS = 60 * 1000;
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
