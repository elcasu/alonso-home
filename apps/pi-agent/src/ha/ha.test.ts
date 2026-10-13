import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import type { ZoneState } from "@alonso/shared";
import { startHaBridge, type HaConnectOptions, type HaMqttClient } from "./bridge.js";
import { loadHaConfig, sanitizeNodeId, type HaConfig } from "./config.js";
import {
  availabilityTopic,
  buildZoneDiscovery,
  commandTopic,
  discoveryTopic,
  isExposableZoneId,
  parseSwitchPayload,
  shouldExpose,
  stateTopic,
  zoneIdFromCommandTopic,
} from "./discovery.js";

const config: HaConfig = {
  enabled: true,
  url: "mqtt://broker:1883",
  username: "alonso",
  password: "secreta",
  nodeId: "alonso_pi",
  deviceName: "Alonso Pi",
  discoveryPrefix: "homeassistant",
  exposeEsp32: false,
};

function zone(id: string, kind: "gpio" | "esp32", on = false): ZoneState {
  return { id, name: id.toUpperCase(), kind, pin: kind === "gpio" ? 17 : undefined, on };
}

type Published = { topic: string; payload: string; retain: boolean; qos: number };

class FakeClient extends EventEmitter implements HaMqttClient {
  published: Published[] = [];
  subscribed: string[] = [];
  ended = false;

  publish(topic: string, payload: string, opts: { qos: 0 | 1 | 2; retain: boolean }, cb?: (err?: Error | null) => void) {
    this.published.push({ topic, payload, retain: opts.retain, qos: opts.qos });
    cb?.(null);
    return this;
  }
  subscribe(topics: string[], _opts: { qos: 0 | 1 | 2 }, cb?: (err: Error | null) => void) {
    this.subscribed.push(...topics);
    cb?.(null);
    return this;
  }
  end(_force?: boolean, cb?: () => void) {
    this.ended = true;
    cb?.();
    return this;
  }
  last(topic: string): Published | undefined {
    return [...this.published].reverse().find((p) => p.topic === topic);
  }
}

function setup(zones: ZoneState[], overrides: Partial<HaConfig> = {}) {
  const client = new FakeClient();
  let connectOpts: HaConnectOptions | undefined;
  const listeners = new Set<(z: ZoneState) => void>();
  const calls: { zoneId: string; on: boolean; reason: string }[] = [];
  let failNext = false;
  const controller = {
    async set(zoneId: string, on: boolean, reason: string) {
      calls.push({ zoneId, on, reason });
      if (failNext) {
        failNext = false;
        throw new Error("gpio roto");
      }
      const target = zones.find((z) => z.id === zoneId);
      if (!target) return undefined;
      target.on = on;
      for (const l of listeners) l(target);
      return target;
    },
    onChange(listener: (z: ZoneState) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const bridge = startHaBridge({
    config: { ...config, ...overrides },
    store: { getZones: () => zones },
    controller,
    connect: (_url, opts) => {
      connectOpts = opts;
      return client;
    },
  });
  return {
    client,
    bridge,
    calls,
    zones,
    connectOpts: () => connectOpts!,
    failNext: () => {
      failNext = true;
    },
    /** Cambio de estado que no viene de HA (horario, nube): el controlador avisa a los listeners. */
    change: (zoneId: string, on: boolean) => {
      const target = zones.find((z) => z.id === zoneId)!;
      target.on = on;
      for (const l of listeners) l(target);
    },
    command: (zoneId: string, payload: string) =>
      client.emit("message", commandTopic(config.nodeId, zoneId), Buffer.from(payload)),
    settle: () => new Promise((resolve) => setImmediate(resolve)),
  };
}

describe("config de Home Assistant", () => {
  it("usa valores por defecto y hereda las credenciales MQTT", () => {
    const cfg = loadHaConfig({ MQTT_URL: "mqtt://pi:1883", MQTT_USER: "u", MQTT_PASSWORD: "p" });
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.url, "mqtt://pi:1883");
    assert.equal(cfg.username, "u");
    assert.equal(cfg.password, "p");
    assert.equal(cfg.nodeId, "alonso_pi");
    assert.equal(cfg.discoveryPrefix, "homeassistant");
    assert.equal(cfg.exposeEsp32, false);
  });

  it("las variables HA_* tienen prioridad", () => {
    const cfg = loadHaConfig({
      HA_ENABLED: "1",
      MQTT_URL: "mqtt://pi:1883",
      HA_MQTT_URL: "mqtt://mac:1883",
      HA_MQTT_USER: "ha-user",
      HA_NODE_ID: "Casa Norte!",
      HA_DISCOVERY_PREFIX: "ha/",
      HA_EXPOSE_ESP32: "true",
    });
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.url, "mqtt://mac:1883");
    assert.equal(cfg.username, "ha-user");
    assert.equal(cfg.nodeId, "casa_norte_");
    assert.equal(cfg.discoveryPrefix, "ha");
    assert.equal(cfg.exposeEsp32, true);
  });

  it("normaliza el id de nodo o cae al valor por defecto", () => {
    assert.equal(sanitizeNodeId("  Pi-Living "), "pi-living");
    assert.equal(sanitizeNodeId("!!!"), "alonso_pi");
    assert.equal(sanitizeNodeId(undefined), "alonso_pi");
    assert.equal(sanitizeNodeId("x".repeat(80)).length, 32);
  });
});

