import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { CameraMessage } from "@alonso/shared";
import { openStore } from "../db.js";
import { parseCameraDevices, type CameraDevice, type CamerasConfig } from "./config.js";
import { buildPacket, extractJpeg, PacketReader, sofiaHash } from "./dvrip.js";
import {
  parseNotifications,
  startOnvifWatcher,
  toSignal,
  usernameTokenHeader,
  type CameraSignal,
  type OnvifWatcherOptions,
} from "./onvif.js";
import { startCameraService } from "./service.js";
import type { CameraSink } from "./sink.js";
import { createTracker } from "./tracker.js";

/** Notificación real capturada de la GT-N3 (firmware V5.01.C01), abreviada. */
const SAMPLE = `
<wsnt:NotificationMessage><wsnt:Topic Dialect="http://www.onvif.org/ver10/tev/topicExpression/ConcreteSet">tns1:VideoSource/MotionAlarm</wsnt:Topic><wsnt:Message><tt:Message UtcTime="2026-10-11T00:40:26Z" PropertyOperation="Initialized"><tt:Source><tt:SimpleItem Name="Source" Value="V_SRC_000" /></tt:Source><tt:Data><tt:SimpleItem Name="State" Value="false" /></tt:Data></tt:Message></wsnt:Message></wsnt:NotificationMessage>
<wsnt:NotificationMessage><wsnt:Topic Dialect="x">tns1:RuleEngine/CellMotionDetector/Motion</wsnt:Topic><wsnt:Message><tt:Message UtcTime="2026-10-11T00:40:30Z" PropertyOperation="Changed"><tt:Source><tt:SimpleItem Name="VideoSource" Value="V_SRC_000" /><tt:SimpleItem Name="Rule" Value="MyMotionDetectorRule" /></tt:Source><tt:Data><tt:SimpleItem Name="IsMotion" Value="true" /></tt:Data></tt:Message></wsnt:Message></wsnt:NotificationMessage>
<wsnt:NotificationMessage><wsnt:Topic Dialect="x">tns1:Device/Trigger/DigitalInput</wsnt:Topic><wsnt:Message><tt:Message UtcTime="2026-10-11T00:40:26Z" PropertyOperation="Initialized"><tt:Data><tt:SimpleItem Name="LogicalState" Value="false" /></tt:Data></tt:Message></wsnt:Message></wsnt:NotificationMessage>
<wsnt:NotificationMessage><wsnt:Topic Dialect="x">tns1:RuleEngine/TamperDetector/Tamper</wsnt:Topic><wsnt:Message><tt:Message UtcTime="2026-10-11T00:40:31Z" PropertyOperation="Changed"><tt:Data><tt:SimpleItem Name="IsTamper" Value="true" /></tt:Data></tt:Message></wsnt:Message></wsnt:NotificationMessage>
`;

