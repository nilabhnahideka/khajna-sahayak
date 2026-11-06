import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'khajna.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name_as       TEXT NOT NULL,
  role          TEXT NOT NULL,            -- mouzadar
  mouza         TEXT NOT NULL
);

-- A simplified Jamabandi: one row per dag under a patta.
CREATE TABLE IF NOT EXISTS land_records (
  id               INTEGER PRIMARY KEY,
  mouza            TEXT NOT NULL,
  village          TEXT NOT NULL,
  patta_no         TEXT NOT NULL,
  patta_type       TEXT NOT NULL CHECK (patta_type IN ('myadi','eksonia')),
  dag_no           TEXT NOT NULL,
  pattadar_name_as TEXT NOT NULL,
  pattadar_name_en TEXT NOT NULL,
  father_name_as   TEXT NOT NULL,
  father_name_en   TEXT NOT NULL,
  bigha            INTEGER NOT NULL,
  katha            INTEGER NOT NULL,
  lessa            INTEGER NOT NULL,
  land_class       TEXT NOT NULL,
  last_paid_year   INTEGER,               -- start year of last paid revenue year
  settled_year     INTEGER NOT NULL,
  pattadar_status  TEXT NOT NULL DEFAULT 'alive',
  UNIQUE (mouza, patta_no, dag_no)
);

CREATE TABLE IF NOT EXISTS applications (
  id              INTEGER PRIMARY KEY,
  app_no          TEXT UNIQUE NOT NULL,
  mouza           TEXT NOT NULL,
  channel         TEXT NOT NULL,          -- online | offline
  submitted_at    TEXT NOT NULL,
  applicant_name  TEXT NOT NULL,
  father_name     TEXT NOT NULL,
  phone           TEXT NOT NULL,
  village         TEXT NOT NULL,
  patta_no        TEXT NOT NULL,
  dag_no          TEXT NOT NULL,
  claimed_bigha   INTEGER NOT NULL,
  claimed_katha   INTEGER NOT NULL,
  claimed_lessa   INTEGER NOT NULL,
  status          TEXT NOT NULL,          -- verify | calculate | decide | approved | rejected | returned
  land_record_id  INTEGER REFERENCES land_records(id),
  last_paid_override INTEGER,             -- set by worker if citizen shows an offline receipt
  dues_total      INTEGER,
  dues_years      INTEGER,
  decision_note   TEXT,
  citizen_message TEXT,
  receipt_no      TEXT,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id             INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  at             TEXT NOT NULL,
  actor          TEXT NOT NULL,           -- username, 'citizen' or 'system'
  action         TEXT NOT NULL,           -- submitted | verified | calculated | approved | rejected | returned | sent_back | ai_suggested
  from_status    TEXT,
  to_status      TEXT,
  note           TEXT,
  ai_used        INTEGER NOT NULL DEFAULT 0
);

-- Cache of AI suggestions so we don't call the model on every page view,
-- and so the audit trail can show exactly what the AI said.
CREATE TABLE IF NOT EXISTS ai_outputs (
  id             INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  kind           TEXT NOT NULL,           -- verify | calculate | decide:<action>
  lang           TEXT NOT NULL,
  input_hash     TEXT NOT NULL,
  source         TEXT NOT NULL,           -- gemini | rules
  output_json    TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  UNIQUE (application_id, kind, lang, input_hash)
);

CREATE INDEX IF NOT EXISTS idx_events_app ON events(application_id, at);
CREATE INDEX IF NOT EXISTS idx_apps_status ON applications(mouza, status);
`;

db.exec(SCHEMA);

export function isEmpty(): boolean {
  return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n === 0;
}

export const nowIso = () => new Date().toISOString();
