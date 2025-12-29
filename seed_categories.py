#!/usr/bin/env python3
"""
============================================================================
SEED CATEGORIES SCRIPT
Lean Inventory System - Part Categories Generator
============================================================================

This script creates the default part categories for a computer assembly
business:
- GPU (Graphics Processing Units)
- CPU (Central Processing Units)
- PSU (Power Supply Units)
- Motherboard
- SSD (Solid State Drives)
- RAM (Random Access Memory)
============================================================================
"""

import os
import sys
import time
import requests
from requests.auth import HTTPBasicAuth

# Configuration
API_BASE_URL = os.getenv("INVENTREE_API_URL", "http://localhost:8000/api")
API_USERNAME = os.getenv("INVENTREE_ADMIN_USER", "admin")
API_PASSWORD = os.getenv("INVENTREE_ADMIN_PASSWORD", "admin123")

# Default Categories for Computer Assembly
DEFAULT_CATEGORIES = [
    {"name": "GPU", "description": "Graphics Processing Units - NVIDIA, AMD, Intel Arc"},
    {"name": "CPU", "description": "Central Processing Units - Intel, AMD"},
    {"name": "PSU", "description": "Power Supply Units - Modular, Semi-Modular, Non-Modular"},
    {"name": "Motherboard", "description": "Motherboards - ATX, Micro-ATX, Mini-ITX"},
    {"name": "SSD", "description": "Solid State Drives - NVMe, SATA, M.2"},
    {"name": "RAM", "description": "Random Access Memory - DDR4, DDR5"},
]


class CategorySeeder:
    """Seeds InvenTree with part categories."""
    
    def __init__(self, base_url: str, username: str, password: str):
        self.base_url = base_url.rstrip("/")
        self.auth = HTTPBasicAuth(username, password)
        self.session = requests.Session()
        self.session.auth = self.auth
        self.session.headers.update({
            "Content-Type": "application/json",
            "Accept": "application/json"
        })
    
    def wait_for_api(self, max_retries: int = 30, delay: int = 5) -> bool:
        """Wait for InvenTree API to become available."""
        print("⏳ Waiting for InvenTree API to be ready...")
        
        for attempt in range(max_retries):
            try:
                response = self.session.get(f"{self.base_url}/", timeout=5)
                if response.status_code in [200, 401, 403]:
                    print(f"   ✓ API is ready (attempt {attempt + 1})")
                    return True
            except requests.exceptions.RequestException:
                pass
            
            print(f"   Attempt {attempt + 1}/{max_retries} - Retrying in {delay}s...")
            time.sleep(delay)
        
        print("   ✗ API failed to respond")
        return False
    
    def get_api_token(self) -> str:
        """Get API token for authenticated requests."""
        response = self.session.get(f"{self.base_url}/user/token/")
        
        if response.status_code == 200:
            token = response.json().get("token")
            if token:
                self.session.headers["Authorization"] = f"Token {token}"
                print(f"   ✓ Authenticated with API token")
                return token
        
        print(f"   ⚠ Using basic auth (token not available)")
        return None
    
    def create_category(self, name: str, description: str) -> dict:
        """Create a part category in InvenTree."""
        payload = {
            "name": name,
            "description": description,
        }
        
        response = self.session.post(
            f"{self.base_url}/part/category/",
            json=payload
        )
        
        if response.status_code == 201:
            category = response.json()
            print(f"   ✓ Created category: {name}")
            return category
        elif response.status_code == 400:
            error = response.json()
            if "already exists" in str(error).lower() or "unique" in str(error).lower():
                print(f"   ⚠ Category '{name}' already exists, skipping...")
                return self._get_existing_category(name)
        
        print(f"   ✗ Failed to create '{name}': {response.status_code} - {response.text}")
        return None
    
    def _get_existing_category(self, name: str) -> dict:
        """Get an existing category by name."""
        response = self.session.get(
            f"{self.base_url}/part/category/",
            params={"name": name}
        )
        
        if response.status_code == 200:
            categories = response.json()
            if categories:
                cat = categories[0] if isinstance(categories, list) else categories.get("results", [{}])[0]
                return cat
        return None
    
    def seed_categories(self):
        """Create all default categories."""
        print("\n" + "=" * 70)
        print("SEEDING PART CATEGORIES")
        print("=" * 70)
        
        created = 0
        for cat in DEFAULT_CATEGORIES:
            result = self.create_category(cat["name"], cat["description"])
            if result:
                created += 1
        
        print("\n" + "=" * 70)
        print("✅ CATEGORY SEEDING COMPLETE")
        print("=" * 70)
        print(f"\nSummary: {created}/{len(DEFAULT_CATEGORIES)} categories created/verified")
        
        return True


def main():
    """Main entry point."""
    print("╔════════════════════════════════════════════════════════════════════╗")
    print("║         LEAN INVENTORY SYSTEM - CATEGORY SEEDER                    ║")
    print("╚════════════════════════════════════════════════════════════════════╝")
    print(f"\nAPI URL: {API_BASE_URL}")
    print(f"Username: {API_USERNAME}")
    
    seeder = CategorySeeder(API_BASE_URL, API_USERNAME, API_PASSWORD)
    
    # Wait for API
    if not seeder.wait_for_api():
        print("\n❌ Error: InvenTree API is not available")
        print("   Make sure the Docker containers are running:")
        print("   docker compose up -d")
        sys.exit(1)
    
    # Authenticate
    seeder.get_api_token()
    
    # Seed categories
    if seeder.seed_categories():
        print("\n🎉 Success! Categories have been created.")
        print("\nCategories available:")
        for cat in DEFAULT_CATEGORIES:
            print(f"  • {cat['name']}: {cat['description']}")
    else:
        print("\n❌ Seeding failed. Check the errors above.")
        sys.exit(1)


if __name__ == "__main__":
    main()