describe("MQTT Discovery", () => {
  it("arma el payload de un switch con topics, disponibilidad y dispositivo", () => {
    const payload = buildZoneDiscovery(config, zone("living", "gpio")) as Record<string, any>;
    assert.equal(payload.name, "LIVING");
    assert.equal(payload.unique_id, "alonso_pi_living");
    assert.equal(payload.default_entity_id, "switch.alonso_pi_living");
    assert.equal(payload.state_topic, "alonso/alonso_pi/zone/living/state");
    assert.equal(payload.command_topic, "alonso/alonso_pi/zone/living/set");
    assert.equal(payload.availability_topic, "alonso/alonso_pi/status");
    assert.equal(payload.payload_on, "ON");
    assert.equal(payload.payload_off, "OFF");
    assert.equal(payload.state_on, "ON");
    assert.equal(payload.qos, 1);
    assert.deepEqual(payload.device.identifiers, ["alonso_alonso_pi"]);
    assert.equal(payload.device.name, "Alonso Pi");
    assert.ok(!("object_id" in payload), "object_id está en desuso en HA 2026");
  });

  it("el entity_id reemplaza guiones por guiones bajos", () => {
    const payload = buildZoneDiscovery({ ...config, nodeId: "pi-norte" }, zone("sala-estar", "gpio"));
    assert.equal(payload.default_entity_id, "switch.pi_norte_sala_estar");
    assert.equal(payload.unique_id, "pi-norte_sala-estar");
  });

  it("topics de discovery, estado y comando", () => {
    assert.equal(discoveryTopic(config, "living"), "homeassistant/switch/alonso_pi/living/config");
    assert.equal(stateTopic("n", "z"), "alonso/n/zone/z/state");
    assert.equal(availabilityTopic("n"), "alonso/n/status");
  });

  it("reconoce comandos del propio nodo y descarta el resto", () => {
    assert.equal(zoneIdFromCommandTopic("alonso_pi", "alonso/alonso_pi/zone/living/set"), "living");
    assert.equal(zoneIdFromCommandTopic("alonso_pi", "alonso/otro/zone/living/set"), null);
    assert.equal(zoneIdFromCommandTopic("alonso_pi", "alonso/alonso_pi/zone/living/state"), null);
    assert.equal(zoneIdFromCommandTopic("alonso_pi", "alonso/alonso_pi/zone//set"), null);
    assert.equal(zoneIdFromCommandTopic("alonso_pi", "alonso/alonso_pi/zone/a/b/set"), null);
  });

  it("interpreta ON y OFF sin importar mayúsculas ni espacios", () => {
    assert.equal(parseSwitchPayload("ON"), true);
    assert.equal(parseSwitchPayload(" off\n"), false);
    assert.equal(parseSwitchPayload("toggle"), null);
    assert.equal(parseSwitchPayload(""), null);
  });

  it("solo anuncia zonas GPIO salvo que se pida expresamente", () => {
    assert.equal(shouldExpose(config, zone("living", "gpio")), true);
    assert.equal(shouldExpose(config, zone("bathroom", "esp32")), false);
    assert.equal(shouldExpose({ ...config, exposeEsp32: true }, zone("bathroom", "esp32")), true);
    assert.equal(isExposableZoneId("a/b"), false);
    assert.equal(shouldExpose(config, zone("a/b", "gpio")), false);
  });
});

