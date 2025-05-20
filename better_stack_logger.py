
import os
import sys
import logging
import json
import traceback
import requests
from datetime import datetime
from flask import request, current_app

class BetterStackHandler(logging.Handler):
    def __init__(self, token=None, url=None, source_id=None):
        super().__init__()
        self.token = token or os.environ.get('BETTERSTACK_TOKEN')
        self.url = url or os.environ.get('BETTERSTACK_URL')
        self.source_id = source_id or os.environ.get('BETTERSTACK_SOURCE_ID')
        
        if not self.token or not self.url:
            self.enabled = False
            print("BetterStack logging disabled: Missing token or URL")
        else:
            self.enabled = True
            print(f"BetterStack logging enabled: {self.url}")
            
        # Custom log levels mapping
        self.level_mapping = {
            "1": logging.DEBUG,  # Level 1: Everything in console (DEBUG and above)
            "2": logging.WARNING,  # Level 2: Warnings and errors (WARNING and above)
            "3": logging.ERROR,  # Level 3: Only errors (ERROR and above)
        }
    
    def emit(self, record):
        if not self.enabled:
            return
        
        try:
            # Format the record
            log_entry = self.format_log_entry(record)
            
            # Send to BetterStack
            headers = {
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {self.token}'
            }
            
            response = requests.post(
                self.url,
                headers=headers,
                json=log_entry
            )
            
            if response.status_code != 202:
                sys.stderr.write(f"Failed to send log to BetterStack: {response.status_code} - {response.text}\n")
        except Exception as e:
            sys.stderr.write(f"Error sending log to BetterStack: {str(e)}\n")

    def format_log_entry(self, record):
        # Get exception info if it exists
        exc_info = None
        if record.exc_info:
            exc_type, exc_value, exc_tb = record.exc_info
            exc_info = {
                'type': exc_type.__name__ if exc_type else None,
                'message': str(exc_value) if exc_value else None,
                'traceback': traceback.format_exception(*record.exc_info) if record.exc_info else None
            }
        
        # Get request info if available
        req_info = {}
        try:
            if request:
                req_info = {
                    'ip': request.remote_addr,
                    'method': request.method,
                    'path': request.path,
                    'user_agent': request.user_agent.string if request.user_agent else None
                }
        except:
            # Request context might not be available
            pass
            
        # Construct the log entry
        log_entry = {
            'dt': datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC'),
            'message': record.getMessage(),
            'level': record.levelname,
            'logger': record.name,
            'source_id': self.source_id,
            'context': {
                'file': record.pathname,
                'line': record.lineno,
                'function': record.funcName,
                'request': req_info,
                'exception': exc_info
            }
        }
        
        return log_entry

def setup_betterstack_logging(app=None, level=logging.WARNING, level_str=None):
    """
    Set up BetterStack logging for a Flask application
    
    Args:
        app: Flask application instance
        level: Python logging level (used as fallback)
        level_str: Custom level string ("1", "2", or "3")
    """
    handler = BetterStackHandler()
    
    # Map custom level string to Python logging level if provided
    if level_str in handler.level_mapping:
        level = handler.level_mapping[level_str]
    
    handler.setLevel(level)
    
    # Create a formatter
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    handler.setFormatter(formatter)
    
    # Add the handler to the application logger
    if app:
        app.logger.addHandler(handler)
        
        # Also log uncaught exceptions
        if not app.debug:
            @app.errorhandler(Exception)
            def handle_exception(e):
                app.logger.exception("Uncaught exception: %s", str(e))
                # Continue with the default handler
                return app.handle_exception(e)
    
    # Add to root logger to catch all logs
    root_logger = logging.getLogger()
    root_logger.addHandler(handler)
    
    return handler
