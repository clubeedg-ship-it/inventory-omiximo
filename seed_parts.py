#!/usr/bin/env python3
"""
============================================================================
SEED PARTS SCRIPT
Omiximo Inventory OS - Example Parts Generator
============================================================================

This script populates the parts catalog with realistic computer components
for testing and demonstration purposes.

Usage:
    python seed_parts.py

Environment Variables:
    INVENTREE_API_URL      - API base URL (default: http://localhost:8000/api)
    INVENTREE_ADMIN_USER   - Admin username (default: admin)
    INVENTREE_ADMIN_PASSWORD - Admin password (default: admin123)
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

# =============================================================================
# EXAMPLE PARTS DATA
# =============================================================================
# Organized by category name -> list of parts
EXAMPLE_PARTS = {
    "GPU": [
        {"name": "NVIDIA GeForce RTX 4090", "description": "24GB GDDR6X, 450W TDP", "min_stock": 2},
        {"name": "NVIDIA GeForce RTX 4080 Super", "description": "16GB GDDR6X, 320W TDP", "min_stock": 3},
        {"name": "NVIDIA GeForce RTX 4070 Ti", "description": "12GB GDDR6X, 285W TDP", "min_stock": 5},
        {"name": "AMD Radeon RX 7900 XTX", "description": "24GB GDDR6, 355W TDP", "min_stock": 2},
        {"name": "AMD Radeon RX 7800 XT", "description": "16GB GDDR6, 263W TDP", "min_stock": 4},
    ],
    "CPU": [
        {"name": "Intel Core i9-14900K", "description": "24 Cores, 6.0GHz Boost, LGA1700", "min_stock": 3},
        {"name": "Intel Core i7-14700K", "description": "20 Cores, 5.6GHz Boost, LGA1700", "min_stock": 5},
        {"name": "Intel Core i5-14600K", "description": "14 Cores, 5.3GHz Boost, LGA1700", "min_stock": 8},
        {"name": "AMD Ryzen 9 7950X", "description": "16 Cores, 5.7GHz Boost, AM5", "min_stock": 3},
        {"name": "AMD Ryzen 7 7800X3D", "description": "8 Cores, 5.0GHz Boost, AM5, 3D V-Cache", "min_stock": 5},
        {"name": "AMD Ryzen 5 7600X", "description": "6 Cores, 5.3GHz Boost, AM5", "min_stock": 10},
    ],
    "RAM": [
        {"name": "Corsair Vengeance DDR5 32GB (2x16GB)", "description": "6000MHz CL36, Black", "min_stock": 10},
        {"name": "G.Skill Trident Z5 RGB DDR5 64GB (2x32GB)", "description": "6400MHz CL32", "min_stock": 5},
        {"name": "Kingston Fury Beast DDR5 16GB (2x8GB)", "description": "5200MHz CL40", "min_stock": 15},
        {"name": "Corsair Dominator Platinum DDR5 32GB (2x16GB)", "description": "7200MHz CL34, RGB", "min_stock": 3},
    ],
    "SSD": [
        {"name": "Samsung 990 Pro 2TB", "description": "NVMe Gen4, 7450MB/s Read", "min_stock": 10},
        {"name": "Samsung 990 Pro 1TB", "description": "NVMe Gen4, 7450MB/s Read", "min_stock": 15},
        {"name": "WD Black SN850X 2TB", "description": "NVMe Gen4, 7300MB/s Read", "min_stock": 8},
        {"name": "Crucial T700 2TB", "description": "NVMe Gen5, 12400MB/s Read", "min_stock": 3},
        {"name": "SK Hynix Platinum P41 1TB", "description": "NVMe Gen4, 7000MB/s Read", "min_stock": 12},
    ],
    "PSU": [
        {"name": "Corsair RM1000x 1000W", "description": "80+ Gold, Fully Modular, ATX 3.0", "min_stock": 5},
        {"name": "Corsair RM850x 850W", "description": "80+ Gold, Fully Modular", "min_stock": 10},
        {"name": "Seasonic Prime TX-1000 1000W", "description": "80+ Titanium, Fully Modular", "min_stock": 3},
        {"name": "be quiet! Dark Power Pro 12 1200W", "description": "80+ Titanium, Fully Modular", "min_stock": 2},
        {"name": "EVGA SuperNOVA 750 G7 750W", "description": "80+ Gold, Fully Modular", "min_stock": 8},
    ],
    "Motherboard": [
        {"name": "ASUS ROG Maximus Z790 Hero", "description": "Intel LGA1700, DDR5, ATX", "min_stock": 3},
        {"name": "MSI MPG Z790 Carbon WiFi", "description": "Intel LGA1700, DDR5, ATX", "min_stock": 5},
        {"name": "Gigabyte Z790 AORUS Master", "description": "Intel LGA1700, DDR5, ATX", "min_stock": 4},
        {"name": "ASUS ROG Crosshair X670E Hero", "description": "AMD AM5, DDR5, ATX", "min_stock": 3},
        {"name": "MSI MEG X670E ACE", "description": "AMD AM5, DDR5, E-ATX", "min_stock": 2},
        {"name": "ASRock B650E Steel Legend", "description": "AMD AM5, DDR5, ATX, Budget", "min_stock": 8},
    ],
}


class PartsSeeder:
    """Seeds InvenTree with example computer parts."""
    
    def __init__(self, base_url: str, username: str, password: str):
        self.base_url = base_url.rstrip("/")
        self.auth = HTTPBasicAuth(username, password)
        self.session = requests.Session()
        self.session.auth = self.auth
        self.session.headers.update({
            "Content-Type": "application/json",
            "Accept": "application/json"
        })
        self.categories = {}  # name -> id cache
    
    def wait_for_api(self, max_retries: int = 15, delay: int = 3) -> bool:
        """Wait for InvenTree API to become available."""
        print("⏳ Connecting to InvenTree API...")
        
        for attempt in range(max_retries):
            try:
                response = self.session.get(f"{self.base_url}/", timeout=5)
                if response.status_code in [200, 401, 403]:
                    print(f"   ✓ API is ready")
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
                print(f"   ✓ Authenticated")
                return token
        
        print(f"   ⚠ Using basic auth fallback")
        return None
    
    def load_categories(self):
        """Load existing categories into cache."""
        try:
            response = self.session.get(f"{self.base_url}/part/category/?limit=100")
            if response.status_code == 200:
                data = response.json()
                categories = data.get("results", data) if isinstance(data, dict) else data
                for cat in categories:
                    self.categories[cat["name"]] = cat["pk"]
                print(f"   ✓ Loaded {len(self.categories)} categories")
        except Exception as e:
            print(f"   ⚠ Failed to load categories: {e}")
    
    def create_category(self, name: str, description: str = "") -> int:
        """Create a category if it doesn't exist. Returns category ID."""
        if name in self.categories:
            return self.categories[name]
        
        payload = {"name": name, "description": description}
        response = self.session.post(f"{self.base_url}/part/category/", json=payload)
        
        if response.status_code == 201:
            cat = response.json()
            self.categories[name] = cat["pk"]
            print(f"   + Created category: {name}")
            return cat["pk"]
        elif response.status_code == 400:
            # Likely already exists, try to find it
            self.load_categories()
            return self.categories.get(name)
        
        print(f"   ✗ Failed to create category '{name}': {response.status_code}")
        return None
    
    def create_part(self, name: str, description: str, category_id: int, min_stock: int = 5) -> bool:
        """Create a single part."""
        payload = {
            "name": name,
            "description": description,
            "category": category_id,
            "active": True,
            "component": True,
            "purchaseable": True,
            "minimum_stock": min_stock
        }
        
        response = self.session.post(f"{self.base_url}/part/", json=payload)
        
        if response.status_code == 201:
            return True
        elif response.status_code == 400:
            error = response.json()
            if "already exists" in str(error).lower() or "unique" in str(error).lower():
                return True  # Already exists, that's fine
        
        return False
    
    def seed(self):
        """Run the seeding process."""
        print("\n" + "=" * 60)
        print("🔧 SEEDING EXAMPLE PARTS")
        print("=" * 60)
        
        total_created = 0
        total_parts = sum(len(parts) for parts in EXAMPLE_PARTS.values())
        
        for category_name, parts in EXAMPLE_PARTS.items():
            print(f"\n📁 {category_name}")
            
            # Ensure category exists
            cat_id = self.create_category(
                category_name, 
                f"Computer {category_name} components"
            )
            
            if not cat_id:
                print(f"   ⚠ Skipping category (no ID)")
                continue
            
            # Create parts
            for part in parts:
                success = self.create_part(
                    name=part["name"],
                    description=part["description"],
                    category_id=cat_id,
                    min_stock=part.get("min_stock", 5)
                )
                
                if success:
                    print(f"   ✓ {part['name']}")
                    total_created += 1
                else:
                    print(f"   ✗ {part['name']}")
        
        print("\n" + "=" * 60)
        print(f"✅ SEEDING COMPLETE: {total_created}/{total_parts} parts")
        print("=" * 60)


def main():
    """Main entry point."""
    print("╔════════════════════════════════════════════════════════════╗")
    print("║      OMIXIMO INVENTORY OS - PARTS SEEDER                   ║")
    print("╚════════════════════════════════════════════════════════════╝")
    print(f"\nAPI URL: {API_BASE_URL}")
    
    seeder = PartsSeeder(API_BASE_URL, API_USERNAME, API_PASSWORD)
    
    # Wait for API
    if not seeder.wait_for_api():
        print("\n❌ Error: InvenTree API is not available")
        print("   Make sure the Docker containers are running:")
        print("   docker compose up -d")
        sys.exit(1)
    
    # Authenticate
    seeder.get_api_token()
    
    # Load existing categories
    seeder.load_categories()
    
    # Seed parts
    seeder.seed()
    
    print("\n🎉 Done! Refresh your browser to see the new parts.")


if __name__ == "__main__":
    main()
