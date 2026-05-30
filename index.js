require('dotenv').config();
const si = require('systeminformation');
const { io } = require('socket.io-client');
const pm2 = require('pm2');
const path = require('path');
const fs = require('fs');

// Connect to PM2
pm2.connect((err) => {
  if (err) {
    console.error('Could not connect to PM2:', err);
  } else {
    console.log('Connected to PM2');
  }
});

const SOCKET_URL = process.env.SOCKET_SERVER_URL || 'http://localhost:8001';
const SERVER_NAME = process.env.SERVER_NAME || 'Unknown Server';
const TOKEN = process.env.AGENT_TOKEN;

const socket = io(SOCKET_URL);

console.log(`Starting TAGOPS Agent for server: ${SERVER_NAME}`);

socket.on('connect', () => {
  console.log(`Connected to Socket Server: ${SOCKET_URL}`);
  socket.emit('agent:register', { serverName: SERVER_NAME, token: TOKEN });
});

socket.on('disconnect', () => {
  console.log('Disconnected from Socket Server');
});

socket.on('deployment:trigger', ({ appName }) => {
  pm2.describe(appName, (err, processDescription) => {
    if (err || !processDescription || processDescription.length === 0) {
      socket.emit('deployment:log', { serverName: SERVER_NAME, appName, log: `Error: Could not find PM2 app ${appName}\n` });
      socket.emit('deployment:end', { serverName: SERVER_NAME, appName, success: false });
      return;
    }
    
    const appCwd = processDescription[0].pm2_env.pm_cwd;
    socket.emit('deployment:log', { serverName: SERVER_NAME, appName, log: `Starting deployment for ${appName} at ${appCwd}...\n` });

    const { spawn } = require('child_process');
    
    // Using spawn with cwd option is cross-platform and secure.
    const deployCommand = `git pull origin main || echo Skipped Git Pull && npm install --no-audit && pm2 restart ${appName}`;

    const deployProc = spawn(deployCommand, {
      shell: true,
      cwd: appCwd
    });
    let fullLog = '';

    deployProc.stdout.on('data', (data) => {
      fullLog += data.toString();
      socket.emit('deployment:log', { serverName: SERVER_NAME, appName, log: data.toString() });
    });

    deployProc.stderr.on('data', (data) => {
      fullLog += data.toString();
      socket.emit('deployment:log', { serverName: SERVER_NAME, appName, log: data.toString() });
    });

    deployProc.on('close', (code) => {
      const success = code === 0;
      const endLog = `\nDeployment finished with exit code ${code}.\n`;
      fullLog += endLog;
      socket.emit('deployment:log', { serverName: SERVER_NAME, appName, log: endLog });
      socket.emit('deployment:end', { serverName: SERVER_NAME, appName, success, fullLog });
    });
  });
});

socket.on('pm2:action', ({ appName, action }) => {
  if (['start', 'stop', 'restart', 'delete'].includes(action)) {
    pm2[action](appName, (err) => {
      if (err) {
        console.error(`Error executing ${action} on ${appName}:`, err);
      } else {
        console.log(`Successfully executed ${action} on ${appName}`);
      }
    });
  }
});

