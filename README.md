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
│   └── index.html   # Dashboard UI (Tailwind + Vanilla JS, talks to the REST API)
├── server.js        # Express server: static frontend + REST endpoints
├── db.js            # SQLite layer (schema, queries, 4-record seed on first boot)
├── package.json     # Dependencies & start script
├── railway.json     # Railway build/deploy config (NIXPACKS + npm start)
├── README.md
└── LICENSE          # MIT
```

## 🚀 How to Run

### Local (requires Node.js 22+)

```bash
npm install
npm start
# open http://localhost:3000
```

The database file is created at `data/bankai-hiring.db` (set `DATABASE_PATH` to override). On first boot the server seeds 5 realistic demo records.

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
| GET | `/api/couriers` | List all couriers |
| POST | `/api/couriers` | Create (full validation, 400 + field errors on failure) |
| PUT | `/api/couriers/:id` | Update a full record |
| PATCH | `/api/couriers/:id/status` | Quick status change |
| DELETE | `/api/couriers/:id` | Delete a record |

## ✨ Features

### Dashboard & Data
- **Top navigation bar** with the project title, live record counter, and a "Live Database" indicator.
- **Quick summary cards**: Total Couriers, Active, OnBoarding, OffBoarding, Attended to D0, Not Attended to D0, Licenses Expiring.
- **Structured data table** with a responsive layout (columns gracefully collapse on smaller screens).
- **Search bar**: search instantly by Name, Phone, National ID, or Plate Number.
- **Quick filters**: Branch (`QCD1`/`QCD2`), Employment Type (`Full Time`/`Part Time`), and Status.

### CRUD Operations
- **Create** — a clean modal form to add a new courier record with client + server validation.
- **Read** — table view with live search and filters, data loaded from the REST API.
- **Update**:
  - Edit any record via the same modal form (prefilled).
  - **Quick status change** directly from the table row (dropdown) for `Active` / `Inactive` / `Attended to D0` / `Not Attended to D0`.
- **Delete** — removal with a confirmation prompt.
- **Persistence** — records are stored in a **SQLite database**; changes are durable across refreshes, devices, and redeploys.

### Extra Features
- **Column sorting** — click any column header (Courier, Phone, National ID, Branch, Type, License, Status) to sort ascending/descending.
- **CSV export** — exports exactly what you currently see (with filters + sorting), UTF-8 BOM so Arabic renders correctly in Excel.
- **Duplicate record** — a copy button on each row opens the add form prefilled from an existing record (edit the National ID, then save).
- **Clickable summary cards** — cards double as quick filters (click "Active" to show actives only, "Licenses Expiring" to show licenses in danger, click "Total Couriers" to reset).
- **Animated counters** — summary numbers ease from their previous value to the new one after every change.
- **License expiry warnings**:
  - ⚠ **Red badge** — "Expired" when the license end date has passed.
  - 🟡 **Pulsing amber badge** — "Expiring in Xd" when less than 30 days remain.
  - Expiring licenses are counted in the summary card and one click filters them.

### Design & Animations
- Animated gradient navbar, floating ambient background blobs, glassmorphism panels.
- Staggered row entrance animations, hover lifts on cards, glowing button shadows, skeleton loading shimmer.
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
- Expiring licenses are counted in the summary card at the top.

### Color Palette
- Primary: `#1E40AF` / `#2563EB`
- Background: `#F8FAFC`
- Cards: `#FFFFFF` (glassmorphism accents)
- Text: `#0F172A`

## 🛠 Tech Stack

| Layer | Choice |
|---|---|
| Frontend | HTML5 + Tailwind CSS (CDN) + Vanilla JavaScript (ES6+, modular & commented) |
| Backend | Node.js + Express (REST API) |
| Database | SQLite via better-sqlite3 (WAL mode, schema-enforced) |
| Fonts | Inter + Cairo (Google Fonts) |
| Hosting | Railway (NIXPACKS build, `/data` volume) |

## 🧪 Reset the Demo Data (local)

Stop the server, delete `data/bankai-hiring.db*` files, start again — the 4 seed records will be recreated.

## 📄 License

MIT — see [LICENSE](LICENSE).
