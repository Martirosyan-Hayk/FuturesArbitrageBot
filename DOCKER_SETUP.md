# Docker Local Development Setup

## 🎯 Overview

This is a simplified Docker Compose setup optimized for **local development only**. All production/staging configurations have been removed for simplicity.

## 🔧 Quick Start

### 1. Prerequisites
- Docker and Docker Compose installed
- `.env` file configured (copy from `env.example`)

### 2. Configure Environment
```bash
# Copy example and edit
cp env.example .env
nano .env  # Add your Telegram bot token and chat ID
```

### 3. Start Development Environment
```bash
# Option 1: Use the start script (recommended)
chmod +x start-dev.sh
./start-dev.sh

# Option 2: Manual Docker Compose
docker-compose up --build
```

### 4. Stop Development Environment
```bash
# Option 1: Use the stop script
./stop-dev.sh

# Option 2: Manual
docker-compose down
```

## 🏗️ What's Included

### Services:
- **`arbitrage-bot-dev`** - The main application with hot reloading
- **`arbitrage-redis-dev`** - Redis for Bull queues

### Development Features:
- ✅ **Hot reloading** - Code changes automatically restart the app
- ✅ **Debug port** exposed (9229) for Node.js debugging
- ✅ **Source code mounting** - Edit files on host, changes reflect in container
- ✅ **Redis exposed** on port 6380 for development tools
- ✅ **All new environment variables** included

## 📊 Monitoring

### Check Status:
```bash
docker-compose ps
```

### View Logs:
```bash
# Follow all logs
docker-compose logs -f

# Follow app logs only
docker-compose logs -f app

# Follow Redis logs only
docker-compose logs -f redis
```

### Check Exchange Status:
```bash
# Once running, check which exchanges are working
curl http://localhost:3000/arbitrage/exchange-status
```

## 🔧 Environment Variables

All environment variables from `env.example` are supported, including the new ones:

```env
# Exchange Failure Settings
ENABLE_EXCHANGE_FALLBACKS=false
NOTIFY_EXCHANGE_FAILURES=true
EXCHANGE_FAILURE_COOLDOWN_MINUTES=30

# WebSocket Settings (Zero Latency)
WEBSOCKET_RECONNECT_INTERVAL=5000
WEBSOCKET_PING_INTERVAL=30000
WEBSOCKET_TIMEOUT=10000
```

## 🛠️ Development Commands

```bash
# Start fresh (rebuild images)
docker-compose up --build

# Start in background
docker-compose up -d

# Stop services
docker-compose down

# Remove all containers and volumes
docker-compose down -v

# Shell into app container
docker-compose exec app sh

# Shell into Redis container
docker-compose exec redis redis-cli
```

## 📱 Port Mapping

| Service | Internal Port | External Port | Purpose |
|---------|---------------|---------------|---------|
| App | 3000 | 3000 | HTTP API |
| App | 9229 | 9229 | Node.js Debug |
| Redis | 6379 | 6380 | Redis Database |

## 🚨 Troubleshooting

### Common Issues:

**1. Port already in use**
```bash
# Stop any local Redis/Node.js processes
sudo lsof -ti:3000 | xargs kill -9
sudo lsof -ti:6380 | xargs kill -9
```

**2. Docker permission issues**
```bash
# Add user to docker group (Linux)
sudo usermod -aG docker $USER
# Then logout and login again
```

**3. Container build issues**
```bash
# Clean build
docker-compose down
docker system prune -f
docker-compose up --build --force-recreate
```

**4. Exchange connection issues**
- Check your internet connection
- Verify `.env` file has correct Telegram settings
- Check logs: `docker-compose logs app`
- Test exchange APIs manually

## 🎉 Success Indicators

When everything is working, you should see:

1. **Services healthy**: `docker-compose ps` shows all services as "Up"
2. **Exchange connections**: Logs show WebSocket connections to exchanges
3. **Telegram ready**: No Telegram connection errors in logs
4. **API responding**: `curl http://localhost:3000/arbitrage/exchange-status` returns JSON

## 🔄 Development Workflow

1. **Edit code** in your IDE (VS Code, etc.)
2. **Save files** - app automatically restarts
3. **Check logs** - `docker-compose logs -f app`
4. **Test changes** - app runs on `http://localhost:3000`
5. **Debug if needed** - attach debugger to port 9229

This setup provides a complete local development environment with all the latest features! 