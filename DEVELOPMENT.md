# GWS Manager — Development Guide

> **Purpose:** Hard-won knowledge about this codebase. Read it before making changes.
> Follow the patterns. Avoid the pitfalls.

---

## Architecture Overview

| Layer | Tech | Notes |
|-------|------|-------|
| Frontend | Single `frontend/index.html` (~815 lines) | Monolithic. No build step. GrapeJS + CodeMirror via CDN. |
| CSS Framework | DaisyUI 4.12.10 + Tailwind via CDN | **No build step = no responsive variants** (`lg:`, `sm:` don't work from CDN) |
| Backend | PocketBase (single binary, `./pocketbase`) | Serves API + static files + hooks |
| Database | SQLite (WAL mode) at `data/data.db` | Also has `auxiliary.db` for sidecar |
| Hooks | `hooks/main.pb.js` | Loaded by PB `--hooksDir` |
| Migrations | `backend/*.js` | Loaded by PB `--migrationsDir` |
| Static files | `frontend/` directory | Served as PB `--publicDir` root |

### How PocketBase is Run

With Docker (the documented path), `scripts/docker-start.sh` runs this inside the
container. For local development the same flags work from the repo root — the
`pocketbase` binary is fetched by the Dockerfile, or download the release for your
platform yourself:

```bash
./pocketbase serve \
  --http=127.0.0.1:8090 \
  --dir=./data \
  --hooksDir=./hooks \
  --migrationsDir=./backend \
  --publicDir=./frontend
```

- **CWD:** the repo root
- **Data dir:** `./data` — SQLite DB + `storage/` (created on first run, gitignored)
- **Public dir:** `./frontend` (so `/components/login.html` maps to `frontend/components/login.html`)

Do not omit `--dir`: PocketBase otherwise defaults to `pb_data/` next to the
binary, so a bare `./pocketbase serve` silently creates a *second*, empty database.

There are two compose files, and they are not interchangeable:

| | `docker-compose.yml` | `docker-compose.dev.yml` |
|---|---|---|
| Purpose | a server | local development |
| Needs | `GWS_DOMAIN` + `ENCRYPTION_KEY` | nothing |
| Serves | HTTPS 443 via Caddy | plain HTTP `127.0.0.1:8090` |
| App port published | no | loopback only |

### Building the image from a checkout

The production compose **pulls** the published image — there is nothing to build
for a normal install. To build from source, which is what you want while
developing and is also permitted for your own internal use:

```bash
docker build -t gws-admin:local .
# or run the production compose with its `build:` line uncommented:
docker compose up -d --build
```

**Do not publish a built image to a registry others can pull from.** The licence
permits modifying and running this internally; **distributing a built image is
redistribution, which it does not permit.** CI publishes
`ghcr.io/wannaco/gws-manager` from `main` — that is the copyright holder's, and it
is the image users are told to run.

**While developing, use the dev file** — the production one requires `GWS_DOMAIN`
and `ENCRYPTION_KEY` and serves through Caddy on 443:

```bash
docker compose -f docker-compose.dev.yml up -d     # binds 127.0.0.1:8090, no TLS
docker compose -f docker-compose.dev.yml logs -f
```

### ⚠️ frontend/ is published to the web

`frontend/` is PocketBase's `--publicDir`: **every file in it is served over
HTTP, unauthenticated.** Dropping a stray script there publishes it.

```
frontend/anything.sh   -->   https://your-host/anything.sh
```

Rules:

- Only put web assets in `frontend/` (HTML, JS, CSS, images).
- Dev/test scripts belong in `scripts/`, never `frontend/`.
- Never put credentials in **any** committed file — if it lands in `frontend/`
  it is public the moment it deploys.
- PocketBase falls back to `index.html` for unknown paths, so a `200` does NOT
  prove a file exists. Check the body, not the status code, when auditing.


## Restarting PocketBase

`hooks/`, `lib/` and `backend/` migrations are read **at startup only** — a change
there needs a restart. Files under `frontend/` are served from disk and are not.

```bash
# Docker
docker compose restart

# Bare metal
kill $(pgrep -f 'pocketbase serve')
./pocketbase serve --http=127.0.0.1:8090 --dir=./data \
  --hooksDir=./hooks --migrationsDir=./backend --publicDir=./frontend &
```

---

## Critical Gotchas

### 1. DaisyUI CDN ≠ DaisyUI Build

**Problem:** `lg:hidden`, `lg:drawer-open`, `sm:inline` and other Tailwind responsive prefixes **do not work** with the CDN build.

**Solution:** Toggle DaisyUI classes with JavaScript based on `window.innerWidth`:

```javascript
// In DOMContentLoaded:
const drawer = document.getElementById('main-drawer');
const syncDrawer = () => drawer?.classList.toggle('drawer-open', window.innerWidth >= 1024);
syncDrawer();
window.addEventListener('resize', syncDrawer);
```

For hiding/showing elements, use JS or media queries in a `<style>` block — not `lg:`/`sm:` classes.

### 2. Mobile Drawer — Label[for] Alone Fails on Some Mobile Browsers

**Problem:** On real mobile devices (Chrome on Android), `<label for="checkbox">` does not reliably toggle the checkbox when tapped.

**Solution:** Add an explicit `onclick` handler:

```html
<label for="dashboard-drawer" class="btn btn-square btn-ghost lg:hidden"
  onclick="event.preventDefault(); document.getElementById('dashboard-drawer').checked = !document.getElementById('dashboard-drawer').checked">
  ☰
</label>
```

### 3. HTMX Component Paths

**Problem:** PB serves `frontend/` as the public root. So HTMX `hx-get` paths must be relative to `frontend/`, NOT to the filesystem.

```html
<!-- WRONG: -->
hx-get="/frontend/components/login.html"

<!-- CORRECT: -->
hx-get="/components/login.html"
```

### 4. Database API Rules

**Problem:** The `users` collection has `listRule = "id = @request.auth.id"`. This means unauthenticated API requests return 0 users even though the database holds records.

**Don't assume the DB is empty based on API response alone.** Query SQLite directly:

```bash
sqlite3 data/data.db "SELECT count(*) FROM users;"
sqlite3 data/data.db "SELECT email FROM users;"
```

Superusers are in `_superusers` table (not `_admins`).

### 5. Drawer Content Needs `flex flex-col`

The `drawer-content` div must have `flex flex-col` classes for proper layout:

```html
<div class="drawer-content flex flex-col">
```

Without this, the drawer layout breaks and content may not display correctly.

### 6. Check for Stray `</div>` Tags

A single extra or misplaced `</div>` can silently break the entire drawer DOM structure. If something visual is broken, check div nesting first:

```bash
# Count opening vs closing divs
grep -c '<div' frontend/index.html
grep -c '</div>' frontend/index.html
```

---

## PocketBase: what will bite you

Every item below was found by running the code, and **none of them throws** — they
produce wrong behaviour that looks like success. All have helper functions in
`lib/helpers.js`; use them instead of open-coding.

### 1. `json` fields arrive as a byte slice, not an array

`Array.isArray()` returns **true** on it, so the usual guard does not help.
`.length` is the BYTE count and `[0]` is a NUMBER (the first character's code):

```
record.get("emails")          ->  object, Array.isArray() === true
record.get("emails").length   ->  70        (bytes, not entries)
record.get("emails")[0]       ->  91        ('[' — a number)
```

Looping that with `i < list.length` silently walks *characters* instead of records.
Normalise through **`asArray()`** / **`asString()`** / **`asObject()`**.

### 2. …and you must NOT decide "is this a byte slice?" by looking at values

A genuine `[1,3,5]` (weekday numbers!) also looks like a byte slice, because its
elements are integers 0–255. Classifying by value made weekly schedules silently
run Mon–Fri. `asArray()` therefore *attempts* the string interpretation and accepts
it only if it actually parses to an array — it does not classify.

### 3. An unset date field is a TRUTHY zero-time object

Not `null`, not `""`. It is truthy, it stringifies to `""`, and
`new Date(it).getTime()` is `NaN`:

```
lastRunAt = ""   typeof object   truthy = true   new Date() -> NaN
```

So the obvious `field ? use(field) : fallback` takes the **wrong branch** and
poisons everything downstream with `NaN`. Use **`dateMs()`** — 0 means "not set".

### 4. `{:placeholder}` supplies its own quoting

```js
findRecordsByFilter("bulkJobs", 'scheduleId = "{:sid}"', ...)   // THROWS
findRecordsByFilter("bulkJobs", 'scheduleId = {:sid}',   ...)   // correct
```

Wrapping it in quotes produces `invalid filter expression: expected && or ||`.

### 5. Module-level bindings are invisible inside handlers

Each handler is evaluated in its own scope, so a module-level `var`/`function` in
`main.pb.js` reads as *not defined* at request time and the route returns
PocketBase's generic `400 {"message":"Something went wrong..."}`. Put shared code
in `lib/helpers.js` and reach it through the required module.

### 6. `sleep(ms)` is a global, and it blocks

There is no `setTimeout` and no `$os.sleep`. It blocks the whole goja runtime
synchronously — fine for backoff inside a cron worker, never in a hot route.

### 7. There is no WebCrypto — `$security` is the only crypto primitive

`crypto`, `crypto.getRandomValues`, `btoa`, `atob`, `TextEncoder` and
`$app.newEncryptionCipher` **do not exist** (`Buffer` does). Use
`$security.encrypt/decrypt`, which needs a 16/24/32-byte key, or
`$security.sha256`.

That key-length rule bites: `openssl rand -hex 32` produces **64 characters**, and
`$security.encrypt` rejects it with `crypto/aes: invalid key size 64`. That is why
`lib/helpers.js` derives `sha256(ENCRYPTION_KEY).slice(0, 32)` before calling it.

### 8. Client-side: setting `.checked` in JS does not fire `change`

Assigning `.checked = true` runs no handler, so state that depends on the handler
silently does not apply. Call the handler explicitly.

### 9. Client-side: dialogs stack by DOM order at equal `z-index`

All three overlays were `z-50`, so the one **later in the DOM** painted on top —
the recipient picker was visible but completely unclickable from the schedule
editor. There is an explicit ladder in `styles/index.css`; keep new overlays on
it. And note that "not `hidden`" is not the same as "reachable": assert with
`document.elementFromPoint()`, not by checking a class.

## Self-hosting: what the compose files guarantee

If you change `docker-compose.yml`, `caddy/Caddyfile` or the `scripts/`, these
properties are load-bearing — they are the difference between "HTTPS" and "HTTPS
plus an exposed plaintext admin panel", which is what the previous version shipped:

- the `gws` service uses **`expose`**, never `ports`. Publishing 8090 puts an
  unencrypted admin UI on the host's network; Caddy reaches the container by
  service name.
- `ENCRYPTION_KEY` and `GWS_DOMAIN` use `:?` so **compose refuses to start**
  without them. An empty key does not fail loudly — the app boots and stores the
  service-account key in plaintext.
- Verify a compose edit **without a daemon**: `docker compose config`. It catches
  interpolation and shape errors. Note that `: ` inside a bare list item makes it
  a YAML map — quote any `:?` message containing a colon.
- Verify a Caddyfile with the real binary, matching the `caddy:2-alpine` version:
  `caddy validate --config caddy/Caddyfile --adapter caddyfile`.

## Testing against a stand-in for Google

The signer, the OAuth token endpoint and every Google API URL are
env-overridable, so the whole app — bulk apply included — can be exercised
without a Workspace domain:

| Variable | Default | Effect |
|---|---|---|
| `GWS_SIGNER_URL` | `http://localhost:9999/sign` | Go RS256 signer |
| `GWS_TOKEN_URL` | `https://oauth2.googleapis.com/token` | OAuth token exchange |
| `GWS_API_BASE` | *(unset)* | rewrites all Google API calls to this base |

All three default to the real endpoints, so leaving them unset changes nothing
in production (asserted in the tests). With them set, `gmail.googleapis.com/...`
becomes `<GWS_API_BASE>/...`, so a mock only has to serve the path, not the host.

This is how the bulk worker was tested: a local server speaking the Gmail error
shapes (403 `userRateLimitExceeded`, `Retry-After`, permission errors) plus a
`SIGKILL` mid-run to prove resumption.

---

## Testing with Playwright

Playwright is installed in `node_modules/`. Use it to test before claiming something works.

### Test Credentials

Credentials are **never** committed. The Playwright tests read them from the
environment:

```bash
export TEST_EMAIL=you@example.com
export TEST_PASSWORD='...'
```

### Mobile Test Template (412×915, Pixel-class)

```javascript
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 412, height: 915 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2.625,
});

await page.goto('http://localhost:8090/', { waitUntil: 'networkidle' });
await page.fill('#login-email', process.env.TEST_EMAIL);
await page.fill('#login-password', process.env.TEST_PASSWORD);
await page.click('#btn-login');
await page.waitForTimeout(3000);
// ... test stuff
```

### Desktop Test Template

```javascript
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
```

### Useful Debug Snippets

```javascript
// What element is actually at a tap point?
const el = await page.evaluate(({x, y}) => {
  const e = document.elementFromPoint(x, y);
  return e ? { tag: e.tagName, class: e.className, id: e.id } : null;
}, { x: 50, y: 30 });

// Computed styles of drawer elements
const styles = await page.$eval('.drawer-side', el => {
  const s = getComputedStyle(el);
  return { visibility: s.visibility, pointerEvents: s.pointerEvents, transform: s.transform };
});
```

### Key Mobile Checks

| Check | How |
|-------|-----|
| Hamburger visible | `await page.isVisible('label.btn-square')` |
| Tap works | `await page.tap('label.btn-square')` then `page.isChecked('#dashboard-drawer')` |
| Sidebar visible | `await page.isVisible('#sidebar-gws-users')` |
| pointer-events after tap | Should be `"auto"` (not `"none"`) |

### Key Desktop Checks

| Check | Expected |
|-------|----------|
| Hamburger visible | `false` (hidden on desktop) |
| Sidebar visible | `true` (always visible) |
| `drawer-open` class on `#main-drawer` | Present |

---

## Git Workflow

### Branches

- `main` — the released branch. CI builds `ghcr.io/wannaco/gws-manager:latest` from it.
- Work on a `feature/*` branch: CI does not currently build those, so nothing is
  published until a change lands on `main`.

### Commit Message Convention

```
fix: short description of what was fixed
feat: short description of new feature
chore: maintenance task
```

### What NOT to Commit

The `.gitignore` already excludes:
- `*.db`, `*.db-*`, `*.bak`, `*.tiptap-backup`, `data/*.bak*`
- `pb_data/`, `pocketbase`, `pocketbase_*`, `pocketbase.log`, `*.zip`
- `sidecar/signer`, `sidecar/signer.exe`
- `node_modules/`, `test-results/`, `.env`
- `.cache/`, `.config/`, `.cptr/`, `.npm/`, `.ssh/`, `.pyenv/`

`scripts/` **is** tracked (the Docker build needs it) — only `scripts/dist/` is ignored.

**Do not commit `node_modules/`.** If you see it staged, unstage it:

```bash
git reset HEAD node_modules/
echo "node_modules/" >> .gitignore
```

---

## File Structure

```
gws-manager/
├── frontend/
│   ├── index.html              # App shell
│   ├── components/             # HTMX-loaded fragments (login, setup, dashboard…)
│   ├── js/                     # Feature modules (auth, api, users, bulk, audience…)
│   └── styles/                 # index.css
├── backend/                    # Migrations, applied in filename order
│   ├── 1780290266_updated_users.js
│   ├── 1780355000_init_collections.js
│   ├── 1786000001_add_user_config_fields.js
│   └── 1786000020_add_bulkJobs.js
├── hooks/
│   └── main.pb.js              # PB hooks — every API route + the cron worker
├── lib/
│   └── helpers.js              # Shared helpers (auth, Google API, encryption)
├── sidecar/
│   └── main.go                 # Go RS256 JWT signer (compiled during docker build)
├── scripts/                    # install / start / manage / build helpers
├── caddy/                      # Optional TLS proxy (compose profile: proxy)
├── docs/                       # Design notes
├── test-drawer.mjs             # Playwright mobile drawer test
├── test-desktop.mjs            # Playwright desktop test
├── test-mobile-detailed.mjs    # Mobile test with diagnostics
├── caddy/
│   └── Caddyfile               # bundled HTTPS proxy (production compose)
├── Dockerfile
├── docker-compose.yml          # standalone: bundled Caddy, TLS on
├── docker-compose.dokploy.yml  # platform terminates TLS (Dokploy/Traefik)
├── docker-compose.dev.yml      # local: no TLS, 127.0.0.1:8090 only
└── package.json                # Node deps (playwright)

# Not in the repo — created at runtime:
#   data/       SQLite DB, -wal/-shm, storage/   (gitignored)
#   .env        your ENCRYPTION_KEY             (gitignored)
```

---

## API Endpoints (Custom, from hooks/main.pb.js)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Health check |
| POST | `/api/collections/users/auth-with-password` | Login |
| GET | `/api/gws/get-tenant` | Get tenant config (requires auth) |
| GET | `/gws/bulk/jobs` | List bulk jobs (`limit` max 100, `offset`) |
| GET | `/gws/bulk/failures` | Paged failures for one job (`limit` max 500) |
| GET | `/gws/bulk/schedules` | List schedules; `?id=` returns one *with* its html |
| POST | `/gws/bulk/schedules` | create \| update \| delete \| toggle \| runNow |
| GET | `/gws/bulk/schedule-runs` | Recent jobs produced by one schedule |
| GET | `/api/gws/users` | List GWS users (requires auth + tenant config) |

### Login Flow

1. User enters email/password → `POST /api/collections/users/auth-with-password`
2. On success, store token, call `afterLogin()`
3. `afterLogin()` calls `GET /api/gws/get-tenant`
4. If no tenant/domain configured → show setup page
5. If tenant exists → show dashboard

### Template Placeholders

Used in signature templates (GrapeJS):

```
{{name}} {{email}} {{title}} {{department}} {{phone}} {{photoUrl}}
{{firstName}} {{lastName}} {{company}}
```

---

## Common Tasks

### "The drawer doesn't work on mobile"

1. Check `drawer-content` has `flex flex-col`
2. Check hamburger has explicit `onclick` handler (not just `label for`)
3. Check for stray `</div>` tags breaking DOM structure
4. Run `node test-mobile-detailed.mjs` to diagnose
5. Check `pointer-events` on `.drawer-side` — should be `auto` after tap

### "API returns 0 users but the DB has users"

This is expected. The `users` collection list rule is `id = @request.auth.id`. You only see your own record when authenticated. Query SQLite directly to see all records.

### "PB isn't serving my latest file changes"

PB serves files directly from disk — no restart needed for static files. If you're not seeing changes:
1. Hard refresh browser (or use incognito)
2. Verify with `curl -s http://localhost:8090/ | grep 'your-change'`
3. Check `Last-Modified` header: `curl -sI http://localhost:8090/`

### "PocketBase hooks not loading"

Restart PB — hooks are only evaluated at startup:

```bash
docker compose restart
```
A syntax error in a hook is reported at boot, not at request time. If a hook fails
to load, *none* of the routes in that file register.

---

## Conventions

- **Direct communication.** No fluff, no hedging.
- **Don't break working things.** Test before and after changes.
- **Use the framework.** DaisyUI has built-in classes — use them. Don't write custom CSS when a class exists.
- **Test on mobile.** If it works in desktop Chrome but not at a ~412px viewport, it's broken.
- **Don't assume the DB is empty.** API rules hide records. Check SQLite directly.
- **Don't point test runs at a real deployment.** Use a throwaway `data/` dir.
