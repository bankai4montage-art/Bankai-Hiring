# Bankai-Hiring

A modern, responsive full-stack web application for managing **courier hiring** — records, branches, licenses, and status tracking.

- **Frontend:** HTML5 + Tailwind CSS (CDN) + Vanilla JS
- **Backend:** Node.js (Express) REST API
- **Database:** SQLite (better-sqlite3), persisted on a Railway Volume
- **Live deployment:** https://bankai-hiring-production.up.railway.app

## 📁 Project Structure

```
Bankai-Hiring/
├── public/
│   ├── index.html          # Dashboard UI (list, profiles, uploads)
│   └── assets/
│       ├── styles.css      # Compiled Tailwind CSS (self-hosted, no CDN)
│       ├── tailwind.src.css# Build input for the CSS
│       ├── fonts.css       # Self-hosted font-face rules
│       └── fonts/          # Inter + Cairo woff2 files
├── server.js               # Express server: static frontend + REST endpoints + uploads
├── db.js                   # SQLite layer (couriers, documents, status events, migrations)
├── storage.js              # Image storage: SQLite BLOBs or S3 / Cloudflare R2
├── tests/
│   ├── api.test.js         # node:test — endpoints, validation, pagination, uploads
│   └── e2e.mjs             # Playwright smoke test (list, search, profile, upload)
├── build.js                # npm run build:css → compiles public/assets/styles.css
├── fetch-fonts.js          # npm run fetch:fonts → downloads self-hosted fonts (one-time)
├── package.json            # Dependencies & scripts
├── railway.json            # Railway build/deploy config (NIXPACKS + npm start)
├── README.md
└── LICENSE                 # MIT
```

**Zero external dependencies at runtime** — Tailwind is pre-compiled to a local CSS file and fonts (Inter + Cairo) are self-hosted, so the app works fully offline / on isolated networks.

## 🚀 How to Run

### Local (requires Node.js 22+)

```bash
npm install
npm start
# open http://localhost:3000
```

The database file is created at `data/bankai-hiring.db` (set `DATABASE_PATH` to override). On first boot the server seeds 5 realistic demo records.

To regenerate the compiled CSS after changing markup/classes: `npm run build:css`.

### Tests

```bash
npm test            # API tests (node:test) — boots the server on a throw-away DB
npm run test:e2e    # browser smoke test (Playwright) — list, search, profile, uploads
```

`npm run test:e2e` needs Playwright and a browser: `npm i -D playwright && npx playwright install chromium`
(or set `CHROME_PATH` to an installed Chrome). It skips cleanly when no browser is found.

### Image storage (optional S3 / R2)

By default images are stored as BLOBs in SQLite. To keep them in a bucket instead:

| Variable | Example | Notes |
|---|---|---|
| `S3_BUCKET` | `bankai-hiring` | required to enable S3 mode |
| `S3_ENDPOINT` | `https://<account>.r2.cloudflarestorage.com` | leave empty for AWS S3 |
| `S3_REGION` | `auto` (R2) / `eu-west-1` (AWS) | defaults to `auto` |
| `S3_ACCESS_KEY_ID` | — | required |
| `S3_SECRET_ACCESS_KEY` | — | required |
| `S3_PUBLIC_BASE_URL` | `https://cdn.example.com` | optional: images are 302-redirected here |
| `S3_PREFIX` | `bankai-hiring` | key prefix inside the bucket |

`/api/health` reports the active backend (`storage.mode`). Without `S3_PUBLIC_BASE_URL` the API streams the objects itself, so the app works either way.

### Railway (production)

Deployed as the **`bankai-hiring`** service in the `reliable-trust` project:

- Build: NIXPACKS → `npm start`
- Persistent **Volume mounted at `/data`** with `DATABASE_PATH=/data/bankai-hiring.db` so records survive redeploys
- Public domain: `bankai-hiring-production.up.railway.app`
- Auto-deploys from the `main` branch of this repository

