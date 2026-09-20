# Security Policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Use GitHub's private reporting form:

**https://github.com/wannaco/gws-manager/security/advisories/new**

That opens a private draft advisory only you and the maintainer can see. If you
would rather not use GitHub, open a normal issue that says *"security issue, need
a private channel"* — with no details — and a private channel will be arranged.

## Before you paste anything

This software stores Google service-account private keys. When reporting, please
**never include**:

- the contents of a service-account JSON key (`private_key`, `client_email`)
- your `ENCRYPTION_KEY`
- real user email addresses or domain names from a live tenant
- OAuth tokens, webhook URLs, or request logs containing any of the above

Describe the shape of the problem instead. "The key is stored unencrypted at
path X" is just as useful as the key itself.

## What is in scope

The interesting surface is small and specific:

| In scope | Notes |
|---|---|
| The API under `/gws/*` | auth bypass, CORS mistakes, unauthenticated data access |
| Service-account key handling | storage, encryption at rest, logging, error messages that leak it |
| Google API calls | scope over-reach, or acting as a user the operator did not authorise |
| The signer sidecar | it holds the private key in memory and signs JWTs |
| The container image | default exposures, published ports, base-image issues |

## What is not in scope

- Anything requiring a Google Workspace super admin to already be acting in bad
  faith — they can do all of this through the Admin Console.
- Issues in PocketBase itself — report those
  [upstream](https://github.com/pocketbase/pocketbase).
- Findings from a scanner with no demonstrated impact.
- Missing headers or hardening on a deployment that sits behind somebody else's
  proxy — see the README for the headers worth setting.

## What to expect

**This is an unpaid, spare-time project. There is no SLA.**

No response-time commitment, no fix commitment, and no support obligation — the
licence says the software comes *as is*, without warranty, and that is deliberate.
What is true:

- Security reports are read first, ahead of feature requests and ordinary bugs.
- You will get an acknowledgement, and an honest assessment — including "not a
  vulnerability" if that is the answer.
- If a fix is warranted it is prioritised over everything else, but no date is
  promised.

**If you need a fix by a date, that is a paid engagement** — see the README.
Buying a commitment is exactly what commercial support is for.
