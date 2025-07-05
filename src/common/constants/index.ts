export const DEFAULT_CONFIG = {
    ARBITRAGE_THRESHOLD_PERCENT: 0.7,
    COOLDOWN_MINUTES: 5,
    MIN_PROFIT_USD: 10,
    TRADING_PAIRS: ['BTC/USDT', 'ETH/USDT', 'BNB/USDT'],
    NEW_LISTING_CHECK_INTERVAL: 30,
    NEW_LISTING_THRESHOLD_HOURS: 24,
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    PORT: 3000,
};

export const EXCHANGE_ENDPOINTS = {
    BINANCE: 'wss://fstream.binance.com/ws/',
    BYBIT: 'wss://stream.bybit.com/v5/public/linear',
    MEXC: 'wss://contract.mexc.com/ws',
    GATEIO: 'wss://fx-ws.gateio.ws/v4/ws/usdt',
    LBANK: 'wss://www.lbkex.net/ws/V2/',
};

export const ARBITRAGE_MESSAGES = {
    OPPORTUNITY_DETECTED: '📈 Arbitrage opportunity detected',
    ALERT_SENT: '📱 Arbitrage alert sent',
    THRESHOLD_NOT_MET: '❌ Arbitrage threshold not met',
    COOLDOWN_ACTIVE: '⏰ Cooldown period active',
    STALE_PRICES: '⚠️ Stale price data detected',
}; 