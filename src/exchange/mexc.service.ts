import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as WebSocket from 'ws';
import { PriceData, SupportedExchanges, ExchangeSymbol } from '@/common/types';

@Injectable()
export class MexcService {
    private readonly logger = new Logger(MexcService.name);
    private readonly baseUrl = 'wss://contract.mexc.com/edge';
    private readonly apiUrl = 'https://contract.mexc.com/api/v1';
    private readonly connections = new Map<string, WebSocket>();
    private readonly subscriptions = new Map<string, (data: PriceData) => void>();
    private isInitialized = false;

    constructor(private readonly configService: ConfigService) { }

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
                }, 10000); // Increased delay for MEXC
            });

        } catch (error) {
            this.logger.error(`❌ Failed to subscribe to MEXC ticker ${symbol}: ${error.message}`);
            throw error;
        }
    }

    async getSymbols(): Promise<ExchangeSymbol[]> {
        try {
            const response = await fetch(`${this.apiUrl}/contract/detail`);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            if (data.code !== 200) {
                throw new Error(`MEXC API error: ${data.msg || 'Unknown error'}`);
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
            }, 60000); // 1 minute delay for MEXC
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
} 