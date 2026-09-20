#!/bin/bash
# GWS Manager - Setup Verification Script
# Verifies that the GCP project, APIs, service account, and credentials are all properly configured
# Usage: ./verify.sh [PROJECT_ID]

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "🔍 GWS Manager - Verification"
echo "============================"
echo ""

# Get project ID
PROJECT_ID="${1:-$PROJECT_NAME}"
if [ -z "$PROJECT_ID" ]; then
    PROJECT_ID=$(gcloud config get-value project 2>/dev/null || true)
fi

if [ -z "$PROJECT_ID" ]; then
    echo "${RED}❌ No project ID provided${NC}"
    echo "Usage: ./verify.sh PROJECT_ID"
    echo "   or: export PROJECT_NAME=... && ./verify.sh"
    exit 1
fi

echo "📋 Project: $PROJECT_ID"
SA_EMAIL="gws-admin-sa@$PROJECT_ID.iam.gserviceaccount.com"
ALL_GOOD=true

# Check 1: Project exists
echo ""
echo "Checking project..."
if gcloud projects describe $PROJECT_ID &>/dev/null; then
    PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
    echo "  ${GREEN}✓ Project exists (Number: $PROJECT_NUMBER)${NC}"
else
    echo "  ${RED}❌ Project not found${NC}"
    ALL_GOOD=false
fi

# Check 2: APIs enabled
echo ""
echo "Checking APIs..."
APIS=(admin.googleapis.com gmail.googleapis.com calendar-json.googleapis.com)
for API in "${APIS[@]}"; do
    if gcloud services list --enabled --project=$PROJECT_ID --filter="name:$API" --format="value(name)" | grep -q "$API"; then
        echo "  ${GREEN}✓ $API${NC}"
    else
        echo "  ${RED}❌ $API not enabled${NC}"
        ALL_GOOD=false
    fi
done

# Check 3: Service account exists
echo ""
echo "Checking service account..."
if gcloud iam service-accounts describe $SA_EMAIL --project=$PROJECT_ID &>/dev/null; then
    echo "  ${GREEN}✓ Service account: $SA_EMAIL${NC}"

    # Check domain-wide delegation
    DWD=$(gcloud iam service-accounts describe $SA_EMAIL --project=$PROJECT_ID --format='value(disabled)' 2>/dev/null || echo "")
    if [ "$DWD" = "False" ] || [ -z "$DWD" ]; then
        echo "  ${GREEN}✓ Service account is enabled${NC}"
    else
        echo "  ${YELLOW}⚠️  Service account may be disabled${NC}"
    fi
else
    echo "  ${RED}❌ Service account not found: $SA_EMAIL${NC}"
    ALL_GOOD=false
fi

# Check 4: Key file exists
echo ""
echo "Checking credentials..."
KEY_FILE="$HOME/gws-admin-key-$PROJECT_ID.json"
if [ ! -f "$KEY_FILE" ]; then
    # Try alternate location
    KEY_FILE="$HOME/gws-admin-key.json"
fi

if [ -f "$KEY_FILE" ]; then
    echo "  ${GREEN}✓ Key file found: $KEY_FILE${NC}"

    # Validate JSON structure
    if command -v python3 &> /dev/null; then
        VALIDATION=$(python3 -c "
import json, sys
try:
    with open('$KEY_FILE') as f:
        data = json.load(f)
    required = ['type', 'project_id', 'private_key', 'client_email', 'client_id']
    missing = [k for k in required if k not in data]
    if missing:
        print('MISSING: ' + ', '.join(missing))
        sys.exit(1)
    if data['type'] != 'service_account':
        print('NOT_SERVICE_ACCOUNT')
        sys.exit(1)
    print('VALID')
    print(data['client_email'])
    print(data['client_id'])
    print(data['project_id'])
except json.JSONDecodeError:
    print('INVALID_JSON')
    sys.exit(1)
" 2>/dev/null)

        if echo "$VALIDATION" | head -1 | grep -q "VALID"; then
            KEY_EMAIL=$(echo "$VALIDATION" | sed -n '2p')
            KEY_CLIENT_ID=$(echo "$VALIDATION" | sed -n '3p')
            KEY_PROJECT=$(echo "$VALIDATION" | sed -n '4p')
            echo "  ${GREEN}✓ Valid service account JSON${NC}"
            echo "  ${GREEN}✓ Client Email: $KEY_EMAIL${NC}"
            echo "  ${GREEN}✓ Client ID: $KEY_CLIENT_ID${NC}"
            echo "  ${GREEN}✓ Project ID: $KEY_PROJECT${NC}"
        else
            echo "  ${RED}❌ Key file issue: $VALIDATION${NC}"
            ALL_GOOD=false
        fi
    else
        echo "  ${YELLOW}⚠️  python3 not available to validate JSON${NC}"
    fi
else
    echo "  ${RED}❌ Key file not found${NC}"
    echo "  Looked for: ~/gws-admin-key-$PROJECT_ID.json and ~/gws-admin-key.json"
    echo "  You may need to re-run setup.sh"
    ALL_GOOD=false
fi

# Check 5: Project ID match
echo ""
echo "Checking consistency..."
if [ -n "$KEY_PROJECT" ] && [ "$KEY_PROJECT" != "$PROJECT_ID" ]; then
    echo "  ${RED}❌ Key file project ($KEY_PROJECT) doesn't match project ($PROJECT_ID)${NC}"
    ALL_GOOD=false
else
    echo "  ${GREEN}✓ Project IDs match${NC}"
fi

# Get OAuth Client ID for Admin Console
echo ""
echo "📋 Admin Console Info:"
CLIENT_ID=$(gcloud iam service-accounts describe $SA_EMAIL --project=$PROJECT_ID --format='value(oauth2ClientId)' 2>/dev/null || echo "")
if [ -n "$CLIENT_ID" ]; then
    echo "  Client ID for DWD: $CLIENT_ID"
else
    echo "  ${YELLOW}⚠️  Could not retrieve OAuth Client ID${NC}"
fi

# Summary
echo ""
echo "============================"
if [ "$ALL_GOOD" = true ]; then
    echo "${GREEN}✅ All checks passed!${NC}"
    echo ""
    echo "Next: Make sure you've completed domain-wide delegation in Admin Console:"
    echo "  → https://admin.google.com/ac/owl/domainwidedelegation"
    echo "  → Client ID: $CLIENT_ID"
    echo "  → Scopes:"
    echo "    https://www.googleapis.com/auth/gmail.settings.basic"
    echo "    https://www.googleapis.com/auth/gmail.settings.sharing"
    echo "    https://www.googleapis.com/auth/admin.directory.user.readonly"
    echo "    https://www.googleapis.com/auth/admin.directory.user"
    echo "    https://www.googleapis.com/auth/admin.directory.group.readonly"
    echo "    https://www.googleapis.com/auth/calendar"
else
    echo "${RED}❌ Some checks failed. Review above.${NC}"
    exit 1
fi
