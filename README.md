# GWS Manager

Self-hosted Google Workspace administration panel — manage email signatures, delegation, forwarding, filters, and more.

Runs on your own server or PC. Single-tenant by design: one instance = one Google Workspace domain.

## Before you install: create your encryption key

GWS Manager encrypts the Google **service-account key** before storing it in the
database. That encryption is unlocked by a single value, `ENCRYPTION_KEY`, which
**you generate once** and then keep for the life of this install.

**`ENCRYPTION_KEY` is not a setting you can regenerate. Treat it as a credential.**

Generate it once:

```bash
openssl rand -hex 32        # or any other long, random string
```

### Store it somewhere safe and permanent — before you deploy

Not in the deployment directory. Not in a chat message. Not only in your shell
history. Put it in your password manager, secrets vault, or backup system, and
record which server/volume it belongs to.

**Why this matters — what happens if you lose it or change it:**

| Situation | Consequence |
|---|---|
| You **lose** the key | The stored service-account key can never be decrypted. You must re-upload the Google service-account JSON and re-run setup. |
| You **change** the key on an existing install | The app still starts and looks healthy, but **every Google call fails** — it cannot read the stored key. There is no error telling you the key is wrong. |
| You **don't set** a key | The service-account key is written to the database in **plaintext**, silently. Intended for quick local testing only. |

**Every future update needs the same key.** Upgrading, redeploying, restoring a
backup, or moving to a new server all mean supplying this same value again. That
is why it must be stored somewhere durable that survives losing the server.

> **Restoring a backup?** You need **both** `data/` **and** the matching
> `ENCRYPTION_KEY`. One without the other leaves the stored key unreadable.

---


## Quick Start (Docker — recommended)

There are **three compose files**. They do different jobs and are separate files
on purpose (not profiles), so there is no flag to forget and no way to run the
server file without TLS.

|  | `docker-compose.yml` | `docker-compose.dev.yml` | `docker-compose.traefik.yml` |
|---|---|---|---|
| **Use it on** | a server, VPS, anywhere reachable | your own machine | a platform that already terminates TLS |
| **Needs** | `GWS_DOMAIN` + `ENCRYPTION_KEY` | **nothing** — works with no `.env` | `ENCRYPTION_KEY` |
| **Serves** | HTTPS on 443 via bundled Caddy | plain HTTP on `127.0.0.1:8090` | nothing — the platform proxies to it |
| **App port published?** | **no** | loopback only | **no** |
| **Reachable from** | the internet, at your domain | only that one machine | the platform's network |

**On a server:**

```bash
git clone <repo-url> gws-admin && cd gws-admin
cp .env.example .env            # set GWS_DOMAIN and ENCRYPTION_KEY
docker compose up -d            # → https://<GWS_DOMAIN>
```

**On your own machine (no domain, no VPS, no TLS):**

```bash
git clone <repo-url> gws-admin && cd gws-admin
docker compose -f docker-compose.dev.yml up -d   # → http://127.0.0.1:8090
```

Either way **nothing needs installing beyond Docker.** On a server the compose
pulls the published image; locally the dev compose builds it from the checkout
(PocketBase and the Go signer are fetched/compiled during that build).

The details of each are below.

### On a server — `docker-compose.yml`

**HTTPS by default.** Caddy obtains and renews a certificate for you, and
PocketBase is never published on a host port, so there is no plaintext path to it.

`GWS_DOMAIN` must already resolve to this server (an A/AAAA record), and ports
**80 and 443 must be reachable from the internet** so Caddy can complete the ACME
challenge.

Both variables are enforced: **compose refuses to start without them.** Neither
has a safe default — an empty `ENCRYPTION_KEY` does not fail loudly, it makes the
app silently store your Google service-account key in plaintext.

### On your own machine — `docker-compose.dev.yml`

Publishes the app on **`127.0.0.1:8090` only** — this machine, and nothing else on
your network. Open <http://127.0.0.1:8090>. It needs no `.env` at all.

It is a separate file rather than a flag so there is no way to end up running the
server file with the proxy disabled. It defaults `ENCRYPTION_KEY` to a throwaway
value — **never point it at production `data/`**, because a different key makes the
stored service-account key unreadable rather than failing loudly.

### Using your own reverse proxy

Run the app without the bundled Caddy. It is not published on a host port, so
give your proxy one of two things:

**1. A loopback port** — simplest, works with any host-installed proxy:

```bash
docker compose -f docker-compose.dev.yml up -d     # binds 127.0.0.1:8090 only
```

Then point nginx/Traefik/your ingress at `http://127.0.0.1:8090`. Keep the
loopback binding — do **not** change it to `0.0.0.0`, which would put an
unencrypted admin panel on your network.

**2. The compose network** — if your proxy also runs in Docker:

```bash
docker network connect gws-manager_gws-net <your-proxy-container>
```

and proxy to `gws:8090` by service name.

**3. Your platform deploys from this repo** (Dokploy, Coolify, an ingress
controller — anything that runs `docker compose up` for you).

Use **`docker-compose.traefik.yml`**. Do **not** leave the path on
`docker-compose.yml`: that file starts its own Caddy on ports 80 and 443, which
the platform's proxy already holds, so the deploy fails — and it requires
`GWS_DOMAIN`, which a platform deployment does not use.

| Setting | Value |
|---|---|
| Compose path | `./docker-compose.traefik.yml` |
| Environment | `ENCRYPTION_KEY=<value>` — **required**, the deploy aborts without it |

That file runs the app alone: no proxy, no published ports, reachable by the
platform on `gws:8090`.

**Point the platform at the volume holding your existing `data/`.** The file
declares a named volume, and a fresh one means the app starts empty.

**Whatever you use, set these response headers** at your proxy. They are applied
by the bundled `caddy/Caddyfile`, which your proxy replaces:

| Header | Value | Why |
|---|---|---|
| `Strict-Transport-Security` | `max-age=31536000` | Pin HTTPS. Add `includeSubDomains` only once every subdomain is HTTPS-capable. |
| `X-Content-Type-Options` | `nosniff` | No MIME sniffing. |
| `X-Frame-Options` | `SAMEORIGIN` | No framing by other sites. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Don't leak paths to third parties. |
| `X-Robots-Tag` | `noindex, nofollow` | An admin console should not be searchable. Optional. |

Remove or mask the `Server` header if your proxy sends one.

A `Content-Security-Policy` is deliberately **not** included: the frontend loads
Tailwind, htmx, GrapesJS and Font Awesome from CDNs and uses inline handlers, so a
CSP has to allow those origins and `unsafe-inline`. Publishing one untested would
break the UI, and a loose one is worse than none because it reads as coverage that
isn't there. If you want a CSP, tune it against your own deployment and tighten
from there.

## Quick Start (bare metal)

```bash
./scripts/install.sh            # downloads PocketBase, builds the signer, writes .env
cd ~/gws-admin && ./start.sh
```

`install.sh` needs `curl`, `tar`, `unzip`, and Go 1.22+ (the signer is compiled
for your platform). It can also register a systemd service.

