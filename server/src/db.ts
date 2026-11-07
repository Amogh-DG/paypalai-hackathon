import Database, { type Database as DatabaseType } from "better-sqlite3";

export const databasePath: string = process.env.DATABASE_PATH || "leash.db";
export const db: DatabaseType = new Database(databasePath);
