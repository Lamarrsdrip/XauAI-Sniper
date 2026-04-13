#!/usr/bin/env python3
"""
Backend API Testing for AI Sniper XAUUSD Trading Bot
Tests all FastAPI endpoints for functionality and data integrity
"""

import requests
import sys
import json
from datetime import datetime
from typing import Dict, Any

class AITradingBotAPITester:
    def __init__(self, base_url="https://ml-gold-bot.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []
        self.test_results = {}

    def run_test(self, name: str, method: str, endpoint: str, expected_status: int = 200, 
                 data: Dict[Any, Any] = None, validate_response: callable = None) -> tuple:
        """Run a single API test with optional response validation"""
        url = f"{self.api_url}/{endpoint}" if not endpoint.startswith('http') else endpoint
        headers = {'Content-Type': 'application/json'}

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=10)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=10)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, timeout=10)
            else:
                raise ValueError(f"Unsupported method: {method}")

            success = response.status_code == expected_status
            response_data = {}
            
            try:
                response_data = response.json() if response.content else {}
            except json.JSONDecodeError:
                if expected_status == 200:
                    print(f"   ⚠️  Warning: Non-JSON response received")
                response_data = {"raw_content": response.text[:200]}

            if success:
                # Additional validation if provided
                if validate_response and response_data:
                    validation_result = validate_response(response_data)
                    if not validation_result:
                        success = False
                        print(f"   ❌ Failed - Response validation failed")
                    else:
                        print(f"   ✅ Passed - Status: {response.status_code}, Validation: OK")
                else:
                    print(f"   ✅ Passed - Status: {response.status_code}")
                
                if success:
                    self.tests_passed += 1
            else:
                print(f"   ❌ Failed - Expected {expected_status}, got {response.status_code}")
                print(f"   Response: {response.text[:200]}")
                self.failed_tests.append({
                    "test": name,
                    "expected": expected_status,
                    "actual": response.status_code,
                    "response": response.text[:200]
                })

            self.test_results[name] = {
                "success": success,
                "status_code": response.status_code,
                "response_data": response_data
            }

            return success, response_data

        except requests.exceptions.RequestException as e:
            print(f"   ❌ Failed - Network Error: {str(e)}")
            self.failed_tests.append({
                "test": name,
                "error": str(e)
            })
            self.test_results[name] = {
                "success": False,
                "error": str(e)
            }
            return False, {}

    def validate_performance_data(self, data: Dict) -> bool:
        """Validate performance summary response structure"""
        required_fields = [
            'total_trades', 'win_rate', 'profit_factor', 'max_drawdown',
            'avg_rr_ratio', 'weekly_return_avg', 'sharpe_ratio',
            'monthly_returns', 'strategy_breakdown', 'weekly_data', 'equity_curve'
        ]
        
        for field in required_fields:
            if field not in data:
                print(f"   Missing required field: {field}")
                return False
        
        # Validate monthly_returns structure
        if not isinstance(data['monthly_returns'], list) or len(data['monthly_returns']) == 0:
            print(f"   Invalid monthly_returns structure")
            return False
            
        # Check first monthly return has required fields
        first_month = data['monthly_returns'][0]
        month_fields = ['month', 'return', 'trades']
        for field in month_fields:
            if field not in first_month:
                print(f"   Missing field in monthly_returns: {field}")
                return False
        
        # Validate strategy_breakdown
        if not isinstance(data['strategy_breakdown'], list) or len(data['strategy_breakdown']) != 3:
            print(f"   Invalid strategy_breakdown structure")
            return False
            
        return True

    def validate_architecture_data(self, data: Dict) -> bool:
        """Validate architecture response structure"""
        if 'modules' not in data or 'filters' not in data:
            print(f"   Missing modules or filters in architecture data")
            return False
            
        if len(data['modules']) != 6:
            print(f"   Expected 6 modules, got {len(data['modules'])}")
            return False
            
        if len(data['filters']) != 4:
            print(f"   Expected 4 filters, got {len(data['filters'])}")
            return False
            
        # Check module structure
        first_module = data['modules'][0]
        module_fields = ['name', 'description', 'components']
        for field in module_fields:
            if field not in first_module:
                print(f"   Missing field in module: {field}")
                return False
                
        return True

    def validate_installation_data(self, data: Dict) -> bool:
        """Validate installation guide response structure"""
        required_fields = ['steps', 'requirements', 'warnings']
        
        for field in required_fields:
            if field not in data:
                print(f"   Missing required field: {field}")
                return False
        
        if len(data['steps']) != 8:
            print(f"   Expected 8 installation steps, got {len(data['steps'])}")
            return False
            
        if len(data['requirements']) != 5:
            print(f"   Expected 5 requirements, got {len(data['requirements'])}")
            return False
            
        if len(data['warnings']) != 4:
            print(f"   Expected 4 warnings, got {len(data['warnings'])}")
            return False
            
        return True

    def test_basic_endpoints(self):
        """Test basic API endpoints"""
        print("\n" + "="*50)
        print("TESTING BASIC ENDPOINTS")
        print("="*50)
        
        # Test root API endpoint
        self.run_test(
            "API Root",
            "GET",
            "",
            200,
            validate_response=lambda data: "message" in data and "AI Sniper EA API" in data["message"]
        )
        
        # Test health endpoint
        self.run_test(
            "Health Check",
            "GET", 
            "health",
            200,
            validate_response=lambda data: data.get("status") == "ok"
        )

    def test_performance_endpoints(self):
        """Test performance data endpoints"""
        print("\n" + "="*50)
        print("TESTING PERFORMANCE ENDPOINTS")
        print("="*50)
        
        self.run_test(
            "Performance Summary",
            "GET",
            "performance/summary",
            200,
            validate_response=self.validate_performance_data
        )

    def test_architecture_endpoints(self):
        """Test system architecture endpoints"""
        print("\n" + "="*50)
        print("TESTING ARCHITECTURE ENDPOINTS")
        print("="*50)
        
        self.run_test(
            "System Architecture",
            "GET",
            "architecture",
            200,
            validate_response=self.validate_architecture_data
        )

    def test_documentation_endpoints(self):
        """Test documentation endpoints"""
        print("\n" + "="*50)
        print("TESTING DOCUMENTATION ENDPOINTS")
        print("="*50)
        
        self.run_test(
            "Installation Guide",
            "GET",
            "docs/installation",
            200,
            validate_response=self.validate_installation_data
        )
        
        self.run_test(
            "Parameter Documentation",
            "GET",
            "docs/parameters",
            200,
            validate_response=lambda data: "groups" in data and len(data["groups"]) >= 3
        )

    def test_download_endpoints(self):
        """Test file download endpoints"""
        print("\n" + "="*50)
        print("TESTING DOWNLOAD ENDPOINTS")
        print("="*50)
        
        # Test EA file download
        success, _ = self.run_test(
            "Download EA File",
            "GET",
            "download/ea",
            200
        )
        
        # Test package download
        success, _ = self.run_test(
            "Download Package",
            "GET",
            "download/package",
            200
        )

    def test_configuration_endpoints(self):
        """Test configuration CRUD endpoints"""
        print("\n" + "="*50)
        print("TESTING CONFIGURATION ENDPOINTS")
        print("="*50)
        
        # Test creating a configuration
        test_config = {
            "name": "Test Configuration",
            "risk_percent": 1.5,
            "daily_loss_limit": 2.5,
            "enable_trend_mode": True,
            "enable_range_mode": False,
            "confidence_threshold": 80
        }
        
        success, create_response = self.run_test(
            "Create Configuration",
            "POST",
            "configs",
            200,
            data=test_config,
            validate_response=lambda data: "id" in data and data["name"] == "Test Configuration"
        )
        
        # Test getting all configurations
        success, get_response = self.run_test(
            "Get All Configurations",
            "GET",
            "configs",
            200,
            validate_response=lambda data: isinstance(data, list)
        )
        
        # Test getting specific configuration if create was successful
        if success and create_response and "id" in create_response:
            config_id = create_response["id"]
            self.run_test(
                "Get Specific Configuration",
                "GET",
                f"configs/{config_id}",
                200,
                validate_response=lambda data: data.get("id") == config_id
            )
            
            # Test deleting the configuration
            self.run_test(
                "Delete Configuration",
                "DELETE",
                f"configs/{config_id}",
                200,
                validate_response=lambda data: "deleted" in data
            )

    def run_all_tests(self):
        """Run all test suites"""
        print("🚀 Starting AI Trading Bot API Tests")
        print(f"Base URL: {self.base_url}")
        print(f"API URL: {self.api_url}")
        
        start_time = datetime.now()
        
        try:
            self.test_basic_endpoints()
            self.test_performance_endpoints()
            self.test_architecture_endpoints()
            self.test_documentation_endpoints()
            self.test_download_endpoints()
            self.test_configuration_endpoints()
        except Exception as e:
            print(f"\n❌ Test suite failed with error: {str(e)}")
            return 1
        
        end_time = datetime.now()
        duration = (end_time - start_time).total_seconds()
        
        # Print final results
        print("\n" + "="*60)
        print("FINAL TEST RESULTS")
        print("="*60)
        print(f"Tests Run: {self.tests_run}")
        print(f"Tests Passed: {self.tests_passed}")
        print(f"Tests Failed: {self.tests_run - self.tests_passed}")
        print(f"Success Rate: {(self.tests_passed/self.tests_run*100):.1f}%")
        print(f"Duration: {duration:.2f} seconds")
        
        if self.failed_tests:
            print(f"\n❌ FAILED TESTS:")
            for i, failure in enumerate(self.failed_tests, 1):
                print(f"{i}. {failure['test']}")
                if 'expected' in failure:
                    print(f"   Expected: {failure['expected']}, Got: {failure['actual']}")
                if 'error' in failure:
                    print(f"   Error: {failure['error']}")
                if 'response' in failure:
                    print(f"   Response: {failure['response']}")
        
        return 0 if self.tests_passed == self.tests_run else 1

def main():
    """Main test execution"""
    tester = AITradingBotAPITester()
    return tester.run_all_tests()

if __name__ == "__main__":
    sys.exit(main())