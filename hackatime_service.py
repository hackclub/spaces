import os
import time
import logging
import requests
import json
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler()
    ]
)
logger = logging.getLogger('hackatime_service')

def send_heartbeat(api_key, heartbeat_data):
    """
    Send a heartbeat to the Hackatime API with detailed heartbeat data
    """
    try:
        if not api_key:
            logger.warning("No API key provided. Cannot send heartbeat.")
            return False

        api_url = "https://hackatime.hackclub.com/api/hackatime/v1/users/current/heartbeats"

        # Prepare heartbeat payload
        current_time = int(time.time())
        user_agent = "Hack Club Spaces/1.0 Python/3.10"

        # Format any array data correctly for PostgreSQL
        # If 'dependencies' is a comma-separated string, properly format it as a PostgreSQL array string
        if isinstance(heartbeat_data, dict) and 'dependencies' in heartbeat_data and isinstance(heartbeat_data['dependencies'], str):
            # Convert "bootstrap,jquery" to "{bootstrap,jquery}"
            deps = heartbeat_data['dependencies']
            if deps and not deps.startswith('{') and not deps.endswith('}'):
                heartbeat_data['dependencies'] = "{" + deps + "}"

        # Use default values if not provided
        default_heartbeat = {
            "entity": "main.py",
            "type": "file",
            "time": current_time,
            "category": "coding",
            "project": "Hack Club Spaces",
            "branch": "main",
            "language": "Python",
            "is_write": True,
            "lines": 150,
            "lineno": 1,
            "cursorpos": 0,
            "line_additions": 0,
            "line_deletions": 0
        }

        # Process input data and ensure all required fields
        if isinstance(heartbeat_data, dict):
            # Single heartbeat
            complete_heartbeat = default_heartbeat.copy()
            complete_heartbeat.update(heartbeat_data)
            heartbeat_payload = [complete_heartbeat]
        elif isinstance(heartbeat_data, list):
            # Multiple heartbeats
            heartbeat_payload = []
            for hb in heartbeat_data:
                if isinstance(hb, dict):
                    complete_hb = default_heartbeat.copy()
                    complete_hb.update(hb)
                    heartbeat_payload.append(complete_hb)
                else:
                    # Invalid item in list
                    complete_hb = default_heartbeat.copy()
                    heartbeat_payload.append(complete_hb)
        else:
            # Fallback to default if data format is unexpected
            heartbeat_payload = [default_heartbeat]

        # Set up headers
        headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
            'User-Agent': user_agent
        }

        # Log detailed request information
        logger.info(f"Sending heartbeat to Hackatime API: {api_url}")
        # Format headers for better readability in logs
        formatted_headers = {
            'Authorization': f'Bearer {api_key[:5]}...{api_key[-5:]}',  # Mask most of the API key for security
            'Content-Type': headers['Content-Type'],
            'User-Agent': headers['User-Agent']
        }
        logger.info(f"Request Headers: {formatted_headers}")
        logger.info(f"Payload: {heartbeat_payload}")

        response = requests.post(
            api_url,
            headers=headers,
            json=heartbeat_payload,
            timeout=10
        )

        if response.status_code >= 400:
            logger.error(f"Failed to send heartbeat: {response.status_code}")
            logger.error(f"Response: {response.text}")
            return False

        logger.info("Heartbeat sent successfully")
        logger.debug(f"Response: {response.text}")
        return True
    except Exception as e:
        logger.error(f"Error sending heartbeat: {str(e)}")
        return False

def poll_hackatime_data():
    """Main function to poll for Hackatime data and send heartbeats"""
    # Poll logic would go here
    pass

if __name__ == "__main__":
    logger.info("Hackatime service started")
    # Service startup logic would go here


import os
import time
import hashlib
import logging
import requests
from flask import Flask, request, jsonify
from functools import wraps
from flask_cors import CORS

# Set up logging
logging.basicConfig(level=logging.INFO, 
                   format='[%(asctime)s] [%(levelname)s] %(message)s',
                   datefmt='%Y-%m-%d %H:%M:%S')
