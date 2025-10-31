#!/bin/bash

# Check if Docker is available (from host system)
if docker info >/dev/null 2>&1; then
    echo "Docker is available from host system!"
else
    echo "Warning: Docker not available. Make sure Docker socket is mounted."
fi

# Start all services with supervisor
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf