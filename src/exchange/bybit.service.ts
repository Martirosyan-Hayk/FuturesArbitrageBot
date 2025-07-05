import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as WebSocket from 'ws';
import { PriceData, SupportedExchanges, ExchangeSymbol } from '@/common/types';

@Injectable()
export class BybitService {
    private readonly logger = new Logger(BybitService.name);
    private readonly baseUrl = 'wss://stream.bybit.com/v5/public/linear';
    private readonly apiUrl = 'https://api.bybit.com/v5';
    private readonly connections = new Map<string, WebSocket>();
    private readonly subscriptions = new Map<string, (data: PriceData) => void>();
    private isInitialized = false;

    constructor(private readonly configService: ConfigService) { }

    async initialize(): Promise<void> {
        this.logger.log('🔄 Initializing ByBit service...');
        this.isInitialized = true;
        this.logger.log('✅ ByBit service initialized');
    }

    async disconnect(): Promise<void> {
        this.logger.log('🔄 Disconnecting from ByBit...');

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

        this.logger.log('✅ Disconnected from ByBit');
    }

    async subscribeToTicker(symbol: string, callback: (data: PriceData) => void): Promise<void> {
        if (!this.isInitialized) {
            throw new Error('ByBit service not initialized');
        }

        const streamSymbol = this.formatSymbolForStream(symbol);

        this.logger.log(`📡 Subscribing to ByBit ticker: ${streamSymbol}`);

        try {
            const ws = new WebSocket(this.baseUrl);

            ws.on('open', () => {
                this.logger.log(`✅ Connected to ByBit WebSocket for ${symbol}`);
                this.connections.set(symbol, ws);
                this.subscriptions.set(symbol, callback);

                // Subscribe to ticker stream
                const subscribeMessage = {
                    op: 'subscribe',
                    args: [`tickers.${streamSymbol}`]
                };

                ws.send(JSON.stringify(subscribeMessage));
            });

            ws.on('message', (data: Buffer) => {
                try {
                    const message = JSON.parse(data.toString());

                    if (message.topic && message.topic.includes('tickers') && message.data) {
                        const priceData = this.parseTickerData(message.data, symbol);
                        callback(priceData);
                    }
                } catch (error) {
                    this.logger.error(`❌ Error parsing ByBit ticker data: ${error.message}`);
                }
            });

            ws.on('error', (error) => {
                this.logger.error(`❌ ByBit WebSocket error for ${symbol}: ${error.message}`);
            });

            ws.on('close', (code, reason) => {
                this.logger.warn(`⚠️ ByBit WebSocket closed for ${symbol}: ${code} - ${reason}`);
                this.connections.delete(symbol);

                // Attempt to reconnect after a delay
                setTimeout(() => {
                    this.reconnectTicker(symbol, callback);
                }, 5000);
            });

        } catch (error) {
            this.logger.error(`❌ Failed to subscribe to ByBit ticker ${symbol}: ${error.message}`);
            throw error;
        }
    }

    async getSymbols(): Promise<ExchangeSymbol[]> {
        try {
            const response = await fetch(`${this.apiUrl}/market/instruments-info?category=linear`);
            const data = await response.json();

            if (data.retCode !== 0) {
                throw new Error(`ByBit API error: ${data.retMsg}`);
            }

            return data.result.list
                .filter((symbol: any) => symbol.status === 'Trading')
                .map((symbol: any) => ({
                    symbol: `${symbol.baseCoin}/${symbol.quoteCoin}`,
                    baseAsset: symbol.baseCoin,
                    quoteAsset: symbol.quoteCoin,
                    status: symbol.status,
                    exchange: SupportedExchanges.BYBIT,
                    minTradeAmount: parseFloat(symbol.lotSizeFilter?.minOrderQty || '0'),
                    tickSize: parseFloat(symbol.priceFilter?.tickSize || '0'),
                    lastUpdated: Date.now(),
                }));
        } catch (error) {
            this.logger.error(`❌ Failed to fetch ByBit symbols: ${error.message}`);
            return [];
        }
    }

    private async reconnectTicker(symbol: string, callback: (data: PriceData) => void): Promise<void> {
        if (!this.isInitialized || this.connections.has(symbol)) {
            return;
        }

        this.logger.log(`🔄 Reconnecting to ByBit ticker: ${symbol}`);

        try {
            await this.subscribeToTicker(symbol, callback);
        } catch (error) {
            this.logger.error(`❌ Failed to reconnect to ByBit ticker ${symbol}: ${error.message}`);

            // Retry after a longer delay
            setTimeout(() => {
                this.reconnectTicker(symbol, callback);
            }, 30000);
        }
    }

    private formatSymbolForStream(symbol: string): string {
        // Convert BTC/USDT to BTCUSDT
        return symbol.replace('/', '');
    }

    private parseTickerData(data: any, symbol: string): PriceData {
        return {
            symbol,
            price: parseFloat(data.lastPrice), // Last price
            exchange: SupportedExchanges.BYBIT,
            timestamp: Date.now(),
            volume: parseFloat(data.volume24h), // 24h volume
            high: parseFloat(data.highPrice24h), // 24h high
            low: parseFloat(data.lowPrice24h), // 24h low
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
} 