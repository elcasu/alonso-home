import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CAMERA_STATUS_STALE_MS, parseCameraMessage } from "@alonso/shared";
import { ingestCameraMessages, readCameras } from "./cameras";
import { isIotConfirmation, safeIotEnableUrl } from "./iot";

const JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");

function event(id: string, extra: Record<string, unknown> = {}) {
  return {
    type: "event",
    id,
    cameraId: "entrada",
    kind: "motion",
    state: "start",
    ts: new Date().toISOString(),
    snapshot: { mime: "image/jpeg", b64: JPEG_B64 },
    ...extra,
  };
}

describe("parseCameraMessage", () => {
  it("acepta eventos y status válidos", () => {
    assert.equal(parseCameraMessage(event("11111111-aaaa"))?.type, "event");
    const status = parseCameraMessage({
      type: "status",
      cameraId: "entrada",
      ts: new Date().toISOString(),
      online: true,
    });
    assert.deepEqual(status && status.type === "status" && status.online, true);
  });

  it("rechaza lo malformado o peligroso", () => {
    assert.equal(parseCameraMessage(null), null);
    assert.equal(parseCameraMessage("hola"), null);
    assert.equal(parseCameraMessage(event("corto")), null, "id demasiado corto");
    assert.equal(parseCameraMessage(event("11111111-aaaa", { cameraId: "../etc" })), null);
    assert.equal(parseCameraMessage(event("11111111-aaaa", { kind: "explosion" })), null);
    assert.equal(parseCameraMessage(event("11111111-aaaa", { ts: "ayer" })), null);
    assert.equal(
      parseCameraMessage(event("11111111-aaaa", { snapshot: { mime: "text/html", b64: "PGI+" } })),
      null,
    );
    assert.equal(
      parseCameraMessage(event("11111111-aaaa", { snapshot: { mime: "image/jpeg", b64: "A".repeat(200_000) } })),
      null,
      "foto gigante",
    );
  });
});

describe("ingest + lectura (store en memoria)", () => {
  it("guarda, deduplica reintentos y descarta mensajes inválidos sin tirar el lote", async () => {
    const id = crypto.randomUUID();
    const batch = [event(id), event(id), { basura: true }];
    const result = await ingestCameraMessages(batch);
    assert.deepEqual(result, { accepted: 1, duplicates: 1, rejected: 1 });
  });

  it("la cámara figura online con status fresco y offline cuando se pone viejo", async () => {
    const eventId = crypto.randomUUID();
    await ingestCameraMessages([
      event(eventId),
      { type: "status", cameraId: "entrada", ts: new Date().toISOString(), online: true },
    ]);

    const fresh = await readCameras(40);
    const cam = fresh.cameras.find((c) => c.id === "entrada");
    assert.ok(cam);
    assert.equal(cam.online, true);
    assert.equal(cam.lastSnapshotEventId, eventId);
    assert.equal(cam.name, "Entrada", "usa el nombre de DEFAULT_CAMERAS");
    assert.ok(fresh.events.some((e) => e.id === eventId && e.hasSnapshot));

    const later = await readCameras(40, Date.now() + CAMERA_STATUS_STALE_MS + 5_000);
    assert.equal(later.cameras.find((c) => c.id === "entrada")?.online, false);
  });

  it("muestra cámaras desconocidas que ya mandan datos", async () => {
    await ingestCameraMessages({
      type: "status",
      cameraId: "patio",
      ts: new Date().toISOString(),
      online: true,
    });
    const data = await readCameras(10);
    assert.equal(data.cameras.find((c) => c.id === "patio")?.name, "patio");
  });
});

describe("confirmación de destino AWS IoT", () => {
  it("solo sigue URLs https de iot.<región>.amazonaws.com", () => {
    const ok = safeIotEnableUrl({
      enableUrl: "https://iot.us-east-2.amazonaws.com/confirmdestination/abc123",
    });
    assert.equal(ok?.hostname, "iot.us-east-2.amazonaws.com");
    for (const enableUrl of [
      "http://iot.us-east-2.amazonaws.com/confirmdestination/x",
      "https://evil.example.com/confirmdestination/x",
      "https://iot.us-east-2.amazonaws.com.evil.com/x",
      "https://user:pw@iot.us-east-2.amazonaws.com/x",
      "https://127.0.0.1/x",
      "no-es-url",
    ]) {
      assert.equal(safeIotEnableUrl({ enableUrl }), null, enableUrl);
    }
    assert.equal(safeIotEnableUrl({}), null);
    assert.equal(safeIotEnableUrl(null), null);
  });

  it("reconoce la cabecera de confirmación", () => {
    const headers = new Headers({ "x-amz-rules-engine-message-type": "DestinationConfirmation" });
    assert.equal(isIotConfirmation(headers), true);
    assert.equal(isIotConfirmation(new Headers()), false);
  });
});
