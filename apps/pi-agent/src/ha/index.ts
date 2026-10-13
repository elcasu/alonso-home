import type { AgentConfig } from "../config.js";
import type { ZoneController } from "../controller.js";
import type { AgentStore } from "../db.js";
import { log, logError } from "../logger.js";
import { startHaBridge, type HaBridge } from "./bridge.js";

export type { HaBridge } from "./bridge.js";

/**
 * Arranca la integración con Home Assistant (MQTT Discovery).
 * Nunca tumba el agente: ante cualquier problema lo registra y devuelve `null`.
 */
export function startHomeAssistant(
  config: AgentConfig,
  store: AgentStore,
  controller: ZoneController,
): HaBridge | null {
  if (!config.ha.enabled) {
    log("Home Assistant: desactivado (HA_ENABLED=0)");
    return null;
  }
  try {
    return startHaBridge({ config: config.ha, store, controller });
  } catch (err) {
    logError("Home Assistant desactivado", err);
    return null;
  }
}
