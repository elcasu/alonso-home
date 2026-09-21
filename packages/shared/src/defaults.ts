import { ALL_DAYS, type Schedule, type ScheduleRule, type Zone } from "./types.js";

export const DEFAULT_ZONES: Zone[] = [
  { id: "living", name: "Living", kind: "gpio", pin: 17, activeLow: true },
  { id: "hallway", name: "Hallway", kind: "gpio", pin: 27, activeLow: true },
  { id: "bedroom", name: "Bedroom", kind: "gpio", pin: 22, activeLow: true },
  {
    id: "bathroom",
    name: "Bathroom",
    kind: "esp32",
    deviceId: "esp-bathroom",
    channel: 1,
    activeLow: true,
  },
];

export const DEFAULT_RULES: ScheduleRule[] = [
  {
    id: "living-on",
    zoneId: "living",
    action: "on",
    time: "18:00",
    days: ALL_DAYS,
    jitterMinutes: 8,
    enabled: true,
  },
  {
    id: "bathroom-pulse-evening",
    zoneId: "bathroom",
    action: "pulse",
    time: "20:30",
    days: ALL_DAYS,
    durationMinutes: 10,
    jitterMinutes: 12,
    enabled: true,
  },
  {
    id: "hallway-on",
    zoneId: "hallway",
    action: "on",
    time: "21:00",
    days: ALL_DAYS,
    jitterMinutes: 6,
    enabled: true,
  },
  {
    id: "bedroom-on",
    zoneId: "bedroom",
    action: "on",
    time: "21:15",
    days: ALL_DAYS,
    jitterMinutes: 10,
    enabled: true,
  },
  {
    id: "bathroom-pulse-night",
    zoneId: "bathroom",
    action: "pulse",
    time: "23:10",
    days: ALL_DAYS,
    durationMinutes: 10,
    jitterMinutes: 15,
    enabled: true,
  },
  {
    id: "living-off",
    zoneId: "living",
    action: "off",
    time: "23:30",
    days: ALL_DAYS,
    jitterMinutes: 8,
    enabled: true,
  },
  {
    id: "hallway-off",
    zoneId: "hallway",
    action: "off",
    time: "23:45",
    days: ALL_DAYS,
    jitterMinutes: 5,
    enabled: true,
  },
  {
    id: "bedroom-off",
    zoneId: "bedroom",
    action: "off",
    time: "00:20",
    days: ALL_DAYS,
    jitterMinutes: 8,
    enabled: true,
  },
];

/** Spanish ids from the first seed → ASCII English. */
export const ZONE_ID_MIGRATION: Record<string, string> = {
  bano: "bathroom",
  pasillo: "hallway",
  habitacion: "bedroom",
};

export const RULE_ID_MIGRATION: Record<string, string> = {
  "bano-pulse-tarde": "bathroom-pulse-evening",
  "bano-pulse-noche": "bathroom-pulse-night",
  "pasillo-on": "hallway-on",
  "pasillo-off": "hallway-off",
  "habitacion-on": "bedroom-on",
  "habitacion-off": "bedroom-off",
};

export function migrateScheduleIds(schedule: Schedule): Schedule {
  return {
    ...schedule,
    rules: schedule.rules.map((rule) => ({
      ...rule,
      id: RULE_ID_MIGRATION[rule.id] ?? rule.id,
      zoneId: ZONE_ID_MIGRATION[rule.zoneId] ?? rule.zoneId,
    })),
  };
}

export function defaultSchedule(now = new Date()): Schedule {
  return {
    updatedAt: now.toISOString(),
    rules: DEFAULT_RULES,
  };
}