socket.on('app:create', (appData) => {
  const { appName, gitUrl, appType, entryFile, port, customInstall, customBuild, customStart } = appData;
  const appsDir = path.join(process.cwd(), 'apps');
  if (!fs.existsSync(appsDir)) fs.mkdirSync(appsDir, { recursive: true });
  
  const appCwd = path.join(appsDir, appName);
  
  socket.emit('deployment:log', { serverName: SERVER_NAME, appName, log: `Creating new app ${appName} from ${gitUrl} [Type: ${appType}]...\n` });

  const { spawn } = require('child_process');
  
  let deployCommand = `git clone ${gitUrl} ${appName} && cd ${appName} && `;
  
  if (appType === 'nextjs') {
    deployCommand += `npm install --no-audit && npm run build && pm2 start ./node_modules/next/dist/bin/next --name ${appName} -- start`;
  } else if (appType === 'react') {
    // Attempting to serve 'dist' first (Vite), fallback to 'build' (CRA) is hard in a one-liner, so we'll default to 'dist' and user can use Custom if needed.
    deployCommand += `npm install --no-audit && npm run build && pm2 serve dist ${port || 8080} --name ${appName} --spa`;
  } else if (appType === 'custom') {
    deployCommand += `${customInstall || 'npm install'} && ${customBuild ? customBuild + ' && ' : ''} ${customStart}`;
  } else {
    // node
    deployCommand += `npm install --no-audit && pm2 start ${entryFile || 'index.js'} --name ${appName}`;
  }

  const deployProc = spawn(deployCommand, {
    shell: true,
    cwd: appsDir
  });
  
  let fullLog = '';

  deployProc.stdout.on('data', (data) => {
    fullLog += data.toString();
    socket.emit('deployment:log', { serverName: SERVER_NAME, appName, log: data.toString() });
  });

  deployProc.stderr.on('data', (data) => {
    fullLog += data.toString();
    socket.emit('deployment:log', { serverName: SERVER_NAME, appName, log: data.toString() });
  });

  deployProc.on('close', (code) => {
    const success = code === 0;
    const endLog = `\nApp creation finished with exit code ${code}.\n`;
    fullLog += endLog;
    socket.emit('deployment:log', { serverName: SERVER_NAME, appName, log: endLog });
    socket.emit('deployment:end', { serverName: SERVER_NAME, appName, success, fullLog });
  });
});

socket.on('nginx:map', (data) => {
  const { appName, domain, port, enableSSL } = data;
  socket.emit('deployment:log', { serverName: SERVER_NAME, appName, log: `Starting Nginx config generation for ${domain} -> Port ${port}...\n` });

  const isWindows = process.platform === 'win32';
  
  if (isWindows) {
    socket.emit('deployment:log', { serverName: SERVER_NAME, appName, log: `[WINDOWS DEV MODE] Mocking Nginx configuration (Linux required for true automation).\n` });
    setTimeout(() => {
      socket.emit('deployment:log', { serverName: SERVER_NAME, appName, log: `Written /etc/nginx/sites-available/${domain}\nSymlinked to sites-enabled\nReloaded Nginx.\n` });
      if (enableSSL) {
        socket.emit('deployment:log', { serverName: SERVER_NAME, appName, log: `[WINDOWS DEV MODE] Mocking Let's Encrypt Certbot...\nSuccessfully provisioned SSL for ${domain}\n` });
      }
      socket.emit('deployment:log', { serverName: SERVER_NAME, appName, log: `\nDomain mapping finished successfully.\n` });
      socket.emit('deployment:end', { serverName: SERVER_NAME, appName, success: true, fullLog: '' });
    }, 2000);
    return;
  }

  // Linux Execution
  const nginxConfig = `server {
    listen 80;
    server_name ${domain};

    location / {
        proxy_pass http://localhost:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}`;

  const { exec } = require('child_process');
  const sitesAvailable = `/etc/nginx/sites-available/${domain}`;
  const sitesEnabled = `/etc/nginx/sites-enabled/${domain}`;

  fs.writeFile(sitesAvailable, nginxConfig, (err) => {
    if (err) {
      socket.emit('deployment:log', { serverName: SERVER_NAME, appName, log: `Error writing Nginx config: ${err.message}\n` });
      return socket.emit('deployment:end', { serverName: SERVER_NAME, appName, success: false });
    }
    
    socket.emit('deployment:log', { serverName: SERVER_NAME, appName, log: `Created Nginx config at ${sitesAvailable}\n` });

    // Symlink
    exec(`ln -sf ${sitesAvailable} ${sitesEnabled} && nginx -s reload`, (error, stdout, stderr) => {
      if (error) {
        socket.emit('deployment:log', { serverName: SERVER_NAME, appName, log: `Error reloading Nginx: ${stderr}\n` });
        return socket.emit('deployment:end', { serverName: SERVER_NAME, appName, success: false });
      }
      
      socket.emit('deployment:log', { serverName: SERVER_NAME, appName, log: `Symlinked and reloaded Nginx successfully.\n` });

      if (enableSSL) {
        socket.emit('deployment:log', { serverName: SERVER_NAME, appName, log: `Triggering Certbot for ${domain}...\n` });
        
        exec(`certbot --nginx -d ${domain} --non-interactive --agree-tos -m admin@${domain}`, (sslError, sslStdout, sslStderr) => {
          if (sslError) {
            socket.emit('deployment:log', { serverName: SERVER_NAME, appName, log: `SSL Provisioning failed: ${sslStderr}\n` });
          } else {
            socket.emit('deployment:log', { serverName: SERVER_NAME, appName, log: `SSL Provisioned successfully:\n${sslStdout}\n` });
          }
          socket.emit('deployment:log', { serverName: SERVER_NAME, appName, log: `\nDomain mapping finished.\n` });
          socket.emit('deployment:end', { serverName: SERVER_NAME, appName, success: !sslError, fullLog: '' });
        });
      } else {
        socket.emit('deployment:log', { serverName: SERVER_NAME, appName, log: `\nDomain mapping finished.\n` });
        socket.emit('deployment:end', { serverName: SERVER_NAME, appName, success: true, fullLog: '' });
      }
    });
  });
});

