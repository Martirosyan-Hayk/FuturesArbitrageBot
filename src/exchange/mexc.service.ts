import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as WebSocket from 'ws';
import { PriceData, SupportedExchanges, ExchangeSymbol } from '@/common/types';
import { TelegramService } from '@/telegram/telegram.service';

@Injectable()
export class MexcService {
    private readonly logger = new Logger(MexcService.name);
    private readonly baseUrl = 'wss://contract.mexc.com/edge';
    private readonly apiUrl = 'https://contract.mexc.com/api/v1';
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
        this.logger.log('🔄 Initializing MEXC service...');
        this.isInitialized = true;
        this.logger.log('✅ MEXC service initialized');
    }

    async disconnect(): Promise<void> {
        this.logger.log('🔄 Disconnecting from MEXC...');

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

        this.logger.log('✅ Disconnected from MEXC');
    }

    async subscribeToTicker(symbol: string, callback: (data: PriceData) => void): Promise<void> {
        if (!this.isInitialized) {
            throw new Error('MEXC service not initialized');
        }

        const streamSymbol = this.formatSymbolForStream(symbol);

        this.logger.log(`📡 Subscribing to MEXC ticker: ${streamSymbol}`);

        try {
            const ws = new WebSocket(this.baseUrl);

            ws.on('open', () => {
                this.logger.log(`✅ Connected to MEXC WebSocket for ${symbol}`);
                this.connections.set(symbol, ws);
                this.subscriptions.set(symbol, callback);

                // Subscribe to ticker stream with correct MEXC format
                const subscribeMessage = {
                    method: 'sub.overview',
                    param: {
                        symbol: streamSymbol
                    }
                };

                ws.send(JSON.stringify(subscribeMessage));
            });

            ws.on('message', (data: Buffer) => {
                try {
                    const message = JSON.parse(data.toString());

                    // Handle different message types from MEXC
                    if (message.channel && message.channel.includes('overview') && message.data) {
                        const priceData = this.parseTickerData(message.data, symbol);
                        callback(priceData);
                    } else if (message.data && message.symbol) {
                        // Alternative format
                        const priceData = this.parseTickerData(message.data, symbol);
                        callback(priceData);
                    }
                } catch (error) {
                    this.logger.error(`❌ Error parsing MEXC ticker data: ${error.message}`);
                }
            });

            ws.on('error', (error) => {
                this.logger.error(`❌ MEXC WebSocket error for ${symbol}: ${error.message}`);
            });

            ws.on('close', (code, reason) => {
                this.logger.warn(`⚠️ MEXC WebSocket closed for ${symbol}: ${code} - ${reason}`);
                this.connections.delete(symbol);

                // Attempt to reconnect after a delay
                setTimeout(() => {
                    this.reconnectTicker(symbol, callback);
                }, this.reconnectInterval);
            });

        } catch (error) {
            this.logger.error(`❌ Failed to subscribe to MEXC ticker ${symbol}: ${error.message}`);
            throw error;
        }
    }

    async getSymbols(): Promise<ExchangeSymbol[]> {
        try {
            // Try multiple MEXC endpoints
            const endpoints = [
                `${this.apiUrl}/contract/detail`,
                `https://contract.mexc.com/api/v1/contract/detail`,
                `https://www.mexc.com/api/v1/contract/detail`
            ];

            let data = null;
            let lastError = null;

            for (const endpoint of endpoints) {
                try {
                    this.logger.log(`🔄 Trying MEXC symbols endpoint: ${endpoint}`);

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

                    const text = await response.text();

                    // Check if response is HTML (error page)
                    if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
                        throw new Error('API returned HTML instead of JSON (likely blocked or rate limited)');
                    }

                    data = JSON.parse(text);

                    if (data.code !== 200) {
                        throw new Error(`MEXC API error: ${data.msg || 'Unknown error'}`);
                    }

                    this.logger.log(`✅ MEXC symbols fetched successfully from: ${endpoint}`);
                    break; // Success, exit loop

                } catch (error) {
                    lastError = error;
                    this.logger.warn(`⚠️ MEXC endpoint failed: ${endpoint} - ${error.message}`);
                    continue; // Try next endpoint
                }
            }

            if (!data) {
                throw new Error(`All MEXC endpoints failed. Last error: ${lastError?.message || 'Unknown error'}`);
            }

            return data.data
                .filter((symbol: any) => symbol.state === 1) // Active contracts
                .map((symbol: any) => ({
                    symbol: `${symbol.baseCoin}/${symbol.quoteCoin}`,
                    baseAsset: symbol.baseCoin,
                    quoteAsset: symbol.quoteCoin,
                    status: symbol.state === 1 ? 'TRADING' : 'INACTIVE',
                    exchange: SupportedExchanges.MEXC,
                    minTradeAmount: parseFloat(symbol.minOrderSize || '0'),
                    tickSize: parseFloat(symbol.priceScale || '0'),
                    lastUpdated: Date.now(),
                }));

        } catch (error) {
            this.logger.error(`❌ Failed to fetch MEXC symbols: ${error.message}`);

            // Send failure notification if enabled
            await this.notifyFailure('Symbol Fetch Failed', error.message);

            // Return fallback symbols only if enabled
            if (this.enableFallbacks) {
                this.logger.warn(`⚠️ Using fallback symbols for MEXC: ${this.fallbackSymbols.join(', ')}`);

                return this.fallbackSymbols.map(symbol => {
                    const [baseAsset, quoteAsset] = symbol.split('/');
                    return {
                        symbol,
                        baseAsset,
                        quoteAsset,
                        status: 'TRADING',
                        exchange: SupportedExchanges.MEXC,
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

        this.logger.log(`🔄 Reconnecting to MEXC ticker: ${symbol}`);

        try {
            await this.subscribeToTicker(symbol, callback);
        } catch (error) {
            this.logger.error(`❌ Failed to reconnect to MEXC ticker ${symbol}: ${error.message}`);

            // Retry after a longer delay
            setTimeout(() => {
                this.reconnectTicker(symbol, callback);
            }, this.reconnectInterval * 6); // 6x the normal interval for retries
        }
    }

    private formatSymbolForStream(symbol: string): string {
        // Convert BTC/USDT to BTC_USDT for MEXC
        return symbol.replace('/', '_');
    }

    private parseTickerData(data: any, symbol: string): PriceData {
        // Handle different data formats from MEXC
        const price = parseFloat(data.lastPrice || data.fairPrice || data.indexPrice || data.price || '0');
        const volume = parseFloat(data.volume24h || data.volume || data.vol || '0');
        const high = parseFloat(data.high24h || data.high || '0');
        const low = parseFloat(data.low24h || data.low || '0');

        return {
            symbol,
            price,
            exchange: SupportedExchanges.MEXC,
            timestamp: Date.now(),
            volume,
            high,
            low,
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
        this.logger.error(`🚨 MEXC FAILURE NOTIFICATION: ${type} - ${message}`);

        // Send Telegram notification
        try {
            await this.telegramService.sendSystemAlert(`🚨 **MEXC Exchange Failure**\n\n**Type:** ${type}\n**Details:** ${message}\n\n⚠️ Please check MEXC API status and fix if needed.`);
        } catch (telegramError) {
            this.logger.error(`❌ Failed to send Telegram notification: ${telegramError.message}`);
        }
    }
} 