import { loadConfig } from "./config.js";
import { openGpio } from "./gpio.js";
import { log } from "./logger.js";

const pin = Number(process.argv[2] ?? 17);
const cycles = Number(process.argv[3] ?? 3);
const config = loadConfig();

const gpio = await openGpio(pin, true, config.gpioMock);
log(`gpio-test pin=${pin} cycles=${cycles} mock=${config.gpioMock}`);
try {
  for (let i = 0; i < cycles; i += 1) {
    await gpio.write(true);
    log(`ciclo ${i + 1} ON`);
    await new Promise((r) => setTimeout(r, 1000));
    await gpio.write(false);
    log(`ciclo ${i + 1} OFF`);
    await new Promise((r) => setTimeout(r, 1000));
  }
} finally {
  await gpio.close();
}