socket.on('ufw:action', (data) => {
  const { port, action } = data;
  socket.emit('deployment:log', { serverName: SERVER_NAME, appName: 'Firewall', log: `Executing UFW ${action} on port ${port}...\n` });

  if (process.platform === 'win32') {
    socket.emit('deployment:log', { serverName: SERVER_NAME, appName: 'Firewall', log: `[WINDOWS DEV MODE] Mocking UFW action: ${action} ${port}\n` });
    setTimeout(() => socket.emit('deployment:end', { serverName: SERVER_NAME, appName: 'Firewall', success: true }), 1500);
    return;
  }
  
  const { exec } = require('child_process');
  let cmd = `sudo ufw ${action} ${port}`;
  if (action === 'delete') cmd = `sudo ufw --force delete ${port}`;
  
  exec(cmd, (err, stdout, stderr) => {
    socket.emit('deployment:log', { serverName: SERVER_NAME, appName: 'Firewall', log: err ? stderr : stdout });
    socket.emit('deployment:end', { serverName: SERVER_NAME, appName: 'Firewall', success: !err });
  });
});

socket.on('mongo:action', (data) => {
  const { dbName, action } = data;
  socket.emit('deployment:log', { serverName: SERVER_NAME, appName: 'Database', log: `Executing Mongo ${action} on database ${dbName}...\n` });

  if (process.platform === 'win32') {
    socket.emit('deployment:log', { serverName: SERVER_NAME, appName: 'Database', log: `[WINDOWS DEV MODE] Mocking Mongo action: ${action} database ${dbName}\n` });
    setTimeout(() => socket.emit('deployment:end', { serverName: SERVER_NAME, appName: 'Database', success: true }), 1500);
    return;
  }

  const { exec } = require('child_process');
  let cmd = '';
  if (action === 'create') {
    cmd = `mongosh ${dbName} --eval "db.init.insert({created_at: new Date()})"`;
  } else if (action === 'drop') {
    cmd = `mongosh ${dbName} --eval "db.dropDatabase()"`;
  }
  
  exec(cmd, (err, stdout, stderr) => {
    socket.emit('deployment:log', { serverName: SERVER_NAME, appName: 'Database', log: err ? stderr : stdout });
    socket.emit('deployment:end', { serverName: SERVER_NAME, appName: 'Database', success: !err });
  });
});