## 🌐 REST API

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/couriers` | Paginated list — `page, pageSize, q, status, branch, type, sort` → `{items,total,page,pages}`; `?all=1` returns an array |
| GET | `/api/couriers/:id` | One courier + documents + status history + time-to-hire |
| GET | `/api/metrics` | Counts, document completeness and time-to-hire averages |
| GET | `/api/events` | Recent status-change activity (`?limit=`) |
| POST | `/api/couriers` | Create (full validation, 400 + field errors on failure) |
| PUT | `/api/couriers/:id` | Update a full record |
| PATCH | `/api/couriers/:id/status` | Quick status change |
| DELETE | `/api/couriers/:id` | Delete a record (its documents cascade) |
| POST | `/api/couriers/:id/documents` | Upload image (`kind` + `file` + optional `thumb`) |
| GET | `/api/documents/:id` | View image inline (`?thumb=1` for the preview) |
| GET | `/api/documents/:id?download=1` | Download image as file |
| DELETE | `/api/documents/:id` | Delete an image |

## ✨ Features

### Dashboard & Data
- **App shell layout** — a fixed dark **sidebar** (brand, workspace navigation, live status overview with per-status counters, database footer) plus a sticky top bar (page context, global search, primary action) and a scrollable content column. On mobile the sidebar becomes a slide-in drawer with a backdrop.
- **KPI panel** — one grouped panel: a gradient "Total couriers" hero tile plus a tile per status. Every tile shows its icon, live count and a share bar, and doubles as a quick filter.
- **Compact clickable cards** — each courier is a small, clean one-row card showing only the essentials: personal photo, name, national ID, branch, Full/Part time and status, with a status-coloured accent edge. Clicking the card opens the **full courier profile** — no data clutter, no horizontal scrolling.
- **Global search** in the top bar (press `/` to focus) — instant search by name, phone, national ID or plate number.
- **Quick filters**: Branch (`QCD1`/`QCD2`), Employment Type (`Full Time`/`Part Time`), Status — plus a **Sort** selector (newest, name A→Z/Z→A, license expiring first, status, branch). Active filters appear as removable chips above the results.
- **CSV export** from the toolbar or the sidebar "Export report" action.
- **One layout** - a paged card grid (12/24/48/96 per page) with page numbers and the total count.
- **Pagination** — server-side paging (`24` per page by default, 12/24/48/96) with page numbers and the total count.
- **Hiring insights** — a compact strip above the results: average **time-to-hire**, hired share, documents completeness and how many are still in progress.
- **Smart Arabic search** — searching `احمد` also finds `أحمد` (letter normalisation for أ/إ/آ/ا, ى/ي, ة/ه and tashkeel).

### CRUD Operations
- **Create** — a clean modal form to add a new courier record with client + server validation.
- **Read** — card list with live search and filters, data loaded from the REST API.
- **Update**:
  - Edit any record via the same modal form (prefilled).
  - **Quick status change** from the profile selector.
- **Delete** — removal with a confirmation prompt.
- **Audit trail** — every create / update / status change / document upload is recorded in `courier_events` and shown as a timeline inside the profile.
- **Persistence** — records are stored in a **SQLite database**; changes are durable across refreshes, devices, and redeploys.

### Extra Features
- **Courier profiles** — clicking a card opens a full profile with every field, an inline status chip + quick status selector, an Edit shortcut, the **activity timeline** and the **time-to-hire** badge.
- **Photo & document uploads** — every profile has 5 upload slots:
  - 🧑 **Personal photo** — shown on the compact card avatar too (upload once, visible everywhere).
  - 🪪 **ID card** — front & back.
  - 📜 **Personal license** — front & back.
- **Three ways to add an image**: file picker, **camera capture** on mobile (`capture="environment"`), or **drag & drop / paste** straight onto the slot.
- **Automatic compression** — images are downscaled to 1600px and re-encoded as JPEG in the browser before upload (a 5MB photo usually lands around 200-400KB), and a **480px thumbnail** is generated for the cards, so the dashboard stays fast.
- **Storage backends** — images live in SQLite by default; set the `S3_*` variables to store them in **AWS S3 / Cloudflare R2** instead (the DB then keeps only metadata + keys).
- **View & download** — every uploaded image can be opened full-size or downloaded with a friendly filename (e.g. `bankai_Ahmed_Mohamed_id-card-front.png`). The personal photo is unique per courier — re-uploading replaces it (and deletes the old objects).
- **CSV export** — exports exactly what you currently see (with filters + sorting), UTF-8 BOM so Arabic renders correctly in Excel.
- **Duplicate record** — from the profile/edit modals a copy button opens the add form prefilled (edit the National ID, then save).
- **Clickable summary cards** — cards double as quick filters (click "Active" to show actives only, click "Total Couriers" to reset).
- **Copy to clipboard** — click the **Phone**, **National ID** (on the card and inside the profile) or the **Outlook account** and the value is copied instantly, with a toast confirmation.
- **Animated counters** — summary numbers ease from their previous value to the new one after every change.
- **License expiry warnings** (inside the courier profile only):
  - ⚠ **Red badge** — "Expired" when the license end date has passed.
  - 🟡 **Pulsing amber badge** — "Expiring in Xd" when less than 30 days remain.

### Design & Animations
- **Sidebar + top bar app shell**, hairline-separated KPI panel, removable filter chips, and a dark → blue gradient brand system.
- Motion: staggered KPI reveal on first paint, staggered card entrance on every filter change, hover lift + light sweep on cards, status-coloured accent edge that thickens on hover, avatar micro-zoom, sidebar item slide/glow, mobile drawer slide, animated counters, skeleton shimmer.
- **Modern cards**: light sweep across courier cards on hover, icon tilt on the KPI tiles, zoom-in effect with a centered "view" button on every uploaded document, and staggered pop-in for the 5 document slots.
- Fully **responsive** — mobile drawer navigation, single-column profile details on small screens, zero horizontal scrolling at any width.
- **Bilingual typography** — Inter for Latin text and Cairo for Arabic names, so mixed Arabic/English data renders seamlessly.
- Toast notifications, modal pop animations, Escape key to close dialogs, and `prefers-reduced-motion` support.

### Courier Model — Fields & Validation

| Field | Type | Rules |
|---|---|---|
| Full Name | Text | Required, min 3 chars (Arabic & English supported) |
| Phone Number | Tel | Required, Egyptian mobile format `01[0125]XXXXXXXX` |
| National ID | Text | Required, exactly **14 digits** |
| Branch | Select | `QCD1` or `QCD2` |
| Employment Type | Select | `Full Time` or `Part Time` |
| License Start Date | Date | Required |
| License End Date | Date | Required, must be after start date |
| Outlook Account | Email | Optional, must be a valid email |
| Motorcycle Plate Number | Text | Optional |
| Courier Status | Select | `Active` / `OnBoarding` / `Inactive` / `OffBoarding` / `Attended to D0` / `Not Attended to D0` |

### Status Color Coding
- 🟢 `Active` — green badge
- 🟣 `OnBoarding` — indigo badge
- ⚪ `Inactive` — gray badge
- 🌹 `OffBoarding` — rose badge
- 🔵 `Attended to D0` — blue badge
- 🟠 `Not Attended to D0` — yellow/orange badge

### License Expiry Warnings
- ⚠ **Red badge** — "Expired" when the license end date has passed.
- 🟡 **Amber badge** — "Expiring in Xd" when less than 30 days remain.
- Shown on the courier profile only — there is no separate expiry summary card.

### Color Palette
- Primary: `#1E40AF` / `#2563EB`
- Background: `#F8FAFC`
- Cards: `#FFFFFF` (glassmorphism accents)
- Text: `#0F172A`

## 🛠 Tech Stack

| Layer | Choice |
|---|---|
| Frontend | HTML5 + self-hosted compiled Tailwind CSS + Vanilla JavaScript (no external CDNs) |
| Backend | Node.js + Express (REST API) |
| Database | SQLite via better-sqlite3 (WAL mode, schema-enforced) |
| Fonts | Inter + Cairo (self-hosted woff2, no Google CDN) |
| Hosting | Railway (NIXPACKS build, `/data` volume) |

## 🧪 Reset the Demo Data (local)

Stop the server, delete `data/bankai-hiring.db*` files, start again — the 4 seed records will be recreated.

## 📄 License

MIT — see [LICENSE](LICENSE).
