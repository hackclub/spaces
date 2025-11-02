#!/bin/bash

if docker info >/dev/null 2>&1; then
    echo "Docker is available."
else
    echo "Warning: Docker not available. Make sure Docker is running."
fi

# Start all services with supervisor
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf