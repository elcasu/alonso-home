-- Esquema Postgres (Neon / Vercel). El panel también lo crea solo al arrancar.
CREATE TABLE IF NOT EXISTS zones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  pin INTEGER,
  device_id TEXT,
  channel INTEGER,
  active_low BOOLEAN NOT NULL DEFAULT TRUE,
  is_on BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS schedule (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commands (
  id TEXT PRIMARY KEY,
  zone_id TEXT NOT NULL,
  action TEXT NOT NULL,
  duration_minutes INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  delivered_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS heartbeat (
  id TEXT PRIMARY KEY,
  last_seen TIMESTAMPTZ NOT NULL,
  mqtt_connected BOOLEAN
);

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  message TEXT NOT NULL,
  zone_id TEXT
);

-- Módulo de cámaras (el panel también crea estas tablas solo al arrancar).
CREATE TABLE IF NOT EXISTS camera_events (
  id TEXT PRIMARY KEY,
  camera_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  snapshot BYTEA
);
CREATE INDEX IF NOT EXISTS camera_events_ts_idx ON camera_events (ts DESC);
CREATE INDEX IF NOT EXISTS camera_events_cam_ts_idx ON camera_events (camera_id, ts DESC);

CREATE TABLE IF NOT EXISTS camera_status (
  camera_id TEXT PRIMARY KEY,
  online BOOLEAN NOT NULL,
  last_seen TIMESTAMPTZ NOT NULL
);
