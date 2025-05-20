
import json
import os
import time
from datetime import datetime
import threading

class LogsManager:
    _instance = None
    _lock = threading.Lock()
    
    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super(LogsManager, cls).__new__(cls)
                cls._instance.logs = []
                cls._instance.max_logs = 1000  # Maximum number of log entries to keep
                cls._instance.last_cleared = datetime.utcnow()
                # Start the automatic log clearing thread
                cls._start_auto_clear_thread()
            return cls._instance
            
    @classmethod
    def _start_auto_clear_thread(cls):
        """Start a background thread to automatically clear logs every 30 minutes"""
        def auto_clear_worker():
            while True:
                # Sleep for 30 minutes (1800 seconds)
                time.sleep(1800)
                try:
                    # Clear the logs
                    if cls._instance:
                        print(f"Auto-clearing logs at {datetime.utcnow().isoformat()}")
                        cls._instance.clear_logs()
                        cls._instance.add_log("Logs automatically cleared", level="INFO", source="system")
                        cls._instance.last_cleared = datetime.utcnow()
                except Exception as e:
                    print(f"Error in auto-clear thread: {str(e)}")
        
        # Create and start the thread as daemon so it doesn't block program exit
        clear_thread = threading.Thread(target=auto_clear_worker, daemon=True)
        clear_thread.start()
    
    def add_log(self, message, level="INFO", source="system"):
        """Add a log entry"""
        log_entry = {
            "timestamp": datetime.utcnow().isoformat(),
            "message": message,
            "level": level,
            "source": source
        }
        
        # Maintain max logs limit
        if len(self.logs) >= self.max_logs:
            self.logs.pop(0)
            
        self.logs.append(log_entry)
    
    def get_logs(self):
        """Get all logs"""
        return self.logs
    
    def clear_logs(self):
        """Clear all logs"""
        self.logs = []
    
    def save_logs(self, filepath="logs.json"):
        """Save logs to file"""
        try:
            with open(filepath, 'w') as f:
                json.dump(self.logs, f, indent=2)
            return True
        except Exception as e:
            print(f"Error saving logs: {str(e)}")
            return False

# Initialize singleton instance
logs_manager = LogsManager()
