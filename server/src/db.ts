import Database, { type Database as DatabaseType } from "better-sqlite3";

export function createDb(dbPath: string): DatabaseType {
  const db: DatabaseType = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS mandate (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      currency TEXT NOT NULL,
      total_budget REAL NOT NULL,
      per_item_cap REAL NOT NULL,
      approval_threshold REAL NOT NULL,
      allowed_categories TEXT NOT NULL,
      allowed_merchants TEXT NOT NULL,
      max_quantity_per_item INTEGER NOT NULL,
      shipping_address TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      signature TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      total REAL NOT NULL,
      status TEXT NOT NULL,
      currency TEXT NOT NULL,
      agent_reasoning TEXT NOT NULL,
      items TEXT NOT NULL,
      ship_to TEXT NOT NULL,
      source_urls TEXT NOT NULL,
      policy TEXT NOT NULL,
      payment TEXT,
      user_decision TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_entries (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      proposal_id TEXT,
      event TEXT NOT NULL,
      summary TEXT NOT NULL,
      amount REAL,
      decision TEXT,
      details TEXT NOT NULL
    );
  `);

  return db;
}
