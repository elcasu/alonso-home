import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  DEFAULT_ZONES,
  defaultSchedule,
  migrateScheduleIds,
  RULE_ID_MIGRATION,
  ZONE_ID_MIGRATION,
  type Schedule,
  type Zone,
  type ZoneState,
} from "@alonso/shared";

export type PendingAction = {
  id: string;
  zoneId: string;
  action: "off";
  executeAt: string;
};

type ZoneRow = {
  id: string;
  name: string;
  kind: Zone["kind"];
  pin: number | null;
  device_id: string | null;
  channel: number | null;
  active_low: number;
  is_on: number;
};

export type AgentStore = {
  db: Database.Database;
  getZones(): ZoneState[];
  upsertZones(zones: Zone[]): void;
  setZoneOn(id: string, on: boolean): void;
  getSchedule(): Schedule;
  setSchedule(schedule: Schedule): void;
  getFired(ruleId: string, day: string): boolean;
  markFired(ruleId: string, day: string): void;
  addPending(action: PendingAction): void;
  duePending(nowIso: string): PendingAction[];
  removePending(id: string): void;
  addEvent(message: string, zoneId?: string): void;
  recentEvents(limit?: number): { ts: string; message: string; zoneId: string | null }[];
  outboxAdd(id: string, payload: string): void;
  outboxPeek(limit: number): OutboxRow[];
  outboxRemove(id: string): void;
  outboxCount(): number;
  /** Borra lo vencido y, si hay demasiado, lo más viejo. Devuelve cuántos eliminó. */
  outboxPrune(maxAgeMs: number, maxRows: number): number;
  close(): void;
};

export type OutboxRow = { id: string; payload: string; createdAt: string };

function rowToZone(row: ZoneRow): ZoneState {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    pin: row.pin ?? undefined,
    deviceId: row.device_id ?? undefined,
    channel: row.channel ?? undefined,
    activeLow: row.active_low === 1,
    on: row.is_on === 1,
  };
}

