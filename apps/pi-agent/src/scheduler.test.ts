import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  expectedZoneOn,
  fireDateForRule,
  jitterMinutesForDay,
  shouldFireRule,
  type ScheduleRule,
} from "@alonso/shared";
import { createScheduler } from "./scheduler.js";
import type { AgentStore, PendingAction } from "./db.js";
import type { ZoneController } from "./controller.js";

function rule(partial: Partial<ScheduleRule> & Pick<ScheduleRule, "id" | "time">): ScheduleRule {
  return {
    zoneId: "living",
    action: "on",
    days: [0, 1, 2, 3, 4, 5, 6],
    enabled: true,
    jitterMinutes: 0,
    ...partial,
  };
}

describe("jitter", () => {
  it("es estable para el mismo día y regla", () => {
    const a = jitterMinutesForDay("living-on", "2026-09-17", 8);
    const b = jitterMinutesForDay("living-on", "2026-09-17", 8);
    assert.equal(a, b);
    assert.ok(a >= -8 && a <= 8);
  });

  it("cambia entre días", () => {
    const values = new Set(
      ["2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"].map((d) =>
        jitterMinutesForDay("living-on", d, 12),
      ),
    );
    assert.ok(values.size > 1);
  });
});

describe("shouldFireRule", () => {
  it("no dispara antes de la hora", () => {
    const now = new Date("2026-09-17T17:59:00");
    assert.equal(shouldFireRule(rule({ id: "x", time: "18:00" }), now, false), false);
  });

  it("dispara a la hora si no se ejecutó hoy", () => {
    const now = new Date("2026-09-17T18:00:00");
    assert.equal(shouldFireRule(rule({ id: "x", time: "18:00" }), now, false), true);
  });

  it("no dispara dos veces el mismo día", () => {
    const now = new Date("2026-09-17T18:05:00");
    assert.equal(shouldFireRule(rule({ id: "x", time: "18:00" }), now, true), false);
  });

  it("respeta el día de la semana", () => {
    const thursday = new Date("2026-09-17T18:05:00");
    assert.equal(thursday.getDay(), 4);
    assert.equal(
      shouldFireRule(rule({ id: "x", time: "18:00", days: [0, 6] }), thursday, false),
      false,
    );
  });

  it("clamp del jitter queda en el mismo día", () => {
    const now = new Date("2026-09-17T00:10:00");
    const fire = fireDateForRule({ id: "edge", time: "00:05", jitterMinutes: 30 }, now);
    assert.equal(fire.getDate(), 17);
  });

  it("no recupera reglas de hace más de 3 minutos", () => {
    const now = new Date("2026-09-17T18:10:00");
    assert.equal(shouldFireRule(rule({ id: "x", time: "18:00" }), now, false), false);
  });
});

describe("expectedZoneOn", () => {
  const rules: ScheduleRule[] = [
    rule({ id: "on", zoneId: "living", action: "on", time: "18:00" }),
    rule({ id: "off", zoneId: "living", action: "off", time: "23:30" }),
    rule({
      id: "pulse",
      zoneId: "bathroom",
      action: "pulse",
      time: "20:30",
      durationMinutes: 10,
    }),
  ];

  it("living on entre 18:00 y 23:30", () => {
    assert.equal(expectedZoneOn("living", rules, new Date("2026-09-17T21:00:00")), true);
    assert.equal(expectedZoneOn("living", rules, new Date("2026-09-17T23:45:00")), false);
    assert.equal(expectedZoneOn("living", rules, new Date("2026-09-17T17:00:00")), false);
  });

  it("pulse solo durante la duración", () => {
    assert.equal(expectedZoneOn("bathroom", rules, new Date("2026-09-17T20:35:00")), true);
    assert.equal(expectedZoneOn("bathroom", rules, new Date("2026-09-17T20:45:00")), false);
  });
});

describe("scheduler pulse", () => {
  it("dispara el pulse de la agenda una vez", async () => {
    const actions: string[] = [];
    const store = {
      getSchedule: () => ({
        updatedAt: new Date().toISOString(),
        rules: [
          rule({
            id: "bathroom-pulse",
            zoneId: "bathroom",
            action: "pulse",
            time: "20:30",
            durationMinutes: 10,
          }),
        ],
      }),
      getFired: () => false,
      markFired() {},
      addPending(_action: PendingAction) {},
      duePending: () => [],
      removePending() {},
    } as unknown as AgentStore;
    const controller = {
      async applyAction(zoneId: string, action: string) {
        actions.push(`${zoneId}:${action}`);
      },
      async set() {},
    } as unknown as ZoneController;
    const scheduler = createScheduler(store, controller, 1000);
    await scheduler.tick(new Date("2026-09-17T20:31:00"));
    assert.deepEqual(actions, ["bathroom:pulse"]);
  });
});
