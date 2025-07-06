import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as WebSocket from 'ws';
import { PriceData, SupportedExchanges, ExchangeSymbol } from '@/common/types';

@Injectable()
export class GateioService {
    private readonly logger = new Logger(GateioService.name);
    private readonly baseUrl = 'wss://fx-ws.gateio.ws/v4/ws/usdt';
    private readonly apiUrl = 'https://api.gateio.ws/api/v4';
    private readonly connections = new Map<string, WebSocket>();
    private readonly subscriptions = new Map<string, (data: PriceData) => void>();
    private isInitialized = false;

    constructor(private readonly configService: ConfigService) {}

    async initialize(): Promise<void> {
        this.logger.log('🔄 Initializing Gate.io service...');
        this.isInitialized = true;
        this.logger.log('✅ Gate.io service initialized');
    }

    async disconnect(): Promise<void> {
        this.logger.log('🔄 Disconnecting from Gate.io...');

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

        this.logger.log('✅ Disconnected from Gate.io');
    }

    async subscribeToTicker(symbol: string, callback: (data: PriceData) => void): Promise<void> {
        if (!this.isInitialized) {
            throw new Error('Gate.io service not initialized');
        }

        const streamSymbol = this.formatSymbolForStream(symbol);

        this.logger.log(`📡 Subscribing to Gate.io ticker: ${streamSymbol}`);

        try {
            const ws = new WebSocket(this.baseUrl);

            ws.on('open', () => {
                this.logger.log(`✅ Connected to Gate.io WebSocket for ${symbol}`);
                this.connections.set(symbol, ws);
                this.subscriptions.set(symbol, callback);

                // Subscribe to ticker stream
                const subscribeMessage = {
                    time: Math.floor(Date.now() / 1000),
                    channel: 'futures.tickers',
                    event: 'subscribe',
                    payload: [streamSymbol]
                };

                ws.send(JSON.stringify(subscribeMessage));
            });

            ws.on('message', (data: Buffer) => {
                try {
                    const message = JSON.parse(data.toString());

                    if (message.channel === 'futures.tickers' && message.event === 'update' && message.result) {
                        const priceData = this.parseTickerData(message.result, symbol);
                        callback(priceData);
                    }
                } catch (error) {
                    this.logger.error(`❌ Error parsing Gate.io ticker data: ${error.message}`);
                }
            });

            ws.on('error', (error) => {
                this.logger.error(`❌ Gate.io WebSocket error for ${symbol}: ${error.message}`);
            });

            ws.on('close', (code, reason) => {
                this.logger.warn(`⚠️ Gate.io WebSocket closed for ${symbol}: ${code} - ${reason}`);
                this.connections.delete(symbol);

                // Attempt to reconnect after a delay
                setTimeout(() => {
                    this.reconnectTicker(symbol, callback);
                }, 5000);
            });

        } catch (error) {
            this.logger.error(`❌ Failed to subscribe to Gate.io ticker ${symbol}: ${error.message}`);
            throw error;
        }
    }

    async getSymbols(): Promise<ExchangeSymbol[]> {
        try {
            const response = await fetch(`${this.apiUrl}/futures/usdt/contracts`);
            const data = await response.json();

            return data
                .filter((contract: any) => contract.in_delisting === false)
                .map((contract: any) => {
                    const baseAsset = contract.name.split('_')[0];
                    const quoteAsset = contract.name.split('_')[1] || 'USDT';

                    return {
                        symbol: `${baseAsset}/${quoteAsset}`,
                        baseAsset,
                        quoteAsset,
                        status: contract.in_delisting ? 'DELISTING' : 'TRADING',
                        exchange: SupportedExchanges.GATEIO,
                        minTradeAmount: parseFloat(contract.order_size_min || '0'),
                        tickSize: parseFloat(contract.mark_price_round || '0'),
                        lastUpdated: Date.now(),
                    };
                });
        } catch (error) {
            this.logger.error(`❌ Failed to fetch Gate.io symbols: ${error.message}`);
            return [];
        }
    }

    private async reconnectTicker(symbol: string, callback: (data: PriceData) => void): Promise<void> {
        if (!this.isInitialized || this.connections.has(symbol)) {
            return;
        }

        this.logger.log(`🔄 Reconnecting to Gate.io ticker: ${symbol}`);

        try {
            await this.subscribeToTicker(symbol, callback);
        } catch (error) {
            this.logger.error(`❌ Failed to reconnect to Gate.io ticker ${symbol}: ${error.message}`);

            // Retry after a longer delay
            setTimeout(() => {
                this.reconnectTicker(symbol, callback);
            }, 30000);
        }
    }

    private formatSymbolForStream(symbol: string): string {
        // Convert BTC/USDT to BTC_USDT
        return symbol.replace('/', '_');
    }

    private parseTickerData(data: any, symbol: string): PriceData {
        return {
            symbol,
            price: parseFloat(data.last), // Last price
            exchange: SupportedExchanges.GATEIO,
            timestamp: Date.now(),
            volume: parseFloat(data.volume_24h || '0'), // 24h volume
            high: parseFloat(data.high_24h || '0'), // 24h high
            low: parseFloat(data.low_24h || '0'), // 24h low
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