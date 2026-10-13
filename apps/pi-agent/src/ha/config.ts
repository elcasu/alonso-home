export type HaConfig = {
  enabled: boolean;
  /** Broker al que se conecta el módulo (el mismo que lee Home Assistant). */
  url: string;
  username: string;
  password: string;
  /** Identifica a esta Pi en los topics y en el id único de cada entidad. */
  nodeId: string;
  /** Nombre del dispositivo que ve el usuario en Home Assistant. */
  deviceName: string;
  discoveryPrefix: string;
  /** Las zonas `esp32` normalmente las anuncia el propio ESP; solo activar con firmware viejo. */
  exposeEsp32: boolean;
};

const NODE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** Topics y ids de MQTT Discovery solo admiten [a-zA-Z0-9_-]; normalizamos a minúsculas. */
export function sanitizeNodeId(raw: string | undefined): string {
  const cleaned = (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 32);
  return NODE_ID_RE.test(cleaned) ? cleaned : "alonso_pi";
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

export function loadHaConfig(env: NodeJS.ProcessEnv): HaConfig {
  return {
    enabled: flag(env.HA_ENABLED, false),
    url: env.HA_MQTT_URL ?? env.MQTT_URL ?? "mqtt://127.0.0.1:1883",
    username: env.HA_MQTT_USER ?? env.MQTT_USER ?? "alonso",
    password: env.HA_MQTT_PASSWORD ?? env.MQTT_PASSWORD ?? "alonso",
    nodeId: sanitizeNodeId(env.HA_NODE_ID),
    deviceName: env.HA_DEVICE_NAME?.trim() || "Alonso Pi",
    discoveryPrefix: (env.HA_DISCOVERY_PREFIX ?? "homeassistant").replace(/\/+$/, ""),
    exposeEsp32: flag(env.HA_EXPOSE_ESP32, false),
  };
}
