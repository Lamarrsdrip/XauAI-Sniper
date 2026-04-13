#!/usr/bin/env python3
"""
Backend API Testing for AI XAUUSD Trading Bot - Iteration 5
Tests new features: JWT admin authentication, admin portal, protected admin routes
"""

import requests
import sys
import json
from datetime import datetime

class APITester:
    def __init__(self, base_url="https://ml-gold-bot.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []
        self.admin_token = None

    def log(self, message, level="INFO"):
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"[{timestamp}] {level}: {message}")

    def run_test(self, name, method, endpoint, expected_status=200, data=None, headers=None, validate_response=None):
        """Run a single API test with optional response validation"""
        url = f"{self.api_url}/{endpoint.lstrip('/')}"
        if headers is None:
            headers = {'Content-Type': 'application/json'}

        self.tests_run += 1
        self.log(f"Testing {name}...")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=10)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=10)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers, timeout=10)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, timeout=10)

            # Check status code
            if response.status_code != expected_status:
                self.log(f"❌ {name} - Expected {expected_status}, got {response.status_code}", "ERROR")
                self.failed_tests.append(f"{name}: Status {response.status_code} != {expected_status}")
                return False, {}

            # Parse JSON response
            try:
                response_data = response.json()
            except json.JSONDecodeError:
                if expected_status == 200:
                    self.log(f"❌ {name} - Invalid JSON response", "ERROR")
                    self.failed_tests.append(f"{name}: Invalid JSON response")
                    return False, {}
                response_data = {}

            # Custom validation
            if validate_response:
                validation_result = validate_response(response_data)
                if validation_result is not True:
                    self.log(f"❌ {name} - Validation failed: {validation_result}", "ERROR")
                    self.failed_tests.append(f"{name}: {validation_result}")
                    return False, response_data

            self.tests_passed += 1
            self.log(f"✅ {name} - Passed")
            return True, response_data

        except requests.exceptions.RequestException as e:
            self.log(f"❌ {name} - Request failed: {str(e)}", "ERROR")
            self.failed_tests.append(f"{name}: Request failed - {str(e)}")
            return False, {}

    def test_health_check(self):
        """Test basic health endpoint"""
        return self.run_test("Health Check", "GET", "/health")

    def test_gold_price_api(self):
        """Test live gold price API - NEW FEATURE"""
        def validate_gold_price(data):
            required_fields = ['symbol', 'bid', 'ask', 'spread', 'change', 'change_pct', 'timestamp', 'source']
            for field in required_fields:
                if field not in data:
                    return f"Missing field: {field}"
            
            if data.get('symbol') != 'XAUUSD':
                return f"Expected symbol XAUUSD, got {data.get('symbol')}"
            
            if data.get('source') != 'live':
                return f"Expected source 'live', got {data.get('source')}"
            
            bid = data.get('bid', 0)
            if not (4000 <= bid <= 5500):
                return f"Bid price {bid} not in expected range 4000-5500"
            
            return True

        return self.run_test("Live Gold Price", "GET", "/gold/price", validate_response=validate_gold_price)

    def test_purchase_price_api(self):
        """Test purchase price API - UPDATED FOR PAYSTACK NAIRA"""
        def validate_purchase_price(data):
            # Price might have been updated by admin settings test, so check for reasonable range
            price_naira = data.get('price_naira', 0)
            if not (200000 <= price_naira <= 400000):
                return f"Price naira {price_naira} not in reasonable range 200000-400000"
            
            expected_fields = {
                'currency': 'NGN', 
                'payment_method': 'paystack'
            }
            for key, expected_value in expected_fields.items():
                if data.get(key) != expected_value:
                    return f"Expected {key}={expected_value}, got {data.get(key)}"
            
            # Check formatted field contains ₦ symbol
            formatted = data.get('formatted', '')
            if '₦' not in formatted:
                return f"Expected ₦ symbol in formatted field, got: {formatted}"
            
            return True

        return self.run_test("Purchase Price (Paystack Naira)", "GET", "/purchase/price", validate_response=validate_purchase_price)

    def test_purchase_initialize_api(self):
        """Test Paystack purchase initialization - SHOULD RETURN 503 (NOT CONFIGURED)"""
        test_data = {
            "buyer_name": "Test User",
            "buyer_email": "test@example.com",
            "origin_url": "https://example.com"
        }
        
        def validate_503_error(data):
            # For 503 status, we expect an error message about not being configured
            if 'detail' not in data:
                return "Missing error detail field"
            
            detail = data.get('detail', '').lower()
            if 'not configured' not in detail:
                return f"Expected 'not configured' in error message, got: {data.get('detail')}"
            
            return True

        return self.run_test("Purchase Initialize (503 Expected)", "POST", "/purchase/initialize", 
                           expected_status=503, data=test_data, validate_response=validate_503_error)

    def test_setup_guide_api(self):
        """Test setup guide API - NEW FEATURE"""
        def validate_setup_guide(data):
            required_fields = ['title', 'intro', 'steps', 'important_notes']
            for field in required_fields:
                if field not in data:
                    return f"Missing field: {field}"
            
            if "10-Year-Old" not in data.get('title', ''):
                return f"Title should contain '10-Year-Old', got: {data.get('title')}"
            
            steps = data.get('steps', [])
            if len(steps) != 10:
                return f"Expected 10 steps, got {len(steps)}"
            
            # Check each step has required fields
            for i, step in enumerate(steps):
                required_step_fields = ['step', 'title', 'instructions', 'tip']
                for field in required_step_fields:
                    if field not in step:
                        return f"Step {i+1} missing field: {field}"
                
                if step.get('step') != i + 1:
                    return f"Step {i+1} has wrong step number: {step.get('step')}"
            
            return True
    def test_video_guide_api(self):
        """Test video guide API - NEW FEATURE (Iteration 4)"""
        def validate_video_guide(data):
            required_fields = ['title', 'subtitle', 'scenes']
            for field in required_fields:
                if field not in data:
                    return f"Missing field: {field}"
            
            if "Visual Walkthrough" not in data.get('title', ''):
                return f"Title should contain 'Visual Walkthrough', got: {data.get('title')}"
            
            scenes = data.get('scenes', [])
            if len(scenes) != 6:
                return f"Expected 6 scenes, got {len(scenes)}"
            
            # Check each scene has required fields
            for i, scene in enumerate(scenes):
                required_scene_fields = ['scene', 'title', 'duration', 'frames']
                for field in required_scene_fields:
                    if field not in scene:
                        return f"Scene {i+1} missing field: {field}"
                
                if scene.get('scene') != i + 1:
                    return f"Scene {i+1} has wrong scene number: {scene.get('scene')}"
                
                # Check frames
                frames = scene.get('frames', [])
                if len(frames) == 0:
                    return f"Scene {i+1} has no frames"
                
                for j, frame in enumerate(frames):
                    required_frame_fields = ['action', 'detail', 'visual']
                    for field in required_frame_fields:
                        if field not in frame:
                            return f"Scene {i+1}, Frame {j+1} missing field: {field}"
            
            return True

        return self.run_test("Video Guide (6 Scenes)", "GET", "/docs/video-guide", validate_response=validate_video_guide)

        return self.run_test("Setup Guide", "GET", "/docs/setup-guide", validate_response=validate_setup_guide)

    def test_admin_login_success(self):
        """Test admin login with correct credentials - NEW FEATURE (Iteration 5)"""
        test_data = {
            "email": "admin@aisniper.com",
            "password": "Admin@2026!"
        }
        
        def validate_login_response(data):
            required_fields = ['email', 'name', 'role', 'token']
            for field in required_fields:
                if field not in data:
                    return f"Missing field: {field}"
            
            if data.get('email') != 'admin@aisniper.com':
                return f"Expected email admin@aisniper.com, got {data.get('email')}"
            
            if data.get('role') != 'admin':
                return f"Expected role admin, got {data.get('role')}"
            
            token = data.get('token')
            if not token or len(token) < 50:
                return f"Invalid token: {token}"
            
            # Store token for subsequent tests
            self.admin_token = token
            return True

        return self.run_test("Admin Login (Success)", "POST", "/auth/login", 
                           data=test_data, validate_response=validate_login_response)

    def test_admin_login_wrong_password(self):
        """Test admin login with wrong password - NEW FEATURE (Iteration 5)"""
        test_data = {
            "email": "admin@aisniper.com",
            "password": "WrongPassword123!"
        }
        
        def validate_401_error(data):
            if 'detail' not in data:
                return "Missing error detail field"
            
            detail = data.get('detail', '').lower()
            if 'invalid' not in detail:
                return f"Expected 'invalid' in error message, got: {data.get('detail')}"
            
            return True

        return self.run_test("Admin Login (Wrong Password)", "POST", "/auth/login", 
                           expected_status=401, data=test_data, validate_response=validate_401_error)

    def test_auth_me_with_token(self):
        """Test /auth/me with valid token - NEW FEATURE (Iteration 5)"""
        if not self.admin_token:
            self.log("❌ Auth Me - No admin token available", "ERROR")
            self.failed_tests.append("Auth Me: No admin token")
            self.tests_run += 1
            return False, {}
        
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {self.admin_token}'
        }
        
        def validate_me_response(data):
            if data.get('email') != 'admin@aisniper.com':
                return f"Expected email admin@aisniper.com, got {data.get('email')}"
            
            if data.get('role') != 'admin':
                return f"Expected role admin, got {data.get('role')}"
            
            return True

        return self.run_test("Auth Me (With Token)", "GET", "/auth/me", 
                           headers=headers, validate_response=validate_me_response)

    def test_admin_settings_requires_auth(self):
        """Test admin settings endpoint requires authentication - NEW FEATURE (Iteration 5)"""
        return self.run_test("Admin Settings (No Auth)", "GET", "/admin/settings", 
                           expected_status=401)

    def test_admin_pins_requires_auth(self):
        """Test admin pins endpoint requires authentication - NEW FEATURE (Iteration 5)"""
        return self.run_test("Admin Pins (No Auth)", "GET", "/admin/pins", 
                           expected_status=401)

    def test_admin_settings_with_token(self):
        """Test admin settings with valid token - NEW FEATURE (Iteration 5)"""
        if not self.admin_token:
            self.log("❌ Admin Settings - No admin token available", "ERROR")
            self.failed_tests.append("Admin Settings: No admin token")
            self.tests_run += 1
            return False, {}
        
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {self.admin_token}'
        }
        
        def validate_settings_response(data):
            required_fields = ['paystack_configured', 'pin_price_kobo', 'pin_price_naira', 'smtp_email', 'smtp_configured']
            for field in required_fields:
                if field not in data:
                    return f"Missing field: {field}"
            
            # Check that paystack is not configured (as per .env)
            if data.get('paystack_configured') != False:
                return f"Expected paystack_configured=False, got {data.get('paystack_configured')}"
            
            # Check price is reasonable (might have been updated by previous tests)
            price_kobo = data.get('pin_price_kobo', 0)
            if not (20000000 <= price_kobo <= 40000000):
                return f"Expected pin_price_kobo in range 20M-40M, got {price_kobo}"
            
            return True

        return self.run_test("Admin Settings (With Token)", "GET", "/admin/settings", 
                           headers=headers, validate_response=validate_settings_response)

    def test_admin_settings_update(self):
        """Test admin settings update - NEW FEATURE (Iteration 5)"""
        if not self.admin_token:
            self.log("❌ Admin Settings Update - No admin token available", "ERROR")
            self.failed_tests.append("Admin Settings Update: No admin token")
            self.tests_run += 1
            return False, {}
        
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {self.admin_token}'
        }
        
        test_data = {
            "pin_price_kobo": 25000000  # Update price to 250,000 Naira
        }
        
        def validate_update_response(data):
            if not data.get('updated'):
                return f"Expected updated=True, got {data.get('updated')}"
            return True

        return self.run_test("Admin Settings Update", "PUT", "/admin/settings", 
                           headers=headers, data=test_data, validate_response=validate_update_response)

    def test_admin_pins_generate(self):
        """Test admin PIN generation - NEW FEATURE (Iteration 5)"""
        if not self.admin_token:
            self.log("❌ Admin PIN Generate - No admin token available", "ERROR")
            self.failed_tests.append("Admin PIN Generate: No admin token")
            self.tests_run += 1
            return False, {}
        
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {self.admin_token}'
        }
        
        test_data = {
            "count": 2,
            "buyer_name": "Test Admin User",
            "buyer_email": "testadmin@example.com",
            "notes": "Test PIN generation"
        }
        
        def validate_pin_generation(data):
            if data.get('pins_created') != 2:
                return f"Expected pins_created=2, got {data.get('pins_created')}"
            
            pins = data.get('pins', [])
            if len(pins) != 2:
                return f"Expected 2 pins in array, got {len(pins)}"
            
            for pin_obj in pins:
                if not pin_obj.get('pin', '').startswith('ASE-'):
                    return f"PIN should start with ASE-, got: {pin_obj.get('pin')}"
                
                if pin_obj.get('buyer_name') != 'Test Admin User':
                    return f"Expected buyer_name='Test Admin User', got {pin_obj.get('buyer_name')}"
            
            return True

        return self.run_test("Admin PIN Generation", "POST", "/admin/pins/generate", 
                           headers=headers, data=test_data, validate_response=validate_pin_generation)

    def test_admin_pins_list(self):
        """Test admin PIN listing - NEW FEATURE (Iteration 5)"""
        if not self.admin_token:
            self.log("❌ Admin PIN List - No admin token available", "ERROR")
            self.failed_tests.append("Admin PIN List: No admin token")
            self.tests_run += 1
            return False, {}
        
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {self.admin_token}'
        }
        
        def validate_pins_list(data):
            if 'total' not in data or 'pins' not in data:
                return "Missing total or pins field"
            
            total = data.get('total', 0)
            pins = data.get('pins', [])
            
            if len(pins) != total:
                return f"Total {total} doesn't match pins array length {len(pins)}"
            
            # Should have at least the pins we generated
            if total < 2:
                return f"Expected at least 2 pins, got {total}"
            
            return True

        return self.run_test("Admin PIN List", "GET", "/admin/pins", 
                           headers=headers, validate_response=validate_pins_list)

    def test_admin_transactions(self):
        """Test admin transactions listing - NEW FEATURE (Iteration 5)"""
        if not self.admin_token:
            self.log("❌ Admin Transactions - No admin token available", "ERROR")
            self.failed_tests.append("Admin Transactions: No admin token")
            self.tests_run += 1
            return False, {}
        
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {self.admin_token}'
        }
        
        def validate_transactions_list(data):
            if 'total' not in data or 'transactions' not in data:
                return "Missing total or transactions field"
            
            total = data.get('total', 0)
            transactions = data.get('transactions', [])
            
            if len(transactions) != total:
                return f"Total {total} doesn't match transactions array length {len(transactions)}"
            
            return True

        return self.run_test("Admin Transactions", "GET", "/admin/transactions", 
                           headers=headers, validate_response=validate_transactions_list)

    def test_pin_validation(self):
        """Test PIN validation - EXISTING FEATURE"""
        # Use a known PIN format for testing
        test_pin = "ASE-TEST-1234"
        test_data = {"pin": test_pin, "mt5_account": "12345"}
        
        def validate_pin_response(data):
            # PIN validation should return false for non-existent PIN
            if data.get('valid') != False:
                return f"Expected valid=False for non-existent PIN, got: {data.get('valid')}"
            
            if 'reason' not in data:
                return "Missing reason field for invalid PIN"
            
            return True

        return self.run_test("PIN Validation (Non-existent)", "POST", "/pins/validate", 
                           data=test_data, validate_response=validate_pin_response)

    def test_performance_summary(self):
        """Test performance data with enhanced AI metrics - UPDATED FOR ITERATION 4"""
        def validate_performance(data):
            required_fields = ['total_trades', 'win_rate', 'profit_factor', 'max_drawdown', 'ai_features']
            for field in required_fields:
                if field not in data:
                    return f"Missing field: {field}"
            
            if not isinstance(data.get('total_trades'), int):
                return "total_trades should be integer"
            
            # Check enhanced AI features
            ai_features = data.get('ai_features', {})
            required_ai_fields = [
                'market_classification_accuracy', 'avg_confidence_on_wins', 
                'avg_confidence_on_losses', 'pattern_memory_size',
                'adaptation_cycles', 'learning_rate_current',
                'win_rate_after_learning', 'loss_avoidance_rate'
            ]
            for field in required_ai_fields:
                if field not in ai_features:
                    return f"Missing AI feature field: {field}"
            
            # Check for higher accuracy targets
            accuracy = ai_features.get('market_classification_accuracy', 0)
            if accuracy < 85:
                return f"Expected market classification accuracy >= 85%, got {accuracy}%"
            
            return True

        return self.run_test("Performance Summary (Enhanced AI)", "GET", "/performance/summary", 
                           validate_response=validate_performance)

    def test_ea_download(self):
        """Test EA file download - EXISTING FEATURE"""
        url = f"{self.api_url}/download/ea"
        self.tests_run += 1
        self.log("Testing EA Download...")
        
        try:
            response = requests.get(url, timeout=10)
            if response.status_code == 200:
                # Check if it's a file download
                content_type = response.headers.get('content-type', '')
                if 'application/octet-stream' in content_type or len(response.content) > 0:
                    self.tests_passed += 1
                    self.log("✅ EA Download - Passed")
                    return True, {}
                else:
                    self.log("❌ EA Download - No file content", "ERROR")
                    self.failed_tests.append("EA Download: No file content")
                    return False, {}
            else:
                self.log(f"❌ EA Download - Status {response.status_code}", "ERROR")
                self.failed_tests.append(f"EA Download: Status {response.status_code}")
                return False, {}
        except requests.exceptions.RequestException as e:
            self.log(f"❌ EA Download - Request failed: {str(e)}", "ERROR")
            self.failed_tests.append(f"EA Download: Request failed - {str(e)}")
            return False, {}

    def run_all_tests(self):
        """Run all backend tests"""
        self.log("=" * 60)
        self.log("STARTING BACKEND API TESTS - ITERATION 5")
        self.log("=" * 60)

        # Test basic connectivity
        self.test_health_check()

        # Test NEW ADMIN AUTHENTICATION features (Iteration 5)
        self.log("\n--- NEW ADMIN AUTHENTICATION (Iteration 5) ---")
        self.test_admin_login_success()
        self.test_admin_login_wrong_password()
        self.test_auth_me_with_token()

        # Test ADMIN PROTECTED ENDPOINTS (Iteration 5)
        self.log("\n--- ADMIN PROTECTED ENDPOINTS (Iteration 5) ---")
        self.test_admin_settings_requires_auth()
        self.test_admin_pins_requires_auth()
        self.test_admin_settings_with_token()
        self.test_admin_settings_update()
        self.test_admin_pins_generate()
        self.test_admin_pins_list()
        self.test_admin_transactions()

        # Test PUBLIC features (should still work)
        self.log("\n--- PUBLIC FEATURES (Should Still Work) ---")
        self.test_gold_price_api()
        self.test_purchase_price_api()
        self.test_purchase_initialize_api()
        self.test_pin_validation()
        self.test_performance_summary()
        self.test_ea_download()

        # Print summary
        self.log("\n" + "=" * 60)
        self.log("BACKEND TEST SUMMARY")
        self.log("=" * 60)
        self.log(f"Tests Run: {self.tests_run}")
        self.log(f"Tests Passed: {self.tests_passed}")
        self.log(f"Tests Failed: {self.tests_run - self.tests_passed}")
        self.log(f"Success Rate: {(self.tests_passed/self.tests_run*100):.1f}%")

        if self.failed_tests:
            self.log("\nFAILED TESTS:")
            for failure in self.failed_tests:
                self.log(f"  - {failure}")

        return self.tests_passed == self.tests_run

def main():
    tester = APITester()
    success = tester.run_all_tests()
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())