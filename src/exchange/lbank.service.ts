import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as WebSocket from 'ws';
import { PriceData, SupportedExchanges, ExchangeSymbol } from '@/common/types';
import { TelegramService } from '@/telegram/telegram.service';

@Injectable()
export class LbankService {
    private readonly logger = new Logger(LbankService.name);
    private readonly baseUrl = 'wss://www.lbkex.net/ws/V2/';
    private readonly apiUrl = 'https://api.lbank.info/v2';
    private readonly connections = new Map<string, WebSocket>();
    private readonly subscriptions = new Map<string, (data: PriceData) => void>();
    private readonly failureNotifications = new Map<string, number>();
    private isInitialized = false;

    // Configuration
    private readonly enableFallbacks: boolean;
    private readonly fallbackSymbols: string[];
    private readonly notifyFailures: boolean;
    private readonly failureCooldownMs: number;
    private readonly reconnectInterval: number;
    private readonly pingInterval: number;
    private readonly wsTimeout: number;

    constructor(
        private readonly configService: ConfigService,
        private readonly telegramService: TelegramService
    ) {
        this.enableFallbacks = this.configService.get<string>('ENABLE_EXCHANGE_FALLBACKS', 'false') === 'true';
        this.fallbackSymbols = this.configService.get<string>('FALLBACK_SYMBOLS', 'BTC/USDT,ETH/USDT').split(',').map(s => s.trim());
        this.notifyFailures = this.configService.get<string>('NOTIFY_EXCHANGE_FAILURES', 'true') === 'true';
        this.failureCooldownMs = parseInt(this.configService.get<string>('EXCHANGE_FAILURE_COOLDOWN_MINUTES', '30')) * 60 * 1000;
        this.reconnectInterval = parseInt(this.configService.get<string>('WEBSOCKET_RECONNECT_INTERVAL', '5000'));
        this.pingInterval = parseInt(this.configService.get<string>('WEBSOCKET_PING_INTERVAL', '30000'));
        this.wsTimeout = parseInt(this.configService.get<string>('WEBSOCKET_TIMEOUT', '10000'));
    }

    async initialize(): Promise<void> {
        this.logger.log('🔄 Initializing LBank service...');
        this.isInitialized = true;
        this.logger.log('✅ LBank service initialized');
    }

    async disconnect(): Promise<void> {
        this.logger.log('🔄 Disconnecting from LBank...');

        for (const [symbol, ws] of this.connections) {
            try {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.close();
                }
            } catch (error) {
                this.logger.error(`❌ Error closing WebSocket for ${symbol}: ${error.message}`);
            }
        }

        this.connections.clear();
        this.subscriptions.clear();
        this.isInitialized = false;

