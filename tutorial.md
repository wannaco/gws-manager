# GWS Manager Setup Tutorial

## Welcome to GWS Manager Setup!

This tutorial will help you create and configure a Google Cloud Platform project for GWS Manager. It takes about 5 minutes.

<walkthrough-tutorial-duration duration="5"></walkthrough-tutorial-duration>

## What you'll do

- Run the automated setup script
- Authorize domain-wide delegation in Google Admin Console
- Verify your setup

Click **Next** to begin.

## Step 1: Link Your Account to gcloud

Cloud Shell is already authenticated via your browser session, but gcloud CLI needs the account explicitly registered in its config. Run:

```bash
gcloud auth login
```

Type **Y** at the prompt — this does **not** re-authenticate you. It just links your existing Cloud Shell session to gcloud's configuration.

## Step 2: Run the Automated Setup

Run the setup script — it handles everything automatically:

```bash
bash setup.sh
```

The script will:
- Create a new GCP project
- Enable required APIs (Admin SDK, Gmail, Calendar)
- Create a service account
- Enable domain-wide delegation
- Generate a JSON key
- Handle org policy blockers automatically
- Display your **Client ID** and **credentials**

<walkthrough-footnote>If the script asks for a project name, just press Enter to use the default.</walkthrough-footnote>

## Step 3: Authorize Domain-Wide Delegation (Manual Step)

<walkthrough-warning-title>Important: Manual Step Required</walkthrough-warning-title>
<walkthrough-warning>
You must complete this step in the Google Admin Console for your domain.
</walkthrough-warning>

1. Go to [Google Admin Console](https://admin.google.com) → Security → API Controls → Domain-wide Delegation
2. Click "Manage Domain-Wide Delegation"
3. Click "Add new"
4. Enter the **Client ID** shown by the setup script:

```bash
echo "Client ID: $(gcloud iam service-accounts describe gws-admin-sa@$(gcloud config get-value project).iam.gserviceaccount.com --format='value(oauth2ClientId)')"
```

5. Add these OAuth scopes (one per line):
   - `https://www.googleapis.com/auth/gmail.settings.basic`
   - `https://www.googleapis.com/auth/gmail.settings.sharing`
   - `https://www.googleapis.com/auth/admin.directory.user.readonly`
   - `https://www.googleapis.com/auth/admin.directory.user`
   - `https://www.googleapis.com/auth/admin.directory.group.readonly`
   - `https://www.googleapis.com/auth/calendar`

  > All six are required. `admin.directory.user` (without `.readonly`) is the
  > **write** scope used when adding a send-as alias — omitting it makes that one
  > feature fail with a 403 while everything else works.

6. Click "Authorize"

## Step 4: Verify Your Setup

Run the verification script to confirm everything is configured:

```bash
bash verify.sh
```

This checks:
- Project exists and is active
- APIs are enabled
- Service account exists with domain-wide delegation
- Key file is valid
- Client ID is retrievable

<walkthrough-success-title>Setup Complete!</walkthrough-success-title>

## Next Steps

1. **Copy the JSON key** — the setup script displayed it and saved it to a file
2. **Complete domain-wide delegation** in Step 3 (if you haven't already)
3. **Go to GWS Manager** → Settings → paste your credentials and connect your domain

<walkthrough-conclusion>
**Need help?** Contact support at support@thinkcloud.dev
</walkthrough-conclusion>

## Troubleshooting

**"Permission denied"**
- Make sure you're a project owner or have Project Creator role
- Check with your Google Workspace admin

**"Service account key creation is disabled" (iam.disableServiceAccountKeyCreation)**
- The setup script handles this automatically
- If the auto-fix fails, run:
```bash
gcloud resource-manager org-policies disable-enforce \
  constraints/iam.disableServiceAccountKeyCreation \
  --project=$(gcloud config get-value project)
```
Then re-run `bash setup.sh`

**Lost your key?**
```bash
bash setup.sh  # re-run to generate a new key
```
