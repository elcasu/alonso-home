import type { ScheduleRule } from "./types.js";

export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseHm(time: string): { hours: number; minutes: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) {
    throw new Error(`Hora inválida: ${time}`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    throw new Error(`Hora inválida: ${time}`);
  }
  return { hours, minutes };
}

export function jitterMinutesForDay(
  ruleId: string,
  key: string,
  maxJitter: number,
): number {
  if (maxJitter <= 0) return 0;
  let hash = 2166136261;
  const input = `${ruleId}:${key}`;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const span = maxJitter * 2 + 1;
  return (hash >>> 0) % span - maxJitter;
}

export function fireDateForRule(
  rule: Pick<ScheduleRule, "id" | "time" | "jitterMinutes">,
  now: Date,
): Date {
  const { hours, minutes } = parseHm(rule.time);
  const key = dayKey(now);
  const jitter = jitterMinutesForDay(rule.id, key, rule.jitterMinutes ?? 0);
  let total = hours * 60 + minutes + jitter;
  total = Math.min(23 * 60 + 59, Math.max(0, total));
  const result = new Date(now);
  result.setHours(Math.floor(total / 60), total % 60, 0, 0);
  return result;
}

export const FIRE_WINDOW_MS = 3 * 60 * 1000;

export function shouldFireRule(
  rule: ScheduleRule,
  now: Date,
  alreadyFiredToday: boolean,
): boolean {
  return ruleDecision(rule, now, alreadyFiredToday) === "due";
}

export type RuleDecision = "ignore" | "missed" | "due";

export function ruleDecision(
  rule: ScheduleRule,
  now: Date,
  alreadyFiredToday: boolean,
): RuleDecision {
  if (!rule.enabled) return "ignore";
  if (alreadyFiredToday) return "ignore";
  if (rule.days.length > 0 && !rule.days.includes(now.getDay())) return "ignore";
  const delta = now.getTime() - fireDateForRule(rule, now).getTime();
  if (delta < 0) return "ignore";
  if (delta > FIRE_WINDOW_MS) return "missed";
  return "due";
}

export function expectedZoneOn(
  zoneId: string,
  rules: ScheduleRule[],
  now: Date,
): boolean {
  const events: { t: number; on: boolean }[] = [];
  for (const rule of rules) {
    if (!rule.enabled || rule.zoneId !== zoneId) continue;
    if (rule.days.length > 0 && !rule.days.includes(now.getDay())) continue;
    const at = fireDateForRule(rule, now).getTime();
    if (at > now.getTime()) continue;
    if (rule.action === "pulse") {
      const duration = (rule.durationMinutes ?? 10) * 60_000;
      events.push({ t: at, on: true });
      events.push({ t: at + duration, on: false });
    } else {
      events.push({ t: at, on: rule.action === "on" });
    }
  }
  events.sort((a, b) => a.t - b.t || Number(a.on) - Number(b.on));
  let on = false;
  for (const event of events) {
    if (event.t <= now.getTime()) on = event.on;
  }
  return on;
}

export function newerIso(a: string, b: string): boolean {
  return Date.parse(a) > Date.parse(b);
}