logger = logging.getLogger('hackatime_service')

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Rate limiter for API endpoints
class RateLimiter:
    def __init__(self):
        self.requests = {}
        self.limits = {
            'default': {'requests': 4500, 'window': 60},  # 4500 requests per minute
            'heartbeat': {'requests': 3000, 'window': 60}  # 3000 heartbeats per minute
        }

    def is_rate_limited(self, key, limit_type='default'):
        current_time = time.time()
        limit_config = self.limits.get(limit_type, self.limits['default'])

        if key not in self.requests:
            self.requests[key] = []

        # Remove old requests outside the window
        self.requests[key] = [t for t in self.requests[key] 
                            if current_time - t < limit_config['window']]

        # Check if exceeded limit
        if len(self.requests[key]) >= limit_config['requests']:
            return True

        # Add current request
        self.requests[key].append(current_time)
        return False

rate_limiter = RateLimiter()

def rate_limit(limit_type='default'):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            ip_address = request.remote_addr

            if rate_limiter.is_rate_limited(ip_address, limit_type):
                logger.warning(f"Rate limit exceeded for IP: {ip_address}")
                return jsonify({
                    'success': False, 
                    'message': 'Rate limit exceeded. Please try again later.'
                }), 429

            return f(*args, **kwargs)
        return decorated_function
    return decorator

@app.route('/health', methods=['GET'])
def health_check():
    """Simple health check endpoint"""
    return jsonify({'status': 'ok', 'service': 'hackatime-service'}), 200

@app.route('/status', methods=['GET'])
def hackatime_status():
    """Check if user has a Hackatime API key connected"""
    try:
        # This would normally check the database
        # For this simplified version, we'll check if the API key exists in the request
        api_key = request.headers.get('X-Hackatime-Key')

        if api_key:
            # Validate by making a simple request to Hackatime API
            return jsonify({'success': True, 'connected': True})
        else:
            return jsonify({'success': True, 'connected': False})
    except Exception as e:
        logger.error(f'Error checking Hackatime status: {str(e)}')
        return jsonify({
            'success': False,
            'connected': False,
            'message': f'Failed to check Hackatime status: {str(e)}'
        })

@app.route('/heartbeat', methods=['POST'])
@rate_limit('heartbeat')
def hackatime_heartbeat():
    """Send a heartbeat to Hackatime API with metadata"""
    try:
        # Get API key from headers
        api_key = request.headers.get('X-Hackatime-Key')
        if not api_key:
            logger.warning("Attempted to send heartbeat without API key")
            return jsonify({
                'success': False,
                'message': 'No Hackatime API key provided'
            }), 403

        # Get heartbeat data from request
        data = request.get_json()
        if not data:
            return jsonify({
                'success': False,
                'message': 'No heartbeat data provided'
            }), 400

        # Prepare the heartbeat data
        if isinstance(data, dict):
            heartbeat_payload = [data]  # Single heartbeat
        elif isinstance(data, list):
            heartbeat_payload = data    # Multiple heartbeats
        else:
            return jsonify({
                'success': False,
                'message': 'Invalid heartbeat data format'
            }), 400

        # Ensure all heartbeats have required fields
        current_time = int(time.time())
        machine_id = f"machine_{hashlib.md5(request.remote_addr.encode()).hexdigest()[:8]}"
        user_agent = request.headers.get('User-Agent', 'Spaces IDE')

        # Default values for heartbeat
        default_heartbeat = {
            "entity": "main.py",
            "type": "file",
            "time": current_time,
            "category": "coding",
            "project": "Hack Club Spaces",
            "branch": "main",
            "language": "Python",
            "is_write": True,
            "lines": 150,
            "lineno": 1,
            "cursorpos": 0,
            "line_additions": 0,
            "line_deletions": 0,
            "project_root_count": 1,
            "dependencies": "flask,sqlalchemy,python-dotenv",
            "machine": machine_id,
            "editor": "Spaces",
            "operating_system": "Web",
            "user_agent": user_agent
        }

        # Apply default values to each heartbeat
        for i, hb in enumerate(heartbeat_payload):
            complete_hb = default_heartbeat.copy()
            complete_hb.update(hb)
            heartbeat_payload[i] = complete_hb

        # Send heartbeat to Hackatime API
        api_url = "https://hackatime.hackclub.com/api/hackatime/v1/users/current/heartbeat.bulk"

        headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
            'User-Agent': user_agent
        }

        # Log detailed request information
        logger.info(f"Sending heartbeat to Hackatime API: {api_url}")
        # Format headers for better readability in logs
        formatted_headers = {
            'Authorization': f'Bearer {api_key[:5]}...{api_key[-5:]}',  # Mask most of the API key for security
            'Content-Type': headers['Content-Type'],
            'User-Agent': headers['User-Agent']
        }
        logger.info(f"Request Headers: {formatted_headers}")
        logger.info(f"Payload: {heartbeat_payload}")

        response = requests.post(
            api_url,
            headers=headers,
            json=heartbeat_payload,
            timeout=10
        )

        logger.info(f"Hackatime API response status: {response.status_code}")
        logger.info(f"Response headers: {dict(response.headers)}")
        logger.info(f"Response content: {response.text[:500]}")

        if response.status_code >= 400:
            error_text = response.text
            logger.error(f"Hackatime heartbeat failed: {response.status_code} - {error_text}")
            return jsonify({
                'success': False,
                'message': f'Heartbeat failed with status code {response.status_code}',
                'details': error_text
            }), response.status_code

        # Try to parse the response
        try:
            response_data = response.json()
            return jsonify({
                'success': True,
                'message': 'Heartbeat sent successfully',
                'response': response_data
            })
        except:
            # If we can't parse JSON but status code was good, still return success
            return jsonify({
                'success': True,
                'message': 'Heartbeat sent successfully'
            })

    except Exception as e:
        logger.error(f'Error sending Hackatime heartbeat: {str(e)}')
        return jsonify({
            'success': False,
            'message': f'Failed to send heartbeat: {str(e)}'
        }), 500

