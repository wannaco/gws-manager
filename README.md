# GWS Manager

Self-hosted Google Workspace administration panel — manage email signatures, delegation, forwarding, filters, and more.

Runs on your own server or PC. Single-tenant by design: one instance = one Google Workspace domain.

## Quick Start (Docker — recommended)

```bash
git clone <repo-url> gws-admin && cd gws-admin
cp .env.example .env            # then set ENCRYPTION_KEY
docker compose up -d
```

Open http://localhost:8090

The image is built from the checkout, so nothing needs to be installed on the
host except Docker — PocketBase and the Go signer are fetched/compiled during
the build.

To serve it over HTTPS without your own reverse proxy, set your hostname in
`caddy/Caddyfile` (it must already resolve to the server, with ports 80/443
reachable so Caddy can obtain a certificate), then:

```bash
docker compose --profile proxy up -d
```

If you already run nginx/Traefik/etc., skip that profile and proxy to the `gws`
service on port 8090.

## Quick Start (bare metal)

```bash
./scripts/install.sh            # downloads PocketBase, builds the signer, writes .env
cd ~/gws-admin && ./start.sh
```

`install.sh` needs `curl`, `tar`, `unzip`, and Go 1.22+ (the signer is compiled
for your platform). It can also register a systemd service.

**First time?** Register with your Google Workspace domain email, then go to
Settings and upload a service account JSON key (domain-wide delegation). The
user sync populates your domain users.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `ENCRYPTION_KEY` | **yes, for production** | Encrypts the Google service-account key at rest. Generate with `openssl rand -hex 32`. |
| `GWS_ALLOWED_ORIGIN` | no | If set, only this exact origin may call the API cross-origin. Same-origin works regardless, so leave blank unless you embed the UI elsewhere. |

**Back up `ENCRYPTION_KEY`.** It is the only way to read back a stored
service-account key — if you lose it you must re-upload the key. The value is
hashed into the actual encryption key, so any sufficiently long random string
works (the documented `openssl rand -hex 32` output is ideal).

## Features

- **Email signatures** — drag-and-drop GrapesJS editor, templates with placeholders (`{{name}}`, `{{email}}`, `{{title}}`, `{{department}}`, `{{company}}`, `{{phone}}`, `{{photoUrl}}`, …), bulk apply to selected users
- **Delegation** — add/remove Gmail delegates per user
- **Forwarding** — forwarding addresses + auto-forwarding rules
- **Filters** — create/delete Gmail filters
- **Vacation responders** — set per-user or bulk
- **Send-As** — aliases + group send-as
- **Calendar sharing** — calendar ACL rules
- **User sync** — Directory API sync into a local cache (fast, offline-friendly)
- **Audit webhook** — optional webhook URL receives audit events (domain.connect, signature.update, bulkApply, …)

## Architecture

```
┌──────────────┐        ┌─────────────────────────────────────────┐
│  Browser     │ ─────► │  PocketBase (:8090)                     │
│  (frontend)  │  HTTP  │   hooks/  → all API routes              │
└──────────────┘        │   lib/    → Google API + encryption     │
                        │   data/   → SQLite (mount a volume)     │
                        └───────────────┬─────────────────────────┘
                                        │ JWT signing (RS256)
                                        ▼
                                 ┌──────────────┐
                                 │  signer      │  :9999 (localhost only)
                                 │  (Go sidecar)│
                                 └──────────────┘
```

`signer` exists because PocketBase 0.39 removed `rsaSign` — it signs the JWTs
used to impersonate Google Workspace users via a service account. It binds to
`127.0.0.1` only, so the private key never leaves the host.

## Files

```
gws-admin/
├── frontend/          # HTML, JS, CSS served as PocketBase public dir
├── hooks/             # PocketBase JS hooks (all API routes)
├── lib/               # Shared helpers (auth, Google API, encryption)
├── backend/           # PocketBase migration files
├── data/              # SQLite database (auto-created; mount as a volume)
├── sidecar/           # Go signer source for RS256 JWT (Google SA keys)
├── scripts/           # install, start, manage, build helpers
└── SKILL.md           # Development guide
```

