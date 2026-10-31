/**
 * Bulk import: turn an Excel (.xlsx) / CSV / pasted table into courier records.
 *
 *   const table  = await readTable(buffer, 'couriers.xlsx');
 *   const mapping = autoMap(table.headers);
 *   const result = buildRows(table, mapping, defaults, existingIds);
 *
 * Nothing here writes to the database — the endpoint decides what to do with
 * the rows after the user has seen the preview.
 */
import ExcelJS from 'exceljs';
import { validate, parseRecord, BRANCHES, EMPLOYMENT_TYPES, STATUSES } from './validate.js';

/* ------------------------- Field catalogue ------------------------- */

export const FIELDS = [
  {
    key: 'fullName', label: 'Full name', required: true,
    aliases: ['name', 'full name', 'fullname', 'courier name', 'driver name', 'rider name',
      'الاسم', 'اسم', 'اسم المندوب', 'اسم الكورير', 'الاسم بالكامل', 'الاسم كامل']
  },
  {
    key: 'phone', label: 'Phone', required: true,
    aliases: ['phone', 'phone number', 'mobile', 'mobile number', 'tel', 'telephone', 'whatsapp',
      'contact', 'رقم الموبايل', 'الموبايل', 'موبايل', 'رقم الهاتف', 'الهاتف', 'تليفون',
      'رقم التليفون', 'رقم الواتس', 'الواتساب']
  },
  {
    key: 'nationalId', label: 'National ID', required: true,
    aliases: ['national id', 'nationalid', 'national number', 'id number', 'id', 'nid',
      'الرقم القومي', 'رقم قومي', 'البطاقة', 'رقم البطاقة', 'رقم الهوية']
  },
  {
    key: 'branch', label: 'Branch',
    aliases: ['branch', 'location', 'area', 'site', 'فرع', 'الفرع', 'المنطقة', 'المنطقه']
  },
  {
    key: 'employmentType', label: 'Employment type',
    aliases: ['employment type', 'employment', 'type', 'contract', 'contract type', 'shift type',
      'نوع التوظيف', 'نوع الدوام', 'نوع', 'الدوام', 'التفرغ', 'نوع العقد']
  },
  {
    key: 'licenseStart', label: 'License start',
    aliases: ['license start', 'licence start', 'license start date', 'licence start date',
      'start date', 'license from', 'issue date', 'بداية الرخصة', 'تاريخ بداية الرخصة',
      'بداية', 'تاريخ الإصدار', 'تاريخ الاصدار', 'تاريخ بدء الرخصة']
  },
  {
    key: 'licenseEnd', label: 'License end',
    aliases: ['license end', 'licence end', 'license end date', 'licence end date', 'end date',
      'expiry', 'expiry date', 'license expiry', 'license expiry date', 'license expiration',
      'نهاية الرخصة', 'تاريخ انتهاء الرخصة', 'انتهاء', 'نهاية', 'تاريخ الانتهاء', 'تاريخ انتهاء']
  },
  {
    key: 'outlook', label: 'Outlook email',
    aliases: ['outlook', 'outlook account', 'email', 'e mail', 'mail', 'e-mail',
      'بريد', 'الإيميل', 'الايميل', 'البريد الالكتروني', 'البريد الإلكتروني', 'ايميل']
  },
  {
    key: 'plate', label: 'Plate / bike',
    aliases: ['plate', 'plate number', 'bike', 'motorcycle', 'bike plate', 'vehicle', 'vehicle plate',
      'لوحة', 'اللوحة', 'لوحة السيارة', 'رقم اللوحة', 'الموتوسيكل', 'الموتوسيكل', 'الدراجة']
  },
  {
    key: 'status', label: 'Status',
    aliases: ['status', 'state', 'stage', 'current status', 'الحالة', 'حالة', 'الوضع', 'المرحلة']
  }
];

/* ------------------------- Small text helpers ------------------------- */

const AR_DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };
const toLatinDigits = (s) => String(s).replace(/[٠-٩۰-۹]/g, (d) => AR_DIGITS[d] ?? d);

