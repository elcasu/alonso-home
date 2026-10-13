import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { CAMERA_RETENTION_DAYS, type CameraEventMessage } from "@alonso/shared";
import { getStore } from "./store";

/**
 * Integración con Postgres real. Se omite sin TEST_DATABASE_URL, por ejemplo:
 *   docker run -d --name pgtest -e POSTGRES_PASSWORD=t -p 54329:5432 postgres:16-alpine
 *   TEST_DATABASE_URL=postgres://postgres:t@localhost:54329/postgres pnpm --filter @alonso/web test
 */
const url = process.env.TEST_DATABASE_URL;

function ev(overrides: Partial<CameraEventMessage> = {}): CameraEventMessage {
  return {
    type: "event",
    id: crypto.randomUUID(),
    cameraId: "pgcam",
    kind: "motion",
    state: "start",
    ts: new Date().toISOString(),
    ...overrides,
  };
}

describe("store de cámaras en Postgres", { skip: !url }, () => {
  after(async () => {
    // El cliente es global y mantiene el proceso vivo; lo cerramos para que el runner termine.
    const g = globalThis as typeof globalThis & { __alonsoSql?: { end(): Promise<void> } };
    await g.__alonsoSql?.end();
  });

  it("guarda la foto como bytea y la devuelve idéntica", async () => {
    process.env.DATABASE_URL = url;
    const store = await getStore();
    assert.equal(store.usingMemory, false);

    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3, 0xff, 0xd9]);
    const e = ev({ snapshot: { mime: "image/jpeg", b64: jpeg.toString("base64") } });
    assert.equal(await store.saveCameraEvent(e), true);
    assert.equal(await store.saveCameraEvent(e), false, "el reintento de IoT no duplica");

    const stored = await store.getCameraSnapshot(e.id);
    assert.equal(stored?.mime, "image/jpeg");
    assert.deepEqual(stored?.data, jpeg);
    assert.equal(await store.getCameraSnapshot(crypto.randomUUID()), null);

    const latest = await store.latestSnapshotEvents();
    assert.equal(latest.find((r) => r.cameraId === "pgcam")?.id, e.id);

    const recent = await store.recentCameraEvents(10, "pgcam");
    assert.ok(recent.length >= 1 && recent.every((r) => r.cameraId === "pgcam"));
    assert.equal(recent.find((r) => r.id === e.id)?.hasSnapshot, true);
  });

  it("el status se actualiza (upsert)", async () => {
    process.env.DATABASE_URL = url;
    const store = await getStore();
    const ts = new Date().toISOString();
    await store.saveCameraStatus({ type: "status", cameraId: "pgcam", ts, online: true });
    await store.saveCameraStatus({ type: "status", cameraId: "pgcam", ts, online: false });
    const row = (await store.getCameraStatuses()).find((s) => s.cameraId === "pgcam");
    assert.equal(row?.online, false);
  });

  it("borra eventos más viejos que la retención al insertar uno nuevo", async () => {
    process.env.DATABASE_URL = url;
    const store = await getStore();
    const oldTs = new Date(Date.now() - (CAMERA_RETENTION_DAYS + 2) * 86_400_000).toISOString();
    const old = ev({ ts: oldTs, cameraId: "pgold" });
    assert.equal(await store.saveCameraEvent(old), true);
    // Insertar uno nuevo dispara la limpieza (el viejo se borró incluso antes si ya había otro insert).
    await store.saveCameraEvent(ev({ cameraId: "pgold" }));
    const rows = await store.recentCameraEvents(50, "pgold");
    assert.ok(!rows.some((r) => r.id === old.id), "el evento vencido ya no está");
  });
});
