#!/bin/bash
# GWS Manager - Automated GCP Project Setup
# This script automates the entire GCP setup process

set -e  # Exit on error

echo "🚀 GWS Manager GCP Setup"
echo "======================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}❌ gcloud CLI not found${NC}"
    echo "Please use Google Cloud Shell or install gcloud CLI"
    exit 1
fi

# Ensure gcloud has an active account (in Cloud Shell this links the browser session)
ACTIVE_ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -n1 || true)
if [ -z "$ACTIVE_ACCOUNT" ]; then
    echo -e "${YELLOW}🔐 Linking your Google account to gcloud...${NC}"
    gcloud auth login
    ACTIVE_ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -n1 || true)
fi
[ -n "$ACTIVE_ACCOUNT" ] && echo -e "${GREEN}✓ Authenticated as: $ACTIVE_ACCOUNT${NC}"

# Get or generate project name
if [ -z "${PROJECT_NAME:-}" ]; then
    DEFAULT_NAME="gws-admin-$(date +%s)"
    read -r -p "Enter project name [$DEFAULT_NAME]: " PROJECT_NAME </dev/tty
    PROJECT_NAME=${PROJECT_NAME:-$DEFAULT_NAME}
fi

echo -e "${YELLOW}📋 Using project name: $PROJECT_NAME${NC}"

# Step 1: Create or select project
echo ""
echo -e "${YELLOW}Step 1/5: Creating/selecting GCP project...${NC}"
if gcloud projects describe "$PROJECT_NAME" >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Project $PROJECT_NAME already exists — selecting it${NC}"
    gcloud config set project "$PROJECT_NAME" --quiet
elif gcloud projects create "$PROJECT_NAME" \
    --name="GWS Manager - $(date +%Y-%m-%d)" \
    --set-as-default 2>/tmp/proj_err; then
    echo -e "${GREEN}✓ Project created and selected${NC}"
else
    echo -e "${RED}❌ Could not create project '$PROJECT_NAME':${NC}"
    cat /tmp/proj_err 2>/dev/null || true
    echo ""
    echo -e "${YELLOW}Common reasons:${NC}"
    echo "  • Google Cloud Terms of Service not yet accepted (visit https://console.cloud.google.com once)"
    echo "  • Missing 'Project Creator' (roles/resourcemanager.projectCreator) permission"
    echo ""
    EXISTING_PROJECTS=$(gcloud projects list --format='value(projectId)' 2>/dev/null || true)
    if [ -n "$EXISTING_PROJECTS" ]; then
        echo "Existing projects you have access to:"
        echo "$EXISTING_PROJECTS" | sed 's/^/  - /'
        echo ""
        read -r -p "Enter an existing project ID to use instead (or press Enter to exit): " ALT_PROJECT </dev/tty
        if [ -n "$ALT_PROJECT" ]; then
            PROJECT_NAME="$ALT_PROJECT"
            gcloud config set project "$PROJECT_NAME" --quiet
            echo -e "${GREEN}✓ Selected existing project: $PROJECT_NAME${NC}"
        else
            exit 1
        fi
    else
        exit 1
    fi
fi

# Step 2: Enable APIs (billing not required for Admin SDK)
echo ""
echo -e "${YELLOW}Step 2/5: Enabling APIs...${NC}"
gcloud services enable admin.googleapis.com
gcloud services enable gmail.googleapis.com
gcloud services enable calendar-json.googleapis.com
echo -e "${GREEN}✓ APIs enabled${NC}"

# Step 3: Create service account
echo ""
echo -e "${YELLOW}Step 3/5: Creating service account...${NC}"
SERVICE_ACCOUNT="gws-admin-sa@$PROJECT_NAME.iam.gserviceaccount.com"
if gcloud iam service-accounts describe "$SERVICE_ACCOUNT" >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Service account already exists${NC}"
else
    gcloud iam service-accounts create gws-admin-sa \
        --display-name="GWS Manager Service Account" \
        --description="Service account for GWS Manager domain-wide delegation"
fi
echo -e "${GREEN}✓ Service account ready${NC}"

# Step 3.5: Enable domain-wide delegation
echo ""
echo -e "${YELLOW}Step 3.5/5: Enabling domain-wide delegation...${NC}"
gcloud iam service-accounts enable-domain-wide-delegation "$SERVICE_ACCOUNT" 2>/tmp/dwd_err || {
    echo -e "${YELLOW}⚠️  Could not enable domain-wide delegation via gcloud${NC}"
    echo "   This can also be done in the GCP Console → IAM & Admin → Service Accounts"
    echo "   → Select the service account → 'Enable Google Workspace Domain-wide Delegation'"
    cat /tmp/dwd_err 2>/dev/null || true
}
echo -e "${GREEN}✓ Domain-wide delegation enabled${NC}"

