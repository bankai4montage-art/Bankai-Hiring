/**
 * Bankai-Hiring — API tests (node:test, no extra dependencies).
 *
 * Boots the real server against a throw-away SQLite database, then exercises
 * validation, pagination, search, filters, metrics, status events and the
 * document upload/preview/delete flow.
 *
 *   npm test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';

const PORT = Number(process.env.TEST_PORT || 3987);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = mkdtempSync(join(tmpdir(), 'bankai-test-'));
const DB = join(TMP, 'test.db');

let server;

const j = async (path, opts = {}) => {
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  const res = await fetch(BASE + path, {
    ...opts,
    headers: isForm ? (opts.headers || {}) : { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, headers: res.headers };
};

const list = (q = '') => j(`/api/couriers?all=1${q}`).then(r => r.body);
const make = (over = {}) => ({
  fullName: 'Test Courier', phone: '01011112222', nationalId: String(29000000000000 + Math.floor(Math.random() * 999999)),
  branch: 'QCD1', employmentType: 'Full Time', licenseStart: '2026-01-01', licenseEnd: '2028-01-01',
  outlook: '', plate: '', status: 'OnBoarding', ...over
});

before(async () => {
  server = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), DATABASE_PATH: DB, S3_BUCKET: '', S3_ACCESS_KEY_ID: '', S3_SECRET_ACCESS_KEY: '' },
    stdio: 'ignore'
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* not yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('server did not start');
});

after(() => {
  try { server?.kill(); } catch { /* already gone */ }
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* windows file lock */ }
});

/* ---------------------------------------------------------------- health */

test('health reports the storage backend', async () => {
  const { status, body } = await j('/api/health');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.storage.mode, 'db'); // no S3 credentials in tests
});

/* ---------------------------------------------------------------- create */

test('creates a courier and seeds status events', async () => {
  const payload = make({ fullName: 'أحمد محمد سعيد' });
  const { status, body } = await j('/api/couriers', { method: 'POST', body: JSON.stringify(payload) });
  assert.equal(status, 201);
  assert.equal(body.status, 'OnBoarding');

  const profile = await j(`/api/couriers/${body.id}`);
  assert.equal(profile.status, 200);
  assert.equal(profile.body.fullName, 'أحمد محمد سعيد');
  assert.ok(profile.body.events.some(e => e.type === 'created'));
  assert.equal(profile.body.timeToHireDays, null);
});

test('rejects invalid payloads field by field', async () => {
  const { status, body } = await j('/api/couriers', {
    method: 'POST',
    body: JSON.stringify({ fullName: 'x', phone: '123', nationalId: '1', branch: 'NOPE', employmentType: 'x',
                           licenseStart: '', licenseEnd: '', status: 'nope' })
  });
  assert.equal(status, 400);
  for (const key of ['fullName', 'phone', 'nationalId', 'branch', 'type', 'licenseStart', 'licenseEnd', 'status']) {
    assert.ok(body.errors[key], `missing error for ${key}`);
  }
});

test('rejects a duplicate national ID with 409', async () => {
  const payload = make();
  const first = await j('/api/couriers', { method: 'POST', body: JSON.stringify(payload) });
  assert.equal(first.status, 201);
  const dup = await j('/api/couriers', { method: 'POST', body: JSON.stringify(payload) });
  assert.equal(dup.status, 409);
  assert.ok(dup.body.errors.nationalId);
});

/* ---------------------------------------------------------------- pagination */

test('paginates and reports totals', async () => {
  const page = await j('/api/couriers?page=1&pageSize=2');
  assert.equal(page.status, 200);
  assert.equal(page.body.items.length, 2);
  assert.ok(page.body.total >= 2);
  assert.equal(page.body.page, 1);
  assert.equal(page.body.pages, Math.ceil(page.body.total / 2));
  assert.equal(page.body.pageSize, 2);

  const last = await j(`/api/couriers?page=${page.body.pages}&pageSize=2`);
  assert.equal(last.body.page, page.body.pages);
  assert.ok(last.body.items.length >= 1 && last.body.items.length <= 2);
});

