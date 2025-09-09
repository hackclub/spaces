from functools import wraps
from flask import request, abort
import time

_request_times = {}

def rate_limit(action, limit=5, per=60):
    """
    Rate limit decorator.
    :param action: a string identifier for the action (e.g. 'login')
    :param limit: max number of requests allowed
    :param per: time window in seconds
    """
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            now = time.time()
            client_id = f"{request.remote_addr}:{action}"
            times = _request_times.get(client_id, [])

            times = [t for t in times if now - t < per]

            if len(times) >= limit:
                abort(429, description="Too Many Requests")

            times.append(now)
            _request_times[client_id] = times

            return f(*args, **kwargs)
        return wrapper
    return decorator
