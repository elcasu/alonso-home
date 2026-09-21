import { log } from "./logger.js";

export type GpioHandle = {
  pin: number;
  write(on: boolean): Promise<void>;
  close(): Promise<void>;
};

type HardwareGpio = {
  writeSync(value: 0 | 1): void;
  unexport(): void;
};

export async function openGpio(
  pin: number,
  activeLow: boolean,
  mock: boolean,
): Promise<GpioHandle> {
  if (mock) {
    let state = false;
    log(`GPIO mock pin ${pin} (activeLow=${activeLow})`);
    return {
      pin,
      async write(on) {
        state = on;
        log(`GPIO mock pin ${pin} -> ${on ? "ON" : "OFF"}`);
        void state;
      },
      async close() {
        log(`GPIO mock pin ${pin} closed`);
      },
    };
  }

  const { Gpio } = (await import("onoff")) as {
    Gpio: new (gpio: number, direction: "out") => HardwareGpio;
  };
  const gpio = new Gpio(pin, "out");
  const level = (on: boolean): 0 | 1 => {
    if (activeLow) return on ? 0 : 1;
    return on ? 1 : 0;
  };
  gpio.writeSync(level(false));
  log(`GPIO pin ${pin} listo (activeLow=${activeLow})`);
  return {
    pin,
    async write(on) {
      gpio.writeSync(level(on));
    },
    async close() {
      gpio.writeSync(level(false));
      gpio.unexport();
    },
  };
}
