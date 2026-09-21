import { newerIso, type SyncRequest, type SyncResponse } from "@alonso/shared";
import type { AgentConfig } from "./config.js";
import type { ZoneController } from "./controller.js";
import type { AgentStore } from "./db.js";
import { log, logError } from "./logger.js";
import type { MqttBridge } from "./mqtt.js";

export function createSyncLoop(
  config: AgentConfig,
  store: AgentStore,
  controller: ZoneController,
  mqtt: MqttBridge,
): { start(): void; stop(): void; once(): Promise<void> } {
  let timer: NodeJS.Timeout | undefined;

  async function once(): Promise<void> {
    if (!config.cloudUrl || !config.deviceToken) return;
    const zones = store.getZones();
    const schedule = store.getSchedule();
    const body: SyncRequest = {
      heartbeat: {
        ts: new Date().toISOString(),
        zones: zones.map((zone) => ({ id: zone.id, on: zone.on })),
        scheduleUpdatedAt: schedule.updatedAt,
        mqttConnected: mqtt.connected,
      },
      schedule,
      zones,
    };
    try {
      const res = await fetch(`${config.cloudUrl}/api/device/sync`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.deviceToken}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) {
        throw new Error(`sync HTTP ${res.status}`);
      }
      const payload = (await res.json()) as SyncResponse;
      if (payload.schedule && newerIso(payload.schedule.updatedAt, schedule.updatedAt)) {
        store.setSchedule(payload.schedule);
        log("Agenda actualizada desde la nube");
      }
      for (const command of payload.commands ?? []) {
        try {
          await controller.applyCommand(command);
        } catch (err) {
          logError("comando remoto", err);
        }
      }
    } catch (err) {
      logError("sync nube (se reintenta; la agenda local sigue)", err);
    }
  }

  return {
    once,
    start() {
      void once();
      timer = setInterval(() => {
        void once();
      }, config.syncIntervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
