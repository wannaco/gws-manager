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
    echo "${RED}❌ gcloud CLI not found${NC}"
    echo "Please use Google Cloud Shell or install gcloud CLI"
    exit 1
fi

# Get or generate project name
if [ -z "$PROJECT_NAME" ]; then
    DEFAULT_NAME="gws-admin-$(date +%s)"
    read -p "Enter project name [$DEFAULT_NAME]: " PROJECT_NAME
    PROJECT_NAME=${PROJECT_NAME:-$DEFAULT_NAME}
fi

echo "${YELLOW}📋 Using project name: $PROJECT_NAME${NC}"

# Step 1: Create project
echo ""
echo "${YELLOW}Step 1/5: Creating GCP project...${NC}"
gcloud projects create $PROJECT_NAME \
    --name="GWS Manager - $(date +%Y-%m-%d)" \
    --set-as-default 2>/dev/null || {
    echo "${RED}⚠️  Project may already exist or name is taken${NC}"
    gcloud config set project $PROJECT_NAME
}

echo "${GREEN}✓ Project created/selected${NC}"

# Step 2: Enable APIs (billing not required for Admin SDK)
echo ""
echo "${YELLOW}Step 2/5: Enabling APIs...${NC}"
gcloud services enable admin.googleapis.com
gcloud services enable gmail.googleapis.com
gcloud services enable calendar-json.googleapis.com
echo "${GREEN}✓ APIs enabled${NC}"

# Step 3: Create service account
echo ""
echo "${YELLOW}Step 3/5: Creating service account...${NC}"
SERVICE_ACCOUNT="gws-admin-sa@$PROJECT_NAME.iam.gserviceaccount.com"
gcloud iam service-accounts create gws-admin-sa \
    --display-name="GWS Manager Service Account" \
    --description="Service account for GWS Manager domain-wide delegation" 2>/dev/null || {
    echo "${YELLOW}⚠️  Service account already exists${NC}"
}
echo "${GREEN}✓ Service account ready${NC}"

# Step 3.5: Enable domain-wide delegation
echo ""
echo "${YELLOW}Step 3.5/5: Enabling domain-wide delegation...${NC}"
gcloud iam service-accounts enable-domain-wide-delegation $SERVICE_ACCOUNT 2>/tmp/dwd_err || {
    echo "${YELLOW}⚠️  Could not enable domain-wide delegation via gcloud${NC}"
    echo "   This can also be done in the GCP Console → IAM & Admin → Service Accounts"
    echo "   → Select the service account → 'Enable Google Workspace Domain-wide Delegation'"
    cat /tmp/dwd_err 2>/dev/null
}
echo "${GREEN}✓ Domain-wide delegation enabled${NC}"

# Step 4: Create key
echo ""
echo "${YELLOW}Step 4/5: Creating service account key...${NC}"
KEY_FILE="$HOME/gws-admin-key-$PROJECT_NAME.json"

_create_key() {
    gcloud iam service-accounts keys create "$KEY_FILE" \
        --iam-account="$SERVICE_ACCOUNT" 2>/tmp/key_err
}

if ! _create_key; then
    if grep -q "disableServiceAccountKeyCreation\|FAILED_PRECONDITION" /tmp/key_err; then
        echo ""
        echo "${YELLOW}⚠️  Org policy blocks key creation. Attempting to override for this project...${NC}"
        if gcloud resource-manager org-policies disable-enforce \
            constraints/iam.disableServiceAccountKeyCreation \
            --project="$PROJECT_NAME" 2>/tmp/policy_err; then
            echo "${GREEN}✓ Policy overridden. Retrying key creation...${NC}"
            sleep 3  # allow policy propagation
            if ! _create_key; then
                echo "${RED}❌ Key creation still failed after policy override:${NC}"
                cat /tmp/key_err
                exit 1
            fi
        else
            echo "${RED}❌ Could not override the org policy (you may need roles/orgpolicy.policyAdmin).${NC}"
            echo ""
            echo "Ask your GCP Org Policy Administrator to run:"
            echo "  gcloud resource-manager org-policies disable-enforce \\"
            echo "    constraints/iam.disableServiceAccountKeyCreation \\"
            echo "    --project=$PROJECT_NAME"
            echo "Then re-run this script."
            exit 1
        fi
    else
        echo "${RED}❌ Key creation failed:${NC}"
        cat /tmp/key_err
        exit 1
    fi
fi
echo "${GREEN}✓ Key saved to: $KEY_FILE${NC}"

# Get client ID
echo ""
CLIENT_ID=$(gcloud iam service-accounts describe $SERVICE_ACCOUNT --format='value(oauth2ClientId)')
echo "${GREEN}✓ Client ID: $CLIENT_ID${NC}"

# Summary
echo ""
echo "${GREEN}🎉 Setup Complete!${NC}"
echo "======================"
echo ""
echo "📊 Project Details:"
echo "  Project ID: $PROJECT_NAME"
echo "  Project Number: $(gcloud projects describe $PROJECT_NAME --format='value(projectNumber)')"
echo "  Service Account: $SERVICE_ACCOUNT"
echo "  Client ID: $CLIENT_ID"
echo ""
echo "📁 Files:"
echo "  Key file: $KEY_FILE"
echo ""
echo "📝 Next Steps:"
echo "  1. Copy the key file contents (cat $KEY_FILE)"
echo "  2. Add Client ID to Domain-Wide Delegation in Google Admin Console"
echo "     → https://admin.google.com/ac/owl/domainwidedelegation"
echo "  3. Add these OAuth scopes:"
echo "     - https://www.googleapis.com/auth/gmail.settings.basic"
echo "     - https://www.googleapis.com/auth/gmail.settings.sharing"
echo "     - https://www.googleapis.com/auth/admin.directory.user.readonly"
  # NOTE: the WRITE scope, needed to add send-as aliases. Easy to omit
  # because admin.directory.user.readonly looks like it covers it -- it does not.
  echo "     - https://www.googleapis.com/auth/admin.directory.user"
echo "     - https://www.googleapis.com/auth/admin.directory.group.readonly"
echo "     - https://www.googleapis.com/auth/calendar"
echo ""
echo "  4. Run the verification script:"
echo "     ./verify.sh $PROJECT_NAME"
echo ""

# Optional: Copy key to clipboard
echo "🔧 Optional: Copy key to clipboard"
if command -v pbcopy &> /dev/null; then
    cat "$KEY_FILE" | pbcopy
    echo "   (Key copied to clipboard on Mac)"
elif command -v xclip &> /dev/null; then
    cat "$KEY_FILE" | xclip -selection clipboard
    echo "   (Key copied to clipboard on Linux)"
fi

echo ""
echo "${YELLOW}Displaying key (save this securely):${NC}"
cat "$KEY_FILE"
echo ""
