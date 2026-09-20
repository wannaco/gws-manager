# Connect Google Workspace

The app impersonates your Workspace users through a **Google service account with
domain-wide delegation (DWD)**. This is the whole Google-side setup — no OAuth
consent screen, no published app, no verification review.

Two ways in:

- **[Automated](#automated--cloud-shell)** — a script creates the GCP project,
  enables the APIs, creates the service account, and prints what to paste into the
  Admin Console. Runs in Cloud Shell (or anywhere `gcloud` is installed).
- **[Manual](#manual--step-by-step)** — the same thing by hand, if you would rather
  click through the Console or cannot use the script.

Either way you finish with the **service-account JSON key**, which you upload in the
app under **Settings**.

> **You need:** a Google Workspace domain, and an account that is a **super admin**
> of it. DWD cannot be authorised by a regular admin.

---

## What gets created

| | |
|---|---|
| GCP project | one, dedicated to this app |
| APIs enabled | `admin.googleapis.com`, `gmail.googleapis.com`, `calendar-json.googleapis.com` |
| Service account | `gws-admin-sa` |
| Domain-wide delegation | enabled on that service account |

**Billing is not required.** The Admin SDK and Gmail APIs used here are available
without a billing account attached.

---

## The OAuth scopes

Six. The app requests exactly these, and DWD authorises exactly these — a mismatch
in either direction produces `401`/`403` at run time, on the feature that needs the
scope.

| Scope | Why it is needed |
|---|---|
| `gmail.settings.basic` | Signatures, filters, vacation responder, send-as |
| `gmail.settings.sharing` | Delegates and forwarding addresses |
| `admin.directory.user.readonly` | User sync — names, titles, departments, org units |
| `admin.directory.user` | **Write** — adding a send-as alias (`addAlias`) |
| `admin.directory.group.readonly` | Reading Google Group membership for targeting |
| `calendar` | Calendar sharing (ACL) management |

> **Copy them exactly, one per line.** A trailing space, a wrong character, or a
> scope authorised in the Admin Console but not requested by the app will fail
> silently on the one feature that uses it.

---

## Automated — Cloud Shell

The fastest path, and the one the app's **Open setup tutorial in Cloud Shell**
button launches.

1. Open [Cloud Shell](https://shell.cloud.google.com) — or any machine with
   `gcloud` installed and authenticated.
2. Run:

   ```bash
   ./setup.sh
   ```

   It creates the project, enables the APIs, creates the service account, enables
   DWD, and prints your **Client ID** and the scope list.

3. **Authorise DWD in the Admin Console** — a manual step the script cannot do for
   you (see [below](#authorise-domain-wide-delegation)).
4. Verify:

   ```bash
   ./verify.sh <project-name>
   ```

5. Download the JSON key and upload it in the app.

To remove everything later, `./cleanup.sh <project-name>`.

---

## Manual — step by step

### 1. Create a GCP project

[console.cloud.google.com](https://console.cloud.google.com) → project selector →
**New project**. Or:

```bash
gcloud projects create my-gws-admin --name="GWS Manager"
gcloud config set project my-gws-admin
```

### 2. Enable the three APIs

Console → **APIs & Services** → **Library**, search for and enable each:

- **Admin SDK API**
- **Gmail API**
- **Google Calendar API**

Or all three at once:

```bash
gcloud services enable admin.googleapis.com
gcloud services enable gmail.googleapis.com
gcloud services enable calendar-json.googleapis.com
```

### 3. Create the service account

Console → **IAM & Admin** → **Service Accounts** → **Create service account**.

- Name: `gws-admin-sa`
- Skip the optional role and user-access steps — DWD grants access through the
  Admin Console, not IAM roles.

Or:

```bash
gcloud iam service-accounts create gws-admin-sa \
  --display-name="GWS Manager"
```

### 4. Enable domain-wide delegation on it

Console → **IAM & Admin** → **Service Accounts** → click `gws-admin-sa` → **Details**
→ **Advanced settings** → **Enable Google Workspace Domain-wide Delegation** → Save.

Or:

```bash
gcloud iam service-accounts enable-domain-wide-delegation \
  gws-admin-sa@my-gws-admin.iam.gserviceaccount.com
```

### 5. Note the Client ID

Console → the service account → **Details** → **OAuth 2 Client ID**. It is a long
numeric string, **not** the service-account email.

Or:

```bash
gcloud iam service-accounts describe \
  gws-admin-sa@$(gcloud config get-value project).iam.gserviceaccount.com \
  --format='value(oauth2ClientId)'
```

### 6. Authorise the six scopes

See [Authorise domain-wide delegation](#authorise-domain-wide-delegation) below.

### 7. Create a JSON key and upload it

Console → the service account → **Keys** → **Add key** → **Create new key** →
**JSON**. A file downloads.

Then in the app: **Settings** → upload that file.

### 8. Verify

```bash
./verify.sh my-gws-admin
```

Or in the app, go to **GWS Users** and sync — if the scopes and DWD are right, your
users appear.

---

## Authorise domain-wide delegation

This is the step that has to happen in the **Admin Console**, not the Cloud
Console, and it is the one people miss.

1. Sign in to [admin.google.com](https://admin.google.com) as a **super admin**.
2. **Security** → **Access and data control** → **API controls**.
3. **Domain-wide delegation** → **Manage Domain-wide Delegation**.
4. **Add new**.
5. **Client ID** — the numeric OAuth client ID from step 5 above. Not the email.
6. **OAuth scopes** — paste all six, comma-separated on one line, or one per line
   if the field accepts it:

   ```
   https://www.googleapis.com/auth/gmail.settings.basic,
   https://www.googleapis.com/auth/gmail.settings.sharing,
   https://www.googleapis.com/auth/admin.directory.user.readonly,
   https://www.googleapis.com/auth/admin.directory.user,
   https://www.googleapis.com/auth/admin.directory.group.readonly,
   https://www.googleapis.com/auth/calendar
   ```

7. **Authorize**.

DWD changes can take a few minutes to propagate.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `401` on everything | Client ID not authorised, or the wrong value (email instead of numeric ID) |
| One feature `403`s, the rest work | That feature's scope is missing, or mistyped, in the Admin Console list |
| `unauthorized_client` | DWD not enabled **on the service account** (step 4), as well as authorised in the Console |
| User sync returns 0 users | `admin.directory.user.readonly` missing, or the admin account is not a super admin |
| Adding a send-as alias fails | The `admin.directory.user` **write** scope is missing — it is easy to omit because `…user.readonly` looks like enough |
| `invalid_grant` | The service-account key was deleted or rotated; create a new one and re-upload |

`./verify.sh` checks the project, the APIs, the service account, and prints the
Client ID and scopes it finds — run it first when something fails.

---

## What the app stores

The **service-account JSON key**, encrypted at rest with your `ENCRYPTION_KEY` —
see the [encryption key section](README.md#before-you-install-create-your-encryption-key).

Losing `ENCRYPTION_KEY` means the stored key cannot be read back and you re-upload
the JSON. Losing the JSON itself just means creating a new key — nothing else in
your Workspace is affected.
