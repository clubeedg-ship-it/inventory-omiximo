#!/usr/bin/env python3
"""
=============================================================================
Omiximo Inventory OS - Tenant Seeding Script
Creates tenant groups, users, and root stock locations
=============================================================================
"""

import os
import sys
import json
import requests
from time import sleep

# Configuration
API_BASE = os.getenv('INVENTREE_API_BASE', 'http://localhost:9000/api')
ADMIN_USER = os.getenv('INVENTREE_ADMIN_USER', 'admin')
ADMIN_PASSWORD = os.getenv('INVENTREE_ADMIN_PASSWORD', 'admin123')

# Default tenants to create
DEFAULT_TENANTS = [
    {
        "name": "demo",
        "display_name": "Demo Tenant",
        "description": "Default demo tenant for testing",
        "users": [
            {"username": "demo_user", "password": "demo123", "email": "demo@inventory.local"}
        ]
    }
]

class TenantSeeder:
    def __init__(self):
        self.session = requests.Session()
        self.token = None
        
    def authenticate(self):
        """Get API token using admin credentials."""
        print(f"🔐 Authenticating as {ADMIN_USER}...")
        
        # Try token auth first
        try:
            resp = self.session.post(
                f"{API_BASE}/user/token/",
                json={"username": ADMIN_USER, "password": ADMIN_PASSWORD},
                headers={"Content-Type": "application/json"}
            )
            if resp.status_code == 200:
                self.token = resp.json().get('token')
                self.session.headers['Authorization'] = f"Token {self.token}"
                print("  ✓ Authenticated via token")
                return True
        except Exception as e:
            print(f"  ⚠ Token auth failed: {e}")
        
        # Fallback to basic auth
        self.session.auth = (ADMIN_USER, ADMIN_PASSWORD)
        try:
            resp = self.session.get(f"{API_BASE}/user/me/")
            if resp.status_code == 200:
                print("  ✓ Authenticated via basic auth")
                return True
        except Exception as e:
            print(f"  ✗ Basic auth failed: {e}")
        
        return False
    
    def get_or_create_group(self, name):
        """Get or create a group for the tenant."""
        # Check if group exists
        resp = self.session.get(f"{API_BASE}/user/group/", params={"name": name})
        if resp.status_code == 200:
            groups = resp.json()
            if isinstance(groups, list) and len(groups) > 0:
                for g in groups:
                    if g.get('name') == name:
                        print(f"  ℹ Group '{name}' already exists (ID: {g['pk']})")
                        return g['pk']
        
        # Create group
        resp = self.session.post(
            f"{API_BASE}/user/group/",
            json={"name": name},
            headers={"Content-Type": "application/json"}
        )
        if resp.status_code in [200, 201]:
            group_id = resp.json().get('pk')
            print(f"  ✓ Created group '{name}' (ID: {group_id})")
            return group_id
        else:
            print(f"  ✗ Failed to create group '{name}': {resp.status_code} {resp.text}")
            return None
    
    def get_or_create_location(self, name, description="", parent=None):
        """Get or create a stock location."""
        params = {"name": name}
        if parent:
            params["parent"] = parent
        
        resp = self.session.get(f"{API_BASE}/stock/location/", params=params)
        if resp.status_code == 200:
            locations = resp.json()
            if isinstance(locations, list) and len(locations) > 0:
                for loc in locations:
                    if loc.get('name') == name:
                        print(f"  ℹ Location '{name}' already exists (ID: {loc['pk']})")
                        return loc['pk']
        
        # Create location
        data = {"name": name, "description": description}
        if parent:
            data["parent"] = parent
            
        resp = self.session.post(
            f"{API_BASE}/stock/location/",
            json=data,
            headers={"Content-Type": "application/json"}
        )
        if resp.status_code in [200, 201]:
            loc_id = resp.json().get('pk')
            print(f"  ✓ Created location '{name}' (ID: {loc_id})")
            return loc_id
        else:
            print(f"  ✗ Failed to create location '{name}': {resp.status_code} {resp.text}")
            return None
    
    def create_user(self, username, password, email, groups=None):
        """Create a user and assign to groups."""
        # Check if user exists
        resp = self.session.get(f"{API_BASE}/user/", params={"username": username})
        if resp.status_code == 200:
            users = resp.json()
            if isinstance(users, list):
                for u in users:
                    if u.get('username') == username:
                        print(f"  ℹ User '{username}' already exists (ID: {u['pk']})")
                        return u['pk']
        
        # InvenTree may not allow user creation via API
        # We'll use Django management command instead
        print(f"  ⚠ User creation via API not supported. Use Django admin or management commands.")
        return None
    
    def seed_tenant(self, tenant):
        """Seed a single tenant with group, location, and users."""
        name = tenant['name']
        display_name = tenant.get('display_name', name.title())
        description = tenant.get('description', '')
        
        print(f"\n📦 Seeding tenant: {display_name}")
        
        # Create group
        group_name = f"tenant_{name}"
        group_id = self.get_or_create_group(group_name)
        
        # Create root location for tenant
        location_name = f"{display_name} Warehouse"
        location_id = self.get_or_create_location(location_name, description)
        
        # Create sub-locations (standard grid)
        if location_id:
            zones = ['A', 'B']
            columns = 4
            for zone in zones:
                for col in range(1, columns + 1):
                    subloc_name = f"{zone}-{col}"
                    self.get_or_create_location(subloc_name, parent=location_id)
        
        # Note about users
        if tenant.get('users'):
            print(f"  ⚠ To create tenant users, use InvenTree admin panel or run:")
            for user in tenant['users']:
                print(f"     docker exec -it inventree-server python manage.py createsuperuser --username {user['username']} --email {user['email']}")
        
        return True
    
    def run(self, tenants=None):
        """Run the seeding process."""
        print("=" * 60)
        print("OMIXIMO INVENTORY OS - TENANT SEEDER")
        print("=" * 60)
        
        # Wait for API
        print("\n⏳ Waiting for InvenTree API...")
        for i in range(12):  # 60 seconds max
            try:
                resp = self.session.get(f"{API_BASE}/", timeout=5)
                if resp.status_code == 200:
                    print("  ✓ API is ready")
                    break
            except:
                pass
            sleep(5)
        else:
            print("  ✗ API not available after 60 seconds")
            return False
        
        # Authenticate
        if not self.authenticate():
            print("\n❌ Authentication failed. Check credentials.")
            return False
        
        # Seed tenants
        tenants = tenants or DEFAULT_TENANTS
        for tenant in tenants:
            self.seed_tenant(tenant)
        
        print("\n" + "=" * 60)
        print("✅ TENANT SEEDING COMPLETE")
        print("=" * 60)
        return True


if __name__ == "__main__":
    # Check for custom tenant config
    config_file = os.getenv('TENANT_CONFIG', 'tenants.json')
    tenants = None
    
    if os.path.exists(config_file):
        print(f"Loading tenant config from {config_file}")
        with open(config_file) as f:
            tenants = json.load(f)
    
    seeder = TenantSeeder()
    success = seeder.run(tenants)
    sys.exit(0 if success else 1)
