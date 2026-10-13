import mqtt from "mqtt";
import type { ZoneState } from "@alonso/shared";
import { log, logError } from "../logger.js";
import type { HaConfig } from "./config.js";
import {
  PAYLOAD_OFF,
  PAYLOAD_OFFLINE,
  PAYLOAD_ON,
  PAYLOAD_ONLINE,
  availabilityTopic,
  birthTopic,
  buildZoneDiscovery,
  commandFilter,
  discoveryTopic,
  parseSwitchPayload,
  shouldExpose,
  stateTopic,
  zoneIdFromCommandTopic,
} from "./discovery.js";

type PublishOpts = { qos: 0 | 1 | 2; retain: boolean };

/** Lo mínimo que usamos del cliente MQTT (permite un doble en los tests). */
export type HaMqttClient = {
  publish(topic: string, payload: string, opts: PublishOpts, cb?: (err?: Error | null) => void): unknown;
  subscribe(topics: string[], opts: { qos: 0 | 1 | 2 }, cb?: (err: Error | null) => void): unknown;
  on(event: "connect" | "close" | "error" | "message", listener: (...args: any[]) => void): unknown;
  end(force?: boolean, cb?: () => void): unknown;
};

export type HaConnectOptions = {
  clientId: string;
  username: string;
  password: string;
  clean: boolean;
  reconnectPeriod: number;
  connectTimeout: number;
  will: { topic: string; payload: string; qos: 0 | 1 | 2; retain: boolean };
};

export type HaBridgeDeps = {
  config: HaConfig;
  store: { getZones(): ZoneState[] };
  controller: {
    set(zoneId: string, on: boolean, reason: string): Promise<ZoneState | undefined>;
    onChange(listener: (zone: ZoneState) => void): () => void;
  };
  /** Inyectable para tests. */
  connect?: (url: string, opts: HaConnectOptions) => HaMqttClient;
};

export type HaBridge = {
  connected(): boolean;
  /** Vuelve a publicar discovery, disponibilidad y estados (idempotente). */
  publishAll(): void;
  stop(): Promise<void>;
};

const RETAINED: PublishOpts = { qos: 1, retain: true };

export function startHaBridge(deps: HaBridgeDeps): HaBridge {
  const { config, store, controller } = deps;
  const node = config.nodeId;
  const connect =
    deps.connect ??
    ((url: string, opts: HaConnectOptions) => mqtt.connect(url, opts) as unknown as HaMqttClient);

  const client = connect(config.url, {
    clientId: `alonso-ha-${node}`,
    username: config.username,
    password: config.password,
    clean: true,
    reconnectPeriod: 4000,
    connectTimeout: 8000,
    // Si la Pi se cae sin avisar, el broker marca todas las entidades como no disponibles.
    will: { topic: availabilityTopic(node), payload: PAYLOAD_OFFLINE, qos: 1, retain: true },
  });

  let up = false;
  let stopped = false;

  function publish(topic: string, payload: string, opts: PublishOpts = RETAINED): void {
    client.publish(topic, payload, opts, (err) => {
      if (err && !stopped) logError(`HA: no pude publicar ${topic}`, err);
    });
  }

  function exposedZones(): ZoneState[] {
    return store.getZones().filter((zone) => shouldExpose(config, zone));
  }

  function publishState(zone: ZoneState): void {
    publish(stateTopic(node, zone.id), zone.on ? PAYLOAD_ON : PAYLOAD_OFF);
  }

  function publishAll(): void {
    if (!up) return;
    publish(availabilityTopic(node), PAYLOAD_ONLINE);
    for (const zone of exposedZones()) {
      publish(discoveryTopic(config, zone.id), JSON.stringify(buildZoneDiscovery(config, zone)));
      publishState(zone);
    }
  }

  async function handleCommand(zoneId: string, payload: string): Promise<void> {
    const zone = exposedZones().find((item) => item.id === zoneId);
    if (!zone) {
      log(`HA: comando para zona desconocida o no expuesta: ${zoneId}`);
      return;
    }
    const on = parseSwitchPayload(payload);
    if (on === null) {
      log(`HA: payload inválido para ${zoneId}: "${payload}"`);
      return;
    }
    try {
      await controller.set(zoneId, on, "home assistant");
    } catch (err) {
      logError(`HA: no pude aplicar el comando a ${zoneId}`, err);
      // Que HA vuelva a mostrar el estado real.
      const current = store.getZones().find((item) => item.id === zoneId);
      if (current) publishState(current);
    }
  }

  client.on("connect", () => {
    up = true;
    log(`HA: MQTT conectado ${config.url} (nodo ${node})`);
    client.subscribe([commandFilter(node), birthTopic(config.discoveryPrefix)], { qos: 1 }, (err) => {
      if (err) logError("HA: no pude suscribirme", err);
    });
    publishAll();
  });
  client.on("close", () => {
    up = false;
  });
  client.on("error", (err: Error) => {
    if (!stopped) logError("HA: MQTT", err);
  });
  client.on("message", (topic: string, payload: Buffer | string) => {
    const text = payload.toString();
    if (topic === birthTopic(config.discoveryPrefix)) {
      // Home Assistant (re)arrancó: vuelve a mostrar todo sin esperar al próximo cambio.
      if (text === PAYLOAD_ONLINE) publishAll();
      return;
    }
    const zoneId = zoneIdFromCommandTopic(node, topic);
    if (zoneId) void handleCommand(zoneId, text);
  });

  const unsubscribe = controller.onChange((zone) => {
    if (up && shouldExpose(config, zone)) publishState(zone);
  });

  return {
    connected: () => up,
    publishAll,
    async stop() {
      unsubscribe();
      if (up) {
        await new Promise<void>((resolve) => {
          client.publish(availabilityTopic(node), PAYLOAD_OFFLINE, RETAINED, () => resolve());
        });
      }
      stopped = true;
      up = false;
      await new Promise<void>((resolve) => {
        client.end(false, () => resolve());
      });
    },
  };
}
