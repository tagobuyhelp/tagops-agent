# TAGOPS Agent (`tagops-agent`)

The **TAGOPS Agent** is the remote execution engine for the TAGOPS Platform. It is a lightweight, high-performance Node.js daemon designed to run directly on your Linux VPS. 

It acts as the secure bridge between your servers and the TAGOPS Dashboard, enabling real-time infrastructure management, application deployment, and system telemetry—all driven by WebSockets.

---

## 🚀 Features

- **App Lifecycle Management:** Seamlessly deploy, start, stop, restart, and delete PM2 Node.js applications directly from the dashboard.
- **Auto-SSL & Reverse Proxy:** Automatically maps custom domains to your apps and provisions Let's Encrypt SSL certificates via Nginx.
- **Security & Firewall (UFW):** View open ports and actively manage UFW firewall rules without SSHing into the server.
- **Database Provisioning:** Automated MongoDB database and user creation.
- **Cron Job Manager:** View, create, and delete automated server tasks (crontabs).
- **Real-Time Telemetry:** Streams live CPU, RAM, Disk usage, open ports, and live application logs back to the dashboard.

---

## 🛠️ Architecture

The Agent operates on a **Pull/Push WebSocket Architecture**:
1. It connects outwardly to the central `tagops-socket-relay`.
2. It pushes system metrics (`si`, `pm2`, `ufw`, `mongo`) every 5 seconds.
3. It listens for commands (e.g., `deployment:trigger`, `nginx:map`, `ufw:action`) relayed from the dashboard.
4. It executes these commands natively on the Linux shell and streams back a live deployment log.

---

## 📦 Installation

To make installation as simple as possible, an automated bash script is provided. This script will install Node.js, NPM, PM2, and recommended infrastructure packages (Nginx, Certbot, UFW).

1. **Copy the Agent to your VPS**
   Upload the `tagops-agent` folder to your server (e.g., to `/var/www/tagops-agent`).

2. **Run the Installer**
   ```bash
   cd /var/www/tagops-agent
   chmod +x install.sh
   ./install.sh
   ```

3. **Configure the Environment**
   Create a `.env` file in the root of the project to identify the server and link it to your relay:
   ```env
   SERVER_NAME=Production-VPS-1
   SOCKET_SERVER_URL=http://<YOUR_SOCKET_SERVER_IP>:8001
   ```

4. **Start the Agent**
   Boot up the agent using PM2 so it stays alive in the background and restarts on system reboot.
   ```bash
   pm2 start index.js --name tagops-agent
   pm2 save
   pm2 startup
   ```

---

## 💻 Local Development (Windows Mock Mode)

The Agent relies heavily on Linux-native tools (`pm2`, `ufw`, `certbot`, `crontab`). However, if you run the Agent on a Windows machine (`win32`), it automatically enters **Windows Mock Mode**. 

In this mode, the Agent will safely stream simulated telemetry (Mock Databases, Mock Firewall Rules) and bypass execution of destructive shell commands, instead streaming a mock log trace. This allows you to safely build and test the Dashboard UI locally before deploying to a real Linux environment.

---

## 📄 License
ISC
