
import requests
import json
import os
import traceback
from flask import request, current_app

# Get API key from environment variable
LOGFLOW_API_KEY = os.environ.get('LOGFLOW_API_KEY', 'ea51fb31a2df447a9c4045dba181c567')
LOGFLOW_URL = 'https://logflow.lol/api/errors'

def log_error(error, error_type=None, source=None, metadata=None):
    """
    Log error to LogFlow.lol service
    
    Args:
        error: The error object or message
        error_type: Type of error (e.g., 'DatabaseError', 'AuthError')
        source: Source of the error (e.g., 'payment-service', 'auth-service')
        metadata: Additional information about the error context
    
    Returns:
        error_id: The ID of the logged error from LogFlow
    """
    try:
        # Get error message and stack trace
        if isinstance(error, Exception):
            message = str(error)
            stack_trace = ''.join(traceback.format_exception(type(error), error, error.__traceback__))
        else:
            message = str(error)
            stack_trace = ''.join(traceback.format_stack())
            
        # Default error type if not provided
        if not error_type:
            error_type = error.__class__.__name__ if isinstance(error, Exception) else 'GenericError'
            
        # Default source
        if not source:
            source = 'spaces-app'
            
        # Default metadata
        if not metadata:
            metadata = {}
            
        # Add request information if available
        try:
            if request:
                metadata.update({
                    'url': request.url,
                    'method': request.method,
                    'ip': request.remote_addr,
                    'user_agent': request.user_agent.string,
                    'referrer': request.referrer
                })
        except:
            pass
            
        # Add timestamp
        from datetime import datetime
        metadata['timestamp'] = datetime.utcnow().isoformat()
        
        # Prepare payload
        payload = {
            'message': message,
            'type': error_type,
            'stack_trace': stack_trace,
            'source': source,
            'metadata': metadata
        }
        
        # Send to LogFlow
        response = requests.post(
            LOGFLOW_URL,
            headers={
                'Content-Type': 'application/json',
                'X-API-Key': LOGFLOW_API_KEY
            },
            json=payload,
            timeout=3  # Set a timeout to avoid blocking the app
        )
        
        # Parse response
        if response.status_code == 200:
            result = response.json()
            error_id = result.get('error_id')
            
            # Also log to application logger
            if hasattr(current_app, 'logger'):
                current_app.logger.error(f"Error logged to LogFlow with ID: {error_id}")
                
            return error_id
        else:
            if hasattr(current_app, 'logger'):
                current_app.logger.error(f"Failed to log to LogFlow: {response.text}")
            return None
            
    except Exception as e:
        # Don't let logging errors crash the application
        if hasattr(current_app, 'logger'):
            current_app.logger.error(f"Error in log_error function: {str(e)}")
        return None