# Step 4: Create key
echo ""
echo -e "${YELLOW}Step 4/5: Creating service account key...${NC}"
KEY_FILE="$HOME/gws-admin-key-$PROJECT_NAME.json"

_create_key() {
    gcloud iam service-accounts keys create "$KEY_FILE" \
        --iam-account="$SERVICE_ACCOUNT" 2>/tmp/key_err
}

if ! _create_key; then
    if grep -q "disableServiceAccountKeyCreation\|FAILED_PRECONDITION" /tmp/key_err; then
        echo ""
        echo -e "${YELLOW}⚠️  Org policy blocks key creation. Attempting to override for this project...${NC}"
        if gcloud resource-manager org-policies disable-enforce \
            constraints/iam.disableServiceAccountKeyCreation \
            --project="$PROJECT_NAME" 2>/tmp/policy_err; then
            echo -e "${GREEN}✓ Policy overridden. Retrying key creation...${NC}"
            sleep 3  # allow policy propagation
            if ! _create_key; then
                echo -e "${RED}❌ Key creation still failed after policy override:${NC}"
                cat /tmp/key_err
                exit 1
            fi
        else
            echo -e "${RED}❌ Could not override the org policy (you may need roles/orgpolicy.policyAdmin).${NC}"
            echo ""
            echo "Ask your GCP Org Policy Administrator to run:"
            echo "  gcloud resource-manager org-policies disable-enforce \\"
            echo "    constraints/iam.disableServiceAccountKeyCreation \\"
            echo "    --project=$PROJECT_NAME"
            echo "Then re-run this script."
            exit 1
        fi
    else
        echo -e "${RED}❌ Key creation failed:${NC}"
        cat /tmp/key_err
        exit 1
    fi
fi
echo -e "${GREEN}✓ Key saved to: $KEY_FILE${NC}"

# Get client ID
echo ""
CLIENT_ID=$(gcloud iam service-accounts describe "$SERVICE_ACCOUNT" --format='value(oauth2ClientId)')
echo -e "${GREEN}✓ Client ID: $CLIENT_ID${NC}"

# Inline verification
echo ""
echo -e "${YELLOW}Verifying setup...${NC}"
if [ -f "./verify.sh" ]; then
    bash ./verify.sh "$PROJECT_NAME" || true
fi

# Auto-download key in Google Cloud Shell
if command -v cloudshell &> /dev/null; then
    echo ""
    echo -e "${YELLOW}⬇️  Downloading key file to your computer via Cloud Shell...${NC}"
    cloudshell download "$KEY_FILE" || true
fi

SCOPES_CSV="https://www.googleapis.com/auth/gmail.settings.basic,https://www.googleapis.com/auth/gmail.settings.sharing,https://www.googleapis.com/auth/admin.directory.user.readonly,https://www.googleapis.com/auth/admin.directory.user,https://www.googleapis.com/auth/admin.directory.group.readonly,https://www.googleapis.com/auth/calendar"

# Summary
echo ""
echo -e "${GREEN}🎉 Setup Complete!${NC}"
echo "======================"
echo ""
echo "📊 Project Details:"
echo "  Project ID:      $PROJECT_NAME"
echo "  Project Number:  $(gcloud projects describe "$PROJECT_NAME" --format='value(projectNumber)')"
echo "  Service Account: $SERVICE_ACCOUNT"
echo "  Client ID:       $CLIENT_ID"
echo "  Key file:        $KEY_FILE"
echo ""
echo "📝 Next Steps:"
echo "  1. Open Domain-Wide Delegation in Google Admin Console:"
echo "     → https://admin.google.com/ac/owl/domainwidedelegation"
echo ""
echo "  2. Click 'Add new' and paste:"
echo "     Client ID:"
echo "       $CLIENT_ID"
echo ""
echo "     OAuth Scopes (single copy-paste line):"
echo "       $SCOPES_CSV"
echo ""
echo "  3. Drag & drop the downloaded .json key file into GWS Manager Setup!"
echo ""

# Optional: Copy key to clipboard on local macOS/Linux
if command -v pbcopy &> /dev/null; then
    cat "$KEY_FILE" | pbcopy
    echo "   (Key copied to clipboard on Mac)"
elif command -v xclip &> /dev/null; then
    cat "$KEY_FILE" | xclip -selection clipboard
    echo "   (Key copied to clipboard on Linux)"
fi

if ! command -v cloudshell &> /dev/null; then
    echo ""
    echo -e "${YELLOW}Key JSON (save securely or upload to GWS Manager):${NC}"
    cat "$KEY_FILE"
    echo ""
fi
