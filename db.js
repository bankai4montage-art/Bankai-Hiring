/**
 * Bankai-Hiring — SQLite database layer (better-sqlite3)
 * Stores courier records in a single file; on Railway the file lives on a
 * persistent Volume mounted at /data so records survive re-deploys.
 *
 * v2 additions: pipeline events (audit + funnel), hired_at, pagination,
 * Arabic-aware search text, document thumbnails and S3/R2 keys.
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
sqlite.pragma('foreign_keys = ON'); // deleting a courier cascades to its documents

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

  CREATE TABLE IF NOT EXISTS documents (
    id          TEXT PRIMARY KEY,
    courier_id  TEXT NOT NULL REFERENCES couriers(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('photo', 'id_front', 'id_back', 'license_front', 'license_back')),
    mime        TEXT NOT NULL,
    size        INTEGER NOT NULL,
    data        BLOB NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_documents_courier ON documents(courier_id);
`);

/* ---- light migrations (safe to re-run on every boot) ---- */
function addColumn(table, def) {
  const name = def.split(/\s+/)[0];
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(name)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${def}`);
}

addColumn('couriers', 'hired_at TEXT');
addColumn('couriers', 'search_text TEXT');
addColumn('documents', 'thumb BLOB');
addColumn('documents', 'thumb_size INTEGER');
addColumn('documents', 'storage TEXT DEFAULT \'db\'');
addColumn('documents', 'file_key TEXT');
addColumn('documents', 'thumb_key TEXT');

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS courier_events (
    id          TEXT PRIMARY KEY,
    courier_id  TEXT NOT NULL REFERENCES couriers(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,
    from_status TEXT,
    to_status   TEXT,
    note        TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_events_courier ON courier_events(courier_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_events_created ON courier_events(created_at);
  CREATE INDEX IF NOT EXISTS idx_couriers_status ON couriers(status);
  CREATE INDEX IF NOT EXISTS idx_couriers_branch ON couriers(branch);
  CREATE INDEX IF NOT EXISTS idx_couriers_license_end ON couriers(license_end);
  CREATE INDEX IF NOT EXISTS idx_couriers_created ON couriers(created_at);
  CREATE INDEX IF NOT EXISTS idx_couriers_search ON couriers(search_text);
`);

const now = () => new Date().toISOString();