socket.on('cron:action', (data) => {
  const { schedule, command, action } = data;
  socket.emit('deployment:log', { serverName: SERVER_NAME, appName: 'Cron Job', log: `Executing Cron ${action} for ${schedule} ${command}...\n` });

  if (process.platform === 'win32') {
    socket.emit('deployment:log', { serverName: SERVER_NAME, appName: 'Cron Job', log: `[WINDOWS DEV MODE] Mocking Cron action: ${action}\n` });
    setTimeout(() => socket.emit('deployment:end', { serverName: SERVER_NAME, appName: 'Cron Job', success: true }), 1500);
    return;
  }

  const { exec } = require('child_process');
  let shellCmd = '';
  if (action === 'create') {
    shellCmd = `(crontab -l 2>/dev/null; echo "${schedule} ${command}") | crontab -`;
  } else if (action === 'delete') {
    shellCmd = `crontab -l | grep -v "${command}" | crontab -`;
  }

  exec(shellCmd, (err, stdout, stderr) => {
    socket.emit('deployment:log', { serverName: SERVER_NAME, appName: 'Cron Job', log: err ? stderr : 'Cron updated successfully.\n' });
    socket.emit('deployment:end', { serverName: SERVER_NAME, appName: 'Cron Job', success: !err });
  });
});

socket.on('env:get', ({ appName }) => {
  const envPath = path.join(process.cwd(), 'apps', appName, '.env');
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }
  socket.emit('env:data', { serverName: SERVER_NAME, appName, envContent });
});

socket.on('env:save', ({ appName, envContent }) => {
  const envPath = path.join(process.cwd(), 'apps', appName, '.env');
  fs.writeFileSync(envPath, envContent, 'utf8');
  
  pm2.restart(appName, (err) => {
    if (err) {
      console.error(`Error restarting ${appName} after env update:`, err);
    } else {
      console.log(`Updated .env and restarted ${appName}`);
    }
  });
});

const activeLogStreams = new Map();

socket.on('pm2:logs:start', ({ appName }) => {
  if (activeLogStreams.has(appName)) return;
  const { spawn } = require('child_process');
  
  const cmd = process.platform === 'win32' ? 'pm2.cmd' : 'pm2';
  const logProc = spawn(cmd, ['logs', appName, '--raw', '--lines', '50']);
  
  activeLogStreams.set(appName, logProc);
  
  logProc.stdout.on('data', (data) => {
    socket.emit('pm2:logs:data', { serverName: SERVER_NAME, appName, log: data.toString() });
  });
  
  logProc.stderr.on('data', (data) => {
    socket.emit('pm2:logs:data', { serverName: SERVER_NAME, appName, log: data.toString() });
  });
});

socket.on('pm2:logs:stop', ({ appName }) => {
  const logProc = activeLogStreams.get(appName);
  if (logProc) {
    logProc.kill();
    activeLogStreams.delete(appName);
  }
});

