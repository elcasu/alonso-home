import { dayKey, expectedZoneOn, fireDateForRule, ruleDecision } from "@alonso/shared";
import type { AgentStore } from "./db.js";
import type { ZoneController } from "./controller.js";
import { logError } from "./logger.js";

export function createScheduler(
  store: AgentStore,
  controller: ZoneController,
  intervalMs: number,
): { start(): void; stop(): void; tick(now?: Date): Promise<void>; reconcile(now?: Date): Promise<void> } {
  let timer: NodeJS.Timeout | undefined;

  async function reconcile(now = new Date()): Promise<void> {
    const schedule = store.getSchedule();
    const key = dayKey(now);
    for (const rule of schedule.rules) {
      const decision = ruleDecision(rule, now, store.getFired(rule.id, key));
      if (decision === "missed" || decision === "due") {
        store.markFired(rule.id, key);
      }
      if (rule.action === "pulse" && rule.enabled) {
        if (rule.days.length === 0 || rule.days.includes(now.getDay())) {
          const start = fireDateForRule(rule, now).getTime();
          const end = start + (rule.durationMinutes ?? 10) * 60_000;
          if (start <= now.getTime() && now.getTime() < end) {
            store.addPending({
              id: `pulse-${rule.id}-${key}`,
              zoneId: rule.zoneId,
              action: "off",
              executeAt: new Date(end).toISOString(),
            });
          }
        }
      }
    }
    for (const zone of store.getZones()) {
      const on = expectedZoneOn(zone.id, schedule.rules, now);
      if (zone.on === on) continue;
      try {
        await controller.set(zone.id, on, "reconcile");
      } catch (err) {
        logError(`reconcile ${zone.id}`, err);
      }
    }
  }

  async function tick(now = new Date()): Promise<void> {
    const schedule = store.getSchedule();
    const key = dayKey(now);
    for (const rule of schedule.rules) {
      const decision = ruleDecision(rule, now, store.getFired(rule.id, key));
      if (decision === "ignore") continue;
      store.markFired(rule.id, key);
      if (decision === "missed") continue;
      try {
        await controller.applyAction(
          rule.zoneId,
          rule.action,
          rule.durationMinutes,
          `agenda ${rule.id}`,
        );
      } catch (err) {
        logError(`regla ${rule.id}`, err);
      }
    }
    for (const pending of store.duePending(now.toISOString())) {
      try {
        await controller.set(pending.zoneId, false, "fin pulse");
      } catch (err) {
        logError(`pending ${pending.id}`, err);
      }
      store.removePending(pending.id);
    }
  }

  return {
    tick,
    reconcile,
    start() {
      void (async () => {
        await reconcile();
        await tick();
      })();
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
