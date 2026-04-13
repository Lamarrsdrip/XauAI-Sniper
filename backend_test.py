#!/usr/bin/env python3
"""
Backend API Testing for AI XAUUSD Trading Bot - Iteration 4
Tests new features: Paystack Naira payment, video guide, enhanced AI metrics
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
            expected_fields = {
                'price_naira': 300000,
                'currency': 'NGN', 
                'payment_method': 'paystack',
                'formatted': '₦300,000'
            }
            for key, expected_value in expected_fields.items():
                if data.get(key) != expected_value:
                    return f"Expected {key}={expected_value}, got {data.get(key)}"
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
            if 'not configured' not in detail or 'paystack' not in detail:
                return f"Expected 'not configured' and 'paystack' in error message, got: {data.get('detail')}"
            
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

    def test_pin_generation(self):
        """Test PIN generation - EXISTING FEATURE"""
        test_data = {"count": 1, "buyer_name": "Test", "buyer_email": "test@example.com"}
        
        def validate_pins(data):
            if 'pins_created' not in data or 'pins' not in data:
                return "Missing pins_created or pins field"
            
            if data.get('pins_created') != 1:
                return f"Expected 1 pin created, got {data.get('pins_created')}"
            
            pins = data.get('pins', [])
            if len(pins) != 1:
                return f"Expected 1 pin in array, got {len(pins)}"
            
            pin_obj = pins[0]
            if not pin_obj.get('pin', '').startswith('ASE-'):
                return f"PIN should start with ASE-, got: {pin_obj.get('pin')}"
            
            return True

        return self.run_test("PIN Generation", "POST", "/pins/generate", 
                           data=test_data, validate_response=validate_pins)

    def test_pin_validation(self):
        """Test PIN validation - EXISTING FEATURE"""
        # First generate a PIN
        gen_success, gen_data = self.test_pin_generation()
        if not gen_success:
            return False, {}
        
        pin = gen_data.get('pins', [{}])[0].get('pin')
        if not pin:
            self.log("❌ PIN Validation - No PIN to validate", "ERROR")
            return False, {}
        
        test_data = {"pin": pin, "mt5_account": "12345"}
        
        def validate_pin_response(data):
            if not data.get('valid'):
                return f"PIN validation failed: {data.get('reason', 'Unknown')}"
            
            if data.get('pin') != pin:
                return f"Returned PIN doesn't match: {data.get('pin')} != {pin}"
            
            return True

        return self.run_test("PIN Validation", "POST", "/pins/validate", 
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
        self.log("STARTING BACKEND API TESTS - ITERATION 4")
        self.log("=" * 60)

        # Test basic connectivity
        self.test_health_check()

        # Test NEW features (Iteration 4)
        self.log("\n--- NEW FEATURES (Iteration 4) ---")
        self.test_gold_price_api()
        self.test_purchase_price_api()
        self.test_purchase_initialize_api()
        self.test_video_guide_api()
        self.test_setup_guide_api()

        # Test EXISTING features
        self.log("\n--- EXISTING FEATURES ---")
        self.test_pin_generation()
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