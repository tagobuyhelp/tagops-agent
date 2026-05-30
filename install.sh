#!/bin/bash

# TAGOPS Agent Installation Script for Ubuntu/Debian

echo "======================================"
echo "   Starting TAGOPS Agent Installer    "
echo "======================================"

# 1. System Updates
echo "[1/6] Updating system packages..."
sudo apt update -y && sudo apt upgrade -y

# 2. Install Node.js & NPM
echo "[2/6] Installing Node.js..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
else
    echo "Node.js is already installed. Skipping."
fi

# 3. Install Global Dependencies
echo "[3/6] Installing PM2..."
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
else
    echo "PM2 is already installed. Skipping."
fi

# 4. Install Infrastructure Dependencies (Optional but recommended)
echo "[4/6] Checking Infrastructure Dependencies (Nginx, UFW, Certbot)..."
DEPS_TO_INSTALL=""
if ! command -v nginx &> /dev/null; then DEPS_TO_INSTALL+="nginx "; fi
if ! command -v ufw &> /dev/null; then DEPS_TO_INSTALL+="ufw "; fi
if ! command -v certbot &> /dev/null; then DEPS_TO_INSTALL+="certbot python3-certbot-nginx "; fi

if [ ! -z "$DEPS_TO_INSTALL" ]; then
    echo "Installing missing dependencies: $DEPS_TO_INSTALL"
    sudo apt install -y $DEPS_TO_INSTALL
else
    echo "All infrastructure dependencies are already installed. Skipping."
fi

# 5. Setup Agent Environment
echo "[5/6] Setting up TAGOPS Agent..."
npm install

echo "======================================"
echo "Installation Complete!"
echo "Next Steps:"
echo "1. Create a .env file in this directory with:"
echo "   SERVER_NAME=My-Production-VPS"
echo "   SOCKET_SERVER_URL=http://<YOUR_SOCKET_SERVER_IP>:8001"
echo ""
echo "2. Start the Agent in the background:"
echo "   pm2 start index.js --name tagops-agent"
echo "   pm2 save"
echo "   pm2 startup"
echo "======================================"
