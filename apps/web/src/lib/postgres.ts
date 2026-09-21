import postgres from "postgres";
import {
  COMMAND_TTL_MS,
  DEFAULT_ZONES,
  defaultSchedule,
  type Command,
  type Schedule,
  type ZoneState,
} from "@alonso/shared";
import type { DataStore, HeartbeatRow, LogEvent } from "./store";

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
  };
}