// Function to collect metrics
const collectMetrics = async () => {
  try {
    const isWindows = process.platform === 'win32';
    const cpu = await si.currentLoad();
    const mem = await si.mem();
    const disk = await si.fsSize();
    const osInfo = await si.osInfo();
    const networkConnections = await si.networkConnections();
    
    // Process Network Connections
    const listeningPorts = new Map();
    networkConnections.forEach(conn => {
      if (conn.state === 'LISTEN' && conn.pid) {
        if (!listeningPorts.has(conn.pid)) {
          listeningPorts.set(conn.pid, []);
        }
        if (!listeningPorts.get(conn.pid).includes(conn.localPort)) {
          listeningPorts.get(conn.pid).push(conn.localPort);
        }
      }
    });

    // Mock UFW Status
    let ufwStatus = { enabled: false, rules: [] };
    if (isWindows) {
      ufwStatus = {
        enabled: true,
        rules: [
          { id: '1', to: '80/tcp', action: 'ALLOW IN', from: 'Anywhere' },
          { id: '2', to: '443/tcp', action: 'ALLOW IN', from: 'Anywhere' },
          { id: '3', to: '27017', action: 'DENY IN', from: 'Anywhere' },
        ]
      };
    } else {
      try {
        const ufwOut = require('child_process').execSync('sudo ufw status numbered', { encoding: 'utf8' });
        if (ufwOut.includes('Status: active')) {
           ufwStatus.enabled = true;
           const lines = ufwOut.split('\n');
           let rules = [];
           lines.forEach(line => {
             const match = line.match(/^\[\s*(\d+)\]\s+(.*?)\s+(ALLOW IN|DENY IN|REJECT IN|ALLOW OUT|DENY OUT|REJECT OUT)\s+(.*?)$/);
             if (match) {
               rules.push({ id: match[1], to: match[2].trim(), action: match[3].trim(), from: match[4].trim() });
             }
           });
           ufwStatus.rules = rules;
        }
      } catch(e) {}
    }

    // Mock Mongo Databases
    let mongoStatus = { installed: false, databases: [] };
    if (isWindows) {
      mongoStatus = {
        installed: true,
        databases: [
          { name: 'admin', sizeOnDisk: 40960, empty: false },
          { name: 'config', sizeOnDisk: 73728, empty: false },
          { name: 'local', sizeOnDisk: 73728, empty: false },
          { name: 'production_db', sizeOnDisk: 1048576, empty: false }
        ]
      };
    } else {
      try {
        const mongoOut = require('child_process').execSync(`mongosh --quiet --eval "JSON.stringify(db.adminCommand('listDatabases').databases)"`, { encoding: 'utf8' });
        mongoStatus.installed = true;
        mongoStatus.databases = JSON.parse(mongoOut.trim());
      } catch(e) {}
    }

    // Mock Cron Jobs
    let cronStatus = [];
    if (isWindows) {
      cronStatus = [
        { schedule: '0 0 * * *', command: '/var/www/tagops/backup.sh' },
        { schedule: '*/15 * * * *', command: 'node /var/www/api/worker.js' }
      ];
    } else {
      try {
        const cronOut = require('child_process').execSync('crontab -l', { encoding: 'utf8' });
        const lines = cronOut.split('\n');
        lines.forEach(line => {
          if (line && !line.trim().startsWith('#')) {
             const parts = line.trim().split(/\s+/);
             if (parts.length >= 6) {
                const schedule = parts.slice(0, 5).join(' ');
                const command = parts.slice(5).join(' ');
                cronStatus.push({ schedule, command });
             }
          }
        });
      } catch(e) {}
    }

    const pm2Processes = await new Promise((resolve) => {
        pm2.list((err, list) => {
          if (err) return resolve([]);
          
          resolve(
            list.map((proc) => {
              const ports = listeningPorts.get(proc.pid) || [];
              
              return {
                name: proc.name,
                pid: proc.pid,
                pm_id: proc.pm_id,
                status: proc.pm2_env.status,
                cpu: proc.monit ? proc.monit.cpu : 0,
                memory: proc.monit ? proc.monit.memory : 0,
                restarts: proc.pm2_env.restart_time,
                ports: ports.length > 0 ? ports.join(', ') : 'None'
              };
            })
          );
        });
      });

    const metrics = {
      cpuUsage: parseFloat(cpu.currentLoad.toFixed(2)),
      ramUsage: parseFloat(((mem.active / mem.total) * 100).toFixed(2)),
      totalRam: mem.total,
      freeRam: mem.free,
      diskUsage: disk.length > 0 ? parseFloat(disk[0].use.toFixed(2)) : 0,
      uptime: si.time().uptime,
      os: osInfo.platform,
      pm2: pm2Processes,
      ufw: ufwStatus,
      mongo: mongoStatus,
      cron: cronStatus
    };

    return metrics;
  } catch (error) {
    console.error('Error collecting metrics:', error);
    return null;
  }
};

// Send metrics every 5 seconds
setInterval(async () => {
  const metrics = await collectMetrics();
  if (metrics && socket.connected) {
    socket.emit('agent:metrics', metrics);
    console.log(`Metrics sent: CPU ${metrics.cpuUsage}% | RAM ${metrics.ramUsage}%`);
  }
}, 5000);
