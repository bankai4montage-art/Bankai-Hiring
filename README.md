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
│   ├── index.html          # Dashboard UI (compact cards + courier profiles)
│   └── assets/
│       ├── styles.css      # Compiled Tailwind CSS (self-hosted, no CDN)
│       ├── tailwind.src.css# Build input for the CSS
│       ├── fonts.css       # Self-hosted font-face rules
│       └── fonts/          # Inter + Cairo woff2 files
├── server.js               # Express server: static frontend + REST endpoints + document uploads
├── db.js                   # SQLite layer (couriers + documents, 5-record seed on first boot)
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
| GET | `/api/couriers` | List all couriers (including personal-photo IDs) |
| GET | `/api/couriers/:id` | One courier + documents metadata (profile) |
| POST | `/api/couriers` | Create (full validation, 400 + field errors on failure) |
| PUT | `/api/couriers/:id` | Update a full record |
| PATCH | `/api/couriers/:id/status` | Quick status change |
| DELETE | `/api/couriers/:id` | Delete a record (its documents cascade) |
| POST | `/api/couriers/:id/documents` | Upload image (kind: photo / id_front / id_back / license_front / license_back) |
| GET | `/api/documents/:id` | View image inline |
| GET | `/api/documents/:id?download=1` | Download image as file |
| DELETE | `/api/documents/:id` | Delete an image |

## ✨ Features

### Dashboard & Data
- **Compact clickable cards** — each courier is a small, clean one-row card showing only the essentials: personal photo, name, national ID, branch, Full/Part time and status. Clicking the card opens the **full courier profile** — no data clutter, no horizontal scrolling.
- **Top navigation bar** with the project title, live record counter, and a "Live Database" indicator.
- **Quick summary cards**: Total Couriers, Active, OnBoarding, OffBoarding, Attended to D0, Not Attended to D0.
- **Search bar**: search instantly by Name, Phone, National ID, or Plate Number.
- **Quick filters**: Branch (`QCD1`/`QCD2`), Employment Type (`Full Time`/`Part Time`), Status — plus a **Sort** selector (newest, name A→Z/Z→A, license expiring first, status, branch).

### CRUD Operations
- **Create** — a clean modal form to add a new courier record with client + server validation.
- **Read** — card view with live search and filters, data loaded from the REST API.
- **Update**:
  - Edit any record via the same modal form (prefilled).
  - **Quick status change** directly from the table row (dropdown) for `Active` / `Inactive` / `Attended to D0` / `Not Attended to D0`.
- **Delete** — removal with a confirmation prompt.
- **Persistence** — records are stored in a **SQLite database**; changes are durable across refreshes, devices, and redeploys.

### Extra Features
- **Courier profiles** — clicking a card opens a full profile with every field, an inline status chip + quick status selector, and an Edit shortcut.
- **Photo & document uploads** — every profile has 5 upload slots:
  - 🧑 **Personal photo** — shown on the compact card avatar too (upload once, visible everywhere).
  - 🪪 **ID card** — front & back.
  - 📜 **Personal license** — front & back.
  Images are stored directly in SQLite (max 5MB, JPG/PNG/WEBP) and survive redeploys on the Railway Volume.
- **View & download** — every uploaded image can be opened full-size or downloaded with a friendly filename (e.g. `bankai_Ahmed_Mohamed_id-card-front.png`). The personal photo is unique per courier — re-uploading replaces it.
- **CSV export** — exports exactly what you currently see (with filters + sorting), UTF-8 BOM so Arabic renders correctly in Excel.
- **Duplicate record** — from the profile/edit modals a copy button opens the add form prefilled (edit the National ID, then save).
- **Clickable summary cards** — cards double as quick filters (click "Active" to show actives only, click "Total Couriers" to reset).
- **Copy to clipboard** — click the **Phone**, **National ID** (on the card and inside the profile) or the **Outlook account** and the value is copied instantly, with a toast confirmation.
- **Animated counters** — summary numbers ease from their previous value to the new one after every change.
- **License expiry warnings** (inside the courier profile only):
  - ⚠ **Red badge** — "Expired" when the license end date has passed.
  - 🟡 **Pulsing amber badge** — "Expiring in Xd" when less than 30 days remain.

### Design & Animations
- Animated gradient navbar, floating ambient background blobs, glassmorphism panels.
- Staggered row entrance animations, hover lifts on cards, glowing button shadows, skeleton loading shimmer.
- **Modern cards**: light sweep across summary + courier cards on hover, floating gradient bubbles behind the summary icons, icon tilt on hover, zoom-in effect with a centered "view" button on every uploaded document, and staggered pop-in for the 5 document slots.
- Fully **responsive** — works great on mobile, tablet, and desktop.
- **Bilingual typography** — Inter for Latin text and Cairo for Arabic names, so mixed Arabic/English data renders seamlessly.
- Toast notifications, modal pop animations, Escape key to close dialogs.

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
