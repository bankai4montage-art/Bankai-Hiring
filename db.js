/**
 * Bankai-Hiring — SQLite database layer (better-sqlite3)
 * Stores courier records in a single file; on Railway the file lives on a
 * persistent Volume mounted at /data so records survive re-deploys.
 */
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

/* DB file location: Railway Volume path if set, otherwise ./data */
const DB_PATH = process.env.DATABASE_PATH
  || path.join(process.cwd(), 'data', 'bankai-hiring.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');

/* ------------------------- Schema ------------------------- */
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS couriers (
    id              TEXT PRIMARY KEY,
    full_name       TEXT NOT NULL,
    phone           TEXT NOT NULL,
    national_id     TEXT NOT NULL UNIQUE,
    branch          TEXT NOT NULL CHECK (branch IN ('QCD1', 'QCD2')),
    employment_type TEXT NOT NULL,
    license_start   TEXT NOT NULL,
    license_end     TEXT NOT NULL,
    outlook         TEXT DEFAULT '',
    plate           TEXT DEFAULT '',
    status          TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const now = () => new Date().toISOString();

/* ------------------------- Queries ------------------------- */
const ROW = {
  fromServer(row) { // DB row (snake_case) -> API shape (camelCase)
    return {
      id: row.id,
      fullName: row.full_name,
      phone: row.phone,
      nationalId: row.national_id,
      branch: row.branch,
      employmentType: row.employment_type,
      licenseStart: row.license_start,
      licenseEnd: row.license_end,
      outlook: row.outlook,
      plate: row.plate,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  },
  fromClient(d) { // API shape -> DB bind params
    return {
      id: crypto.randomUUID(),
      full_name: d.fullName, phone: d.phone, national_id: d.nationalId,
      branch: d.branch, employment_type: d.employmentType,
      license_start: d.licenseStart, license_end: d.licenseEnd,
      outlook: d.outlook, plate: d.plate, status: d.status,
      created_at: now(), updated_at: now()
    };
  }
};

const SELECT = 'SELECT * FROM couriers';

export const db = {
  /** All couriers, newest first. */
  list() {
    return sqlite.prepare(`${SELECT} ORDER BY created_at DESC, id`).all().map(ROW.fromServer);
  },

  /** One courier by id (or null). */
  get(id) {
    const row = sqlite.prepare(`${SELECT} WHERE id = ?`).get(id);
    return row ? ROW.fromServer(row) : null;
  },

  /** Create a courier from a validated payload. */
  create(d) {
    const r = ROW.fromClient(d);
    sqlite.prepare(`
      INSERT INTO couriers
        (id, full_name, phone, national_id, branch, employment_type,
         license_start, license_end, outlook, plate, status, created_at, updated_at)
      VALUES
        (@id, @full_name, @phone, @national_id, @branch, @employment_type,
         @license_start, @license_end, @outlook, @plate, @status, @created_at, @updated_at)
    `).run(r);
    return { id: r.id, createdAt: r.created_at, updatedAt: r.updated_at, ...d };
  },

  /** Update all editable fields of a courier. */
  update(id, d) {
    const r = ROW.fromClient(d);
    sqlite.prepare(`
      UPDATE couriers SET
        full_name = @full_name, phone = @phone, national_id = @national_id,
        branch = @branch, employment_type = @employment_type,
        license_start = @license_start, license_end = @license_end,
        outlook = @outlook, plate = @plate, status = @status,
        updated_at = @updated_at
      WHERE id = @id
    `).run({ ...r, id }); // spread last-but-one, then pin @id to the target row
    return db.get(id);
  },

  /** Quick status change only. */
  updateStatus(id, status) {
    sqlite.prepare(`UPDATE couriers SET status = ?, updated_at = ? WHERE id = ?`)
      .run(status, now(), id);
    return db.get(id);
  },

  /** Remove a courier; returns true when a row was deleted. */
  remove(id) {
    return sqlite.prepare('DELETE FROM couriers WHERE id = ?').run(id).changes > 0;
  }
};

/** Back-compat alias used by server.js for GET /api/couriers */
export const listCouriers = db.list;

/* ------------------------- Seed data (first boot only) ------------------------- */
export function seedIfEmpty() {
  const count = sqlite.prepare('SELECT COUNT(*) AS n FROM couriers').get().n;
  if (count > 0) return;

  const seed = [
    { fullName: 'أحمد محمد سعيد',      phone: '01012345678', nationalId: '29901011234567', branch: 'QCD1', employmentType: 'Full Time', licenseStart: '2024-11-01', licenseEnd: '2025-10-31', outlook: 'ahmed.saeed@bankai.com',    plate: 'ABC 123', status: 'Active' },
    { fullName: 'Youssef Khaled',      phone: '01123456789', nationalId: '30005051234567', branch: 'QCD2', employmentType: 'Part Time', licenseStart: '2025-06-15', licenseEnd: '2026-06-14', outlook: 'youssef.k@bankai.com',     plate: 'XYZ 456', status: 'Attended to D0' },
    { fullName: 'محمود علي حسن',       phone: '01234567890', nationalId: '29803031234567', branch: 'QCD1', employmentType: 'Full Time', licenseStart: '2024-01-10', licenseEnd: '2025-01-09', outlook: 'mahmoud.hassan@bankai.com', plate: 'JKL 789', status: 'Inactive' },
    { fullName: 'Omar Tarek',          phone: '01098765432', nationalId: '30109101234567', branch: 'QCD2', employmentType: 'Part Time', licenseStart: '2025-09-01', licenseEnd: '2026-09-30', outlook: '',                          plate: 'MNO 321', status: 'OnBoarding' },
    { fullName: 'Mostafa Gamal',       phone: '01555555555', nationalId: '30107071234567', branch: 'QCD2', employmentType: 'Full Time', licenseStart: '2024-02-01', licenseEnd: '2024-12-31', outlook: 'mostafa.g@bankai.com',     plate: 'QRS 654', status: 'OffBoarding' }
  ];
  seed.forEach(d => db.create(d));
  console.log(`🌱 Seeded ${seed.length} demo courier records.`);
}