        this.logger.log('✅ Disconnected from LBank');
    }

    async subscribeToTicker(symbol: string, callback: (data: PriceData) => void): Promise<void> {
        if (!this.isInitialized) {
            throw new Error('LBank service not initialized');
        }

        const streamSymbol = this.formatSymbolForStream(symbol);

        this.logger.log(`📡 Subscribing to LBank ticker: ${streamSymbol}`);

        try {
            const ws = new WebSocket(this.baseUrl);

            ws.on('open', () => {
                this.logger.log(`✅ Connected to LBank WebSocket for ${symbol}`);
                this.connections.set(symbol, ws);
                this.subscriptions.set(symbol, callback);

                // Subscribe to ticker stream
                const subscribeMessage = {
                    action: 'subscribe',
                    subscribe: 'tick',
                    pair: streamSymbol
                };

                ws.send(JSON.stringify(subscribeMessage));
            });

            ws.on('message', (data: Buffer) => {
                try {
                    const message = JSON.parse(data.toString());

                    if (message.type === 'tick' && message.tick) {
                        const priceData = this.parseTickerData(message.tick, symbol);
                        callback(priceData);
                    }
                } catch (error) {
                    this.logger.error(`❌ Error parsing LBank ticker data: ${error.message}`);
                }
            });

            ws.on('error', (error) => {
                this.logger.error(`❌ LBank WebSocket error for ${symbol}: ${error.message}`);
            });

            ws.on('close', (code, reason) => {
                this.logger.warn(`⚠️ LBank WebSocket closed for ${symbol}: ${code} - ${reason}`);
                this.connections.delete(symbol);

                // Attempt to reconnect after a delay
                setTimeout(() => {
                    this.reconnectTicker(symbol, callback);
                }, this.reconnectInterval);
            });

        } catch (error) {
            this.logger.error(`❌ Failed to subscribe to LBank ticker ${symbol}: ${error.message}`);
            throw error;
        }
    }

    async getSymbols(): Promise<ExchangeSymbol[]> {
        try {
            const endpoint = `${this.apiUrl}/currencyPairs.do`;

            this.logger.log(`🔄 Trying LBank symbols endpoint: ${endpoint}`);

            // Set up timeout using AbortController
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.wsTimeout);

            const response = await fetch(endpoint, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (compatible; FuturesArbitrageBot/1.0)'
                },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const responseDataJson = await response.json();

            // Check if API response is valid
            if (!responseDataJson.result || !Array.isArray(responseDataJson.data)) {
                throw new Error('Invalid API response format');
            }

            this.logger.log(`✅ LBank symbols fetched successfully from: ${endpoint}`);

            return responseDataJson.data.map((pair: string) => {
                const [baseAsset, quoteAsset] = pair.split('_');

                return {
                    symbol: `${baseAsset.toUpperCase()}/${quoteAsset.toUpperCase()}`,
                    baseAsset: baseAsset.toUpperCase(),
                    quoteAsset: quoteAsset.toUpperCase(),
                    status: 'TRADING',
                    exchange: SupportedExchanges.LBANK,
                    minTradeAmount: 0,
                    tickSize: 0,
                    lastUpdated: Date.now(),
                };
            });

        } catch (error) {
            this.logger.error(`❌ Failed to fetch LBank symbols: ${error.message}`);

            // Send failure notification if enabled
            await this.notifyFailure('Symbol Fetch Failed', error.message);

            // Return fallback symbols only if enabled
            if (this.enableFallbacks) {
                this.logger.warn(`⚠️ Using fallback symbols for LBank: ${this.fallbackSymbols.join(', ')}`);

                return this.fallbackSymbols.map(symbol => {
                    const [baseAsset, quoteAsset] = symbol.split('/');
                    return {
                        symbol,
                        baseAsset,
                        quoteAsset,
                        status: 'TRADING',
                        exchange: SupportedExchanges.LBANK,
                        minTradeAmount: 0,
                        tickSize: 0,
                        lastUpdated: Date.now(),
                    };
                });
            }

            // No fallbacks - return empty array to force notification
            return [];
        }
    }

    private async reconnectTicker(symbol: string, callback: (data: PriceData) => void): Promise<void> {
        if (!this.isInitialized || this.connections.has(symbol)) {
            return;
        }

        this.logger.log(`🔄 Reconnecting to LBank ticker: ${symbol}`);

        try {
            await this.subscribeToTicker(symbol, callback);
        } catch (error) {
            this.logger.error(`❌ Failed to reconnect to LBank ticker ${symbol}: ${error.message}`);

            // Retry after a longer delay
            setTimeout(() => {
                this.reconnectTicker(symbol, callback);
            }, this.reconnectInterval * 6); // 6x the normal interval for retries
        }
    }

    private formatSymbolForStream(symbol: string): string {
        // Convert BTC/USDT to btc_usdt
        return symbol.replace('/', '_').toLowerCase();
    }

    private parseTickerData(data: any, symbol: string): PriceData {
        return {
            symbol,
            price: parseFloat(data.latest || data.price), // Last price
            exchange: SupportedExchanges.LBANK,
            timestamp: Date.now(),
            volume: parseFloat(data.vol || '0'), // Volume
            high: parseFloat(data.high || '0'), // High price
            low: parseFloat(data.low || '0'), // Low price
        };
    }

    isConnected(): boolean {
        return this.isInitialized && this.connections.size > 0;
    }

    getConnectionCount(): number {
        return this.connections.size;
    }

    getConnectedSymbols(): string[] {
        return Array.from(this.connections.keys());
    }

    private async notifyFailure(type: string, message: string): Promise<void> {
        if (!this.notifyFailures) return;

        const notificationKey = `${type}-${message}`;
        const now = Date.now();
        const lastNotification = this.failureNotifications.get(notificationKey);

        // Check cooldown period
        if (lastNotification && now - lastNotification < this.failureCooldownMs) {
            return; // Still in cooldown
        }

        this.failureNotifications.set(notificationKey, now);

        // Log the failure
        this.logger.error(`🚨 LBANK FAILURE NOTIFICATION: ${type} - ${message}`);

        // Send Telegram notification
        try {
            await this.telegramService.sendSystemAlert(`🚨 **LBank Exchange Failure**\n\n**Type:** ${type}\n**Details:** ${message}\n\n⚠️ Please check LBank API status and fix if needed.`);
        } catch (telegramError) {
            this.logger.error(`❌ Failed to send Telegram notification: ${telegramError.message}`);
        }
    }
} 