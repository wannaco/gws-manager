#!/bin/bash
# Cleanup script for GWS Manager GCP setup
# Use this to remove resources if needed

echo "🧹 GWS Manager Cleanup"
echo "===================="
echo ""
echo "${YELLOW}WARNING: This will delete resources${NC}"
echo ""

# Check if project name is provided
if [ -z "$PROJECT_NAME" ]; then
    read -p "Enter project name to cleanup: " PROJECT_NAME
fi

echo "Project: $PROJECT_NAME"
echo ""
echo "Choose cleanup level:"
echo "1. Delete service account key only"
echo "2. Delete service account"
echo "3. Delete entire project (IRREVERSIBLE)"
echo "4. Cancel"
read -p "Enter choice (1-4): " CHOICE

case $CHOICE in
    1)
        echo "Deleting service account keys..."
        gcloud iam service-accounts keys list \
            --iam-account=gws-admin-sa@$PROJECT_NAME.iam.gserviceaccount.com \
            --format="value(name)" | while read key; do
            gcloud iam service-accounts keys delete $key \
                --iam-account=gws-admin-sa@$PROJECT_NAME.iam.gserviceaccount.com --quiet
        done
        echo "✓ Keys deleted"
        ;;
    2)
        echo "Deleting service account..."
        gcloud iam service-accounts delete \
            gws-admin-sa@$PROJECT_NAME.iam.gserviceaccount.com --quiet
        echo "✓ Service account deleted"
        ;;
    3)
        echo "${RED}⚠️  WARNING: This will delete the entire project!${NC}"
        read -p "Type 'DELETE' to confirm: " CONFIRM
        if [ "$CONFIRM" = "DELETE" ]; then
            gcloud projects delete $PROJECT_NAME --quiet
            echo "✓ Project deleted"
        else
            echo "Cancelled"
        fi
        ;;
    *)
        echo "Cancelled"
        exit 0
        ;;
esac
