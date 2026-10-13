import { randomUUID } from "node:crypto";
import type { Command, RuleAction, ZoneState } from "@alonso/shared";
import type { AgentStore } from "./db.js";
import type { GpioHandle } from "./gpio.js";
import { openGpio } from "./gpio.js";
import { log, logError } from "./logger.js";
import type { MqttBridge } from "./mqtt.js";

export class ZoneController {
  private gpios = new Map<string, GpioHandle>();
  private listeners = new Set<(zone: ZoneState) => void>();

  /** Avisa cada vez que una zona cambia de estado, venga de donde venga (horario, nube, HA). */
  onChange(listener: (zone: ZoneState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(zone: ZoneState): void {
    for (const listener of this.listeners) {
      try {
        listener(zone);
      } catch (err) {
        logError("listener de zona", err);
      }
    }
  }

  constructor(
    private store: AgentStore,
    private mqtt: MqttBridge,
    private gpioMock: boolean,
    private gpioActiveLow = true,
  ) {}

  async init(): Promise<void> {
    for (const zone of this.store.getZones()) {
      if (zone.kind === "gpio" && zone.pin !== undefined) {
        const activeLow = this.gpioActiveLow && zone.activeLow !== false;
        const handle = await openGpio(zone.pin, activeLow, this.gpioMock);
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
    const updated = this.store.getZones().find((item) => item.id === zoneId);
    if (updated) this.notify(updated);
    return updated;
  }

  async applyAction(
    zoneId: string,
    action: RuleAction,
    durationMinutes: number | undefined,
    reason: string,
  ): Promise<ZoneState | undefined> {
    if (action === "off") return this.set(zoneId, false, reason);
    const updated = await this.set(zoneId, true, reason);
    if (!updated) return undefined;
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
    return updated;
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