describe("ONVIF", () => {
  it("parsea notificaciones y las traduce a señales", () => {
    const notes = parseNotifications(SAMPLE);
    assert.equal(notes.length, 4);
    assert.deepEqual(toSignal(notes[0]), { kind: "motion", active: false, initial: true });
    assert.deepEqual(toSignal(notes[1]), { kind: "motion", active: true, initial: false });
    assert.equal(toSignal(notes[2]), null, "DigitalInput no es movimiento");
    assert.deepEqual(toSignal(notes[3]), { kind: "tamper", active: true, initial: false });
  });

  it("arma la cabecera WS-Security con digest SHA1 reproducible", () => {
    const header = usernameTokenHeader(
      "admin",
      "secreto",
      new Date("2026-01-01T00:00:00.000Z"),
      Buffer.from("0123456789abcdef"),
    );
    assert.match(header, /<Username>admin<\/Username>/);
    assert.match(header, /PasswordDigest/);
    assert.match(header, /<Created[^>]*>2026-01-01T00:00:00.000Z<\/Created>/);
    assert.ok(!header.includes("secreto"), "la clave nunca va en claro");
  });

  it("el watcher se suscribe, hace pull y avisa señales (cámara simulada)", async () => {
    let pulls = 0;
    let renews = 0;
    let creates = 0;
    let unsubscribed = false;
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.setHeader("content-type", "application/soap+xml");
        if (body.includes("Renew")) {
          // Comportamiento real de la GT-N3: sin WS-Addressing (Action + To) rechaza el Renew.
          if (!body.includes("<a:To") || !body.includes("<a:Action")) {
            res.statusCode = 400;
            res.end("<s:Envelope><s:Body><s:Fault>ResourceUnknownFault</s:Fault></s:Body></s:Envelope>");
            return;
          }
          renews += 1;
          res.end("<s:Envelope><s:Body><wsnt:RenewResponse/></s:Body></s:Envelope>");
        } else if (body.includes("Unsubscribe")) {
          unsubscribed = true;
          res.end("<s:Envelope><s:Body/></s:Envelope>");
        } else if (body.includes("CreatePullPointSubscription")) {
          creates += 1;
          res.end(
            "<s:Envelope><s:Body><tev:CreatePullPointSubscriptionResponse><tev:SubscriptionReference>" +
              "<wsa:Address>http://10.9.9.9:1/event_service/0</wsa:Address></tev:SubscriptionReference>" +
              "</tev:CreatePullPointSubscriptionResponse></s:Body></s:Envelope>",
          );
        } else if (body.includes("PullMessages")) {
          pulls += 1;
          res.end(`<s:Envelope><s:Body>${pulls === 1 ? SAMPLE : ""}</s:Body></s:Envelope>`);
        } else {
          res.end("<s:Envelope><s:Body/></s:Envelope>");
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;

    const signals: CameraSignal[] = [];
    const connections: boolean[] = [];
    const opts: OnvifWatcherOptions = {
      host: "127.0.0.1",
      port,
      pollIntervalMs: 20,
      subscriptionTtlSec: 0.2, // renueva cada 100 ms
      onSignal: (s) => signals.push(s),
      onConnection: (c) => connections.push(c),
    };
    const watcher = startOnvifWatcher(opts);
    for (let i = 0; i < 150 && (signals.length < 3 || pulls < 2 || renews < 2); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    watcher.stop();
    await new Promise((r) => setTimeout(r, 80));
    server.close();

    assert.equal(signals.length, 3);
    assert.deepEqual(connections, [true, false], "una sola conexión, sin reconexiones espurias");
    assert.equal(creates, 1, "el Renew funciona: no hace falta recrear la suscripción");
    assert.ok(renews >= 2, "renueva con WS-Addressing");
    assert.ok(pulls >= 2, "sigue consultando después del primer pull");
    assert.equal(unsubscribed, true, "libera la suscripción al apagar");
  });
});

describe("DVRIP", () => {
  it("sofiaHash coincide con el cliente Python validado contra la cámara", () => {
    assert.equal(sofiaHash(""), "tlJwpbo6");
    assert.equal(sofiaHash("admin"), "6QNMIQGe");
    assert.equal(sofiaHash("casa1234"), "vXsc9Act");
  });

  it("buildPacket + PacketReader hacen ida y vuelta, incluso con bytes partidos", () => {
    const packet = buildPacket(0x2a, 3, 1560, { Name: "OPSNAP" });
    assert.equal(packet[0], 0xff);
    assert.equal(packet.readUInt32LE(4), 0x2a);
    assert.equal(packet.readUInt16LE(14), 1560);
    assert.equal(packet.readUInt32LE(16), packet.length - 20);

    const reader = new PacketReader();
    assert.deepEqual(reader.push(packet.subarray(0, 7)), []);
    assert.deepEqual(reader.push(packet.subarray(7, 25)), []);
    const [got] = reader.push(packet.subarray(25));
    assert.equal(got.msgid, 1560);
    assert.deepEqual(JSON.parse(got.body.toString().replace(/[\x00\n]+$/, "")), { Name: "OPSNAP" });
  });

  it("extractJpeg recorta el JPEG dentro del flujo", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    const stream = Buffer.concat([Buffer.from("basura"), jpeg, Buffer.from([0, 0])]);
    assert.deepEqual(extractJpeg(stream), jpeg);
    assert.equal(extractJpeg(Buffer.from("sin imagen")), null);
  });
});

describe("tracker", () => {
  const motion = (active: boolean, initial = false): CameraSignal => ({ kind: "motion", active, initial });

  it("deduplica MotionAlarm + CellMotionDetector y emite start/end una vez", () => {
    const t = createTracker({ startCooldownMs: 1000, now: () => 0 });
    assert.deepEqual(t.handle(motion(false, true)), []);
    assert.equal(t.handle(motion(true)).length, 1);
    assert.deepEqual(t.handle(motion(true)), [], "segunda fuente del mismo movimiento");
    assert.deepEqual(t.handle(motion(false)), [{ kind: "motion", state: "end", wantSnapshot: false }]);
    assert.deepEqual(t.handle(motion(false)), []);
  });

  it("suprime ráfagas dentro del cooldown (y su end), y vuelve a emitir después", () => {
    let now = 0;
    const t = createTracker({ startCooldownMs: 20_000, now: () => now });
    assert.deepEqual(t.handle(motion(true)), [{ kind: "motion", state: "start", wantSnapshot: true }]);
    now = 3000;
    t.handle(motion(false));
    now = 5000;
    assert.deepEqual(t.handle(motion(true)), [], "start dentro del cooldown");
    now = 6000;
    assert.deepEqual(t.handle(motion(false)), [], "su end también se suprime");
    now = 30_000;
    assert.equal(t.handle(motion(true))[0].state, "start");
    assert.equal(t.handle(motion(false))[0].state, "end");
  });

  it("movimiento y sabotaje son independientes; reset olvida el estado pero no el cooldown", () => {
    let now = 0;
    const t = createTracker({ startCooldownMs: 1000, now: () => now });
    assert.equal(t.handle({ kind: "tamper", active: true, initial: false })[0].kind, "tamper");
    assert.equal(t.handle(motion(true))[0].kind, "motion");
    t.reset();
    assert.deepEqual(t.handle(motion(true)), [], "una conexión que flapea no rompe el cooldown");
    t.reset();
    now = 5000;
    assert.equal(t.handle(motion(true)).length, 1, "pasado el cooldown vuelve a ser transición");
  });
});

describe("config de cámaras", () => {
  it("acepta JSON válido con defaults y rechaza lo malformado", () => {
    const ok = parseCameraDevices('[{"id":"entrada","host":"192.168.1.9"}]');
    assert.equal(ok.error, undefined);
    assert.deepEqual(ok.devices[0], {
      id: "entrada",
      host: "192.168.1.9",
      onvifPort: 8899,
      dvripPort: 34567,
      user: "admin",
      password: "",
    });
    assert.deepEqual(parseCameraDevices(undefined), { devices: [] });
    assert.match(parseCameraDevices("{no").error ?? "", /JSON/);
    assert.match(parseCameraDevices('{"a":1}').error ?? "", /arreglo/);
    assert.match(parseCameraDevices('[{"id":"Mala ID","host":"x"}]').error ?? "", /id inválido/);
    assert.match(parseCameraDevices('[{"id":"a","host":"x"},{"id":"a","host":"y"}]').error ?? "", /repetido/);
  });
});

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alonso-cam-"));
  return openStore(path.join(dir, "t.db"));
}

