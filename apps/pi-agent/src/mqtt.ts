import mqtt from "mqtt";
import { log, logError } from "./logger.js";

export type MqttBridge = {
  connected: boolean;
  setChannel(deviceId: string, channel: number, on: boolean): Promise<void>;
  close(): Promise<void>;
};

export function connectMqtt(opts: {
  enabled: boolean;
  url: string;
  username: string;
  password: string;
}): MqttBridge {
  if (!opts.enabled) {
    return {
      connected: false,
      async setChannel(deviceId, channel, on) {
        log(`MQTT disabled: ${deviceId} ch${channel} -> ${on ? "ON" : "OFF"}`);
      },
      async close() {},
    };
  }

  const client = mqtt.connect(opts.url, {
    username: opts.username,
    password: opts.password,
    reconnectPeriod: 4000,
    connectTimeout: 8000,
    clientId: `alonso-pi-${Math.random().toString(16).slice(2, 8)}`,
  });

  const bridge: MqttBridge = {
    connected: false,
    async setChannel(deviceId, channel, on) {
      const topic = `home/${deviceId}/set`;
      const payload = JSON.stringify({ channel, on });
      await new Promise<void>((resolve, reject) => {
        client.publish(topic, payload, { qos: 1, retain: false }, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      log(`MQTT ${topic} ${payload}`);
    },
    async close() {
      await new Promise<void>((resolve) => {
        client.end(false, {}, () => resolve());
      });
    },
  };

  client.on("connect", () => {
    bridge.connected = true;
    log(`MQTT conectado ${opts.url}`);
  });
  client.on("reconnect", () => {
    bridge.connected = false;
  });
  client.on("close", () => {
    bridge.connected = false;
  });
  client.on("error", (err) => {
    bridge.connected = false;
    logError("MQTT", err);
  });

  return bridge;
}