/** Lowercase, unify Arabic letters, strip punctuation — for header matching only. */
function normKey(s) {
  return toLatinDigits(s)
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670]/g, '')      // tashkeel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const clean = (v) => toLatinDigits(String(v ?? ''))
  .replace(/\u00A0/g, ' ')
  .trim()
  .replace(/\s+/g, ' ')
  .slice(0, 400);

/* ------------------------- Reading the file ------------------------- */

const isXlsx = (buf) => buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b; // "PK"

function decodeText(buf) {
  let bytes = buf;
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) bytes = bytes.subarray(3);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Excel on Windows saves Arabic CSV as Windows-1256 — decode that instead of
    // showing the user a screen full of question marks.
    try { return new TextDecoder('windows-1256').decode(bytes); } catch { return bytes.toString('utf8'); }
  }
}

/** RFC-4180-ish parser: handles quotes, embedded separators and newlines. */
function splitDelimited(text, delim) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; }
      } else cell += ch;
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === delim) {
      row.push(cell); cell = '';
    } else if (ch === '\n') {
      row.push(cell); rows.push(row); row = []; cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

function detectDelimiter(text) {
  const firstLine = text.slice(0, text.indexOf('\n') >= 0 ? text.indexOf('\n') : text.length);
  const counts = { '\t': 0, ';': 0, ',': 0, '|': 0 };
  let quoted = false;
  for (const ch of firstLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch]++;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ',';
}

/** Score each of the first rows so a title row above the header is skipped. */
function pickHeaderRow(matrix) {
  const limit = Math.min(matrix.length, 12);
  let best = { index: -1, score: 0 };
  for (let i = 0; i < limit; i++) {
    const cells = matrix[i].map((c) => normKey(c)).filter(Boolean);
    if (cells.length < 2) continue;
    let score = 0;
    for (const cell of cells) {
      for (const field of FIELDS) {
        if (field.aliases.some((a) => normKey(a) === cell)) { score += 3; break; }
      }
    }
    if (score > best.score) best = { index: i, score };
  }
  if (best.score >= 2) return best.index;

  // No recognisable header — fall back to the first row with 2+ values.
  for (let i = 0; i < matrix.length; i++) {
    if (matrix[i].filter((c) => String(c ?? '').trim() !== '').length >= 2) return i;
  }
  return matrix.findIndex((r) => r.some((c) => String(c ?? '').trim() !== ''));
}

/** Turn a header matrix + data rows into `{ headers, rows }`. */
function buildTable(matrix) {
  if (!matrix.length) throw new Error('The file is empty.');

  const headerIdx = pickHeaderRow(matrix);
  if (headerIdx < 0) throw new Error('Could not find a header row in this file.');

  const rawHeaders = matrix[headerIdx].map((h) => clean(h));
  const width = Math.max(...matrix.map((r) => r.length), rawHeaders.length);
  const seen = new Map();
  const headers = [];
  for (let i = 0; i < width; i++) {
    let name = rawHeaders[i] || `Column ${i + 1}`;
    const n = (seen.get(name) || 0) + 1;
    seen.set(name, n);
    if (n > 1) name = `${name} (${n})`;
    headers.push(name);
  }

  const rows = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const cells = matrix[i];
    if (!cells || cells.every((c) => String(c ?? '').trim() === '')) continue;
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = clean(cells[idx] ?? ''); });
    rows.push(obj);
  }

  if (!rows.length) throw new Error('The file has headers but no data rows.');
  return { headers, rows };
}

/** Read a .xlsx / .xlsm buffer (first worksheet with data). */
async function readXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const sheet = wb.worksheets.find((ws) => ws.rowCount > 0);
  if (!sheet) throw new Error('The workbook has no sheets with data.');

  const matrix = [];
  const width = Math.max(sheet.columnCount, 1);
  const last = Math.min(sheet.rowCount, 10000);
  for (let r = 1; r <= last; r++) {
    const row = sheet.getRow(r);
    const cells = [];
    for (let c = 1; c <= width; c++) cells.push(cellValue(row.getCell(c).value));
    matrix.push(cells);
  }
  return buildTable(matrix);
}

