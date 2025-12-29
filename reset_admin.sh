#!/bin/bash
# =============================================================================
# Reset Admin Password
# =============================================================================

set -e

echo "🔐 Resetting admin password..."

# Check if container is running
if ! docker ps --filter "name=inventree-server" --format "{{.Names}}" | grep -q inventree-server; then
    echo "❌ inventree-server container is not running."
    echo "   Run 'docker compose up -d' first."
    exit 1
fi

# Prompt for new password
echo -n "Enter new admin password: "
read -s NEW_PASSWORD
echo ""
echo -n "Confirm password: "
read -s CONFIRM_PASSWORD
echo ""

if [ "$NEW_PASSWORD" != "$CONFIRM_PASSWORD" ]; then
    echo "❌ Passwords do not match."
    exit 1
fi

# Reset password
# Reset password
docker exec -it inventree-server /bin/bash -c "cd /home/inventree/src/backend/InvenTree && python manage.py shell -c \"
from django.contrib.auth import get_user_model
User = get_user_model()
try:
    admin = User.objects.get(username='admin')
    admin.set_password('$NEW_PASSWORD')
    admin.save()
    print('✅ Admin password updated successfully.')
except User.DoesNotExist:
    print('❌ Admin user not found. Creating...')
    User.objects.create_superuser('admin', 'admin@inventory.local', '$NEW_PASSWORD')
    print('✅ Admin user created.')
\""

echo ""
echo "You can now login with:"
echo "  Username: admin"
echo "  Password: (the password you just set)"
