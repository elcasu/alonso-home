import postgres from "postgres";
import {
  CAMERA_RETENTION_DAYS,
  COMMAND_TTL_MS,
  DEFAULT_ZONES,
  defaultSchedule,
  type Command,
  type Schedule,
  type ZoneState,
} from "@alonso/shared";
import type { CameraEventRow, DataStore, HeartbeatRow, LogEvent } from "./store";

type Sql = ReturnType<typeof postgres>;

const globalForPg = globalThis as typeof globalThis & {
  __alonsoSql?: Sql;
  __alonsoReady?: Promise<void>;
};

function sqlClient(): Sql {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL required");
  }
  if (!globalForPg.__alonsoSql) {
    const local = process.env.DATABASE_URL.includes("localhost") || process.env.DATABASE_URL.includes("127.0.0.1");
    globalForPg.__alonsoSql = postgres(process.env.DATABASE_URL, {
      max: 1,
      ssl: local ? false : "require",
    });
  }
  return globalForPg.__alonsoSql;
}

async function ensure(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS zones (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      pin INTEGER,
      device_id TEXT,
      channel INTEGER,
      active_low BOOLEAN NOT NULL DEFAULT TRUE,
      is_on BOOLEAN NOT NULL DEFAULT FALSE
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS schedule (
      id TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS commands (
      id TEXT PRIMARY KEY,
      zone_id TEXT NOT NULL,
      action TEXT NOT NULL,
      duration_minutes INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      delivered_at TIMESTAMPTZ
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS heartbeat (
      id TEXT PRIMARY KEY,
      last_seen TIMESTAMPTZ NOT NULL,
      mqtt_connected BOOLEAN
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS events (
      id BIGSERIAL PRIMARY KEY,
      ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      message TEXT NOT NULL,
      zone_id TEXT
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS camera_events (
      id TEXT PRIMARY KEY,
      camera_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      state TEXT NOT NULL,
      ts TIMESTAMPTZ NOT NULL,
      snapshot BYTEA
    )`;
  await sql`CREATE INDEX IF NOT EXISTS camera_events_ts_idx ON camera_events (ts DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS camera_events_cam_ts_idx ON camera_events (camera_id, ts DESC)`;
  await sql`
    CREATE TABLE IF NOT EXISTS camera_status (
      camera_id TEXT PRIMARY KEY,
      online BOOLEAN NOT NULL,
      last_seen TIMESTAMPTZ NOT NULL
    )`;

  const [{ n }] = await sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM zones`;
  if (n === 0) {
    for (const zone of DEFAULT_ZONES) {
      await sql`
        INSERT INTO zones (id, name, kind, pin, device_id, channel, active_low, is_on)
        VALUES (
          ${zone.id}, ${zone.name}, ${zone.kind}, ${zone.pin ?? null},
          ${zone.deviceId ?? null}, ${zone.channel ?? null},
          ${zone.activeLow !== false}, false
        )`;
    }
    const schedule = defaultSchedule();
    await sql`
      INSERT INTO schedule (id, payload, updated_at)
      VALUES ('default', ${sql.json(schedule)}, ${schedule.updatedAt})`;
    await sql`
      INSERT INTO events (message) VALUES ('Postgres inicializado con zonas y agenda de ocupación.')`;
  }
}

function ready(sql: Sql): Promise<void> {
  if (!globalForPg.__alonsoReady) {
    globalForPg.__alonsoReady = ensure(sql);
  }
  return globalForPg.__alonsoReady;
}

export function getPostgresStore(): DataStore {
  const sql = sqlClient();
  return {
    usingMemory: false,
    async getZones() {
      await ready(sql);
      const rows = await sql<
        {
          id: string;
          name: string;
          kind: ZoneState["kind"];
          pin: number | null;
          device_id: string | null;
          channel: number | null;
          active_low: boolean;
          is_on: boolean;
        }[]
      >`SELECT id, name, kind, pin, device_id, channel, active_low, is_on FROM zones ORDER BY name`;
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
        pin: row.pin ?? undefined,
        deviceId: row.device_id ?? undefined,
        channel: row.channel ?? undefined,
        activeLow: row.active_low,
        on: row.is_on,
      }));
    },
    async setZoneOn(id, on) {
      await ready(sql);
      await sql`UPDATE zones SET is_on = ${on} WHERE id = ${id}`;
    },
    async replaceZones(zones) {
      await ready(sql);
      for (const zone of zones) {
        await sql`
          INSERT INTO zones (id, name, kind, pin, device_id, channel, active_low, is_on)
          VALUES (
            ${zone.id}, ${zone.name}, ${zone.kind}, ${zone.pin ?? null},
            ${zone.deviceId ?? null}, ${zone.channel ?? null},
            ${zone.activeLow !== false}, ${zone.on}
          )
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            kind = EXCLUDED.kind,
            pin = EXCLUDED.pin,
            device_id = EXCLUDED.device_id,
            channel = EXCLUDED.channel,
            active_low = EXCLUDED.active_low,
            is_on = EXCLUDED.is_on`;
      }
    },
    async getSchedule() {
      await ready(sql);
      const rows = await sql<{ payload: Schedule }[]>`SELECT payload FROM schedule WHERE id = 'default'`;
      return rows[0]?.payload ?? defaultSchedule();
    },
    async setSchedule(schedule) {
      await ready(sql);
      await sql`
        INSERT INTO schedule (id, payload, updated_at)
        VALUES ('default', ${sql.json(schedule)}, ${schedule.updatedAt})
        ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at`;
    },
    async enqueueCommand(command) {
      await ready(sql);
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + COMMAND_TTL_MS);
      const full: Command = {
        id: command.id,
        zoneId: command.zoneId,
        action: command.action,
        durationMinutes: command.durationMinutes,
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      };
      await sql`
        INSERT INTO commands (id, zone_id, action, duration_minutes, created_at, expires_at)
        VALUES (
          ${full.id}, ${full.zoneId}, ${full.action}, ${full.durationMinutes ?? null},
          ${full.createdAt}, ${full.expiresAt}
        )`;
      return full;
    },
    async takeCommands() {
      await ready(sql);
      const rows = await sql<
        {
          id: string;
          zone_id: string;
          action: Command["action"];
          duration_minutes: number | null;
          created_at: Date;
          expires_at: Date;
        }[]
      >`
        UPDATE commands
        SET delivered_at = NOW()
        WHERE delivered_at IS NULL AND expires_at > NOW()
        RETURNING id, zone_id, action, duration_minutes, created_at, expires_at`;
      return rows.map((row) => ({
        id: row.id,
        zoneId: row.zone_id,
        action: row.action,
        durationMinutes: row.duration_minutes ?? undefined,
        createdAt: row.created_at.toISOString(),
        expiresAt: row.expires_at.toISOString(),
      }));
    },
    async setHeartbeat(ts, mqttConnected) {
      await ready(sql);
      await sql`
        INSERT INTO heartbeat (id, last_seen, mqtt_connected)
        VALUES ('pi', ${ts}, ${mqttConnected ?? null})
        ON CONFLICT (id) DO UPDATE SET last_seen = EXCLUDED.last_seen, mqtt_connected = EXCLUDED.mqtt_connected`;
    },
    async getHeartbeat() {
      await ready(sql);
      const rows = await sql<{ last_seen: Date; mqtt_connected: boolean | null }[]>`
        SELECT last_seen, mqtt_connected FROM heartbeat WHERE id = 'pi'`;
      const row = rows[0];
      if (!row) return null;
      return { lastSeen: row.last_seen.toISOString(), mqttConnected: row.mqtt_connected };
    },
    async addEvent(message, zoneId) {
      await ready(sql);
      await sql`INSERT INTO events (message, zone_id) VALUES (${message}, ${zoneId ?? null})`;
    },
    async recentEvents(limit = 30) {
      await ready(sql);
      const rows = await sql<{ ts: Date; message: string; zone_id: string | null }[]>`
        SELECT ts, message, zone_id FROM events ORDER BY id DESC LIMIT ${limit}`;
      return rows.map((row) => ({
        ts: row.ts.toISOString(),
        message: row.message,
        zoneId: row.zone_id,
      }));
    },
    async saveCameraEvent(message) {
      await ready(sql);
      const snapshot = message.snapshot ? Buffer.from(message.snapshot.b64, "base64") : null;
      const inserted = await sql<{ id: string }[]>`
        INSERT INTO camera_events (id, camera_id, kind, state, ts, snapshot)
        VALUES (${message.id}, ${message.cameraId}, ${message.kind}, ${message.state}, ${message.ts}, ${snapshot})
        ON CONFLICT (id) DO NOTHING
        RETURNING id`;
      if (inserted.length > 0) {
        await sql`DELETE FROM camera_events WHERE ts < NOW() - make_interval(days => ${CAMERA_RETENTION_DAYS})`;
      }
      return inserted.length > 0;
    },
    async saveCameraStatus(message) {
      await ready(sql);
      await sql`
        INSERT INTO camera_status (camera_id, online, last_seen)
        VALUES (${message.cameraId}, ${message.online}, ${message.ts})
        ON CONFLICT (camera_id) DO UPDATE SET online = EXCLUDED.online, last_seen = EXCLUDED.last_seen`;
    },
    async recentCameraEvents(limit, cameraId) {
      await ready(sql);
      const rows = await sql<CameraEventDbRow[]>`
        SELECT id, camera_id, kind, state, ts, (snapshot IS NOT NULL) AS has_snapshot
        FROM camera_events
        WHERE (${cameraId ?? null}::text IS NULL OR camera_id = ${cameraId ?? null})
        ORDER BY ts DESC LIMIT ${limit}`;
      return rows.map(toCameraEvent);
    },
    async latestSnapshotEvents() {
      await ready(sql);
      const rows = await sql<CameraEventDbRow[]>`
        SELECT DISTINCT ON (camera_id) id, camera_id, kind, state, ts, TRUE AS has_snapshot
        FROM camera_events
        WHERE snapshot IS NOT NULL
        ORDER BY camera_id, ts DESC`;
      return rows.map(toCameraEvent);
    },
    async getCameraSnapshot(eventId) {
      await ready(sql);
      const rows = await sql<{ snapshot: Buffer | null }[]>`
        SELECT snapshot FROM camera_events WHERE id = ${eventId}`;
      const data = rows[0]?.snapshot;
      return data ? { mime: "image/jpeg", data: Buffer.from(data) } : null;
    },
    async getCameraStatuses() {
      await ready(sql);
      const rows = await sql<{ camera_id: string; online: boolean; last_seen: Date }[]>`
        SELECT camera_id, online, last_seen FROM camera_status`;
      return rows.map((row) => ({
        cameraId: row.camera_id,
        online: row.online,
        lastSeen: row.last_seen.toISOString(),
      }));
    },
  };
}

type CameraEventDbRow = {
  id: string;
  camera_id: string;
  kind: CameraEventRow["kind"];
  state: CameraEventRow["state"];
  ts: Date;
  has_snapshot: boolean;
};

function toCameraEvent(row: CameraEventDbRow): CameraEventRow {
  return {
    id: row.id,
    cameraId: row.camera_id,
    kind: row.kind,
    state: row.state,
    ts: row.ts.toISOString(),
    hasSnapshot: row.has_snapshot,
  };
}
