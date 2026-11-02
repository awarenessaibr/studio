# Studio management (developer only)

**URL** `/admin.html` (also `/admin` and `/manage`)
**Source** `admin.html`, `src/client/admin/admin.js`, `src/client/admin/admin.css`
**Purpose** choose which brand groups the studio shows, and in what order —
without deleting anything from disk.

> This is a developer surface, not part of the client experience. It is not
> linked from any studio page. The server prints its URL on startup.

---

## 1. What it controls

One ordered list of brand packs drives every group picker in the studio:

| Surface | How it reads the list |
|---|---|
| **Layer Studio** group selector and brand cards | Brand identity (`src/client/brand/brand-identity.js` → `GET /api/brand-packs`, `GET /api/brand-packs/:id`) |
| **Asset Studio** gate tabs, brand cards and top-bar group selector | `GET /api/brand-packs`, `GET /api/brand-packs/:id` |
| **Asset library** pack/brand filters | `GET /api/brand-packs` |
| **Voice Studio** brand list | `GET /api/brand-packs` |
| **Brand intake / crawler** | unaffected (it works on runs, not packs) |
| **Social intelligence** | reads scraped profiles by brand; the per-business **client social crawler** switch is resolved through `GET /api/social/:id` |

- **Client social crawler** — an expandable switch per business beneath each
  group. Only enabled businesses get a **Run social crawler** button in Social
  intelligence. It is independent of visibility: you can hide a business from
  the design UIs and still allow its social research, or the other way round.
- **Hidden groups** disappear from every list and tab; they are **not
  deleted**.
- **Hidden businesses** are toggled by clicking a brand chip inside a group.
  They disappear from brand cards, brand switches and the group's brand count.
- **Order** is the order of group tabs and selectors. Move groups with the
  ↑/↓ buttons; **Reset order** returns to newest-first.
- **Show all** clears every hidden group and business.
- A pack imported after this list is created appears automatically (visible,
  at the end until ordered).
- Hidden groups remain addressable by id: `asset-studio.html?pack=…` and saved
  assets that reference the group keep working. Hidden businesses are filtered
  from the pack itself, so a saved asset for a hidden business cannot be
  reopened until that business is shown again — the asset is still on disk.
- Hidden means "not shown", not "private": direct pack URLs still work, and
  the setting is a developer convenience, not an access control.
- **Indexed library assets are archival**: hiding a group or business removes
  it from the library's pack/brand filters, but already-indexed asset records
  stay in the archive (and in "All packs"). The library is a research surface,
  like Social and Brand intake.

At least one group must stay visible, and every visible group must keep at
least one visible business. Both rules are enforced by the UI and the API.

---

## 2. Using it

1. Start the studio (`npm start`) and open
   `http://127.0.0.1:8008/admin.html`.
2. Toggle **Visible** on a card to show or hide that group everywhere.
3. Use **↑ / ↓** to set the order, **Show all** to reset visibility, or
   **Reset order** to return to the default sort.
4. Open **Client social crawler** under a group's brand chips and tick the
   businesses that may launch a crawl from Social intelligence.
5. Changes save immediately. The status line confirms the time; open Asset
   Studio or Layer Studio in another tab to see the list change.

Each card shows the group cover (or its brand swatches), id, brand count,
added/updated dates, brand chips and a direct **Open in Asset Studio** link.
Click a brand chip to hide or show that business alone; hidden chips are
struck through. The **Client social crawler** details list each business with
an enable checkbox and a live count.

---

## 3. Access control

The management API is **not** part of the public studio API surface:

- By default the server allows admin calls **from localhost only** (the studio
  binds `127.0.0.1` by default).
- Set **`STUDIO_ADMIN_KEY`** to require a key from any caller:

  ```bash
  STUDIO_ADMIN_KEY="choose-a-secret" npm start
  ```

  The page then asks for the key once and keeps it in `sessionStorage` for that
  tab; requests send it as the `x-admin-key` header. Wrong or missing keys get
  `401`.
- `GET /api/brand-packs?all=1` (the full list, including hidden groups) also
  requires admin access, so client UIs cannot ask for the unfiltered list.

| Request | No key configured | Key configured |
|---|---|---|
| `GET /api/admin/groups` (loopback) | allowed | `401` without header, allowed with it |
| `GET /api/admin/groups` (remote) | `401` | `401` without header |
| `GET /api/brand-packs` | allowed, filtered | allowed, filtered |
| `GET /api/brand-packs?all=1` | loopback only | header required |
| `PUT /api/admin/groups` | loopback only | header required |

---

## 4. Storage

```
data/settings/groups.json
{
  "version": 3,
  "updatedAt": "2026-11-02T09:22:50.911Z",
  "order": ["pack-id", "…"],
  "hidden": ["pack-id", "…"],
  "hiddenBrands": ["pack-id::brand-id", "…"],
  "socialCrawler": ["pack-id::brand-id", "…"]
}
```

- The file is created on the first save; a missing file means "all visible,
  newest first".
- Unknown or deleted pack ids are pruned on read/normalise; the list is capped
  at the pack limit.
- Writes are atomic (temporary file + rename).
- `data/` is git-ignored, so this is machine-local configuration, like the
  packs themselves.

---

## 5. API

| Method | Path | Body / query | Result |
|---|---|---|---|
| `GET` | `/api/admin/groups` | — | `{ packs, settings, adminKeyConfigured }`, hidden groups and businesses included with `visible` flags |
| `PUT` | `/api/admin/groups` | `{ "order": [ids], "hidden": [ids], "hiddenBrands": ["pack::brand"], "socialCrawler": ["pack::brand"] }` | Same payload, saved (validates the last-group / last-business rules) |
| `GET` | `/api/brand-packs` | `?all=1` (admin) | Visible packs and businesses only, ordered |
| `GET` | `/api/brand-packs/:id` | `?all=1` (admin) | The pack with hidden businesses removed; `?all=1` returns everything |

---

## 6. Notes and limits

- Enabling the social crawler does **not** expose API keys, and it does not
  bypass the crawler's own limits: at most two crawler jobs run at once, and a
  business can start at most one crawl every 30 seconds.
- Hiding a group does **not** remove its shared brand kits or save files;
  compositions keep working. Hiding a business removes it from the pack the
  studio reads, so its saved assets need the business to be shown again.
  Deleting a pack is still done from Brand identity and is permanent.
- The last-visible-group and last-visible-business guards are enforced by the
  API as well as the UI, so scripts cannot accidentally empty a group.
- The list is enforced **server-side**, which is why every UI respects it
  without code changes. If a new UI adds its own hard-coded group list, route
  it through `/api/brand-packs` (or the admin list) instead.
- The management page itself contains no brand data; with a key configured it
  is inert until the key is entered.