/** Normalise every ExcelJS cell shape to a string (dates → YYYY-MM-DD). */
function cellValue(v) {
  if (v == null) return '';
  if (v instanceof Date) return isoDate(v);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if (v.text != null) return String(v.text);
    if (v.result != null) return cellValue(v.result);
    if (v.hyperlink) return String(v.hyperlink);
    if (v.error) return '';
    return '';
  }
  return String(v);
}

/** Excel serial date (1900 system) → Date. */
function serialToDate(n) {
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = Math.round((n - 25569) * 86400 * 1000);
  return new Date(ms);
}

const isoDate = (d) => {
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/** Best-effort date parser: Date, Excel serial, ISO, D/M/Y, Y/M/D. */
function toIsoDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return isoDate(value);
  const raw = toLatinDigits(String(value ?? '')).trim();
  if (!raw) return '';

  if (/^\d{5}$/.test(raw)) {
    const d = serialToDate(Number(raw));
    if (d) return isoDate(d);
  }

  const iso = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  const dmy = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (dmy) {
    let [, a, b, y] = dmy;
    if (y.length === 2) y = `20${y}`;
    // Egyptian sheets are day-first; fall back to month-first when impossible.
    let day = Number(a);
    let month = Number(b);
    if (month > 12 && day <= 12) [day, month] = [month, day];
    if (month < 1 || month > 12 || day < 1 || day > 31) return '';
    const d = new Date(Date.UTC(Number(y), month - 1, day));
    return Number.isNaN(d.getTime()) ? '' : isoDate(d);
  }
  return '';
}

/* ------------------------- Mapping ------------------------- */

/** Guess which column feeds which field. */
export function autoMap(headers) {
  const used = new Set();
  const mapping = {};
  const keys = headers.map((h) => normKey(h));

  for (const field of FIELDS) {
    let best = { header: null, score: 0 };
    keys.forEach((key, i) => {
      if (!key || used.has(headers[i])) return;
      let score = 0;
      for (const alias of field.aliases) {
        const a = normKey(alias);
        if (!a) continue;
        if (key === a) score = Math.max(score, 100);
        else if (key.startsWith(a) || key.endsWith(a)) score = Math.max(score, 70);
        else if (a.length >= 4 && key.includes(a)) score = Math.max(score, 50);
      }
      if (score > best.score) best = { header: headers[i], score };
    });
    if (best.header) {
      mapping[field.key] = best.header;
      used.add(best.header);
    }
  }
  return mapping;
}

/* ------------------------- Value normalisation ------------------------- */

const digitsOnly = (s) => toLatinDigits(String(s ?? '')).replace(/\D+/g, '');

function normalizePhone(raw) {
  let d = digitsOnly(raw);
  if (!d) return '';
  if (d.startsWith('0020') && d.length >= 14) d = d.slice(4);
  else if (d.startsWith('20') && d.length === 12) d = d.slice(2);
  if (d.length === 10 && /^1[0125]\d{8}$/.test(d)) d = `0${d}`;  // Excel ate the leading zero
  return d;
}

function normalizeNationalId(raw) {
  const d = digitsOnly(raw);
  if (d.length === 14) return d;
  // Excel may render a 14-digit number in scientific notation.
  const sci = String(raw ?? '').match(/^(\d(?:\.\d+)?)[eE]\+?(\d+)$/);
  if (sci) {
    const n = Number(raw);
    if (Number.isFinite(n) && String(Math.round(n)).length === 14) return String(Math.round(n));
  }
  return d;
}

function normalizeBranch(raw) {
  const v = normKey(raw);
  if (!v) return '';
  if (/qcd\s*1|qcd1|\b1\b/.test(v) && !/2/.test(v)) return 'QCD1';
  if (/qcd\s*2|qcd2|\b2\b/.test(v) && !/1/.test(v)) return 'QCD2';
  if (/qcd\s*1|qcd1/.test(v)) return 'QCD1';
  if (/qcd\s*2|qcd2/.test(v)) return 'QCD2';
  return BRANCHES.includes(raw) ? raw : '';
}

function normalizeEmployment(raw) {
  const v = normKey(raw);
  if (!v) return '';
  if (/part|بارت|جزء|نصف/.test(v) || v === 'pt') return 'Part Time';
  if (/full|كامل|فت|دوام كامل/.test(v) || v === 'ft') return 'Full Time';
  return EMPLOYMENT_TYPES.includes(raw) ? raw : '';
}

