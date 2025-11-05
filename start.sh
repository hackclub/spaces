#!/bin/bash

# Enable IP forwarding for nested containers
echo 1 > /proc/sys/net/ipv4/ip_forward

# Configure iptables for NAT to allow nested containers internet access
iptables -t nat -A POSTROUTING -s 172.17.0.0/16 ! -o docker0 -j MASQUERADE 2>/dev/null || true
iptables -t nat -A POSTROUTING -s 172.18.0.0/16 ! -o docker0 -j MASQUERADE 2>/dev/null || true

if docker info >/dev/null 2>&1; then
    echo "Docker is available."
else
    echo "Warning: Docker not available. Make sure Docker is running."
fi

# Start all services with supervisor
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf