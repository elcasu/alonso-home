import { randomUUID } from "node:crypto";
import type { Command, RuleAction, ZoneState } from "@alonso/shared";
import type { AgentStore } from "./db.js";
import type { GpioHandle } from "./gpio.js";
import { openGpio } from "./gpio.js";
import { log, logError } from "./logger.js";
import type { MqttBridge } from "./mqtt.js";

export class ZoneController {
  private gpios = new Map<string, GpioHandle>();

  constructor(
    private store: AgentStore,
    private mqtt: MqttBridge,
    private gpioMock: boolean,
  ) {}

  async init(): Promise<void> {
    for (const zone of this.store.getZones()) {
      if (zone.kind === "gpio" && zone.pin !== undefined) {
        const handle = await openGpio(zone.pin, zone.activeLow !== false, this.gpioMock);
        this.gpios.set(zone.id, handle);
      }
    }
    for (const zone of this.store.getZones()) {
      await this.set(zone.id, false, "arranque");
    }
  }

  async set(zoneId: string, on: boolean, reason: string): Promise<ZoneState | undefined> {
    const zone = this.store.getZones().find((item) => item.id === zoneId);
    if (!zone) {
      log(`Zona desconocida: ${zoneId}`);
      return undefined;
    }
    try {
      if (zone.kind === "gpio") {
        const gpio = this.gpios.get(zone.id);
        if (!gpio) throw new Error(`GPIO no abierto para ${zone.id}`);
        await gpio.write(on);
      } else {
        if (!zone.deviceId || zone.channel === undefined) {
          throw new Error(`ESP32 incompleto en ${zone.id}`);
        }
        await this.mqtt.setChannel(zone.deviceId, zone.channel, on);
      }
      this.store.setZoneOn(zone.id, on);
      this.store.addEvent(`${reason}: ${zone.name} ${on ? "ON" : "OFF"}`, zone.id);
      log(`${zone.name} -> ${on ? "ON" : "OFF"} (${reason})`);
    } catch (err) {
      logError(`No pude cambiar ${zone.id}`, err);
      throw err;
    }
    return this.store.getZones().find((item) => item.id === zoneId);
  }

  async applyAction(
    zoneId: string,
    action: RuleAction,
    durationMinutes: number | undefined,
    reason: string,
  ): Promise<void> {
    if (action === "off") {
      await this.set(zoneId, false, reason);
      return;
    }
    await this.set(zoneId, true, reason);
    if (action === "pulse") {
      const minutes = durationMinutes && durationMinutes > 0 ? durationMinutes : 10;
      this.store.addPending({
        id: randomUUID(),
        zoneId,
        action: "off",
        executeAt: new Date(Date.now() + minutes * 60_000).toISOString(),
      });
      this.store.addEvent(`Pulse ${minutes} min en ${zoneId}`, zoneId);
    }
  }

  async applyCommand(command: Command): Promise<void> {
    await this.applyAction(
      command.zoneId,
      command.action,
      command.durationMinutes,
      `comando ${command.id.slice(0, 8)}`,
    );
  }

  async close(): Promise<void> {
    for (const gpio of this.gpios.values()) {
      await gpio.close().catch((err) => logError("gpio close", err));
    }
    this.gpios.clear();
  }
}
