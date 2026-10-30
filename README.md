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

The database file is created at `data/bankai-hiring.db` (set `DATABASE_PATH` to override). On first boot the server seeds 4 realistic demo records.

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
- **Quick summary cards**: Total Couriers, Active, Attended to D0, Not Attended to D0, Licenses Expiring.
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
| Courier Status | Select | `Active` / `Inactive` / `Attended to D0` / `Not Attended to D0` |

### Status Color Coding
- 🟢 `Active` — green badge
- ⚪ `Inactive` — gray badge
- 🔵 `Attended to D0` — blue badge
- 🟠 `Not Attended to D0` — yellow/orange badge

### License Expiry Warnings
- ⚠ **Red badge** — "Expired" when the license end date has passed.
- 🟡 **Amber badge** — "Expiring in Xd" when less than 30 days remain.
- Expiring licenses are counted in the summary card at the top.

### Design & Typography
- Clean **Blue & White** professional palette:
  - Primary: `#1E40AF` / `#2563EB`
  - Background: `#F8FAFC`
  - Cards: `#FFFFFF`
  - Text: `#0F172A`
- Fully **responsive** — works great on mobile, tablet, and desktop.
- **Bilingual typography** — Inter for Latin text and Cairo for Arabic names, so mixed Arabic/English data renders seamlessly.
- Toast notifications, hover states, modal animations, Escape key to close dialogs.

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