/* Normalise Arabic/Latin text for search: أإآ→ا, ى→ي, ة→ه, ignore tashkeel/tatweel */
export function normText(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')   // tashkeel + tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const searchTextOf = (d) => normText([d.fullName, d.phone, d.nationalId, d.plate, d.outlook].join(' '));

/* Statuses that count as “hired” for the time-to-hire metric */
const HIRED_STATUSES = new Set(['Active', 'Attended to D0']);

/* ------------------------- Row mapping ------------------------- */
const ROW = {
  fromServer(row) {
    const days = row.hired_at && row.created_at
      ? Math.max(0, Math.round((new Date(row.hired_at) - new Date(row.created_at)) / 86400000))
      : null;
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
      photo: row.photo_doc || null,
      thumbPhoto: row.photo_thumb ? row.photo_doc : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      hiredAt: row.hired_at || null,
      timeToHireDays: days
    };
  },
  fromClient(d) {
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

const SELECT_WITH_PHOTO = `SELECT c.*,
  (SELECT d.id FROM documents d WHERE d.courier_id = c.id AND d.kind = 'photo' LIMIT 1) AS photo_doc,
  (SELECT d.thumb_size FROM documents d WHERE d.courier_id = c.id AND d.kind = 'photo' LIMIT 1) AS photo_thumb
  FROM couriers c`;

/* ------------------------- Events (pipeline history) ------------------------- */
const events = {
  add(courierId, type, { from = null, to = null, note = null } = {}) {
    const id = crypto.randomUUID();
    sqlite.prepare(`INSERT INTO courier_events (id, courier_id, type, from_status, to_status, note, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, courierId, type, from, to, note, now());
    return id;
  },
  list(courierId, limit = 50) {
    return sqlite.prepare(`SELECT * FROM courier_events WHERE courier_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(courierId, limit)
      .map(e => ({ id: e.id, courierId: e.courier_id, type: e.type, fromStatus: e.from_status,
                   toStatus: e.to_status, note: e.note, createdAt: e.created_at }));
  },
  recent(limit = 20) {
    return sqlite.prepare(`SELECT e.*, c.full_name FROM courier_events e
                           JOIN couriers c ON c.id = e.courier_id
                           ORDER BY e.created_at DESC LIMIT ?`).all(limit)
      .map(e => ({ id: e.id, courierId: e.courier_id, fullName: e.full_name, type: e.type,
                   fromStatus: e.from_status, toStatus: e.to_status, note: e.note, createdAt: e.created_at }));
  }
};

/* ------------------------- Couriers ------------------------- */
const whereFor = ({ q = '', status = '', branch = '', type = '' } = {}) => {
  const where = [];
  const params = [];
  const needle = normText(q);
  if (needle) { where.push('c.search_text LIKE ?'); params.push(`%${needle}%`); }
  if (status) { where.push('c.status = ?'); params.push(status); }
  if (branch) { where.push('c.branch = ?'); params.push(branch); }
  if (type) { where.push('c.employment_type = ?'); params.push(type); }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
};

const orderFor = (sort) => ({
  newest: 'c.created_at DESC, c.id',
  oldest: 'c.created_at ASC, c.id',
  name: 'c.full_name COLLATE NOCASE ASC',
  'name-desc': 'c.full_name COLLATE NOCASE DESC',
  license: 'c.license_end ASC',
  status: 'c.status ASC, c.full_name COLLATE NOCASE ASC',
  branch: 'c.branch ASC, c.full_name COLLATE NOCASE ASC'
}[sort] || 'c.created_at DESC, c.id');

export const db = {
  /**
   * Paginated, filterable list.
   * @returns {{items: object[], total: number, page: number, pageSize: number, pages: number}}
   */
  list({ page = 1, pageSize = 24, q = '', status = '', branch = '', type = '', sort = 'newest' } = {}) {
    const { sql: w, params } = whereFor({ q, status, branch, type });
    const total = sqlite.prepare(`SELECT COUNT(*) AS n FROM couriers c ${w}`).get(...params).n;

    const size = Math.max(1, Math.min(200, Number(pageSize) || 24));
    const p = Math.max(1, Number(page) || 1);
    const items = sqlite.prepare(`${SELECT_WITH_PHOTO} ${w} ORDER BY ${orderFor(sort)} LIMIT ? OFFSET ?`)
      .all(...params, size, (p - 1) * size).map(ROW.fromServer);

    return { items, total, page: p, pageSize: size, pages: Math.max(1, Math.ceil(total / size)) };
  },

  /** Every matching row (kanban board, CSV export). */
  filterAll({ q = '', status = '', branch = '', type = '', sort = 'newest' } = {}) {
    const { sql: w, params } = whereFor({ q, status, branch, type });
    return sqlite.prepare(`${SELECT_WITH_PHOTO} ${w} ORDER BY ${orderFor(sort)}`).all(...params).map(ROW.fromServer);
  },

  /** Every row (metrics). */
  all() {
    return sqlite.prepare(`${SELECT_WITH_PHOTO} ORDER BY created_at DESC, id`).all().map(ROW.fromServer);
  },

  get(id) {
    const row = sqlite.prepare(`${SELECT_WITH_PHOTO} WHERE c.id = ?`).get(id);
    return row ? ROW.fromServer(row) : null;
  },

  create(d) {
    const r = ROW.fromClient(d);
    r.search_text = searchTextOf(d);
    if (HIRED_STATUSES.has(d.status)) r.hired_at = r.created_at;
    sqlite.prepare(`
      INSERT INTO couriers
        (id, full_name, phone, national_id, branch, employment_type,
         license_start, license_end, outlook, plate, status, created_at, updated_at, hired_at, search_text)
      VALUES
        (@id, @full_name, @phone, @national_id, @branch, @employment_type,
         @license_start, @license_end, @outlook, @plate, @status, @created_at, @updated_at, @hired_at, @search_text)
    `).run({ hired_at: null, ...r });
    events.add(r.id, 'created', { to: d.status });
    return db.get(r.id);
  },

  update(id, d) {
    const before = db.get(id);
    const r = ROW.fromClient(d);
    const hiredAt = before?.hiredAt || (HIRED_STATUSES.has(d.status) ? now() : null);
    sqlite.prepare(`
      UPDATE couriers SET
        full_name = @full_name, phone = @phone, national_id = @national_id,
        branch = @branch, employment_type = @employment_type,
        license_start = @license_start, license_end = @license_end,
        outlook = @outlook, plate = @plate, status = @status,
        updated_at = @updated_at, hired_at = @hired_at, search_text = @search_text
      WHERE id = @id
    `).run({ ...r, id, hired_at: hiredAt, search_text: searchTextOf(d) });
    if (before && before.status !== d.status) events.add(id, 'status', { from: before.status, to: d.status });
    else events.add(id, 'updated', {});
    return db.get(id);
  },

  updateStatus(id, status) {
    const before = db.get(id);
    if (!before) return null;
    const hiredAt = before.hiredAt || (HIRED_STATUSES.has(status) ? now() : null);
    sqlite.prepare(`UPDATE couriers SET status = ?, updated_at = ?, hired_at = COALESCE(hired_at, ?) WHERE id = ?`)
      .run(status, now(), hiredAt, id);
    events.add(id, 'status', { from: before.status, to: status });
    return db.get(id);
  },

  remove(id) {
    return sqlite.prepare('DELETE FROM couriers WHERE id = ?').run(id).changes > 0;
  },

  /** Numbers for the KPI panel + time-to-hire + document completeness. */
  metrics() {
    const rows = db.all();
    const byStatus = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    const byBranch = {};
    for (const r of rows) byBranch[r.branch] = (byBranch[r.branch] || 0) + 1;

    const tth = rows.map(r => r.timeToHireDays).filter(v => typeof v === 'number').sort((a, b) => a - b);
    const avg = tth.length ? Math.round(tth.reduce((s, v) => s + v, 0) / tth.length) : null;
    const median = tth.length ? tth[Math.floor(tth.length / 2)] : null;

    const docsByCourier = sqlite.prepare(
      `SELECT courier_id, COUNT(DISTINCT kind) AS n FROM documents GROUP BY courier_id`).all();
    const docMap = new Map(docsByCourier.map(r => [r.courier_id, r.n]));
    const complete = rows.filter(r => (docMap.get(r.id) || 0) >= 5).length;

    return {
      total: rows.length,
      byStatus,
      byBranch,
      byType: rows.reduce((acc, r) => (acc[r.employmentType] = (acc[r.employmentType] || 0) + 1, acc), {}),
      timeToHire: { avgDays: avg, medianDays: median, sampled: tth.length },
      documents: { complete, incomplete: rows.length - complete },
      hired: rows.filter(r => r.hiredAt).length
    };
  }
};

/** Back-compat alias used by server.js */
export const listCouriers = db.all;

export { events };

/* ------------------------- Documents (courier images) ------------------------- */
const DOC_META = `SELECT id, courier_id, kind, mime, size, thumb_size, storage, created_at FROM documents`;

export const docs = {
  list(courierId) {
    return sqlite.prepare(`${DOC_META} WHERE courier_id = ? ORDER BY created_at`).all(courierId)
      .map(r => ({
        id: r.id, courierId: r.courier_id, kind: r.kind, mime: r.mime, size: r.size,
        hasThumb: !!r.thumb_size, storage: r.storage || 'db', createdAt: r.created_at
      }));
  },

  /**
   * Store an image. `data`/`thumb` are Buffers when the image lives in SQLite;
   * `fileKey`/`thumbKey` are used when it lives in S3/R2 instead.
   */
  add({ id = null, courierId, kind, mime, size, data = null, thumb = null, thumbSize = null,
        storage = 'db', fileKey = null, thumbKey = null }) {
    const docId = id || crypto.randomUUID();
    sqlite.prepare(`INSERT INTO documents
      (id, courier_id, kind, mime, size, data, thumb, thumb_size, storage, file_key, thumb_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(docId, courierId, kind, mime, size, data, thumb, thumbSize, storage, fileKey, thumbKey, new Date().toISOString());
    return { id: docId, courierId, kind, mime, size, hasThumb: !!thumbSize, storage, createdAt: new Date().toISOString() };
  },

  get(id) {
    return sqlite.prepare('SELECT * FROM documents WHERE id = ?').get(id) || null;
  },

  remove(id) {
    return sqlite.prepare('DELETE FROM documents WHERE id = ?').run(id).changes > 0;
  }
};

/** Backfill shape/search data for rows created before v2 (runs once, cheap). */
function migrateExisting() {
  const rows = sqlite.prepare(
    `SELECT id, full_name, phone, national_id, plate, outlook, status FROM couriers
     WHERE search_text IS NULL OR search_text = ''`).all();
  if (rows.length) {
    const upd = sqlite.prepare('UPDATE couriers SET search_text = ? WHERE id = ?');
    const tx = sqlite.transaction(list => list.forEach(r => upd.run(searchTextOf({
      fullName: r.full_name, phone: r.phone, nationalId: r.national_id, plate: r.plate, outlook: r.outlook
    }), r.id)));
    tx(rows);
  }

  // give old records a starting point in the pipeline timeline
  const withoutEvents = sqlite.prepare(
    `SELECT c.id, c.status FROM couriers c
     WHERE NOT EXISTS (SELECT 1 FROM courier_events e WHERE e.courier_id = c.id)`).all();
  for (const r of withoutEvents) events.add(r.id, 'created', { to: r.status, note: 'imported' });
}

/* ------------------------- Seed data (first boot only) ------------------------- */
export function seedIfEmpty() {
  migrateExisting();   // upgrade data created by older versions (search text + timeline)
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