@app.route('/connect', methods=['POST'])
def hackatime_connect():
    """Connect Hackatime account by validating API key"""
    try:
        data = request.get_json()
        api_key = data.get('api_key')

        if not api_key:
            return jsonify({
                'success': False,
                'message': 'API key is required'
            })

        # Validate the API key by making a request to the Hackatime API
        api_url = "https://hackatime.hackclub.com/api/hackatime/v1/users/current/heartbeats"

        headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        }

        # Simple test heartbeat
        current_time = int(time.time())
        test_data = [{
            "type": "file",
            "time": current_time,
            "entity": "test.txt",
            "language": "Text"
        }]

        logger.info(f"Testing Hackatime API key")

        response = requests.post(
            api_url,
            headers=headers,
            json=test_data,
            timeout=5
        )

        logger.info(f"API validation response: {response.status_code}")

        if response.status_code >= 400:
            # Try an alternative endpoint as backup validation
            alternative_endpoint = "https://hackatime.hackclub.com/api/hackatime/v1/users/current"
            alternative_response = requests.get(
                alternative_endpoint,
                headers=headers,
                timeout=5
            )

            if alternative_response.status_code >= 400:
                logger.error(f"API key validation failed")
                return jsonify({
                    'success': False,
                    'message': 'Invalid API key. Please check your API key and try again.'
                })

        # If we get here, the API key is valid
        logger.info(f"API key validation successful")

        return jsonify({
            'success': True,
            'message': 'Hackatime account connected successfully'
        })

    except Exception as e:
        logger.error(f'Error connecting Hackatime: {str(e)}')
        return jsonify({
            'success': False,
            'message': f'Failed to connect Hackatime: {str(e)}'
        })

@app.route('/disconnect', methods=['POST'])
def hackatime_disconnect():
    """Disconnect Hackatime account"""
    try:
        # In a real app, this would remove the API key from the database
        return jsonify({
            'success': True,
            'message': 'Hackatime account disconnected successfully'
        })
    except Exception as e:
        logger.error(f'Error disconnecting Hackatime: {str(e)}')
        return jsonify({
            'success': False,
            'message': f'Failed to disconnect Hackatime: {str(e)}'
        })

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 3001))
    logger.info(f"Starting Hackatime service on port {port}")
    app.run(host='0.0.0.0', port=port, debug=True)