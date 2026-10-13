import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { startLocalApi } from "./api.js";
import {
  formatBytes,
  formatCameras,
  formatSnap,
  formatStatus,
  formatZoneChange,
  parseArgs,
  runCli,
  USAGE,
} from "./cli.js";
import { ZoneController } from "./controller.js";
import { openStore } from "./db.js";
import type { MqttBridge } from "./mqtt.js";

describe("parseArgs", () => {
  it("rechaza el uso vacío", () => {
    assert.deepEqual(parseArgs([]), { error: USAGE });
  });

  it("acepta status, cámaras y zonas", () => {
    assert.deepEqual(parseArgs(["status"]), { kind: "status" });
    assert.deepEqual(parseArgs(["cameras"]), { kind: "cameras" });
    assert.deepEqual(parseArgs(["on", "living"]), { kind: "zone", action: "on", zoneId: "living" });
    assert.deepEqual(parseArgs(["off", "living"]), {
      kind: "zone",
      action: "off",
      zoneId: "living",
    });
    assert.deepEqual(parseArgs(["pulse", "bathroom"]), {
      kind: "pulse",
      zoneId: "bathroom",
      minutes: 10,
    });
    assert.deepEqual(parseArgs(["pulse", "bathroom", "15"]), {
      kind: "pulse",
      zoneId: "bathroom",
      minutes: 15,
    });
    assert.deepEqual(parseArgs(["snap", "entrada"]), { kind: "snap", cameraId: "entrada" });
  });

  it("rechaza minutos que no son un entero positivo", () => {
    const parsed = parseArgs(["pulse", "bathroom", "0"]);
    assert.equal("error" in parsed, true);
  });
});

describe("formato", () => {
  it("alinea el estado y la hora de Argentina", () => {
    const text = formatStatus({
      zones: [
        { id: "living", on: false, kind: "gpio" },
        { id: "bathroom", on: false, kind: "esp32" },
      ],
      mqttConnected: false,
      events: [{ ts: "2026-10-13T00:38:00.000Z", message: "api local: Living ON" }],
    });
    assert.equal(
      text,
      [
        "living    OFF  gpio",
        "bathroom  OFF  esp32",
        "mqtt      desconectado",
        "",
        "21:38  api local: Living ON",
      ].join("\n"),
    );
  });

  it("marca publicado solo en esp32 y el pulse aparte", () => {
    assert.equal(formatZoneChange({ id: "living", on: true, kind: "gpio" }), "living ON");
    assert.equal(
      formatZoneChange({ id: "bathroom", on: true, kind: "esp32" }, 10),
      "bathroom ON publicado pulse 10 min",
    );
  });

  it("formatea cámaras y el tamaño de la foto", () => {
    assert.equal(formatCameras({ enabled: false }), "cámaras desactivadas");
    assert.equal(
      formatCameras({
        cameras: [{ id: "entrada", host: "192.168.4.20", onvifConnected: true }],
        outbox: 2,
      }),
      ["entrada   192.168.4.20  conectada", "outbox    2"].join("\n"),
    );
    assert.equal(formatBytes(24576), "24 KB");
    assert.deepEqual(formatSnap("entrada", { ok: true, bytes: 24576 }), {
      ok: true,
      text: "entrada  ok  24 KB",
    });
    assert.deepEqual(formatSnap("entrada", { ok: false, error: "cámara desconocida: entrada" }), {
      ok: false,
      text: "cámara desconocida: entrada",
    });
  });
});

function fakeFetch(
  handler: (url: string, init?: RequestInit) => { status: number; body: unknown } | Promise<never>,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const result = await handler(String(input), init);
    return new Response(JSON.stringify(result.body), { status: result.status });
  }) as typeof fetch;
}

describe("runCli", () => {
  it("imprime el estado que devuelve el agente", async () => {
    const result = await runCli(["status"], {
      env: {},
      fetch: fakeFetch(() => ({
        status: 200,
        body: {
          zones: [{ id: "living", on: true, kind: "gpio" }],
          mqttConnected: true,
          events: [],
        },
      })),
    });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, "living    ON   gpio\nmqtt      conectado");
  });

  it("prende una zona gpio y publica una esp32", async () => {
    const calls: { url: string; body: string }[] = [];
    const fetchImpl = fakeFetch((url, init) => {
      calls.push({ url, body: String(init?.body ?? "") });
      const id = url.endsWith("/bathroom") ? "bathroom" : "living";
      const kind = id === "bathroom" ? "esp32" : "gpio";
      return {
        status: 200,
        body: { zones: [{ id, on: true, kind }] },
      };
    });
    const on = await runCli(["on", "living"], { env: { LOCAL_API_PORT: "3001" }, fetch: fetchImpl });
    const pulse = await runCli(["pulse", "bathroom", "10"], {
      env: {},
      fetch: fetchImpl,
    });
    assert.equal(on.stdout, "living ON");
    assert.equal(on.code, 0);
    assert.equal(pulse.stdout, "bathroom ON publicado pulse 10 min");
    assert.deepEqual(JSON.parse(calls[0].body), { on: true });
    assert.deepEqual(JSON.parse(calls[1].body), { action: "pulse", durationMinutes: 10 });
    assert.match(calls[1].url, /127\.0\.0\.1:3001\/zones\/bathroom$/);
  });

  it("muestra el error de una zona o cámara que no existe", async () => {
    const missing = await runCli(["on", "azotea"], {
      env: {},
      fetch: fakeFetch(() => ({ status: 404, body: { error: "zona desconocida" } })),
    });
    const snap = await runCli(["snap", "entrada"], {
      env: {},
      fetch: fakeFetch(() => ({
        status: 502,
        body: { ok: false, error: "cámara desconocida: entrada" },
      })),
    });
    assert.equal(missing.code, 1);
    assert.equal(missing.stderr, "zona desconocida");
    assert.equal(snap.code, 1);
    assert.equal(snap.stderr, "cámara desconocida: entrada");
  });

  it("avisa si el agente no escucha", async () => {
    const result = await runCli(["status"], {
      env: {},
      fetch: (async () => {
        throw new Error("connect ECONNREFUSED");
      }) as typeof fetch,
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /no pude hablar con el agente en 127\.0\.0\.1:3001/);
  });
});

describe("API local", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alonso-cli-"));
  const store = openStore(path.join(dir, "alonso.db"));
  const mqtt: MqttBridge = {
    connected: false,
    async setChannel() {},
    async close() {},
  };
  const controller = new ZoneController(store, mqtt, true);
  let server: ReturnType<typeof startLocalApi>;
  let port = 0;

  after(() => {
    server?.close();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("responde 404 si la zona no existe y no agenda un pulse", async () => {
    await controller.init();
    server = startLocalApi(0, store, controller, mqtt, null);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    port = typeof address === "object" && address ? address.port : 0;

    const missing = await fetch(`http://127.0.0.1:${port}/zones/azotea`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "pulse", durationMinutes: 5 }),
    });
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "zona desconocida" });
    assert.deepEqual(store.duePending("9999-01-01T00:00:00.000Z"), []);

    const ok = await fetch(`http://127.0.0.1:${port}/zones/living`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ on: true }),
    });
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as { zones: { id: string; on: boolean }[] };
    assert.equal(body.zones.find((zone) => zone.id === "living")?.on, true);
  });
});