describe("outbox SQLite", () => {
  it("conserva el orden, deduplica por id y poda por antigüedad y cantidad", () => {
    const store = tmpStore();
    store.outboxAdd("a", "1");
    store.outboxAdd("b", "2");
    store.outboxAdd("a", "dup");
    store.outboxAdd("c", "3");
    assert.deepEqual(store.outboxPeek(10).map((r) => r.id), ["a", "b", "c"]);
    assert.equal(store.outboxCount(), 3);
    store.outboxRemove("b");
    assert.deepEqual(store.outboxPeek(10).map((r) => r.id), ["a", "c"]);
    assert.equal(store.outboxPrune(60_000, 1), 1, "queda solo el más nuevo");
    assert.deepEqual(store.outboxPeek(10).map((r) => r.id), ["c"]);
    assert.equal(store.outboxPrune(-1, 100), 1, "todo es más viejo que el límite");
    assert.equal(store.outboxCount(), 0);
    store.close();
  });
});

describe("servicio de cámaras", () => {
  const device: CameraDevice = {
    id: "entrada",
    host: "127.0.0.1",
    onvifPort: 1,
    dvripPort: 1,
    user: "admin",
    password: "",
  };
  const config: CamerasConfig = {
    devices: [device],
    sink: "log",
    iot: { endpoint: "", clientId: "x", certPath: "", keyPath: "", caPath: "" },
    startCooldownMs: 1000,
    statusIntervalMs: 3_600_000,
    outboxMaxAgeMs: 3_600_000,
    outboxMaxRows: 100,
  };

  function harness(sinkFails: { value: boolean }) {
    const store = tmpStore();
    const delivered: CameraMessage[] = [];
    const sink: CameraSink = {
      name: "test",
      connected: () => !sinkFails.value,
      async publish(message) {
        if (sinkFails.value) throw new Error("sin red");
        delivered.push(message);
      },
      async close() {},
    };
    let handlers: OnvifWatcherOptions | undefined;
    const service = startCameraService({
      config,
      store,
      sink,
      snapshot: async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      watch: (opts) => {
        handlers = opts;
        return { connected: () => true, stop() {} };
      },
    });
    return { store, delivered, service, handlers: () => handlers as OnvifWatcherOptions };
  }

  const settle = () => new Promise((r) => setTimeout(r, 30));

  it("movimiento → evento start con foto en base64, luego end sin foto", async () => {
    const { delivered, service, handlers, store } = harness({ value: false });
    handlers().onConnection(true);
    handlers().onSignal({ kind: "motion", active: false, initial: true });
    handlers().onSignal({ kind: "motion", active: true, initial: false });
    handlers().onSignal({ kind: "motion", active: false, initial: false });
    await settle();
    await service.flush();

    const events = delivered.filter((m) => m.type === "event");
    assert.equal(events.length, 2);
    const [start, end] = events as Extract<CameraMessage, { type: "event" }>[];
    assert.equal(start.state, "start");
    assert.equal(start.snapshot?.mime, "image/jpeg");
    assert.deepEqual(Buffer.from(start.snapshot!.b64, "base64"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    assert.equal(end.state, "end");
    assert.equal(end.snapshot, undefined);
    assert.ok(delivered.some((m) => m.type === "status" && m.online), "avisa que la cámara está online");
    assert.equal(store.outboxCount(), 0);
    await service.stop();
    store.close();
  });

  it("sin red los eventos quedan en el outbox y salen cuando vuelve", async () => {
    const fails = { value: true };
    const { delivered, service, handlers, store } = harness(fails);
    handlers().onSignal({ kind: "motion", active: true, initial: false });
    await settle();
    assert.equal(delivered.filter((m) => m.type === "event").length, 0);
    assert.equal(store.outboxCount(), 1, "el evento no se pierde");

    fails.value = false;
    // El flush respeta un backoff de 5 s tras fallar; lo salteamos adelantando el reloj interno.
    const realNow = Date.now;
    Date.now = () => realNow() + 10_000;
    try {
      await service.flush();
    } finally {
      Date.now = realNow;
    }
    assert.equal(delivered.filter((m) => m.type === "event").length, 1);
    assert.equal(store.outboxCount(), 0);
    await service.stop();
    store.close();
  });

  it("snapshotNow genera un evento manual con foto", async () => {
    const { delivered, service, store } = harness({ value: false });
    const result = await service.snapshotNow("entrada");
    assert.deepEqual(result, { ok: true, bytes: 4 });
    await service.flush();
    const event = delivered.find((m) => m.type === "event");
    assert.ok(event && event.type === "event");
    assert.equal(event.kind, "snapshot");
    assert.equal(event.state, "instant");
    assert.deepEqual(await service.snapshotNow("nadie"), { ok: false, error: "cámara desconocida: nadie" });
    await service.stop();
    store.close();
  });
});