describe("puente Home Assistant", () => {
  it("conecta con LWT retained y credenciales", () => {
    const t = setup([zone("living", "gpio")]);
    const opts = t.connectOpts();
    assert.equal(opts.username, "alonso");
    assert.equal(opts.password, "secreta");
    assert.equal(opts.clientId, "alonso-ha-alonso_pi");
    assert.deepEqual(opts.will, {
      topic: "alonso/alonso_pi/status",
      payload: "offline",
      qos: 1,
      retain: true,
    });
  });

  it("no publica nada hasta que el broker confirma la conexión", () => {
    const t = setup([zone("living", "gpio")]);
    assert.equal(t.client.published.length, 0);
    assert.equal(t.bridge.connected(), false);
  });

  it("al conectar anuncia disponibilidad, discovery y estados (todo retained)", () => {
    const t = setup([zone("living", "gpio", true), zone("hallway", "gpio"), zone("bathroom", "esp32")]);
    t.client.emit("connect");

    assert.equal(t.bridge.connected(), true);
    assert.deepEqual(t.client.subscribed, ["alonso/alonso_pi/zone/+/set", "homeassistant/status"]);
    assert.equal(t.client.last("alonso/alonso_pi/status")?.payload, "online");
    assert.ok(t.client.published.every((p) => p.retain), "todo se publica retained");

    const living = JSON.parse(t.client.last("homeassistant/switch/alonso_pi/living/config")!.payload);
    assert.equal(living.unique_id, "alonso_pi_living");
    assert.ok(t.client.last("homeassistant/switch/alonso_pi/hallway/config"));
    assert.equal(t.client.last("alonso/alonso_pi/zone/living/state")?.payload, "ON");
    assert.equal(t.client.last("alonso/alonso_pi/zone/hallway/state")?.payload, "OFF");
    assert.equal(
      t.client.last("homeassistant/switch/alonso_pi/bathroom/config"),
      undefined,
      "la zona esp32 no se anuncia",
    );
  });

  it("publica el estado cuando una zona cambia por cualquier vía (horario, nube)", () => {
    const t = setup([zone("living", "gpio"), zone("bathroom", "esp32")]);
    t.client.emit("connect");
    t.client.published.length = 0;

    // El horario o la nube cambian la zona: el controlador avisa por onChange.
    t.change("living", true);
    const state = t.client.last("alonso/alonso_pi/zone/living/state");
    assert.equal(state?.payload, "ON");
    assert.equal(state?.retain, true);
    assert.equal(state?.qos, 1);

    t.change("living", false);
    assert.equal(t.client.last("alonso/alonso_pi/zone/living/state")?.payload, "OFF");

    t.client.published.length = 0;
    t.change("bathroom", true);
    assert.equal(t.client.published.length, 0, "las zonas no expuestas no se publican");
  });

  it("no publica cambios mientras no hay conexión con el broker", () => {
    const t = setup([zone("living", "gpio")]);
    t.change("living", true);
    assert.equal(t.client.published.length, 0);
  });

  it("un comando ON/OFF de HA llama al controlador con el motivo correcto", async () => {
    const t = setup([zone("living", "gpio")]);
    t.client.emit("connect");

    t.command("living", "ON");
    await t.settle();
    t.command("living", "OFF");
    await t.settle();

    assert.deepEqual(t.calls, [
      { zoneId: "living", on: true, reason: "home assistant" },
      { zoneId: "living", on: false, reason: "home assistant" },
    ]);
    assert.equal(t.client.last("alonso/alonso_pi/zone/living/state")?.payload, "OFF");
  });

  it("ignora payloads inválidos, zonas desconocidas y zonas no expuestas", async () => {
    const t = setup([zone("living", "gpio"), zone("bathroom", "esp32")]);
    t.client.emit("connect");

    t.command("living", "toggle");
    t.command("fantasma", "ON");
    t.command("bathroom", "ON");
    await t.settle();

    assert.deepEqual(t.calls, []);
  });

  it("si el controlador falla, vuelve a publicar el estado real", async () => {
    const t = setup([zone("living", "gpio", false)]);
    t.client.emit("connect");
    t.client.published.length = 0;

    t.failNext();
    t.command("living", "ON");
    await t.settle();

    assert.equal(t.calls.length, 1);
    assert.equal(t.client.last("alonso/alonso_pi/zone/living/state")?.payload, "OFF");
  });

  it("cuando Home Assistant reinicia (birth), vuelve a publicar todo", () => {
    const t = setup([zone("living", "gpio", true)]);
    t.client.emit("connect");
    t.client.published.length = 0;

    t.client.emit("message", "homeassistant/status", Buffer.from("offline"));
    assert.equal(t.client.published.length, 0, "offline no dispara nada");

    t.client.emit("message", "homeassistant/status", Buffer.from("online"));
    assert.ok(t.client.last("homeassistant/switch/alonso_pi/living/config"));
    assert.equal(t.client.last("alonso/alonso_pi/zone/living/state")?.payload, "ON");
    assert.equal(t.client.last("alonso/alonso_pi/status")?.payload, "online");
  });

  it("al reconectar al broker vuelve a anunciar todo", () => {
    const t = setup([zone("living", "gpio")]);
    t.client.emit("connect");
    t.client.emit("close");
    assert.equal(t.bridge.connected(), false);
    t.client.published.length = 0;

    t.client.emit("connect");
    assert.ok(t.client.last("homeassistant/switch/alonso_pi/living/config"));
  });

  it("stop() marca todo como no disponible y cierra el cliente", async () => {
    const t = setup([zone("living", "gpio")]);
    t.client.emit("connect");

    await t.bridge.stop();

    assert.equal(t.client.last("alonso/alonso_pi/status")?.payload, "offline");
    assert.equal(t.client.last("alonso/alonso_pi/status")?.retain, true);
    assert.equal(t.client.ended, true);
    assert.equal(t.bridge.connected(), false);
  });

  it("tras stop() los cambios del controlador ya no publican", async () => {
    const zones = [zone("living", "gpio")];
    const t = setup(zones);
    t.client.emit("connect");
    await t.bridge.stop();
    t.client.published.length = 0;

    t.command("living", "ON");
    await t.settle();

    assert.equal(t.client.published.length, 0);
  });
});
