/**
 * Bankai-Hiring — end-to-end smoke test (Playwright).
 *
 *   npm run test:e2e
 *
 * Boots the server against a throw-away DB, opens the dashboard in a real
 * browser and walks the main flows: cards → search → pipeline → profile →
 * camera/drag uploads → pagination.
 *
 * Skips (exit 0 with a message) when Playwright or a Chrome binary is missing.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import zlib from 'node:zlib';

const PORT = Number(process.env.E2E_PORT || 3988);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = mkdtempSync(join(tmpdir(), 'bankai-e2e-'));
const DB = join(TMP, 'e2e.db');

const say = (...a) => console.log(...a);

/** Minimal RGB PNG encoder (no dependencies) — used for the upload test. */
function makePng(width = 1200, height = 900) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      raw[p++] = Math.round((x / width) * 255);
      raw[p++] = Math.round((y / height) * 255);
      raw[p++] = 180;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc(Buffer.concat([typeBuf, data])));
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

let failures = 0;
const check = (name, ok, extra = '') => {
  say(`${ok ? '✔' : '✖'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

async function loadPlaywright() {
  try { return await import('playwright'); }
  catch {
    say('ℹ️  Playwright is not installed — skipping e2e.\n   npm i -D playwright && npx playwright install chromium');
    return null;
  }
}

function resolveChrome(chromium) {
  const candidates = [
    process.env.CHROME_PATH,
    (() => { try { return chromium.executablePath(); } catch { return null; } })(),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);
  return candidates.find(p => existsSync(p)) || null;
}

const server = spawn(process.execPath, ['server.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(PORT), DATABASE_PATH: DB, S3_BUCKET: '', S3_ACCESS_KEY_ID: '', S3_SECRET_ACCESS_KEY: '' },
  stdio: 'ignore'
});

const cleanup = () => {
  try { server.kill(); } catch { /* gone */ }
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* locked on windows */ }
};

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* booting */ }
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

try {
  if (!await waitForServer()) throw new Error('server did not start');

  const pw = await loadPlaywright();
  if (!pw) { cleanup(); process.exit(0); }

  const chromePath = resolveChrome(pw.chromium);
  if (!chromePath) {
    say('ℹ️  No Chrome binary found — run `npx playwright install chromium`. Skipping e2e.');
    cleanup(); process.exit(0);
  }

  const browser = await pw.chromium.launch({ executablePath: chromePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push(String(e.message || e)));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#cardsGrid article, #emptyState:not(.hidden)', { timeout: 15000 });

  /* ---------------------------------------------------------- list view */
  check('KPI tiles render', (await page.locator('#summaryCards .kpi-tile').count()) === 7);
  check('insight strip renders', (await page.locator('#insights .insight').count()) === 4);
  const cards = await page.locator('#cardsGrid article').count();
  check('courier cards render', cards >= 5, `${cards} cards`);
  check('result counter shows the total', /record/.test(await page.locator('#resultCount').innerText()));

  /* ---------------------------------------------------------- search */
  await page.fill('#searchInput', 'احمد');
  await page.waitForTimeout(700);
  const searched = await page.locator('#cardsGrid article').count();
  check('Arabic search filters the list', searched >= 1 && searched < cards, `${searched} of ${cards}`);
  await page.fill('#searchInput', '');
  await page.waitForTimeout(700);
  check('clearing search restores the list', (await page.locator('#cardsGrid article').count()) === cards);

  /* ---------------------------------------------------------- kanban */
  await page.click('#viewToggle button[data-view="kanban"]');
  await page.waitForSelector('#kanbanBoard .kanban-col', { timeout: 10000 });
  check('pipeline shows every status column', (await page.locator('#kanbanBoard .kanban-col').count()) === 6);
  const boardCards = await page.locator('#kanbanBoard .kanban-card').count();
  check('pipeline contains all couriers', boardCards === cards, `${boardCards} cards`);

  // move the first card to another column through the real API helper
  const move = await page.evaluate(async () => {
    const from = [...document.querySelectorAll('#kanbanBoard .kanban-col')].find(c => c.querySelector('.kanban-card'));
    const card = from?.querySelector('.kanban-card');
    if (!card) return null;
    const target = [...document.querySelectorAll('#kanbanBoard .kanban-col')].find(c => c !== from).dataset.status;
    await window.moveToStatus(card.dataset.id, target);
    await new Promise(r => setTimeout(r, 900));
    return { target, status: document.querySelector(`#kanbanBoard .kanban-col[data-status="${CSS.escape(target)}"]`).querySelectorAll('.kanban-card').length };
  });
  check('dragging a card changes its status', move && move.status >= 1, move ? `→ ${move.target}` : 'no card');

  /* ---------------------------------------------------------- profile */
  await page.click('#viewToggle button[data-view="cards"]');
  await page.waitForTimeout(800);
  await page.click('#cardsGrid article h3');
  await page.waitForSelector('#profilePanel .doc-slot', { timeout: 10000 });
  check('profile opens with 5 document slots', (await page.locator('#profilePanel .doc-slot').count()) === 5);
  check('profile exposes camera inputs', (await page.locator('#profilePanel input[type=file][capture]').count()) === 5);
  check('profile shows the pipeline history', (await page.locator('#profilePanel ul li').count()) >= 1);
  check('profile shows time to hire', /TIME TO HIRE/i.test(await page.locator('#profilePanel').innerText()));

  /* ---------------------------------------------------------- upload (compressed + thumb) */
  // build a valid PNG in Node (no dependencies) so the browser can really decode it
  const png = makePng(1200, 900);
  const file = join(TMP, 'shot.png');
  writeFileSync(file, png);

  const photoInput = page.locator('#doc-file-photo');
  await photoInput.setInputFiles(file);
  await page.waitForTimeout(3000);
  const uploaded = await page.evaluate(async () => {
    const img = document.querySelector('.doc-slot[data-kind="photo"] img');
    if (!img) return null;
    const src = img.getAttribute('src') || '';
    return { thumb: /[?&]thumb=1/.test(src), loaded: img.complete && img.naturalWidth > 0,
             docs: (profileCourier?.documents || []).length };
  });
  check('upload stores a thumbnail used by the slot', uploaded && uploaded.thumb && uploaded.loaded,
    uploaded ? `${uploaded.docs} doc(s)` : 'no image');

  /* ---------------------------------------------------------- pagination */
  await page.click('#profilePanel button[aria-label], #profilePanel .nav-gradient button:last-child').catch(() => {});
  await page.evaluate(() => closeProfile());
  await page.waitForTimeout(500);
  await page.evaluate(async () => { model.pageSize = 2; await loadCouriers({ keepScroll: true }); });
  await page.waitForTimeout(900);
  const pager = await page.locator('#pagination button').count();
  check('pagination appears for small page sizes', pager >= 3, `${pager} buttons`);
  const firstPage = await page.locator('#cardsGrid article').count();
  await page.click('#pagination button[data-page="2"]');
  await page.waitForTimeout(900);
  const secondPage = await page.locator('#cardsGrid article').count();
  check('page 2 loads its own rows', secondPage >= 1 && secondPage <= 2, `${firstPage} → ${secondPage}`);

  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

  await browser.close();
  cleanup();
  say(failures ? `\n${failures} check(s) failed` : '\nAll e2e checks passed');
  process.exit(failures ? 1 : 0);
} catch (err) {
  say('e2e crashed:', err?.message || err);
  cleanup();
  process.exit(1);
}
