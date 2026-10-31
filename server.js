/**
 * Bankai-Hiring — Express server + SQLite persistence (Railway-ready)
 * REST endpoints consumed by the frontend dashboard in /public.
 */
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, docs, events, seedIfEmpty } from './db.js';
import { storage, s3Enabled, objectKey } from './storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));

/* Courier images (max 5MB each, images only). Two files per upload:
   `file` = the compressed full image, `thumb` = small preview for cards. */
const KINDS = ['photo', 'id_front', 'id_back', 'license_front', 'license_back'];
const KIND_LABELS = {
  photo: 'personal-photo', id_front: 'id-card-front', id_back: 'id-card-back',
  license_front: 'license-front', license_back: 'license-back'
};
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, cb) => cb(null, !!MIME_EXT[file.mimetype])
});

/* ------------------------- Static frontend ------------------------- */
app.use(express.static(path.join(__dirname, 'public')));

/* ------------------------- API: Couriers ------------------------- */

// Health check (used by Railway) — also reports the storage backend
app.get('/api/health', (_req, res) => res.json({
  ok: true, service: 'bankai-hiring', version: 2, storage: storage.info()
}));

/**
 * Read: paginated + filterable list.
 *   ?page=1&pageSize=24&q=&status=&branch=&type=&sort=newest
 *   ?all=1  → plain array (used by the kanban board and CSV export)
 */
app.get('/api/couriers', (req, res) => {
  const { page, pageSize, q, status, branch, type, sort, all } = req.query;
  const filters = { q: String(q || ''), status: String(status || ''), branch: String(branch || ''),
                    type: String(type || ''), sort: String(sort || 'newest') };
  if (String(all) === '1') return res.json(db.filterAll(filters));
  res.json(db.list({ ...filters, page: Number(page) || 1, pageSize: Number(pageSize) || 24 }));
});

// Read: one courier + documents + pipeline history
app.get('/api/couriers/:id', (req, res) => {
  const courier = db.get(req.params.id);
  if (!courier) return res.status(404).json({ error: 'Courier not found.' });
  const documents = docs.list(courier.id);
  res.json({
    ...courier,
    photo: documents.find(d => d.kind === 'photo')?.id || null,
    documents,
    events: events.list(courier.id, 30)
  });
});

// Aggregated numbers for the KPI panel (counts, time-to-hire, documents)
app.get('/api/metrics', (_req, res) => res.json(db.metrics()));

// Recent pipeline activity
app.get('/api/events', (req, res) => {
  res.json(events.recent(Math.min(100, Number(req.query.limit) || 20)));
});

/* ------------------------- Documents ------------------------- */

function sendImage(res, doc, buf, { thumb = false, download = false } = {}) {
  const courier = db.get(doc.courier_id);
  const name = courier ? courier.fullName.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() : 'courier';
  const ext = MIME_EXT[doc.mime] || 'jpg';
  const suffix = thumb ? '-preview' : '';
  const filename = `bankai-${name}-${KIND_LABELS[doc.kind]}${suffix}.${ext}`.replace(/\s+/g, '_');

  res.setHeader('Content-Type', doc.mime || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('Content-Disposition', download
    ? `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    : 'inline');
  res.send(buf);
}

// Upload (or replace) an image. Multipart: kind, file, thumb?
app.post('/api/couriers/:id/documents', upload.fields([{ name: 'file', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]),
  async (req, res) => {
    try {
      const courier = db.get(req.params.id);
      if (!courier) return res.status(404).json({ error: 'Courier not found.' });

      const kind = String(req.body.kind || '');
      if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Invalid document kind.' });

      const file = req.files?.file?.[0];
      const thumb = req.files?.thumb?.[0];
      if (!file) return res.status(400).json({ error: 'No image file received (jpg/png/webp, max 5MB).' });

      // Personal photo is unique: replace the previous one (and its stored objects)
      if (kind === 'photo') {
        for (const d of docs.list(courier.id).filter(d => d.kind === 'photo')) {
          const old = docs.get(d.id);
          if (old) { await storage.del(old.file_key); await storage.del(old.thumb_key); }
          docs.remove(d.id);
        }
      }

      const docId = crypto.randomUUID();
      const ext = MIME_EXT[file.mimetype];
      const key = objectKey(courier.id, docId, '', ext);
      const stored = await storage.put(key, file.buffer, file.mimetype);

      let storedThumb = { storage: 'db', key: null };
      let thumbExt = ext;
      if (thumb) {
        thumbExt = MIME_EXT[thumb.mimetype] || ext;
        storedThumb = await storage.put(objectKey(courier.id, docId, 'thumb', thumbExt), thumb.buffer, thumb.mimetype);
      }

      const doc = docs.add({
        id: docId,
        courierId: courier.id,
        kind,
        mime: file.mimetype,
        size: file.size,
        data: stored.storage === 'db' ? file.buffer : null,
        thumb: storedThumb.storage === 'db' && thumb ? thumb.buffer : null,
        thumbSize: thumb ? thumb.size : null,
        storage: stored.storage,
        fileKey: stored.key,
        thumbKey: storedThumb.key
      });

      events.add(courier.id, 'document', { note: kind });
      res.status(201).json(doc);
    } catch (err) {
      console.error('upload failed:', err);
      res.status(500).json({ error: 'Could not store the image.' });
    }
  });

// View inline, preview (?thumb=1) or download (?download=1)
app.get('/api/documents/:id', async (req, res) => {
  try {
    const doc = docs.get(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found.' });

    const wantThumb = req.query.thumb != null && doc.thumb_size;
    if (doc.storage === 's3') {
      const key = wantThumb ? doc.thumb_key : doc.file_key;
      const pub = storage.publicUrl(key);
      if (pub && !req.query.download) return res.redirect(302, pub);
      const buf = await storage.get(key);
      return sendImage(res, doc, buf, { thumb: wantThumb, download: !!req.query.download });
    }

    const buf = wantThumb ? doc.thumb : doc.data;
    if (!buf) return res.status(404).json({ error: 'Document data missing.' });
    sendImage(res, doc, buf, { thumb: wantThumb, download: !!req.query.download });
  } catch (err) {
    console.error('document read failed:', err);
    res.status(500).json({ error: 'Could not read the image.' });
  }
});

// Delete a stored image (DB row + S3 objects)
app.delete('/api/documents/:id', async (req, res) => {
  const doc = docs.get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  await storage.del(doc.file_key);
  await storage.del(doc.thumb_key);
  docs.remove(doc.id);
  res.json({ ok: true });
});

/* ------------------------- Validation ------------------------- */

// Server-side validation (mirrors the client-side rules)
function validate(data) {
  const e = {};
  if (!data.fullName || data.fullName.trim().length < 3) e.fullName = 'Full name is required (min 3 chars).';
  if (!data.phone || !/^01[0125][0-9]{8}$/.test(String(data.phone || '').trim())) e.phone = 'Phone must be a valid Egyptian mobile (11 digits).';
  if (!data.nationalId || !/^\d{14}$/.test(String(data.nationalId || '').trim())) e.nationalId = 'National ID must be exactly 14 digits.';
  if (!['QCD1', 'QCD2'].includes(data.branch)) e.branch = 'Branch must be QCD1 or QCD2.';
  if (!['Full Time', 'Part Time'].includes(data.employmentType)) e.type = 'Employment type must be Full Time or Part Time.';
  if (!data.licenseStart) e.licenseStart = 'License start date is required.';
  if (!data.licenseEnd || (data.licenseStart && String(data.licenseEnd) < String(data.licenseStart))) e.licenseEnd = 'End date is required and must be after the start date.';
  if (data.outlook && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.outlook).trim())) e.outlook = 'Outlook account must be a valid email.';
  if (!['Active', 'Inactive', 'Attended to D0', 'Not Attended to D0', 'OnBoarding', 'OffBoarding'].includes(data.status)) e.status = 'Invalid courier status.';
  return e;
}

function parseRecord(body) {
  return {
    fullName: String(body.fullName ?? '').trim(),
    phone: String(body.phone ?? '').trim(),
    nationalId: String(body.nationalId ?? '').trim(),
    branch: String(body.branch ?? ''),
    employmentType: String(body.employmentType ?? ''),
    licenseStart: String(body.licenseStart ?? '').trim(),
    licenseEnd: String(body.licenseEnd ?? '').trim(),
    outlook: String(body.outlook ?? '').trim(),
    plate: String(body.plate ?? '').trim(),
    status: String(body.status ?? '')
  };
}

// Create
app.post('/api/couriers', (req, res) => {
  const data = parseRecord(req.body);
  const errors = validate(data);
  if (Object.keys(errors).length) return res.status(400).json({ errors });

  try {
    res.status(201).json(db.create(data));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ errors: { nationalId: 'A courier with this National ID already exists.' } });
    }
    console.error(err);
    res.status(500).json({ error: 'Could not create courier.' });
  }
});

// Update (full record)
app.put('/api/couriers/:id', (req, res) => {
  const existing = db.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Courier not found.' });

  const data = parseRecord({ ...existing, ...req.body });
  const errors = validate(data);
  if (Object.keys(errors).length) return res.status(400).json({ errors });

  try {
    res.json(db.update(req.params.id, data));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ errors: { nationalId: 'A courier with this National ID already exists.' } });
    }
    console.error(err);
    res.status(500).json({ error: 'Could not update courier.' });
  }
});

// Quick status change (kanban drag & drop + profile selector)
app.patch('/api/couriers/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['Active', 'Inactive', 'Attended to D0', 'Not Attended to D0', 'OnBoarding', 'OffBoarding'].includes(status)) {
    return res.status(400).json({ error: 'Invalid courier status.' });
  }
  const updated = db.updateStatus(req.params.id, status);
  if (!updated) return res.status(404).json({ error: 'Courier not found.' });
  res.json(updated);
});

// Delete
app.delete('/api/couriers/:id', async (req, res) => {
  const courier = db.get(req.params.id);
  if (!courier) return res.status(404).json({ error: 'Courier not found.' });
  for (const d of docs.list(courier.id)) {
    const row = docs.get(d.id);
    if (row) { await storage.del(row.file_key); await storage.del(row.thumb_key); }
  }
  res.json({ ok: db.remove(courier.id) });
});

/* ------------------------- Boot ------------------------- */
seedIfEmpty(); // first run: 5 realistic demo records

app.listen(PORT, () => {
  console.log(`✅ Bankai-Hiring API + dashboard running on port ${PORT} (storage: ${storage.mode})`);
  if (!s3Enabled) console.log('ℹ️  S3/R2 not configured — images are stored as SQLite BLOBs.');
});
