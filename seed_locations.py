#!/usr/bin/env python3
"""
============================================================================
SEED LOCATIONS SCRIPT
Lean Inventory System - Warehouse Structure Generator
============================================================================

This script uses the InvenTree Python API to automatically generate
the physical warehouse structure:

Zone A: Columns A-1 to A-4, Levels 1-7 (with A/B bin split)
Zone B: Columns B-1 to B-3, Levels 1-7 (with A/B bin split)
Zone B: Column B-4, Levels 1-7 (Power Supplies - NO A/B split)
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

# Warehouse Structure
ZONES = ["A", "B"]
COLUMNS_PER_ZONE = 4  # 1-4
LEVELS = 7  # 1 (Bottom) to 7 (Top)
POWER_SUPPLY_COLUMN = "B-4"  # Exception: no A/B split


class InvenTreeSeeder:
    """Seeds InvenTree with warehouse location structure."""
    
    def __init__(self, base_url: str, username: str, password: str):
        self.base_url = base_url.rstrip("/")
        self.auth = HTTPBasicAuth(username, password)
        self.session = requests.Session()
        self.session.auth = self.auth
        self.session.headers.update({
            "Content-Type": "application/json",
            "Accept": "application/json"
        })
        self.location_cache = {}
    
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
        # First try basic auth to get user-token
        response = self.session.get(f"{self.base_url}/user/token/")
        
        if response.status_code == 200:
            token = response.json().get("token")
            if token:
                self.session.headers["Authorization"] = f"Token {token}"
                print(f"   ✓ Authenticated with API token")
                return token
        
        # Fall back to basic auth
        print(f"   ⚠ Using basic auth (token not available)")
        return None
    
    def create_location(self, name: str, description: str, parent_id: int = None) -> dict:
        """Create a stock location in InvenTree."""
        payload = {
            "name": name,
            "description": description,
        }
        
        if parent_id:
            payload["parent"] = parent_id
        
        response = self.session.post(
            f"{self.base_url}/stock/location/",
            json=payload
        )
        
        if response.status_code == 201:
            location = response.json()
            self.location_cache[name] = location["pk"]
            return location
        elif response.status_code == 400:
            # Location might already exist
            error = response.json()
            if "already exists" in str(error).lower():
                print(f"      ⚠ Location '{name}' already exists, skipping...")
                return self._get_existing_location(name)
        
        print(f"      ✗ Failed to create '{name}': {response.status_code} - {response.text}")
        return None
    
    def _get_existing_location(self, name: str) -> dict:
        """Get an existing location by name."""
        response = self.session.get(
            f"{self.base_url}/stock/location/",
            params={"name": name}
        )
        
        if response.status_code == 200:
            locations = response.json()
            if locations:
                loc = locations[0] if isinstance(locations, list) else locations.get("results", [{}])[0]
                self.location_cache[name] = loc.get("pk")
                return loc
        return None
    
    def seed_warehouse(self):
        """Create the complete warehouse structure."""
        print("\n" + "=" * 70)
        print("SEEDING WAREHOUSE STRUCTURE")
        print("=" * 70)
        
        # Create root location: Warehouse
        print("\n📦 Creating Root Location: Warehouse")
        warehouse = self.create_location(
            name="Warehouse",
            description="Main warehouse - Lean Inventory System"
        )
        
        if not warehouse:
            print("   ✗ Failed to create warehouse root")
            return False
        
        warehouse_id = warehouse.get("pk")
        print(f"   ✓ Warehouse created (ID: {warehouse_id})")
        
        # Create Zones
        for zone in ZONES:
            print(f"\n🏢 Creating Zone {zone}")
            zone_location = self.create_location(
                name=f"Zone-{zone}",
                description=f"Zone {zone} - {'Standard Components' if zone == 'A' else 'Standard + Power Supplies'}",
                parent_id=warehouse_id
            )
            
            if not zone_location:
                continue
            
            zone_id = zone_location.get("pk")
            print(f"   ✓ Zone-{zone} created (ID: {zone_id})")
            
            # Create Columns within Zone
            for col in range(1, COLUMNS_PER_ZONE + 1):
                column_name = f"{zone}-{col}"
                print(f"\n   📚 Creating Column {column_name}")
                
                is_power_supply = column_name == POWER_SUPPLY_COLUMN
                col_desc = "Power Supplies (Solid)" if is_power_supply else f"Column {col} in Zone {zone}"
                
                column_location = self.create_location(
                    name=column_name,
                    description=col_desc,
                    parent_id=zone_id
                )
                
                if not column_location:
                    continue
                
                column_id = column_location.get("pk")
                
                # Create Shelves (Levels 1-7)
                for level in range(1, LEVELS + 1):
                    shelf_name = f"{column_name}-{level}"
                    
                    shelf_location = self.create_location(
                        name=shelf_name,
                        description=f"Level {level} (1=Bottom, 7=Top)",
                        parent_id=column_id
                    )
                    
                    if not shelf_location:
                        continue
                    
                    shelf_id = shelf_location.get("pk")
                    
                    # Create Bins (A/B split) - EXCEPT for Power Supply column
                    if not is_power_supply:
                        # Bin A (In - New Stock)
                        self.create_location(
                            name=f"{shelf_name}-A",
                            description="IN - New Stock (FIFO: Use Last)",
                            parent_id=shelf_id
                        )
                        
                        # Bin B (Out - Old Stock)
                        self.create_location(
                            name=f"{shelf_name}-B",
                            description="OUT - Old Stock (FIFO: Use First)",
                            parent_id=shelf_id
                        )
                        
                        print(f"      ✓ {shelf_name} + Bins A/B")
                    else:
                        print(f"      ✓ {shelf_name} (Solid - No Split)")
        
        print("\n" + "=" * 70)
        print("✅ WAREHOUSE SEEDING COMPLETE")
        print("=" * 70)
        
        # Summary
        total_shelves = LEVELS * COLUMNS_PER_ZONE * len(ZONES)
        split_columns = (COLUMNS_PER_ZONE * len(ZONES)) - 1  # All except B-4
        total_bins = (split_columns * LEVELS * 2) + (LEVELS)  # A/B bins + solid B-4
        
        print(f"\nSummary:")
        print(f"  • Zones: {len(ZONES)}")
        print(f"  • Columns: {COLUMNS_PER_ZONE * len(ZONES)}")
        print(f"  • Shelves: {total_shelves}")
        print(f"  • Total Bins: {total_bins}")
        print(f"    - Split (A/B): {split_columns * LEVELS} shelves × 2 = {split_columns * LEVELS * 2} bins")
        print(f"    - Solid (B-4): {LEVELS} bins")
        
        return True


def main():
    """Main entry point."""
    print("╔════════════════════════════════════════════════════════════════════╗")
    print("║         LEAN INVENTORY SYSTEM - WAREHOUSE SEEDER                   ║")
    print("╚════════════════════════════════════════════════════════════════════╝")
    print(f"\nAPI URL: {API_BASE_URL}")
    print(f"Username: {API_USERNAME}")
    
    seeder = InvenTreeSeeder(API_BASE_URL, API_USERNAME, API_PASSWORD)
    
    # Wait for API
    if not seeder.wait_for_api():
        print("\n❌ Error: InvenTree API is not available")
        print("   Make sure the Docker containers are running:")
        print("   docker compose up -d")
        sys.exit(1)
    
    # Authenticate
    seeder.get_api_token()
    
    # Seed warehouse
    if seeder.seed_warehouse():
        print("\n🎉 Success! Warehouse structure has been created.")
        print("\nNext Steps:")
        print("  1. Access InvenTree at http://localhost:8000")
        print("  2. Login with admin/admin123")
        print("  3. Verify locations under Stock > Locations")
        print("  4. Run Phase 2: Frontend Dashboard")
    else:
        print("\n❌ Seeding failed. Check the errors above.")
        sys.exit(1)


if __name__ == "__main__":
    main()
