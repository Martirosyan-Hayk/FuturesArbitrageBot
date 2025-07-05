import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as WebSocket from 'ws';
import { PriceData, SupportedExchanges, ExchangeSymbol } from '@/common/types';

@Injectable()
export class LbankService {
    private readonly logger = new Logger(LbankService.name);
    private readonly baseUrl = 'wss://www.lbkex.net/ws/V2/';
    private readonly apiUrl = 'https://www.lbank.info/v2';
    private readonly connections = new Map<string, WebSocket>();
    private readonly subscriptions = new Map<string, (data: PriceData) => void>();
    private isInitialized = false;

    constructor(private readonly configService: ConfigService) { }

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
                }, 5000);
            });

        } catch (error) {
            this.logger.error(`❌ Failed to subscribe to LBank ticker ${symbol}: ${error.message}`);
            throw error;
        }
    }

    async getSymbols(): Promise<ExchangeSymbol[]> {
        try {
            const response = await fetch(`${this.apiUrl}/currencyPairs.do`);
            const data = await response.json();

            if (!data.result || !Array.isArray(data.data)) {
                throw new Error('Invalid LBank API response');
            }

            return data.data.map((pair: string) => {
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
            }, 30000);
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
} 