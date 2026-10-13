import type { ZoneState } from "@alonso/shared";
import type { HaConfig } from "./config.js";

/**
 * Convención de topics (la misma que usará el firmware de los ESP32):
 *
 *   alonso/<nodo>/status                 online | offline   (retained, LWT)
 *   alonso/<nodo>/zone/<zona>/state      ON | OFF           (retained)
 *   alonso/<nodo>/zone/<zona>/set        ON | OFF           (comando desde Home Assistant)
 *   <prefijo>/switch/<nodo>/<zona>/config                   (MQTT Discovery, retained)
 */

export const PAYLOAD_ON = "ON";
export const PAYLOAD_OFF = "OFF";
export const PAYLOAD_ONLINE = "online";
export const PAYLOAD_OFFLINE = "offline";

/** Home Assistant publica `online` acá cuando arranca o reconecta al broker. */
export function birthTopic(prefix: string): string {
  return `${prefix}/status`;
}

export function availabilityTopic(nodeId: string): string {
  return `alonso/${nodeId}/status`;
}

export function stateTopic(nodeId: string, zoneId: string): string {
  return `alonso/${nodeId}/zone/${zoneId}/state`;
}

export function commandTopic(nodeId: string, zoneId: string): string {
  return `alonso/${nodeId}/zone/${zoneId}/set`;
}

export function commandFilter(nodeId: string): string {
  return `alonso/${nodeId}/zone/+/set`;
}

/** Devuelve el id de zona si el topic es un comando de este nodo. */
export function zoneIdFromCommandTopic(nodeId: string, topic: string): string | null {
  const prefix = `alonso/${nodeId}/zone/`;
  if (!topic.startsWith(prefix) || !topic.endsWith("/set")) return null;
  const zoneId = topic.slice(prefix.length, -"/set".length);
  return zoneId.length > 0 && !zoneId.includes("/") ? zoneId : null;
}

export function discoveryTopic(config: HaConfig, zoneId: string): string {
  return `${config.discoveryPrefix}/switch/${config.nodeId}/${zoneId}/config`;
}

/** Ids de zona que se pueden poner en un topic y en un object_id de HA. */
export function isExposableZoneId(zoneId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(zoneId);
}

/** ¿Esta zona la anuncia la Pi? Las `esp32` las anuncia el propio ESP salvo que se pida lo contrario. */
export function shouldExpose(config: HaConfig, zone: ZoneState): boolean {
  if (!isExposableZoneId(zone.id)) return false;
  return zone.kind === "gpio" || config.exposeEsp32;
}

function entitySlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

export const AGENT_VERSION = "0.1.0";

/** Payload de MQTT Discovery de un `switch` por zona. */
export function buildZoneDiscovery(config: HaConfig, zone: ZoneState): Record<string, unknown> {
  const node = config.nodeId;
  return {
    name: zone.name,
    unique_id: `${node}_${zone.id}`,
    // HA 2026: `default_entity_id` reemplaza a `object_id`.
    default_entity_id: `switch.${entitySlug(node)}_${entitySlug(zone.id)}`,
    state_topic: stateTopic(node, zone.id),
    command_topic: commandTopic(node, zone.id),
    availability_topic: availabilityTopic(node),
    payload_available: PAYLOAD_ONLINE,
    payload_not_available: PAYLOAD_OFFLINE,
    payload_on: PAYLOAD_ON,
    payload_off: PAYLOAD_OFF,
    state_on: PAYLOAD_ON,
    state_off: PAYLOAD_OFF,
    qos: 1,
    device: {
      identifiers: [`alonso_${node}`],
      name: config.deviceName,
      manufacturer: "alonso-home",
      model: "pi-agent",
      sw_version: AGENT_VERSION,
    },
    origin: { name: "alonso-home pi-agent", sw_version: AGENT_VERSION },
  };
}

export function parseSwitchPayload(payload: string): boolean | null {
  const value = payload.trim().toUpperCase();
  if (value === PAYLOAD_ON) return true;
  if (value === PAYLOAD_OFF) return false;
  return null;
}
