# GWS Manager Setup Tutorial

## Welcome to GWS Manager Setup!

This tutorial will help you create and configure a Google Cloud Platform project for GWS Manager. It takes about 5 minutes.

<walkthrough-tutorial-duration duration="3"></walkthrough-tutorial-duration>

## What you'll do

1. Run **one script** (`bash setup.sh`) — it handles authentication, project creation, APIs, service account, key download, and verification automatically.
2. Paste the **Client ID** and **OAuth scopes** into Google Admin Console.
3. Drag & drop the downloaded `.json` key file into GWS Manager.

Click **Next** to begin.

## Step 1: Run the Setup Script

Run this single command in the Cloud Shell terminal:

```bash
bash setup.sh
```

The script will automatically:
- Link your Google account to `gcloud` (if not already active)
- Create a new GCP project (press Enter for the default name)
- Enable required APIs (Admin SDK, Gmail, Calendar)
- Create the service account & handle org policy blockers if needed
- Verify everything and **download the `.json` key file** straight to your computer
- Print your **Client ID** and a **single comma-separated OAuth scopes line**

## Step 2: Authorize Domain-Wide Delegation

<walkthrough-warning-title>One Manual Step in Google Admin Console</walkthrough-warning-title>
<walkthrough-warning>
Google does not provide an API for Domain-Wide Delegation, so this step is done once in your Workspace Admin Console.
</walkthrough-warning>

1. Open [Domain-Wide Delegation](https://admin.google.com/ac/owl/domainwidedelegation) in Google Admin Console
2. Click **Add new**
3. Paste the **Client ID** printed by `setup.sh`
4. Paste the **single comma-separated OAuth Scopes line** printed by `setup.sh` (all 6 scopes in one paste):

```text
https://www.googleapis.com/auth/gmail.settings.basic,https://www.googleapis.com/auth/gmail.settings.sharing,https://www.googleapis.com/auth/admin.directory.user.readonly,https://www.googleapis.com/auth/admin.directory.user,https://www.googleapis.com/auth/admin.directory.group.readonly,https://www.googleapis.com/auth/calendar
```

5. Click **Authorize**

<walkthrough-success-title>Setup Complete!</walkthrough-success-title>

## Next Step

Return to **GWS Manager** and **drag & drop** the downloaded `.json` key file into the Setup screen.

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
