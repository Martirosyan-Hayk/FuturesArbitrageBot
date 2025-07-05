# ⚡ Futures Arbitrage Bot — Nest.js

This project is a real-time arbitrage trading bot built with **Nest.js**. It continuously monitors **futures markets** on multiple exchanges and sends real-time **arbitrage opportunity alerts** to a **Telegram channel**. The system is designed for **high-speed, low-latency arbitrage decision making** and automatic/manual trading signal delivery.

---

## 🚀 Purpose

The main goal of this app is to:
- Track futures prices from multiple crypto exchanges in real time
- Detect arbitrage opportunities (price gaps)
- Send actionable notifications to a Telegram channel
- Optionally include actions to take (buy/sell/hold)

---

## 📈 Supported Exchanges

- ✅ Binance Futures
- ✅ ByBit
- ✅ MEXC
- ✅ Gate.io
- ✅ LBank

> **Note:** Use official exchange WebSocket APIs for real-time data feeds.

---

## 🧩 Architecture Overview

- **NestJS** for modular backend
- **WebSockets** for real-time price updates from exchanges
- **Scheduler/Worker** (e.g., `@nestjs/schedule` or `BullMQ`) for comparing prices and triggering alerts
- **Telegram Bot API** (via [grammY](https://grammy.dev/) or [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api))
- **ENV-based config** for sensitive data (API keys, tokens, thresholds)

---

## 🔧 Features

- 🔁 Real-time price tracking for selected trading pairs
- 🔍 Arbitrage logic:
  - Detect when price difference between any 2 exchanges is more than a defined **threshold (%)**
  - Calculate spread, profit potential, fees
- 📤 Send detailed alert to Telegram channel with:
  - Pair (e.g., BTC/USDT)
  - Exchange A vs Exchange B
  - Long on one / Short on another
  - Current prices, difference %
  - Suggested action (buy/sell)
- 📊 Console & log output for debugging

---

## 🧪 Environment Variables

```env
TELEGRAM_BOT_TOKEN=xxxxxxxx
TELEGRAM_CHAT_ID=-123456789
BINANCE_API_KEY=...
BYBIT_API_KEY=...
GATEIO_API_KEY=...
# Add other exchange credentials here if needed
ARBITRAGE_THRESHOLD_PERCENT=0.7
```

---

## 📦 Tech Stack

- [Nest.js](https://nestjs.com/)
- [WebSocket](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API) for exchange feeds
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [BullMQ](https://docs.bullmq.io/) or `@nestjs/schedule` for job scheduling
- [RxJS](https://rxjs.dev/) (optional) for reactive streams
- TypeScript

---

## 📌 To Do (for Cursor AI)

1. **Exchange Integrations**
   - Connect to Binance, ByBit, MEXC, Gate.io, and LBank WebSocket endpoints
   - Subscribe to futures ticker feeds for predefined pairs (e.g., BTC/USDT, ETH/USDT)

2. **Price Aggregator Service**
   - Maintain in-memory store for latest prices per exchange
   - Normalize price formats across different APIs

3. **Arbitrage Detector**
   - Compare prices in real time
   - Trigger alert if `price_difference_percent >= ARBITRAGE_THRESHOLD_PERCENT`
   - Avoid duplicate alerts (set a cooldown per pair-exchange combo)

4. **Telegram Notifier**
   - Use Telegram Bot API to send messages
   - Format messages for easy human understanding

5. **Config System**
   - Use `.env` for secrets and thresholds
   - Allow defining which pairs to watch

6. **Resilience**
   - Handle disconnects & reconnects
   - Retry failed jobs
   - Monitor system health

---

## 🛠 Setup

### Prerequisites

- Node.js (v18 or higher)
- Yarn package manager
- Redis server (for job queue)
- Telegram Bot Token (optional but recommended)

### Installation

1. **Clone the repository:**
```bash
git clone <repository-url>
cd futures-arbitrage-bot
```

2. **Install dependencies:**
```bash
yarn install
```

3. **Configure environment variables:**
```bash
# Copy the sample environment file
cp .env.example .env

# Edit the .env file with your configuration
nano .env
```

4. **Start Redis server:**
```bash
# On macOS (using Homebrew)
brew services start redis

# On Ubuntu/Debian
sudo systemctl start redis-server

# Using Docker
docker run -d -p 6379:6379 redis:alpine
```

5. **Run the application:**
```bash
# Development mode
yarn start:dev

# Production mode
yarn build
yarn start:prod

# Using the startup script
chmod +x scripts/start.sh
./scripts/start.sh
```

### Telegram Bot Setup

1. **Create a Telegram Bot:**
   - Message @BotFather on Telegram
   - Use `/newbot` command
   - Get your bot token

2. **Get Chat ID:**
   - Add your bot to a group or channel
   - Send a message to the bot
   - Visit: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
   - Find your chat ID in the response

3. **Update Environment Variables:**
```bash
TELEGRAM_BOT_TOKEN=your_actual_bot_token
TELEGRAM_CHAT_ID=your_actual_chat_id
```

---

## 🐳 Docker Setup

### Quick Start with Docker

The easiest way to run the Futures Arbitrage Bot is using Docker and Docker Compose:

1. **Clone the repository:**
```bash
git clone <repository-url>
cd futures-arbitrage-bot
```

2. **Configure environment variables:**
```bash
# Copy the sample environment file
cp env.example .env

# Edit the .env file with your configuration
nano .env
```

3. **Run with Docker Compose:**
```bash
# Development mode (with hot reloading)
docker-compose up -d

# Production mode
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# View logs
docker-compose logs -f app
```

### Docker Commands

```bash
# Build the application
docker-compose build

# Start services
docker-compose up -d

# Stop services
docker-compose down

# View logs
docker-compose logs -f

# Restart app only
docker-compose restart app

# View Redis logs
docker-compose logs -f redis

# Execute commands in container
docker-compose exec app yarn --version

# Clean up volumes (removes all data)
docker-compose down -v
```

### Docker Compose Configurations

#### Development (`docker-compose.yml` + `docker-compose.override.yml`)
- Hot reloading enabled
- Source code mounted as volume
- Debug port exposed (9229)
- Redis exposed on host for debugging

#### Production (`docker-compose.yml` + `docker-compose.prod.yml`)
- Optimized for production
- Resource limits enforced
- Proper logging configuration
- Security hardened (no exposed Redis)

### Environment Variables for Docker

Key environment variables for Docker deployment:

```env
# Application
NODE_ENV=production
PORT=3000

# Redis (uses docker service names)
REDIS_HOST=redis
REDIS_PORT=6379

# Telegram Bot
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Trading Configuration
TRADING_PAIRS=BTC/USDT,ETH/USDT,BNB/USDT
ARBITRAGE_THRESHOLD_PERCENT=0.7
COOLDOWN_MINUTES=5
```

### Health Checks

Both services include health checks:
- **App**: HTTP check on `/health` endpoint
- **Redis**: Redis ping command

### Volumes

- **Redis Data**: Persistent storage for Redis data
- **App Logs**: Application logs (accessible via `docker-compose logs`)

### Troubleshooting Docker

```bash
# Check container status
docker-compose ps

# View container resource usage
docker stats

# Access container shell
docker-compose exec app sh

# Check Redis connection
docker-compose exec redis redis-cli ping

# Rebuild and restart
docker-compose down && docker-compose up -d --build

# Remove all containers and volumes
docker-compose down -v --remove-orphans
```

### Production Deployment

For production deployment, use the production compose file:

```bash
# Production deployment
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# With specific environment file
docker-compose --env-file .env.prod -f docker-compose.yml -f docker-compose.prod.yml up -d
```

---

## 📡 API Endpoints

### Health & Status
- `GET /` - Welcome message
- `GET /health` - Health check
- `GET /status` - Service status

### Price Data
- `GET /prices` - Get all current prices
- `GET /prices/symbols` - Get available symbols
- `GET /prices/exchanges` - Get available exchanges
- `GET /prices/symbol/:symbol` - Get prices for specific symbol
- `GET /prices/price/:symbol/:exchange` - Get price for specific symbol/exchange
- `GET /prices/history/:symbol/:exchange` - Get price history

### Arbitrage
- `GET /arbitrage/opportunities` - Get recent arbitrage opportunities
- `GET /arbitrage/stats` - Get arbitrage statistics
- `POST /arbitrage/config` - Update arbitrage configuration
- `POST /arbitrage/clear-alerts` - Clear recent alerts

### New Listings
- `GET /listings` - Get recent new listings
- `GET /listings/stats` - Get new listings statistics
- `GET /listings/exchange/:exchange` - Get listings for specific exchange
- `GET /listings/symbol/:symbol/exchanges` - Check symbol availability across exchanges
- `GET /listings/monitored/:exchange/:symbol` - Check if symbol is monitored
- `POST /listings/refresh` - Force refresh all symbols
- `POST /listings/force-check` - Force check for new listings

### Example API Usage

```bash
# Get all current prices
curl http://localhost:3000/prices

# Get arbitrage opportunities
curl http://localhost:3000/arbitrage/opportunities

# Get arbitrage statistics
curl http://localhost:3000/arbitrage/stats

# Update arbitrage threshold
curl -X POST http://localhost:3000/arbitrage/config \
  -H "Content-Type: application/json" \
  -d '{"thresholdPercent": 1.0}'

# Get recent new listings
curl http://localhost:3000/listings

# Get new listings statistics
curl http://localhost:3000/listings/stats

# Check symbol availability across exchanges
curl http://localhost:3000/listings/symbol/BTC%2FUSDT/exchanges

# Force check for new listings
curl -X POST http://localhost:3000/listings/force-check
```

---

## 🎯 Key Features Implemented

- ✅ **Real-time Price Tracking**: WebSocket connections to 5+ exchanges
- ✅ **Arbitrage Detection**: Automated opportunity detection with configurable thresholds
- ✅ **New Listings Monitor**: Automatic detection of new token listings across all exchanges
- ✅ **Telegram Notifications**: Rich HTML formatted alerts for arbitrage and new listings
- ✅ **Multi-Exchange Support**: Binance, ByBit, MEXC, Gate.io, LBank
- ✅ **Cross-Exchange Analysis**: Check symbol availability and arbitrage potential
- ✅ **Rate Limiting & Cooldowns**: Prevents spam and duplicate alerts
- ✅ **Queue System**: Bull/Redis for reliable job processing
- ✅ **REST API**: Complete API for monitoring and configuration
- ✅ **Error Handling**: Robust error handling with automatic reconnection
- ✅ **Configurable**: Environment-based configuration
- ✅ **Logging**: Comprehensive logging with emojis for easy reading

---

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | - |
| `TELEGRAM_CHAT_ID` | Telegram chat/channel ID | - |
| `ARBITRAGE_THRESHOLD_PERCENT` | Minimum price difference % | `0.7` |
| `COOLDOWN_MINUTES` | Alert cooldown period | `5` |
| `MIN_PROFIT_USD` | Minimum profit requirement | `10` |
| `TRADING_PAIRS` | Comma-separated trading pairs | `BTC/USDT,ETH/USDT` |
| `NEW_LISTING_CHECK_INTERVAL` | Minutes between new listing checks | `30` |
| `NEW_LISTING_THRESHOLD_HOURS` | Hours to consider listing as "new" | `24` |
| `REDIS_HOST` | Redis server host | `localhost` |
| `REDIS_PORT` | Redis server port | `6379` |
| `PORT` | Application port | `3000` |

### Supported Trading Pairs

- BTC/USDT
- ETH/USDT
- BNB/USDT
- (Add more pairs in TRADING_PAIRS environment variable)

---

## 📊 Monitoring

The bot provides comprehensive monitoring capabilities:

- **Real-time Logs**: Color-coded logs with emojis
- **API Endpoints**: Monitor prices, opportunities, and statistics
- **Telegram Alerts**: Instant notifications for opportunities
- **Health Checks**: Service status and connection monitoring

---

## 🚨 Example Telegram Alert

```
🚨 ARBITRAGE OPPORTUNITY 🚨

📊 Pair: BTC/USDT
📈 Spread: 1.25%
💰 Potential Profit: $1,250.00

🔄 Action:
   🟢 BUY on binance: $43,250.00
   🔴 SELL on bybit: $43,790.00

💸 Price Difference: $540.00

⏰ Time: 2024-01-15 10:30:45

Act quickly! Arbitrage opportunities are time-sensitive.
```

## 🆕 Example New Listing Alert

```
🆕 NEW LISTING DETECTED 🆕

📊 Symbol: NEWTOKEN/USDT
🏷️ Asset: NEWTOKEN/USDT
🏢 Exchange: BINANCE
📅 Listed: 2024-01-15 09:00:00
📈 Status: TRADING

🎯 Arbitrage Potential: YES - Available on 3 exchanges

💰 Current Prices:
   binance: $0.1250
   bybit: $0.1284
   mexc: $0.1195

⏰ Detection Time: 2024-01-15 09:05:32

New listings often provide excellent arbitrage opportunities!
```

---

## 📅 Future Improvements

- Automatic execution (real trading)
- Web UI Dashboard (Next.js)
- Historical opportunity logging
- Profit estimation based on funding/fees/slippage
- Risk management module
- Machine learning for opportunity prediction
- Multi-asset arbitrage
- Cross-exchange portfolio management