test('searches Arabic with letter normalisation', async () => {
  const withHamza = await j('/api/couriers?all=1&q=' + encodeURIComponent('أحمد'));
  const withoutHamza = await j('/api/couriers?all=1&q=' + encodeURIComponent('احمد'));
  assert.equal(withHamza.status, 200);
  assert.equal(withoutHamza.body.length, withHamza.body.length);
  assert.ok(withHamza.body.some(r => r.fullName.includes('أحمد')));
});

test('filters by branch, type and status', async () => {
  const branch = await j('/api/couriers?all=1&branch=QCD2');
  assert.ok(branch.body.every(r => r.branch === 'QCD2'));

  const type = await j('/api/couriers?all=1&type=Part Time');
  assert.ok(type.body.every(r => r.employmentType === 'Part Time'));

  const status = await j('/api/couriers?all=1&status=Active');
  assert.ok(status.body.every(r => r.status === 'Active'));
});

/* ---------------------------------------------------------------- status + time to hire */

test('status change is recorded and sets hiredAt on first hire', async () => {
  const created = await j('/api/couriers', { method: 'POST', body: JSON.stringify(make({ status: 'OnBoarding' })) });
  const id = created.body.id;

  const patched = await j(`/api/couriers/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'Active' }) });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.status, 'Active');
  assert.ok(patched.body.hiredAt, 'hiredAt should be stamped');
  assert.equal(typeof patched.body.timeToHireDays, 'number');

  const profile = await j(`/api/couriers/${id}`);
  const statusEvents = profile.body.events.filter(e => e.type === 'status');
  assert.equal(statusEvents[0].toStatus, 'Active');
  assert.equal(statusEvents[0].fromStatus, 'OnBoarding');

  // moving away keeps the original hire date
  const back = await j(`/api/couriers/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'Inactive' }) });
  assert.equal(back.body.hiredAt, patched.body.hiredAt);
});

test('rejects an unknown status', async () => {
  const { status } = await j('/api/couriers/whatever/status', { method: 'PATCH', body: JSON.stringify({ status: 'Nope' }) });
  assert.equal(status, 400);
});

/* ---------------------------------------------------------------- metrics */

test('metrics aggregate counts, documents and time to hire', async () => {
  const { status, body } = await j('/api/metrics');
  assert.equal(status, 200);
  assert.ok(body.total >= 2);
  assert.equal(typeof body.byStatus, 'object');
  assert.equal(typeof body.timeToHire.avgDays, 'number');
  assert.ok(body.documents.complete >= 0);
  assert.equal(body.documents.complete + body.documents.incomplete, body.total);
});

/* ---------------------------------------------------------------- documents */

test('uploads an image with a thumbnail and serves both', async () => {
  const created = await j('/api/couriers', { method: 'POST', body: JSON.stringify(make()) });
  const id = created.body.id;

  // smallest valid PNG (2×2)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC', 'base64');
  const fd = new FormData();
  fd.append('kind', 'photo');
  fd.append('file', new Blob([png], { type: 'image/png' }), 'photo.png');
  fd.append('thumb', new Blob([png], { type: 'image/png' }), 'thumb.png');

  const up = await j(`/api/couriers/${id}/documents`, { method: 'POST', body: fd });
  assert.equal(up.status, 201);
  assert.equal(up.body.hasThumb, true);

  const full = await fetch(`${BASE}/api/documents/${up.body.id}`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'image/png');
  assert.ok((await full.arrayBuffer()).byteLength > 0);

  const thumb = await fetch(`${BASE}/api/documents/${up.body.id}?thumb=1`);
  assert.equal(thumb.status, 200);
  assert.ok((await thumb.arrayBuffer()).byteLength > 0);

  const download = await fetch(`${BASE}/api/documents/${up.body.id}?download=1`);
  assert.match(download.headers.get('content-disposition') || '', /attachment/);

  // the profile and the list both expose the photo id for the avatar
  const profile = await j(`/api/couriers/${id}`);
  assert.equal(profile.body.photo, up.body.id);
  assert.equal(profile.body.documents.length, 1);

  const row = (await list()).find(r => r.id === id);
  assert.equal(row.photo, up.body.id);
  assert.equal(row.thumbPhoto, up.body.id);
});

