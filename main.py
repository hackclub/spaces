import os
import logging
import subprocess
import signal
import atexit
import socket
from flask import render_template
from app import app, db
from better_stack_logger import setup_betterstack_logging

# Configure logging - reduced verbosity
logging.basicConfig(
    level=logging.WARNING,
    format='[%(asctime)s] [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

# Create console handler with a higher log level
console_handler = logging.StreamHandler()
console_handler.setLevel(logging.WARNING)
formatter = logging.Formatter('[%(asctime)s] [%(levelname)s] %(message)s')
console_handler.setFormatter(formatter)

# Add the handlers to the logger
app.logger.addHandler(console_handler)
app.logger.setLevel(logging.WARNING)

# Setup BetterStack logging if enabled
if os.environ.get('BETTERSTACK_TOKEN') and os.environ.get('BETTERSTACK_URL'):
    # Check if BetterStack is enabled in system settings
    with app.app_context():
        try:
            with db.engine.connect() as conn:
                result = conn.execute(
                    db.text("SELECT value FROM system_settings WHERE key = 'betterstack_enabled'")
                )
                enabled = result.fetchone()
                if enabled and enabled[0].lower() == 'true':
                    result = conn.execute(
                        db.text("SELECT value FROM system_settings WHERE key = 'betterstack_log_level'")
                    )
                    log_level = result.fetchone()
                    log_level = log_level[0] if log_level else 'WARNING'
                    log_level_int = getattr(logging, log_level)
                    
                    # Setup BetterStack logging
                    betterstack_handler = setup_betterstack_logging(app, log_level_int)
                    
                    # Log startup information
                    hostname = socket.gethostname()
                    ip_address = socket.gethostbyname(hostname)
                    app.logger.warning(f"Application starting on {hostname} ({ip_address})")
        except Exception as e:
            print(f"Error setting up BetterStack logging: {str(e)}")
            # Continue without BetterStack logging

# Global variable to store the Hackatime service process
hackatime_process = None

def initialize_database():
    """Initialize the database and create all tables."""
    try:
        app.logger.info("Initializing database...")
        with app.app_context():
            db.create_all()
        app.logger.info("Database initialized successfully.")
        return True
    except Exception as e:
        app.logger.warning(f"Database initialization error: {e}")
        return False

def start_hackatime_service():
    """Start the Hackatime service as a subprocess."""
    global hackatime_process
    try:
        app.logger.info("Starting Hackatime service...")
        hackatime_process = subprocess.Popen(
            ['python', 'hackatime_service.py'],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        app.logger.info(f"Hackatime service started with PID {hackatime_process.pid}")
    except Exception as e:
        app.logger.error(f"Error starting Hackatime service: {str(e)}")

def stop_hackatime_service():
    """Stop the Hackatime service when the main app exits."""
    global hackatime_process
    if hackatime_process and hackatime_process.poll() is None:
        app.logger.info(f"Stopping Hackatime service (PID {hackatime_process.pid})...")
        try:
            hackatime_process.send_signal(signal.SIGTERM)
            hackatime_process.wait(timeout=5)
            app.logger.info("Hackatime service stopped gracefully")
        except subprocess.TimeoutExpired:
            app.logger.warning("Timeout waiting for service to stop, forcing termination")
            hackatime_process.kill()
        except Exception as e:
            app.logger.error(f"Error stopping service: {str(e)}")
            hackatime_process.kill()

@app.route('/support')
def support():
    return render_template('support.html')

if __name__ == '__main__':
    app.logger.info("Starting Hack Club Spaces application")

    # Initialize database
    try:
        initialize_database()
    except Exception as e:
        app.logger.warning(f"Database initialization error: {e}")

    # Start Hackatime service
    start_hackatime_service()

    # Register the cleanup function to stop Hackatime service on exit
    atexit.register(stop_hackatime_service)

    # Start the main Flask application
    port = int(os.environ.get('PORT', 3000))
    app.logger.info(f"Server running on http://0.0.0.0:{port}")
    app.run(host='0.0.0.0', port=port, debug=True)


