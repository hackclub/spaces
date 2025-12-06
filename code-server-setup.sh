#!/bin/bash

# runs inside of created code-server containers, installs essential dev tools by default 
# Usage: ./code-server-setup.sh [HACKATIME_API_KEY]

set -e  

HACKATIME_API_KEY="${1:-}"

echo "Starting development environment setup..."

# Set up Hackatime if API key is provided
if [ -n "$HACKATIME_API_KEY" ]; then
  echo "⏱️ Setting up Hackatime..."
  export HACKATIME_API_KEY="$HACKATIME_API_KEY"
  export HACKATIME_API_URL="https://hackatime.hackclub.com/api/hackatime/v1"
  export SUCCESS_URL="https://hackatime.hackclub.com//success.txt"
  curl -sSL https://hackatime.hackclub.com/hackatime/setup.sh | bash
fi

echo "Updating package manager..."
sudo apt update && sudo apt upgrade -y

sudo apt install -y wget
wget -O /config/workspace/README.md https://raw.githubusercontent.com/hackclub/spaces/refs/heads/main/in-space.md

echo "Installing essential system tools..."
sudo apt install -y \
    curl \
    git \
    nano \
    unzip \
    build-essential \
    apt-transport-https \
    ca-certificates \
    gnupg 

echo "🐍 Setting up Python environment..."
sudo apt install -y \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    python3-setuptools


echo "📗 Setting up Node.js..."
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs

echo "🧶 Installing Yarn..."
curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | sudo apt-key add -
echo "deb https://dl.yarnpkg.com/debian/ stable main" | sudo tee /etc/apt/sources.list.d/yarn.list
sudo apt update && sudo apt install -y yarn

echo "setting up gh cli"
(type -p wget >/dev/null || (sudo apt update && sudo apt install wget -y)) \
	&& sudo mkdir -p -m 755 /etc/apt/keyrings \
	&& out=$(mktemp) && wget -nv -O$out https://cli.github.com/packages/githubcli-archive-keyring.gpg \
	&& cat $out | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
	&& sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
	&& sudo mkdir -p -m 755 /etc/apt/sources.list.d \
	&& echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
	&& sudo apt update \
	&& sudo apt install gh -y

echo "☕ Setting up Java..."
sudo apt install -y openjdk-17-jdk openjdk-17-jre

echo "🔵 Setting up Go..."
GO_VERSION="1.21.4"
wget "https://golang.org/dl/go${GO_VERSION}.linux-amd64.tar.gz"
sudo rm -rf /usr/local/go
sudo tar -C /usr/local -xzf "go${GO_VERSION}.linux-amd64.tar.gz"
rm "go${GO_VERSION}.linux-amd64.tar.gz"

echo "🦀 Setting up Rust..."
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"

echo "💎 Setting up Ruby..."
sudo apt install -y ruby-full

echo "🐘 Setting up PHP..."
sudo apt install -y \
    php \
    php-cli \
    php-common \
    php-curl \
    php-json \
    php-mbstring \
    php-xml \
    php-zip

curl -sS https://getcomposer.org/installer | php
sudo mv composer.phar /usr/local/bin/composer

# Database tools
echo "🗄️ Setting up database tools..."
sudo apt install -y \
    sqlite3 \
    postgresql-client \
    mysql-client

# Extras
echo "Seting up extras"
curl -LsSf https://astral.sh/uv/install.sh | sh
sudo apt install crystal -y
gem install rails 
sudo npm install pnpm

# Final cleanup
echo "🧹 Cleaning up..."
sudo apt autoremove -y
sudo apt autoclean