function normalizeStatus(raw) {
  const v = normKey(raw);
  if (!v) return '';
  if (/not attended|no show|لم يحضر|لم يذهب|غير حاضر/.test(v)) return 'Not Attended to D0';
  if (/attended|حضر|دي زيرو|دى زيرو|\bd0\b/.test(v)) return 'Attended to D0';
  if (/off ?board|offboard|خارج الخدمه|خارج الخدمة|انهاء|إنهاء/.test(v)) return 'OffBoarding';
  if (/on ?board|onboard|قيد التوظيف|اون بورد|تعيين|توظيف/.test(v)) return 'OnBoarding';
  if (/inactive|غير نشط|موقوف|متوقف/.test(v)) return 'Inactive';
  if (/active|نشط|فعال|شغال/.test(v)) return 'Active';
  return STATUSES.includes(raw) ? raw : '';
}

/* ------------------------- Row building ------------------------- */

/**
 * Apply the mapping + defaults, normalise every value and validate.
 * @param {{headers: string[], rows: object[]}} table
 * @param {Record<string,string>} mapping   field → header
 * @param {Record<string,string>} defaults  field → fallback value
 * @param {Set<string>} existingIds         national IDs already in the database
 */
export function buildRows(table, mapping, defaults = {}, existingIds = new Set()) {
  const rows = [];
  const seen = new Map();

  table.rows.forEach((source, i) => {
    const pick = (key) => {
      const header = mapping[key];
      const raw = header ? source[header] : '';
      return raw === undefined || raw === null || String(raw).trim() === ''
        ? (defaults[key] ?? '')
        : raw;
    };

    const data = parseRecord({
      fullName: clean(pick('fullName')),
      phone: normalizePhone(pick('phone')),
      nationalId: normalizeNationalId(pick('nationalId')),
      branch: normalizeBranch(pick('branch')),
      employmentType: normalizeEmployment(pick('employmentType')),
      licenseStart: toIsoDate(pick('licenseStart')),
      licenseEnd: toIsoDate(pick('licenseEnd')),
      outlook: clean(pick('outlook')),
      plate: clean(pick('plate')),
      status: normalizeStatus(pick('status'))
    });

    const errors = validate(data);
    const duplicate = !errors.nationalId && (existingIds.has(data.nationalId) || seen.has(data.nationalId));
    if (!errors.nationalId && !seen.has(data.nationalId)) seen.set(data.nationalId, i);

    rows.push({
      line: i + 2,                 // +2 = header row is line 1
      data,
      errors,
      duplicate,
      ok: Object.keys(errors).length === 0 && !duplicate
    });
  });

  return {
    rows,
    summary: {
      total: rows.length,
      ready: rows.filter((r) => r.ok).length,
      duplicates: rows.filter((r) => r.duplicate).length,
      invalid: rows.filter((r) => !r.ok && !r.duplicate).length
    }
  };
}

/* ------------------------- Entry points ------------------------- */

/** Read an uploaded file (.xlsx / .xlsm / .csv / .txt / .tsv). */
export async function readTable(buffer, filename = '') {
  const ext = String(filename).split('.').pop().toLowerCase();
  if (ext === 'xls' || ext === 'xlt') {
    throw new Error('The old .xls format is not supported. Open the file in Excel and use “Save As → .xlsx” (or CSV), then try again.');
  }
  if (isXlsx(buffer)) return readXlsx(buffer);
  return readTableFromText(decodeText(buffer));
}

/** Read a pasted table (TSV from Excel, or CSV). */
export function readTableFromText(text) {
  const body = String(text || '').replace(/^\uFEFF/, '');
  if (!body.trim()) throw new Error('Nothing to import — paste the rows or attach a file.');
  return buildTable(splitDelimited(body, detectDelimiter(body)));
}

/** CSV template with the canonical English headers (Excel-friendly BOM). */
export function csvTemplate() {
  const headers = ['Full Name', 'Phone', 'National ID', 'Branch', 'Employment Type',
    'License Start', 'License End', 'Outlook', 'Plate', 'Status'];
  return `\uFEFF${headers.join(',')}\r\n`;
}
