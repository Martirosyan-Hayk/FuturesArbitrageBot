# Exchange Configuration Guide

## 🎯 Overview

The exchange system has been completely redesigned to be:
- **Zero latency** with WebSocket prioritization
- **Configurable** with no hardcoded values
- **Transparent** with immediate failure notifications
- **Manual control** - you decide when to use fallbacks

## 🔧 Configuration Settings

Add these to your `.env` file:

```env
# Exchange Failure Settings
ENABLE_EXCHANGE_FALLBACKS=false           # Use fallback symbols when APIs fail
FALLBACK_SYMBOLS=BTC/USDT,ETH/USDT,SOL/USDT  # Which symbols to use as fallbacks
NOTIFY_EXCHANGE_FAILURES=true            # Send Telegram alerts for failures
EXCHANGE_FAILURE_COOLDOWN_MINUTES=30     # Cooldown between duplicate notifications

# WebSocket Settings (for zero latency)
WEBSOCKET_RECONNECT_INTERVAL=5000        # Reconnect delay (5 seconds)
WEBSOCKET_PING_INTERVAL=30000            # Ping interval (30 seconds)
WEBSOCKET_TIMEOUT=10000                  # API timeout (10 seconds)
```

## 🚨 How Failure Notifications Work

### When an exchange API fails, you'll get:

**Telegram Alert:**
```
🚨 **LBank Exchange Failure**

**Type:** Symbol Fetch Failed
**Details:** All LBank endpoints failed. Last error: fetch failed

⚠️ Please check LBank API status and fix if needed.
```

### Notification Features:
- ✅ **30-minute cooldown** - No spam notifications
- ✅ **Per-failure tracking** - Different errors get separate notifications
- ✅ **Rich details** - Exact error messages and failure types
- ✅ **Exchange-specific** - Know exactly which exchange failed

## 🔄 System Behavior

### With Fallbacks DISABLED (Recommended):
```env
ENABLE_EXCHANGE_FALLBACKS=false
```

**What happens:**
1. Exchange API fails → Empty symbol list returned
2. Telegram notification sent immediately
3. Exchange excluded from arbitrage detection
4. You fix the issue manually
5. System auto-reconnects when API is back online

### With Fallbacks ENABLED:
```env
ENABLE_EXCHANGE_FALLBACKS=true
```

**What happens:**
1. Exchange API fails → Fallback symbols used
2. Telegram notification sent
3. Exchange continues with limited symbols
4. System auto-reconnects in background

## 📊 Monitoring Exchange Status

### Real-time Status Check:
```bash
# Check which exchanges are working
curl http://localhost:3000/arbitrage/exchange-status
```

### Status Response:
```json
{
  "exchangeStatus": {
    "binance": {
      "connected": true,
      "connectionCount": 3,
      "connectedSymbols": ["BTC/USDT", "ETH/USDT", "SOL/USDT"]
    },
    "lbank": {
      "connected": false,
      "connectionCount": 0,
      "connectedSymbols": [],
      "error": "fetch failed"
    }
  },
  "timestamp": "2024-01-20T10:30:00.000Z"
}
```

## 🎛️ Recommended Settings

### For Production (Zero tolerance for failures):
```env
ENABLE_EXCHANGE_FALLBACKS=false
NOTIFY_EXCHANGE_FAILURES=true
EXCHANGE_FAILURE_COOLDOWN_MINUTES=15
```

### For Development/Testing:
```env
ENABLE_EXCHANGE_FALLBACKS=true
FALLBACK_SYMBOLS=BTC/USDT,ETH/USDT
NOTIFY_EXCHANGE_FAILURES=true
EXCHANGE_FAILURE_COOLDOWN_MINUTES=5
```

## 🔌 WebSocket Prioritization

### Zero Latency Configuration:
- **Primary data source**: WebSocket connections
- **Fallback**: REST API only for initial symbol fetching
- **Auto-reconnect**: Failed WebSocket connections retry automatically
- **Configurable intervals**: All timeouts and delays are configurable

### Connection Health:
- ✅ **Active monitoring** every 5 minutes
- ✅ **Auto-reconnection** for failed exchanges
- ✅ **Real-time status** via API endpoint
- ✅ **Connection counting** tracks active subscriptions

## 🚀 Why This Approach is Better

### 1. **No Silent Failures**
- You know immediately when something breaks
- No hidden fallbacks masking real issues
- Full visibility into system health

### 2. **Zero Latency**
- WebSocket-first approach
- No polling delays
- Real-time price updates

### 3. **Full Control**
- You decide when to use fallbacks
- Configure all timeouts and intervals
- Manual intervention when needed

### 4. **Production Ready**
- Proper error handling
- Rate limiting awareness
- Telegram integration for monitoring

## 🛠️ Troubleshooting

### Common Issues:

**1. "All endpoints failed"**
- Check internet connection
- Verify exchange API status
- Check if IP is rate limited/blocked

**2. "WebSocket connection failed"**
- Firewall blocking WebSocket connections
- Exchange WebSocket maintenance
- Network connectivity issues

**3. "Too many notifications"**
- Increase `EXCHANGE_FAILURE_COOLDOWN_MINUTES`
- Check if multiple exchanges failing simultaneously

### Quick Fixes:
```bash
# Restart a specific exchange
curl -X POST http://localhost:3000/arbitrage/exchange-status

# Check logs for detailed errors
docker logs futures-arbitrage-bot

# Verify configuration
cat .env | grep EXCHANGE
```

## 📈 System Health Indicators

### ✅ Healthy System:
- 2+ exchanges connected
- WebSocket connections active
- No recent failure notifications
- Arbitrage opportunities being detected

### ⚠️ Degraded System:
- 1 exchange connected
- Recent failure notifications
- Limited arbitrage opportunities

### ❌ Critical System:
- 0 exchanges connected
- Multiple failure notifications
- No arbitrage detection possible

With this configuration, you have complete control and visibility over your exchange connections! 