import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as WebSocket from 'ws';
import { PriceData, SupportedExchanges, ExchangeSymbol } from '@/common/types';

@Injectable()
export class BinanceService {
    private readonly logger = new Logger(BinanceService.name);
    private readonly baseUrl = 'wss://fstream.binance.com/ws/';
    private readonly apiUrl = 'https://fapi.binance.com/fapi/v1';
    private readonly connections = new Map<string, WebSocket>();
    private readonly subscriptions = new Map<string, (data: PriceData) => void>();
    private isInitialized = false;

    constructor(private readonly configService: ConfigService) { }

    async initialize(): Promise<void> {
        this.logger.log('🔄 Initializing Binance service...');
        this.isInitialized = true;
        this.logger.log('✅ Binance service initialized');
    }

    async disconnect(): Promise<void> {
        this.logger.log('🔄 Disconnecting from Binance...');

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

        this.logger.log('✅ Disconnected from Binance');
    }

    async subscribeToTicker(symbol: string, callback: (data: PriceData) => void): Promise<void> {
        if (!this.isInitialized) {
            throw new Error('Binance service not initialized');
        }

        const streamSymbol = this.formatSymbolForStream(symbol);
        const streamName = `${streamSymbol}@ticker`;

        this.logger.log(`📡 Subscribing to Binance ticker: ${streamName}`);

        try {
            const ws = new WebSocket(`${this.baseUrl}${streamName}`);

            ws.on('open', () => {
                this.logger.log(`✅ Connected to Binance WebSocket for ${symbol}`);
                this.connections.set(symbol, ws);
                this.subscriptions.set(symbol, callback);
            });

            ws.on('message', (data: Buffer) => {
                try {
                    const message = JSON.parse(data.toString());
                    const priceData = this.parseTickerData(message, symbol);
                    callback(priceData);
                } catch (error) {
                    this.logger.error(`❌ Error parsing Binance ticker data: ${error.message}`);
                }
            });

            ws.on('error', (error) => {
                this.logger.error(`❌ Binance WebSocket error for ${symbol}: ${error.message}`);
            });

            ws.on('close', (code, reason) => {
                this.logger.warn(`⚠️ Binance WebSocket closed for ${symbol}: ${code} - ${reason}`);
                this.connections.delete(symbol);

                // Attempt to reconnect after a delay
                setTimeout(() => {
                    this.reconnectTicker(symbol, callback);
                }, 5000);
            });

        } catch (error) {
            this.logger.error(`❌ Failed to subscribe to Binance ticker ${symbol}: ${error.message}`);
            throw error;
        }
    }

    async getSymbols(): Promise<ExchangeSymbol[]> {
        try {
            const response = await fetch(`${this.apiUrl}/exchangeInfo`);
            const data = await response.json();

            return data.symbols
                .filter((symbol: any) => symbol.status === 'TRADING')
                .map((symbol: any) => ({
                    symbol: `${symbol.baseAsset}/${symbol.quoteAsset}`,
                    baseAsset: symbol.baseAsset,
                    quoteAsset: symbol.quoteAsset,
                    status: symbol.status,
                    exchange: SupportedExchanges.BINANCE,
                    minTradeAmount: parseFloat(symbol.filters?.find((f: any) => f.filterType === 'LOT_SIZE')?.minQty || '0'),
                    tickSize: parseFloat(symbol.filters?.find((f: any) => f.filterType === 'PRICE_FILTER')?.tickSize || '0'),
                    lastUpdated: Date.now(),
                }));
        } catch (error) {
            this.logger.error(`❌ Failed to fetch Binance symbols: ${error.message}`);
            return [];
        }
    }

    private async reconnectTicker(symbol: string, callback: (data: PriceData) => void): Promise<void> {
        if (!this.isInitialized || this.connections.has(symbol)) {
            return;
        }

        this.logger.log(`🔄 Reconnecting to Binance ticker: ${symbol}`);

        try {
            await this.subscribeToTicker(symbol, callback);
        } catch (error) {
            this.logger.error(`❌ Failed to reconnect to Binance ticker ${symbol}: ${error.message}`);

            // Retry after a longer delay
            setTimeout(() => {
                this.reconnectTicker(symbol, callback);
            }, 30000);
        }
    }

    private formatSymbolForStream(symbol: string): string {
        // Convert BTC/USDT to btcusdt
        return symbol.replace('/', '').toLowerCase();
    }

    private parseTickerData(data: any, symbol: string): PriceData {
        return {
            symbol,
            price: parseFloat(data.c), // Close price
            exchange: SupportedExchanges.BINANCE,
            timestamp: Date.now(),
            volume: parseFloat(data.v), // Volume
            high: parseFloat(data.h), // High price
            low: parseFloat(data.l), // Low price
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