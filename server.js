/**
 * Bankai-Hiring — Express server + SQLite persistence (Railway-ready)
 * REST endpoints consumed by the frontend dashboard in /public.
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, seedIfEmpty, listCouriers } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

/* ------------------------- Static frontend ------------------------- */
app.use(express.static(path.join(__dirname, 'public')));

/* ------------------------- API: Couriers CRUD ------------------------- */

// Health check (used by Railway)
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'bankai-hiring' }));

// Read: all couriers
app.get('/api/couriers', (_req, res) => {
  res.json(listCouriers());
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
  if (!['Active', 'Inactive', 'Attended to D0', 'Not Attended to D0'].includes(data.status)) e.status = 'Invalid courier status.';
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
  if (!['Active', 'Inactive', 'Attended to D0', 'Not Attended to D0'].includes(status)) {
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