export function openStore(dbPath: string): AgentStore {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS zones (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      pin INTEGER,
      device_id TEXT,
      channel INTEGER,
      active_low INTEGER NOT NULL DEFAULT 1,
      is_on INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS schedule (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fired (
      rule_id TEXT NOT NULL,
      day_key TEXT NOT NULL,
      PRIMARY KEY (rule_id, day_key)
    );
    CREATE TABLE IF NOT EXISTS pending (
      id TEXT PRIMARY KEY,
      zone_id TEXT NOT NULL,
      action TEXT NOT NULL,
      execute_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      message TEXT NOT NULL,
      zone_id TEXT
    );
    CREATE TABLE IF NOT EXISTS camera_outbox (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const zoneCount = db.prepare("SELECT COUNT(*) AS n FROM zones").get() as { n: number };
  if (zoneCount.n === 0) {
    const insert = db.prepare(
      `INSERT INTO zones (id, name, kind, pin, device_id, channel, active_low, is_on)
       VALUES (@id, @name, @kind, @pin, @deviceId, @channel, @activeLow, 0)`,
    );
    const tx = db.transaction(() => {
      for (const zone of DEFAULT_ZONES) {
        insert.run({
          id: zone.id,
          name: zone.name,
          kind: zone.kind,
          pin: zone.pin ?? null,
          deviceId: zone.deviceId ?? null,
          channel: zone.channel ?? null,
          activeLow: zone.activeLow === false ? 0 : 1,
        });
      }
      db.prepare("INSERT INTO schedule (id, payload) VALUES ('default', ?)").run(
        JSON.stringify(defaultSchedule()),
      );
    });
    tx();
  }

  migrateLegacyZoneIds(db);

  return {
    db,
    getZones() {
      const rows = db
        .prepare(
          "SELECT id, name, kind, pin, device_id, channel, active_low, is_on FROM zones ORDER BY name",
        )
        .all() as ZoneRow[];
      return rows.map(rowToZone);
    },
    upsertZones(zones) {
      const stmt = db.prepare(
        `INSERT INTO zones (id, name, kind, pin, device_id, channel, active_low, is_on)
         VALUES (@id, @name, @kind, @pin, @deviceId, @channel, @activeLow, COALESCE((SELECT is_on FROM zones WHERE id=@id), 0))
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, kind=excluded.kind, pin=excluded.pin,
           device_id=excluded.device_id, channel=excluded.channel, active_low=excluded.active_low`,
      );
      const tx = db.transaction(() => {
        for (const zone of zones) {
          stmt.run({
            id: zone.id,
            name: zone.name,
            kind: zone.kind,
            pin: zone.pin ?? null,
            deviceId: zone.deviceId ?? null,
            channel: zone.channel ?? null,
            activeLow: zone.activeLow === false ? 0 : 1,
          });
        }
      });
      tx();
    },
    setZoneOn(id, on) {
      db.prepare("UPDATE zones SET is_on = ? WHERE id = ?").run(on ? 1 : 0, id);
    },
    getSchedule() {
      const row = db.prepare("SELECT payload FROM schedule WHERE id = 'default'").get() as
        | { payload: string }
        | undefined;
      if (!row) return defaultSchedule();
      return JSON.parse(row.payload) as Schedule;
    },
    setSchedule(schedule) {
      db.prepare(
        "INSERT INTO schedule (id, payload) VALUES ('default', ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
      ).run(JSON.stringify(schedule));
    },
    getFired(ruleId, day) {
      const row = db
        .prepare("SELECT 1 AS ok FROM fired WHERE rule_id = ? AND day_key = ?")
        .get(ruleId, day) as { ok: number } | undefined;
      return Boolean(row);
    },
    markFired(ruleId, day) {
      db.prepare("INSERT OR IGNORE INTO fired (rule_id, day_key) VALUES (?, ?)").run(ruleId, day);
    },
    addPending(action) {
      db.prepare(
        "INSERT OR IGNORE INTO pending (id, zone_id, action, execute_at) VALUES (@id, @zoneId, @action, @executeAt)",
      ).run(action);
    },
    duePending(nowIso) {
      return db
        .prepare(
          "SELECT id, zone_id AS zoneId, action, execute_at AS executeAt FROM pending WHERE execute_at <= ? ORDER BY execute_at",
        )
        .all(nowIso) as PendingAction[];
    },
    removePending(id) {
      db.prepare("DELETE FROM pending WHERE id = ?").run(id);
    },
    addEvent(message, zoneId) {
      db.prepare("INSERT INTO events (ts, message, zone_id) VALUES (?, ?, ?)").run(
        new Date().toISOString(),
        message,
        zoneId ?? null,
      );
    },
    recentEvents(limit = 50) {
      return db
        .prepare(
          "SELECT ts, message, zone_id AS zoneId FROM events ORDER BY id DESC LIMIT ?",
        )
        .all(limit) as { ts: string; message: string; zoneId: string | null }[];
    },
    outboxAdd(id, payload) {
      db.prepare(
        "INSERT OR IGNORE INTO camera_outbox (id, payload, created_at) VALUES (?, ?, ?)",
      ).run(id, payload, new Date().toISOString());
    },
    outboxPeek(limit) {
      return db
        .prepare(
          "SELECT id, payload, created_at AS createdAt FROM camera_outbox ORDER BY seq LIMIT ?",
        )
        .all(limit) as OutboxRow[];
    },
    outboxRemove(id) {
      db.prepare("DELETE FROM camera_outbox WHERE id = ?").run(id);
    },
    outboxCount() {
      return (db.prepare("SELECT COUNT(*) AS n FROM camera_outbox").get() as { n: number }).n;
    },
    outboxPrune(maxAgeMs, maxRows) {
      const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
      const old = db.prepare("DELETE FROM camera_outbox WHERE created_at < ?").run(cutoff).changes;
      const extra = db
        .prepare(
          `DELETE FROM camera_outbox WHERE seq IN (
             SELECT seq FROM camera_outbox ORDER BY seq DESC LIMIT -1 OFFSET ?
           )`,
        )
        .run(maxRows).changes;
      return old + extra;
    },
    close() {
      db.close();
    },
  };
}

function migrateLegacyZoneIds(db: Database.Database): void {
  const existing = db.prepare("SELECT id FROM zones").all() as { id: string }[];
  const ids = new Set(existing.map((row) => row.id));
  const needsRename = Object.keys(ZONE_ID_MIGRATION).some((oldId) => ids.has(oldId));
  if (!needsRename) {
    for (const zone of DEFAULT_ZONES) {
      db.prepare("UPDATE zones SET name = ?, device_id = ? WHERE id = ?").run(
        zone.name,
        zone.deviceId ?? null,
        zone.id,
      );
    }
    return;
  }

  const tx = db.transaction(() => {
    for (const [from, to] of Object.entries(ZONE_ID_MIGRATION)) {
      if (!ids.has(from) || ids.has(to)) continue;
      db.prepare("UPDATE zones SET id = ? WHERE id = ?").run(to, from);
      db.prepare("UPDATE pending SET zone_id = ? WHERE zone_id = ?").run(to, from);
      db.prepare("UPDATE events SET zone_id = ? WHERE zone_id = ?").run(to, from);
    }
    for (const zone of DEFAULT_ZONES) {
      db.prepare(
        "UPDATE zones SET name = ?, kind = ?, pin = ?, device_id = ?, channel = ?, active_low = ? WHERE id = ?",
      ).run(
        zone.name,
        zone.kind,
        zone.pin ?? null,
        zone.deviceId ?? null,
        zone.channel ?? null,
        zone.activeLow === false ? 0 : 1,
        zone.id,
      );
    }
    const row = db.prepare("SELECT payload FROM schedule WHERE id = 'default'").get() as
      | { payload: string }
      | undefined;
    if (row) {
      const schedule = migrateScheduleIds(JSON.parse(row.payload) as Schedule);
      schedule.updatedAt = new Date().toISOString();
      db.prepare("UPDATE schedule SET payload = ? WHERE id = 'default'").run(JSON.stringify(schedule));
    }
    for (const [from, to] of Object.entries(RULE_ID_MIGRATION)) {
      db.prepare("UPDATE fired SET rule_id = ? WHERE rule_id = ?").run(to, from);
    }
  });
  tx();
}