test('replacing the personal photo keeps only one', async () => {
  const created = await j('/api/couriers', { method: 'POST', body: JSON.stringify(make()) });
  const id = created.body.id;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC', 'base64');

  const send = async () => {
    const fd = new FormData();
    fd.append('kind', 'photo');
    fd.append('file', new Blob([png], { type: 'image/png' }), 'a.png');
    return j(`/api/couriers/${id}/documents`, { method: 'POST', body: fd });
  };
  const a = await send();
  const b = await send();
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);

  const profile = await j(`/api/couriers/${id}`);
  assert.equal(profile.body.documents.filter(d => d.kind === 'photo').length, 1);
});

test('rejects a non-image upload', async () => {
  const created = await j('/api/couriers', { method: 'POST', body: JSON.stringify(make()) });
  const fd = new FormData();
  fd.append('kind', 'photo');
  fd.append('file', new Blob([Buffer.from('not an image')], { type: 'text/plain' }), 'x.txt');
  const res = await j(`/api/couriers/${created.body.id}/documents`, { method: 'POST', body: fd });
  assert.ok([400, 500].includes(res.status));
});

/* ---------------------------------------------------------------- update + delete */

test('updates a record and logs the change', async () => {
  const created = await j('/api/couriers', { method: 'POST', body: JSON.stringify(make({ fullName: 'Old Name' })) });
  const id = created.body.id;

  const updated = await j(`/api/couriers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(make({ fullName: 'New Name', status: 'Active' }))
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.fullName, 'New Name');

  const profile = await j(`/api/couriers/${id}`);
  assert.ok(profile.body.events.some(e => e.type === 'status' && e.toStatus === 'Active'));
});

test('deletes a courier and its documents', async () => {
  const created = await j('/api/couriers', { method: 'POST', body: JSON.stringify(make()) });
  const id = created.body.id;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC', 'base64');
  const fd = new FormData();
  fd.append('kind', 'id_front');
  fd.append('file', new Blob([png], { type: 'image/png' }), 'id.png');
  const up = await j(`/api/couriers/${id}/documents`, { method: 'POST', body: fd });

  const del = await j(`/api/couriers/${id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);

  assert.equal((await j(`/api/couriers/${id}`)).status, 404);
  assert.equal((await j(`/api/documents/${up.body.id}`)).status, 404);
});

/* ---------------------------------------------------------------- bulk import */

const nid = () => String(28000000000000 + Math.floor(Math.random() * 999999));

const importFile = (content, name, fields = {}) => {
  const fd = new FormData();
  fd.append('file', new Blob([content], { type: 'text/csv' }), name);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return j('/api/couriers/import', { method: 'POST', body: fd });
};

test('import preview auto-maps Arabic columns without writing', async () => {
  const before = (await list()).length;
  const text = [
    'اسم المندوب\tالموبايل\tالرقم القومي\tالفرع\tنوع التوظيف\tبداية الرخصة\tانتهاء الرخصة\tالحالة',
    `سارة مصطفى\t01099998888\t${nid()}\tفرع 1\tكامل\t2025-01-01\t2027-01-01\tقيد التوظيف`
  ].join('\n');

  const fd = new FormData();
  fd.append('text', text);
  const { status, body } = await j('/api/couriers/import', { method: 'POST', body: fd });

  assert.equal(status, 200);
  assert.equal(body.summary.total, 1);
  assert.equal(body.summary.ready, 1);
  assert.equal(body.mapping.fullName, 'اسم المندوب');
  assert.equal(body.mapping.nationalId, 'الرقم القومي');
  assert.equal(body.rows[0].data.branch, 'QCD1');
  assert.equal(body.rows[0].data.employmentType, 'Full Time');
  assert.equal(body.rows[0].data.status, 'OnBoarding');
  assert.equal((await list()).length, before, 'preview must not write');
});

test('imports a CSV file, writes valid rows and skips duplicates', async () => {
  const existing = (await j('/api/couriers', { method: 'POST', body: JSON.stringify(make({ fullName: 'Already Here' })) })).body;
  const fresh = nid();

  const csv = 'Name,Phone,National ID,Branch,Employment Type,License Start,License End,Status\n' +
    `Already Here,${existing.phone},${existing.nationalId},QCD1,Full Time,2026-01-01,2028-01-01,Active\n` +
    `Imported Person,01077776666,${fresh},QCD2,Part Time,2025-05-05,2027-05-05,Active\n`;

  const { status, body } = await importFile(csv, 'couriers.csv', { mode: 'commit' });
  assert.equal(status, 200);
  assert.equal(body.created, 1);
  assert.equal(body.skipped, 1);

  const stored = await j(`/api/couriers?q=${encodeURIComponent('Imported Person')}`);
  assert.equal(stored.body.total, 1);
  assert.equal(stored.body.items[0].branch, 'QCD2');
  assert.equal(stored.body.items[0].phone, '01077776666');
});

test('reports malformed rows instead of writing them', async () => {
  const csv = 'Name,Phone,National ID,Branch,Type,License Start,License End,Status\n' +
    `Broken Phone,12345,${nid()},QCD1,Full Time,2026-01-01,2028-01-01,Active\n`;

  const { status, body } = await importFile(csv, 'bad.csv', { mode: 'commit' });
  assert.equal(status, 200);
  assert.equal(body.created, 0);
  assert.equal(body.failed, 1);
  assert.ok(body.failures[0].errors.phone);
});

test('imports a real .xlsx workbook with Excel dates and numeric phones', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Couriers');
  ws.addRow(['Full Name', 'Phone', 'National ID', 'Branch', 'Employment Type', 'License Start', 'License End', 'Status']);
  ws.addRow(['Excel Person', 1011121314, nid(), 'QCD 1', 'Full Time',
    new Date(Date.UTC(2024, 2, 3)), new Date(Date.UTC(2027, 2, 2)), 'Active']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());

  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'couriers.xlsx');
  fd.append('mode', 'commit');
  const { status, body } = await j('/api/couriers/import', { method: 'POST', body: fd });

  assert.equal(status, 200);
  assert.equal(body.created, 1);

  const found = await j(`/api/couriers?q=${encodeURIComponent('Excel Person')}`);
  const row = found.body.items[0];
  assert.equal(row.phone, '01011121314');       // Excel dropped the leading zero
  assert.equal(row.licenseStart, '2024-03-03'); // serial date, not a raw number
  assert.equal(row.licenseEnd, '2027-03-02');
});

test('updateExisting refreshes a courier that is already stored', async () => {
  const created = (await j('/api/couriers', { method: 'POST', body: JSON.stringify(make({ fullName: 'Before Import' })) })).body;

  const csv = 'Name,Phone,National ID,Branch,Type,License Start,License End,Status\n' +
    `After Import,${created.phone},${created.nationalId},QCD2,Part Time,2026-01-01,2028-01-01,Active\n`;

  const { body } = await importFile(csv, 'update.csv', { mode: 'commit', updateExisting: '1' });
  assert.equal(body.updated, 1);
  assert.equal(body.created, 0);

  const row = (await j(`/api/couriers/${created.id}`)).body;
  assert.equal(row.fullName, 'After Import');
  assert.equal(row.branch, 'QCD2');
});

test('rejects an empty import payload', async () => {
  const fd = new FormData();
  fd.append('text', '   ');
  const { status, body } = await j('/api/couriers/import', { method: 'POST', body: fd });
  assert.equal(status, 400);
  assert.match(body.error, /Nothing to import/i);
});

