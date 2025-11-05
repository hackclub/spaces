# Use Ubuntu as base image for better Docker-in-Docker support
FROM ubuntu:22.04

# Avoid prompts from apt
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies including Docker
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    gnupg \
    lsb-release \
    ca-certificates \
    apt-transport-https \
    software-properties-common \
    supervisor \
    nginx \
    iptables \
    && rm -rf /var/lib/apt/lists/*

# Install Docker Engine for Docker-in-Docker
RUN mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null \
    && apt-get update \
    && apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 18.x
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY client/package*.json ./client/

# Install dependencies
RUN npm install
RUN cd client && npm install

# Copy application code
COPY . .

# Copy nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Create supervisor configuration
RUN mkdir -p /var/log/supervisor
COPY <<EOF /etc/supervisor/conf.d/supervisord.conf
[supervisord]
nodaemon=true
user=root

[program:dockerd]
command=dockerd --host=unix:///var/run/docker.sock --host=tcp://0.0.0.0:2376 --storage-driver=overlay2 --iptables=true --ip-forward=true --ip-masq=true
autostart=true
autorestart=true
stderr_logfile=/var/log/supervisor/dockerd.err.log
stdout_logfile=/var/log/supervisor/dockerd.out.log
priority=100

[program:docker-pull]
command=/bin/bash -c "sleep 25 && docker pull linuxserver/code-server && docker pull linuxserver/blender && docker pull linuxserver/kicad && echo 'Docker images pulled successfully'"
autostart=true
autorestart=false
startsecs=0
stderr_logfile=/var/log/supervisor/docker-pull.err.log
stdout_logfile=/var/log/supervisor/docker-pull.out.log
priority=150

[program:dev-server]
command=npm run dev
directory=/app
autostart=true
autorestart=true
stderr_logfile=/var/log/supervisor/dev-server.err.log
stdout_logfile=/var/log/supervisor/dev-server.out.log
environment=NODE_ENV=development
priority=200

[program:nginx]
command=nginx -g "daemon off;"
autostart=true
autorestart=true
stderr_logfile=/var/log/supervisor/nginx.err.log
stdout_logfile=/var/log/supervisor/nginx.out.log
priority=400
EOF

# Copy and setup startup script
COPY start.sh /app/start.sh
RUN sed -i 's/\r$//' /app/start.sh && chmod +x /app/start.sh

# Expose ports
EXPOSE 80 3000 5173

# Set environment variables
ENV NODE_ENV=development
ENV DOCKER_HOST=unix:///var/run/docker.sock
ENV DOCKER_TLS_CERTDIR=""

# Use the startup script as entrypoint
ENTRYPOINT ["/app/start.sh"]