/**
 * Bankai-Hiring — Express server + SQLite persistence (Railway-ready)
 * REST endpoints consumed by the frontend dashboard in /public.
 */
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, docs, seedIfEmpty, listCouriers } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

/* Courier images (max 5MB, images only) kept in-memory then persisted as blobs */
const KINDS = ['photo', 'id_front', 'id_back', 'license_front', 'license_back'];
const KIND_LABELS = {
  photo: 'personal-photo', id_front: 'id-card-front', id_back: 'id-card-back',
  license_front: 'license-front', license_back: 'license-back'
};
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, !!MIME_EXT[file.mimetype])
});

/* ------------------------- Static frontend ------------------------- */
app.use(express.static(path.join(__dirname, 'public')));

/* ------------------------- API: Couriers CRUD ------------------------- */

// Health check (used by Railway)
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'bankai-hiring' }));

// Read: all couriers
app.get('/api/couriers', (_req, res) => {
  res.json(listCouriers());
});

// Read: one courier + its documents metadata (profile view)
app.get('/api/couriers/:id', (req, res) => {
  const courier = db.get(req.params.id);
  if (!courier) return res.status(404).json({ error: 'Courier not found.' });
  const documents = docs.list(courier.id);
  res.json({
    ...courier,
    photo: documents.find(d => d.kind === 'photo')?.id || null, // so the header avatar renders
    documents
  });
});

/* ------------------------- Documents: upload / view / download / delete ------------------------- */

// Upload an image (kind: photo | id_front | id_back | license_front | license_back)
app.post('/api/couriers/:id/documents', upload.single('file'), (req, res) => {
  const courier = db.get(req.params.id);
  if (!courier) return res.status(404).json({ error: 'Courier not found.' });

  const kind = String(req.body.kind || '');
  if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Invalid document kind.' });
  if (!req.file) return res.status(400).json({ error: 'No image file received (jpg/png/webp, max 5MB).' });

  // Personal photo is unique: replace any previous photo document
  if (kind === 'photo') {
    docs.list(courier.id).filter(d => d.kind === 'photo').forEach(d => docs.remove(d.id));
  }

  const doc = docs.add({
    courierId: courier.id,
    kind,
    mime: req.file.mimetype,
    size: req.file.size,
    data: req.file.buffer
  });
  res.status(201).json(doc);
});

// View (inline) or download (?download=1) a stored image
app.get('/api/documents/:id', (req, res) => {
  const doc = docs.get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });

  const courier = db.get(doc.courier_id);
  const name = courier ? courier.fullName.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() : 'courier';
  const ext = MIME_EXT[doc.mime] || 'jpg';
  const filename = `bankai-${name}-${KIND_LABELS[doc.kind]}.${ext}`.replace(/\s+/g, '_');

  res.setHeader('Content-Type', doc.mime);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  if (req.query.download) {
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  } else {
    res.setHeader('Content-Disposition', `inline`);
  }
  res.send(doc.data);
});

// Delete a stored image
app.delete('/api/documents/:id', (req, res) => {
  const doc = docs.get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  docs.remove(doc.id);
  res.json({ ok: true });
});

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
    const created = db.create(data);
    res.status(201).json(created);
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

// Quick status change
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
app.delete('/api/couriers/:id', (req, res) => {
  const deleted = db.remove(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Courier not found.' });
  res.json({ ok: true });
});

/* ------------------------- Boot ------------------------- */
seedIfEmpty(); // first run: 4 realistic demo records

app.listen(PORT, () => {
  console.log(`✅ Bankai-Hiring API + dashboard running on port ${PORT}`);
});