**Bare metal binds `127.0.0.1:8090` only.** PocketBase serves plain HTTP, so
binding every interface would put the admin UI on your network unencrypted. Put a
reverse proxy in front of it (see
[Using your own reverse proxy](#using-your-own-reverse-proxy) — the headers there
apply the same way) and reach it through that.

Override with `GWS_BIND` if you deliberately need direct exposure, e.g.
`GWS_BIND=0.0.0.0:8090 ./start.sh`. Do not do that on an untrusted network.

**First time?** Register with your Google Workspace domain email, then upload a
service-account JSON key with domain-wide delegation in **Settings**. The user
sync then populates your domain users.

**Doing the Google side for the first time?** That is a separate setup on Google's
side — a GCP project, three APIs, a service account, and six OAuth scopes
authorised in the Admin Console. Full walkthrough, automated and manual:

**→ [Connect Google Workspace](GOOGLE-WORKSPACE.md)**

It is the step people get stuck on, and where a single missing scope makes one
feature fail with no useful error.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `GWS_DOMAIN` | **yes, with the bundled proxy** | Hostname Caddy serves and obtains a certificate for. Must resolve to this server. Not needed with `docker-compose.dev.yml` or your own proxy. |
| `ENCRYPTION_KEY` | **yes, for production** | Encrypts the Google service-account key at rest. **Generate once for a NEW install only, then keep forever** — reuse the original for an existing `data/` volume. See [Before you install](#before-you-install-create-your-encryption-key). |
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
gws-manager/
├── frontend/          # HTML, JS, CSS served as PocketBase public dir
├── hooks/             # PocketBase JS hooks (all API routes + cron)
├── lib/               # Shared helpers (auth, Google API, encryption)
├── backend/           # PocketBase migration files
├── data/              # SQLite database (auto-created; mount as a volume)
├── sidecar/           # Go signer source for RS256 JWT (Google SA keys)
├── scripts/           # install, start, manage, build helpers
├── caddy/             # Caddyfile for the bundled HTTPS proxy
├── docs/              # Design notes
├── .env.example       # Copy to .env; GWS_DOMAIN + ENCRYPTION_KEY are required
├── Dockerfile
├── docker-compose.yml      # Standalone server: bundled Caddy, TLS on
├── docker-compose.traefik.yml # Platform owns TLS (Dokploy/Coolify/ingress)
├── docker-compose.dev.yml  # Local only: no TLS, 127.0.0.1
├── THIRD_PARTY_NOTICES.md  # Upstream licenses for bundled components
└── DEVELOPMENT.md     # Development guide
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

## Using the published image

**There is nothing to build.** The image is published publicly to GitHub
Container Registry, so no registry login is required:

```bash
docker pull ghcr.io/wannaco/gws-manager:latest
```

Run it (supply the `ENCRYPTION_KEY` you created above). **The port is bound to
loopback** so the unencrypted admin UI is not on your network:

```bash
docker run -d --name gws-manager -p 127.0.0.1:8090:8090 \
  -e ENCRYPTION_KEY='<your key>' \
  -v gws_data:/app/data \
  ghcr.io/wannaco/gws-manager:latest
```

→ <http://127.0.0.1:8090>

This is a **local / evaluation** run: plain HTTP, no TLS. For anything reachable,
use `docker compose up -d` — the bundled Caddy gives you HTTPS and never publishes
the app port. If you front it with your own proxy instead, see
[Using your own reverse proxy](#using-your-own-reverse-proxy).

**If you are attaching an existing `data/` volume, you must pass the same
`ENCRYPTION_KEY` that was used when that data was created.** A different value
does not raise an error — the app starts normally and then fails every Google
call, because it cannot decrypt the stored service-account key.

### Updating

`docker compose up -d` pulls `:latest` each time, so taking an update is:

```bash
docker compose pull && docker compose up -d
```

Or pin a specific digest for reproducibility. Back up `data/` **and** your
`ENCRYPTION_KEY` first — restoring one without the other leaves the stored
service-account key unreadable.

### Building from source

Not a documented path for self-hosters — it is a **development** task. See
[DEVELOPMENT.md](DEVELOPMENT.md). The licence permits modifying and running this
software internally, but **not distributing a built image to others**.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for the full development guide.

```bash
# Run PocketBase in dev mode + the signer
./scripts/start.sh

# Run tests
npx playwright test
```

### PocketBase hook gotchas

The two that bite hardest. **The full list of nine — including the four that
silently produce wrong behaviour rather than errors — is in
[DEVELOPMENT.md](DEVELOPMENT.md#pocketbase-what-will-bite-you).**

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

**PolyForm Internal Use License 1.0.0** — see [LICENSE](LICENSE). That is the
standard PolyForm text plus one added section permitting personal use.

**Free for internal use, at any company size.** You may use, modify and
self-host this software to administer your own Google Workspace domain, as part
of your own organisation's internal operations — commercially or not. Small
business, enterprise, nonprofit, government, home lab: all permitted, at no
cost and with no registration.

**You may not distribute it.** Without written permission from the copyright
holder you may not:

- redistribute the software, or a modified version of it, to anyone else
- offer it to third parties as a hosted or managed service
- bundle or embed it in a product or service that you sell

**Commercial licensing** is available for those cases — contact the maintainer.

### This is source-available, not "open source"

To be precise about the term: the [Open Source Definition](https://opensource.org/osd)
forbids restricting a license by field of endeavour, so **no license that
restricts what you may use it for can be called open source**. This project is
*source-available* / *internal-use*. Some practical consequences:

- GitHub will not show an OSI-approved license badge for it.
- Linux distributions and some package repositories cannot redistribute it.
- Some companies have policies against using non-OSI licenses — if you sell to
  them, expect questions.

That is a deliberate trade-off: the source is public so it can be audited,
self-hosted and improved, while commercial rights stay with the copyright
holder. If you would rather be OSI-approved, the usual alternatives are
AGPL-3.0 (copyleft; permits all commercial use, but forces anyone offering it as
a service to publish their changes) or BUSL-1.1 (time-delayed: converts to an
open license after a set period).

### Third-party components

This software redistributes the PocketBase binary (MIT) and runs on an Alpine
Linux base image. Full notices and license texts: see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Copyright (c) 2026 ThinkCloud.

