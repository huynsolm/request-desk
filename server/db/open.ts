import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

// node:sqlite 는 vite/vitest 의 모듈 해석과 충돌하는 경우가 있어 require 로 불러온다.
const require = createRequire(import.meta.url);
const { DatabaseSync: DatabaseSyncImpl } = require('node:sqlite') as typeof import('node:sqlite');

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSyncImpl(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  return db;
}

/** BEGIN IMMEDIATE 트랜잭션. 예외가 나면 롤백한다. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* 이미 롤백된 경우 */
    }
    throw err;
  }
}
