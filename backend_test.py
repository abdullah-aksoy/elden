#!/usr/bin/env python3
"""
Comprehensive Backend API Testing for Secondhand Marketplace Application
Tests all endpoints systematically with proper authentication flow
"""

import requests
import json
import base64
from datetime import datetime
import time

# Configuration
BASE_URL = "https://resale-hub-101.preview.emergentagent.com/api"

# Test credentials
TEST_USERS = [
    {
        "email": "test@test.com",
        "password": "test123",
        "name": "Test Kullanıcı",
        "phone": "+90 555 123 4567"
    },
    {
        "email": "test2@test.com", 
        "password": "test123",
        "name": "İkinci Kullanıcı",
        "phone": "+90 555 987 6543"
    }
]

# Sample base64 image (small 1x1 pixel PNG)
SAMPLE_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

class BackendTester:
    def __init__(self):
        self.session = requests.Session()
        self.tokens = {}
        self.users = {}
        self.listings = {}
        self.test_results = []
        
    def log_result(self, test_name, success, message, details=None):
        """Log test result"""
        result = {
            "test": test_name,
            "success": success,
            "message": message,
            "timestamp": datetime.now().isoformat(),
            "details": details
        }
        self.test_results.append(result)
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status}: {test_name} - {message}")
        if details and not success:
            print(f"   Details: {details}")
    
    def test_auth_register(self):
        """Test user registration"""
        print("\n=== Testing User Registration ===")
        
        for i, user in enumerate(TEST_USERS):
            try:
                response = self.session.post(
                    f"{BASE_URL}/auth/register",
                    json=user,
                    headers={"Content-Type": "application/json"}
                )
                
                if response.status_code == 200 or response.status_code == 201:
                    data = response.json()
                    self.users[user["email"]] = data.get("user", {})
                    if "token" in data:
                        self.tokens[user["email"]] = data["token"]
                    self.log_result(
                        f"Register User {i+1}",
                        True,
                        f"User {user['name']} registered successfully"
                    )
                elif response.status_code == 400 and "already" in response.text.lower():
                    self.log_result(
                        f"Register User {i+1}",
                        True,
                        f"User {user['name']} already exists (expected)"
                    )
                else:
                    self.log_result(
                        f"Register User {i+1}",
                        False,
                        f"Registration failed with status {response.status_code}",
                        response.text
                    )
                    
            except Exception as e:
                self.log_result(
                    f"Register User {i+1}",
                    False,
                    f"Registration error: {str(e)}"
                )
    
    def test_auth_login(self):
        """Test user login"""
        print("\n=== Testing User Login ===")
        
        for i, user in enumerate(TEST_USERS):
            try:
                response = self.session.post(
                    f"{BASE_URL}/auth/login",
                    json={
                        "email": user["email"],
                        "password": user["password"]
                    },
                    headers={"Content-Type": "application/json"}
                )
                
                if response.status_code == 200:
                    data = response.json()
                    if "token" in data:
                        self.tokens[user["email"]] = data["token"]
                        self.users[user["email"]] = data.get("user", {})
                        self.log_result(
                            f"Login User {i+1}",
                            True,
                            f"User {user['name']} logged in successfully"
                        )
                    else:
                        self.log_result(
                            f"Login User {i+1}",
                            False,
                            "No token in response",
                            data
                        )
                else:
                    self.log_result(
                        f"Login User {i+1}",
                        False,
                        f"Login failed with status {response.status_code}",
                        response.text
                    )
                    
            except Exception as e:
                self.log_result(
                    f"Login User {i+1}",
                    False,
                    f"Login error: {str(e)}"
                )
    
    def test_auth_me(self):
        """Test get current user info"""
        print("\n=== Testing Get Current User ===")
        
        for i, user in enumerate(TEST_USERS):
            email = user["email"]
            if email not in self.tokens:
                self.log_result(
                    f"Get User Info {i+1}",
                    False,
                    "No token available for user"
                )
                continue
                
            try:
                response = self.session.get(
                    f"{BASE_URL}/auth/me",
                    headers={
                        "Authorization": f"Bearer {self.tokens[email]}",
                        "Content-Type": "application/json"
                    }
                )
                
                if response.status_code == 200:
                    data = response.json()
                    self.log_result(
                        f"Get User Info {i+1}",
                        True,
                        f"Retrieved user info for {user['name']}"
                    )
                else:
                    self.log_result(
                        f"Get User Info {i+1}",
                        False,
                        f"Failed to get user info with status {response.status_code}",
                        response.text
                    )
                    
            except Exception as e:
                self.log_result(
                    f"Get User Info {i+1}",
                    False,
                    f"Get user info error: {str(e)}"
                )
    
    def test_categories(self):
        """Test get categories"""
        print("\n=== Testing Categories ===")
        
        try:
            response = self.session.get(f"{BASE_URL}/categories")
            
            if response.status_code == 200:
                categories = response.json()
                if isinstance(categories, list) and len(categories) > 0:
                    self.log_result(
                        "Get Categories",
                        True,
                        f"Retrieved {len(categories)} categories"
                    )
                else:
                    self.log_result(
                        "Get Categories",
                        False,
                        "Categories response is not a valid list"
                    )
            else:
                self.log_result(
                    "Get Categories",
                    False,
                    f"Failed to get categories with status {response.status_code}",
                    response.text
                )
                
        except Exception as e:
            self.log_result(
                "Get Categories",
                False,
                f"Get categories error: {str(e)}"
            )
    
    def test_listings_create(self):
        """Test create listings"""
        print("\n=== Testing Create Listings ===")
        
        sample_listings = [
            {
                "title": "iPhone 13 Pro Max 256GB",
                "description": "Çok temiz kullanılmış iPhone 13 Pro Max. Kutusu ve aksesuarları mevcut. Hiç düşürülmemiş, ekran koruyucu ile kullanılmış.",
                "price": 25000.0,
                "category": "Elektronik",
                "condition": "İyi",
                "images": [SAMPLE_IMAGE, SAMPLE_IMAGE],
                "location": {"city": "İstanbul", "district": "Kadıköy"}
            },
            {
                "title": "MacBook Air M2 2022",
                "description": "2022 model MacBook Air M2 çip. 8GB RAM, 256GB SSD. Garantisi devam ediyor. Çanta hediye.",
                "price": 18000.0,
                "category": "Elektronik", 
                "condition": "Çok İyi",
                "images": [SAMPLE_IMAGE],
                "location": {"city": "Ankara", "district": "Çankaya"}
            },
            {
                "title": "Nike Air Max 270 Ayakkabı",
                "description": "42 numara Nike Air Max 270. Çok az kullanılmış, temiz durumda. Orijinal kutusu mevcut.",
                "price": 800.0,
                "category": "Moda & Aksesuar",
                "condition": "İyi",
                "images": [SAMPLE_IMAGE, SAMPLE_IMAGE, SAMPLE_IMAGE],
                "location": {"city": "İzmir", "district": "Konak"}
            }
        ]
        
        for i, listing_data in enumerate(sample_listings):
            user_email = TEST_USERS[i % len(TEST_USERS)]["email"]
            
            if user_email not in self.tokens:
                self.log_result(
                    f"Create Listing {i+1}",
                    False,
                    "No token available for user"
                )
                continue
                
            try:
                response = self.session.post(
                    f"{BASE_URL}/listings",
                    json=listing_data,
                    headers={
                        "Authorization": f"Bearer {self.tokens[user_email]}",
                        "Content-Type": "application/json"
                    }
                )
                
                if response.status_code == 200 or response.status_code == 201:
                    data = response.json()
                    listing_id = data.get("id")
                    if listing_id:
                        self.listings[listing_id] = {
                            "data": data,
                            "owner": user_email
                        }
                        self.log_result(
                            f"Create Listing {i+1}",
                            True,
                            f"Created listing: {listing_data['title']}"
                        )
                    else:
                        self.log_result(
                            f"Create Listing {i+1}",
                            False,
                            "No listing ID in response",
                            data
                        )
                else:
                    self.log_result(
                        f"Create Listing {i+1}",
                        False,
                        f"Failed to create listing with status {response.status_code}",
                        response.text
                    )
                    
            except Exception as e:
                self.log_result(
                    f"Create Listing {i+1}",
                    False,
                    f"Create listing error: {str(e)}"
                )
    
    def test_listings_get_all(self):
        """Test get all listings with filters"""
        print("\n=== Testing Get All Listings ===")
        
        # Test basic get all
        user_email = TEST_USERS[0]["email"]
        auth_headers = {}
        if user_email in self.tokens:
            auth_headers = {"Authorization": f"Bearer {self.tokens[user_email]}"}
            
        try:
            response = self.session.get(
                f"{BASE_URL}/listings",
                headers=auth_headers
            )
            
            if response.status_code == 200:
                listings = response.json()
                if isinstance(listings, list):
                    self.log_result(
                        "Get All Listings",
                        True,
                        f"Retrieved {len(listings)} listings"
                    )
                else:
                    self.log_result(
                        "Get All Listings",
                        False,
                        "Listings response is not a list"
                    )
            else:
                self.log_result(
                    "Get All Listings",
                    False,
                    f"Failed to get listings with status {response.status_code}",
                    response.text
                )
                
        except Exception as e:
            self.log_result(
                "Get All Listings",
                False,
                f"Get listings error: {str(e)}"
            )
        
        # Test with filters
        filters = [
            {"category": "Elektronik"},
            {"search": "iPhone"},
            {"min_price": "1000", "max_price": "30000"},
            {"condition": "İyi"}
        ]
        
        for i, filter_params in enumerate(filters):
            try:
                response = self.session.get(
                    f"{BASE_URL}/listings",
                    params=filter_params,
                    headers=auth_headers
                )
                
                if response.status_code == 200:
                    listings = response.json()
                    self.log_result(
                        f"Filter Test {i+1}",
                        True,
                        f"Filter {filter_params} returned {len(listings)} listings"
                    )
                else:
                    self.log_result(
                        f"Filter Test {i+1}",
                        False,
                        f"Filter failed with status {response.status_code}",
                        response.text
                    )
                    
            except Exception as e:
                self.log_result(
                    f"Filter Test {i+1}",
                    False,
                    f"Filter error: {str(e)}"
                )
    
    def test_listings_get_specific(self):
        """Test get specific listing"""
        print("\n=== Testing Get Specific Listing ===")
        
        if not self.listings:
            self.log_result(
                "Get Specific Listing",
                False,
                "No listings available to test"
            )
            return
            
        listing_id = list(self.listings.keys())[0]
        
        user_email = TEST_USERS[0]["email"]
        auth_headers = {}
        if user_email in self.tokens:
            auth_headers = {"Authorization": f"Bearer {self.tokens[user_email]}"}
        
        try:
            response = self.session.get(
                f"{BASE_URL}/listings/{listing_id}",
                headers=auth_headers
            )
            
            if response.status_code == 200:
                listing = response.json()
                self.log_result(
                    "Get Specific Listing",
                    True,
                    f"Retrieved listing: {listing.get('title', 'Unknown')}"
                )
            else:
                self.log_result(
                    "Get Specific Listing",
                    False,
                    f"Failed to get listing with status {response.status_code}",
                    response.text
                )
                
        except Exception as e:
            self.log_result(
                "Get Specific Listing",
                False,
                f"Get specific listing error: {str(e)}"
            )
    
    def test_listings_update(self):
        """Test update listing"""
        print("\n=== Testing Update Listing ===")
        
        if not self.listings:
            self.log_result(
                "Update Listing",
                False,
                "No listings available to test"
            )
            return
            
        listing_id = list(self.listings.keys())[0]
        owner_email = self.listings[listing_id]["owner"]
        
        if owner_email not in self.tokens:
            self.log_result(
                "Update Listing",
                False,
                "No token available for listing owner"
            )
            return
            
        update_data = {
            "title": "iPhone 13 Pro Max 256GB - FİYAT DÜŞTÜ!",
            "price": 23000.0
        }
        
        try:
            response = self.session.put(
                f"{BASE_URL}/listings/{listing_id}",
                json=update_data,
                headers={
                    "Authorization": f"Bearer {self.tokens[owner_email]}",
                    "Content-Type": "application/json"
                }
            )
            
            if response.status_code == 200:
                self.log_result(
                    "Update Listing",
                    True,
                    "Listing updated successfully"
                )
            else:
                self.log_result(
                    "Update Listing",
                    False,
                    f"Failed to update listing with status {response.status_code}",
                    response.text
                )
                
        except Exception as e:
            self.log_result(
                "Update Listing",
                False,
                f"Update listing error: {str(e)}"
            )
    
    def test_listings_my_listings(self):
        """Test get my listings"""
        print("\n=== Testing Get My Listings ===")
        
        for i, user in enumerate(TEST_USERS):
            email = user["email"]
            if email not in self.tokens:
                continue
                
            try:
                response = self.session.get(
                    f"{BASE_URL}/listings/my/listings",
                    headers={
                        "Authorization": f"Bearer {self.tokens[email]}",
                        "Content-Type": "application/json"
                    }
                )
                
                if response.status_code == 200:
                    listings = response.json()
                    self.log_result(
                        f"Get My Listings User {i+1}",
                        True,
                        f"Retrieved {len(listings)} listings for {user['name']}"
                    )
                else:
                    self.log_result(
                        f"Get My Listings User {i+1}",
                        False,
                        f"Failed to get my listings with status {response.status_code}",
                        response.text
                    )
                    
            except Exception as e:
                self.log_result(
                    f"Get My Listings User {i+1}",
                    False,
                    f"Get my listings error: {str(e)}"
                )
    
    def test_favorites(self):
        """Test favorite system"""
        print("\n=== Testing Favorite System ===")
        
        if not self.listings or len(TEST_USERS) < 2:
            self.log_result(
                "Favorite System",
                False,
                "Need at least 2 users and 1 listing to test favorites"
            )
            return
            
        listing_id = list(self.listings.keys())[0]
        user_email = TEST_USERS[1]["email"]  # Use second user
        
        if user_email not in self.tokens:
            self.log_result(
                "Favorite System",
                False,
                "No token available for test user"
            )
            return
        
        # Add to favorites
        try:
            response = self.session.post(
                f"{BASE_URL}/listings/{listing_id}/favorite",
                headers={
                    "Authorization": f"Bearer {self.tokens[user_email]}",
                    "Content-Type": "application/json"
                }
            )
            
            if response.status_code == 200:
                self.log_result(
                    "Add to Favorites",
                    True,
                    "Added listing to favorites"
                )
            else:
                self.log_result(
                    "Add to Favorites",
                    False,
                    f"Failed to add to favorites with status {response.status_code}",
                    response.text
                )
                
        except Exception as e:
            self.log_result(
                "Add to Favorites",
                False,
                f"Add to favorites error: {str(e)}"
            )
        
        # Get favorites
        try:
            response = self.session.get(
                f"{BASE_URL}/listings/my/favorites",
                headers={
                    "Authorization": f"Bearer {self.tokens[user_email]}",
                    "Content-Type": "application/json"
                }
            )
            
            if response.status_code == 200:
                favorites = response.json()
                self.log_result(
                    "Get Favorites",
                    True,
                    f"Retrieved {len(favorites)} favorite listings"
                )
            else:
                self.log_result(
                    "Get Favorites",
                    False,
                    f"Failed to get favorites with status {response.status_code}",
                    response.text
                )
                
        except Exception as e:
            self.log_result(
                "Get Favorites",
                False,
                f"Get favorites error: {str(e)}"
            )
        
        # Remove from favorites
        try:
            response = self.session.delete(
                f"{BASE_URL}/listings/{listing_id}/favorite",
                headers={
                    "Authorization": f"Bearer {self.tokens[user_email]}",
                    "Content-Type": "application/json"
                }
            )
            
            if response.status_code == 200:
                self.log_result(
                    "Remove from Favorites",
                    True,
                    "Removed listing from favorites"
                )
            else:
                self.log_result(
                    "Remove from Favorites",
                    False,
                    f"Failed to remove from favorites with status {response.status_code}",
                    response.text
                )
                
        except Exception as e:
            self.log_result(
                "Remove from Favorites",
                False,
                f"Remove from favorites error: {str(e)}"
            )
    
    def test_messages(self):
        """Test messaging system"""
        print("\n=== Testing Messaging System ===")
        
        if not self.listings or len(TEST_USERS) < 2:
            self.log_result(
                "Messaging System",
                False,
                "Need at least 2 users and 1 listing to test messaging"
            )
            return
            
        listing_id = list(self.listings.keys())[0]
        sender_email = TEST_USERS[1]["email"]  # Second user sends message
        receiver_id = self.users.get(TEST_USERS[0]["email"], {}).get("id")  # First user receives
        
        if sender_email not in self.tokens or not receiver_id:
            self.log_result(
                "Messaging System",
                False,
                "Missing tokens or user IDs for messaging test"
            )
            return
        
        # Send message
        message_data = {
            "listingId": listing_id,
            "receiverId": receiver_id,
            "text": "Merhaba, bu ürün hala satılık mı? Fiyat konusunda pazarlık yapabilir miyiz?"
        }
        
        try:
            response = self.session.post(
                f"{BASE_URL}/messages",
                json=message_data,
                headers={
                    "Authorization": f"Bearer {self.tokens[sender_email]}",
                    "Content-Type": "application/json"
                }
            )
            
            if response.status_code == 200 or response.status_code == 201:
                self.log_result(
                    "Send Message",
                    True,
                    "Message sent successfully"
                )
            else:
                self.log_result(
                    "Send Message",
                    False,
                    f"Failed to send message with status {response.status_code}",
                    response.text
                )
                
        except Exception as e:
            self.log_result(
                "Send Message",
                False,
                f"Send message error: {str(e)}"
            )
        
        # Get conversations
        try:
            response = self.session.get(
                f"{BASE_URL}/messages/conversations",
                headers={
                    "Authorization": f"Bearer {self.tokens[sender_email]}",
                    "Content-Type": "application/json"
                }
            )
            
            if response.status_code == 200:
                conversations = response.json()
                self.log_result(
                    "Get Conversations",
                    True,
                    f"Retrieved {len(conversations)} conversations"
                )
            else:
                self.log_result(
                    "Get Conversations",
                    False,
                    f"Failed to get conversations with status {response.status_code}",
                    response.text
                )
                
        except Exception as e:
            self.log_result(
                "Get Conversations",
                False,
                f"Get conversations error: {str(e)}"
            )
        
        # Get chat history
        sender_id = self.users.get(sender_email, {}).get("id")
        if sender_id:
            try:
                response = self.session.get(
                    f"{BASE_URL}/messages/{listing_id}/{sender_id}",
                    headers={
                        "Authorization": f"Bearer {self.tokens[TEST_USERS[0]['email']]}",
                        "Content-Type": "application/json"
                    }
                )
                
                if response.status_code == 200:
                    messages = response.json()
                    self.log_result(
                        "Get Chat History",
                        True,
                        f"Retrieved {len(messages)} messages in chat"
                    )
                else:
                    self.log_result(
                        "Get Chat History",
                        False,
                        f"Failed to get chat history with status {response.status_code}",
                        response.text
                    )
                    
            except Exception as e:
                self.log_result(
                    "Get Chat History",
                    False,
                    f"Get chat history error: {str(e)}"
                )
    
    def test_ratings(self):
        """Test rating system"""
        print("\n=== Testing Rating System ===")
        
        if len(TEST_USERS) < 2:
            self.log_result(
                "Rating System",
                False,
                "Need at least 2 users to test rating system"
            )
            return
            
        rater_email = TEST_USERS[1]["email"]
        rated_user_id = self.users.get(TEST_USERS[0]["email"], {}).get("id")
        listing_id = list(self.listings.keys())[0] if self.listings else None
        
        if rater_email not in self.tokens or not rated_user_id:
            self.log_result(
                "Rating System",
                False,
                "Missing tokens or user IDs for rating test"
            )
            return
        
        # Create rating
        rating_data = {
            "userId": rated_user_id,
            "rating": 5,
            "comment": "Çok güvenilir satıcı, ürün açıklamada belirtildiği gibi. Hızlı teslimat. Teşekkürler!",
            "listingId": listing_id
        }
        
        try:
            response = self.session.post(
                f"{BASE_URL}/ratings",
                json=rating_data,
                headers={
                    "Authorization": f"Bearer {self.tokens[rater_email]}",
                    "Content-Type": "application/json"
                }
            )
            
            if response.status_code == 200:
                self.log_result(
                    "Create Rating",
                    True,
                    "Rating created successfully"
                )
            else:
                self.log_result(
                    "Create Rating",
                    False,
                    f"Failed to create rating with status {response.status_code}",
                    response.text
                )
                
        except Exception as e:
            self.log_result(
                "Create Rating",
                False,
                f"Create rating error: {str(e)}"
            )
        
        # Get user ratings
        try:
            response = self.session.get(f"{BASE_URL}/ratings/{rated_user_id}")
            
            if response.status_code == 200:
                ratings = response.json()
                self.log_result(
                    "Get User Ratings",
                    True,
                    f"Retrieved {len(ratings)} ratings for user"
                )
            else:
                self.log_result(
                    "Get User Ratings",
                    False,
                    f"Failed to get ratings with status {response.status_code}",
                    response.text
                )
                
        except Exception as e:
            self.log_result(
                "Get User Ratings",
                False,
                f"Get ratings error: {str(e)}"
            )
    
    def test_reports(self):
        """Test report system"""
        print("\n=== Testing Report System ===")
        
        if not self.listings:
            self.log_result(
                "Report System",
                False,
                "No listings available to test reporting"
            )
            return
            
        listing_id = list(self.listings.keys())[0]
        reporter_email = TEST_USERS[1]["email"] if len(TEST_USERS) > 1 else TEST_USERS[0]["email"]
        
        if reporter_email not in self.tokens:
            self.log_result(
                "Report System",
                False,
                "No token available for reporter"
            )
            return
        
        report_data = {
            "listingId": listing_id,
            "reason": "Sahte ürün",
            "description": "Bu ürün orijinal değil gibi görünüyor. Fotoğraflar şüpheli."
        }
        
        try:
            response = self.session.post(
                f"{BASE_URL}/reports",
                json=report_data,
                headers={
                    "Authorization": f"Bearer {self.tokens[reporter_email]}",
                    "Content-Type": "application/json"
                }
            )
            
            if response.status_code == 200:
                self.log_result(
                    "Create Report",
                    True,
                    "Report submitted successfully"
                )
            else:
                self.log_result(
                    "Create Report",
                    False,
                    f"Failed to create report with status {response.status_code}",
                    response.text
                )
                
        except Exception as e:
            self.log_result(
                "Create Report",
                False,
                f"Create report error: {str(e)}"
            )
    
    def test_listings_delete(self):
        """Test delete listing"""
        print("\n=== Testing Delete Listing ===")
        
        if not self.listings:
            self.log_result(
                "Delete Listing",
                False,
                "No listings available to test deletion"
            )
            return
            
        listing_id = list(self.listings.keys())[-1]  # Use last listing
        owner_email = self.listings[listing_id]["owner"]
        
        if owner_email not in self.tokens:
            self.log_result(
                "Delete Listing",
                False,
                "No token available for listing owner"
            )
            return
        
        try:
            response = self.session.delete(
                f"{BASE_URL}/listings/{listing_id}",
                headers={
                    "Authorization": f"Bearer {self.tokens[owner_email]}",
                    "Content-Type": "application/json"
                }
            )
            
            if response.status_code == 200:
                self.log_result(
                    "Delete Listing",
                    True,
                    "Listing deleted successfully"
                )
            else:
                self.log_result(
                    "Delete Listing",
                    False,
                    f"Failed to delete listing with status {response.status_code}",
                    response.text
                )
                
        except Exception as e:
            self.log_result(
                "Delete Listing",
                False,
                f"Delete listing error: {str(e)}"
            )
    
    def run_all_tests(self):
        """Run all backend tests"""
        print("🚀 Starting Comprehensive Backend API Testing")
        print(f"📍 Base URL: {BASE_URL}")
        print("=" * 60)
        
        # Test authentication flow
        self.test_auth_register()
        self.test_auth_login()
        self.test_auth_me()
        
        # Test categories
        self.test_categories()
        
        # Test listings
        self.test_listings_create()
        self.test_listings_get_all()
        self.test_listings_get_specific()
        self.test_listings_update()
        self.test_listings_my_listings()
        
        # Test favorites
        self.test_favorites()
        
        # Test messaging
        self.test_messages()
        
        # Test ratings
        self.test_ratings()
        
        # Test reports
        self.test_reports()
        
        # Test delete (last to avoid affecting other tests)
        self.test_listings_delete()
        
        # Print summary
        self.print_summary()
    
    def print_summary(self):
        """Print test summary"""
        print("\n" + "=" * 60)
        print("📊 TEST SUMMARY")
        print("=" * 60)
        
        total_tests = len(self.test_results)
        passed_tests = len([r for r in self.test_results if r["success"]])
        failed_tests = total_tests - passed_tests
        
        print(f"Total Tests: {total_tests}")
        print(f"✅ Passed: {passed_tests}")
        print(f"❌ Failed: {failed_tests}")
        print(f"Success Rate: {(passed_tests/total_tests*100):.1f}%")
        
        if failed_tests > 0:
            print("\n🔍 FAILED TESTS:")
            for result in self.test_results:
                if not result["success"]:
                    print(f"   ❌ {result['test']}: {result['message']}")
        
        print("\n" + "=" * 60)

if __name__ == "__main__":
    tester = BackendTester()
    tester.run_all_tests()