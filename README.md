# �Courier Bankai-Hiring

A modern, responsive single-page web application for managing **courier hiring** — records, branches, licenses, and status tracking. Built with **HTML5, Tailwind CSS (CDN), and Vanilla JavaScript** with zero broken dependencies.

## 📁 Project Structure

```
Bankai-Hiring/
├── index.html    # The complete single-page application (layout, styles & logic)
├── README.md     # This file
└── LICENSE       # MIT license
```

## 🚀 How to Run

No build step, no dependencies, no server required.

**Option 1 — Just open it:**
Double-click `index.html` (or open it in any modern browser: Chrome, Edge, Firefox, Safari).

**Option 2 — Serve locally (recommended for development):**

```bash
# Python 3
python -m http.server 8000
# then open http://localhost:8000

# Or with Node.js
npx serve .
```

**Fully live version:** Open the GitHub Pages URL once enabled (Settings → Pages → deploy from branch `main` / root).

## ✨ Features

### Dashboard & Data
- **Top navigation bar** with the project title and a global counter.
- **Quick summary cards**: Total Couriers, Active, Attended to D0, Not Attended to D0, Licenses Expiring.
- **Structured data table** with a responsive layout (columns gracefully collapse on smaller screens).
- **Search bar**: search instantly by Name, Phone, National ID, or Plate Number.
- **Quick filters**: Branch (`QCD1`/`QCD2`), Employment Type (`Full Time`/`Part Time`), and Status.

### CRUD Operations
- **Create** — a clean modal form to add a new courier record with full validation.
- **Read** — table view with live search and filters.
- **Update**:
  - Edit any record via the same modal form (prefilled).
  - **Quick status change** directly from the table row (dropdown) for `Active` / `Inactive` / `Attended to D0` / `Not Attended to D0`.
- **Delete** — removal with a confirmation prompt.
- **Persistence** — data is saved to **LocalStorage** and survives page refreshes. On first visit, 4 realistic dummy records are seeded to showcase the UI.

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
| Markup | HTML5 |
| Styling | Tailwind CSS via CDN (with a custom design-token config) |
| Logic | Vanilla JavaScript (ES6+, modular & commented) |
| Persistence | Browser LocalStorage |
| Fonts | Inter + Cairo (Google Fonts) |

## 🧪 Reset the Demo Data

Open your browser DevTools → Application → Local Storage → delete the key `bankai-hiring:records`, then refresh — the 4 seed records will be recreated.

## 📄 License

MIT — see [LICENSE](LICENSE).