## Operations

```bash
./scripts/manage.sh status     # containers + health + signer check
./scripts/manage.sh logs       # tail logs
./scripts/manage.sh backup     # gzipped backup of data/ (keeps last 14)
./scripts/manage.sh restart
./scripts/manage.sh update     # pull the configured image + recreate
```

Back up `data/` **and** `ENCRYPTION_KEY` — restoring one without the other
leaves the stored service-account key unreadable.

## Using a published image

The compose file builds locally by default. To deploy a prebuilt image instead,
point `GWS_IMAGE` at a registry reference and authenticate first:

```bash
docker login <registry>
GWS_IMAGE=<registry>/gws-admin:latest docker compose up -d
```

With a prebuilt image the deployment pulls on each `up`, so keep the tag
current (or pin a digest) and re-run `docker compose up -d` to take an update.

## Building an image yourself

```bash
./scripts/build-docker.sh my-registry/gws-admin:dev
docker push my-registry/gws-admin:dev
```

## Development

See [SKILL.md](SKILL.md) for the full development guide.

```bash
# Run PocketBase in dev mode + the signer
./scripts/start.sh

# Run tests
npx playwright test
```

### PocketBase hook gotchas

Two things bite everyone writing hooks for this app:

1. **Module-level bindings are not visible inside handlers.** PocketBase's JSVM
   evaluates each handler in its own scope, so a module-level `var`/`function`
   reads as *"not defined"* at request time and the route returns PocketBase's
   generic `400 {"message":"Something went wrong..."}`. Resolve paths with the
   built-in `__hooks` global and call helpers through the required module:

   ```js
   routerAdd("GET", "/gws/example", (e) => {
       var h = require(__hooks + "/../lib/helpers.js");   // good
       // not: require(APP_ROOT + "/lib/helpers.js")     // module-level var
   });
   ```

2. **There is no WebCrypto.** `crypto`, `btoa`, `TextEncoder` and
   `$app.newEncryptionCipher` do not exist. Use `$security.encrypt/decrypt`
   (needs a 16/24/32-byte key) or `$security.sha256`.

## Tech Stack

- **PocketBase** — Backend/database/auth
- **GrapesJS** — Drag & drop signature editor
- **DaisyUI + Tailwind** — UI components
- **HTMX** — Dynamic component loading
- **Go** — RS256 JWT signer sidecar

## License

**PolyForm Noncommercial License 1.0.0** — see [LICENSE](LICENSE).

You may use, modify and self-host this software for **noncommercial** purposes:
personal projects, study, evaluation, and use by charitable organisations,
educational institutions, public research bodies, public safety or health
organisations, environmental protection organisations, and government
institutions.

**Commercial use requires a separate license.** You may not use this software
to run a business, provide it as a paid service, or otherwise pursue commercial
advantage without written permission from the copyright holder. For commercial
licensing, contact the maintainer.

### This is source-available, not "open source"

To be precise about the term: the [Open Source Definition](https://opensource.org/osd)
forbids restricting a license by field of endeavour, so **no license that
prohibits commercial use can be called open source**. This project is
*source-available* / *noncommercial*. Some practical consequences:

- GitHub will not show an OSI-approved license badge for it.
- Linux distributions and some package repositories cannot redistribute it.
- Some companies have policies against using non-OSI licenses — if you sell to
  them, expect questions.

That is a deliberate trade-off: the source is public so it can be audited,
self-hosted and improved, while commercial rights stay with the copyright
holder. If you would rather be OSI-approved, the usual alternatives are
AGPL-3.0 (copyleft; still permits commercial use, but forces anyone offering it
as a service to publish their changes) or BUSL-1.1 (time-delayed: converts to
an open license after a set period).

Copyright (c) 2026 ThinkCloud.

