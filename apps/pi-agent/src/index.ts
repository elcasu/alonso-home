import { loadConfig } from "./config.js";
import { ZoneController } from "./controller.js";
import { openStore } from "./db.js";
import { startLocalApi } from "./api.js";
import { startCameras } from "./cameras/index.js";
import { startHomeAssistant } from "./ha/index.js";
import { log, logError } from "./logger.js";
import { connectMqtt } from "./mqtt.js";
import { notifyReady, notifyWatchdog } from "./notify.js";
import { createScheduler } from "./scheduler.js";
import { createSyncLoop } from "./sync.js";

async function main(): Promise<void> {
  const config = loadConfig();
  process.env.TZ = config.timezone;
  log(
    `Alonso Home agent TZ=${config.timezone} mock=${config.gpioMock} activeLow=${config.gpioActiveLow}`,
  );

  const store = openStore(config.dbPath);
  const mqtt = connectMqtt({
    enabled: config.mqttEnabled,
    url: config.mqttUrl,
    username: config.mqttUser,
    password: config.mqttPassword,
  });
  const controller = new ZoneController(store, mqtt, config.gpioMock, config.gpioActiveLow);
  await controller.init();
  // Después de init(): así los estados iniciales que se publican ya son los reales.
  const ha = startHomeAssistant(config, store, controller);

  const scheduler = createScheduler(store, controller, config.schedulerIntervalMs);
  scheduler.start();
  const sync = createSyncLoop(config, store, controller, mqtt);
  sync.start();
  const cameras = startCameras(config, store);
  const api = startLocalApi(config.localApiPort, store, controller, mqtt, cameras);

  notifyReady();
  const watchdog = setInterval(() => notifyWatchdog(), 10_000);

  const shutdown = async (signal: string) => {
    log(`apagando (${signal})`);
    clearInterval(watchdog);
    scheduler.stop();
    sync.stop();
    api.close();
    await cameras?.stop();
    await ha?.stop();
    await controller.close();
    await mqtt.close();
    store.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logError("fatal", err);
  process.exit(1);
});
