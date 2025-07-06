import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BinanceService } from './binance.service';
import { BybitService } from './bybit.service';
import { MexcService } from './mexc.service';
import { GateioService } from './gateio.service';
import { LbankService } from './lbank.service';
import { PriceService } from '@/price/price.service';
import { PriceData, SupportedExchanges, ExchangeSymbol } from '@/common/types';

@Injectable()
export class ExchangeService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(ExchangeService.name);
    private readonly exchangeServices = new Map<string, any>();
    private tradingPairs: string[] = [];
    private readonly discoveredSymbols = new Map<string, Set<string>>(); // exchange -> symbols
    private readonly minExchangeCount: number; // Minimum exchanges required for a pair

    constructor(
        private readonly configService: ConfigService,
        private readonly priceService: PriceService,
        private readonly binanceService: BinanceService,
        private readonly bybitService: BybitService,
        private readonly mexcService: MexcService,
        private readonly gateioService: GateioService,
        private readonly lbankService: LbankService,
    ) {
        // Register exchange services
        this.exchangeServices.set(SupportedExchanges.BINANCE, this.binanceService);
        this.exchangeServices.set(SupportedExchanges.BYBIT, this.bybitService);
        this.exchangeServices.set(SupportedExchanges.MEXC, this.mexcService);
        this.exchangeServices.set(SupportedExchanges.GATEIO, this.gateioService);
        this.exchangeServices.set(SupportedExchanges.LBANK, this.lbankService);

        // Initialize minimum exchange count from config
        this.minExchangeCount = parseInt(this.configService.get<string>('MIN_EXCHANGES_FOR_PAIR', '2'));

        // Initialize with default pairs from config (as fallback)
        const pairs = this.configService.get<string>('TRADING_PAIRS', 'BTC/USDT,ETH/USDT');
        this.tradingPairs = pairs.split(',').map(pair => pair.trim());
    }

    async onModuleInit() {
        this.logger.log('🔄 Initializing Exchange Service...');

        // Discover common USDT pairs across all exchanges
        await this.discoverCommonUSDTPairs();

        await this.startWebSocketConnections();
        this.logger.log('✅ Exchange Service initialized');
    }

    async onModuleDestroy() {
        this.logger.log('🔄 Shutting down Exchange Service...');

        // Disconnect all exchange services
        for (const [exchangeName, service] of this.exchangeServices) {
            try {
                await service.disconnect();
                this.logger.log(`✅ ${exchangeName} disconnected successfully`);
            } catch (error) {
                this.logger.error(`❌ Failed to disconnect ${exchangeName}: ${error.message}`);
            }
        }

        this.logger.log('✅ Exchange Service shut down');
    }

    /**
     * Discover all USDT pairs that exist on at least the minimum number of exchanges
     */
    async discoverCommonUSDTPairs(): Promise<void> {
        this.logger.log('🔍 Discovering common USDT pairs across exchanges...');

        try {
            // Fetch symbols from all exchanges
            const symbolDiscoveryPromises = Array.from(this.exchangeServices.entries()).map(
                async ([exchangeName, service]) => {
                    try {
                        const symbols = await service.getSymbols();
                        const usdtSymbols = symbols
                            .filter((symbol: ExchangeSymbol) => symbol.quoteAsset === 'USDT')
                            .map((symbol: ExchangeSymbol) => symbol.symbol);

                        this.discoveredSymbols.set(exchangeName, new Set(usdtSymbols));
                        this.logger.log(`📊 ${exchangeName}: Found ${usdtSymbols.length} USDT pairs`);

                        return { exchangeName, symbols: usdtSymbols };
                    } catch (error) {
                        this.logger.error(`❌ Failed to fetch symbols from ${exchangeName}: ${error.message}`);
                        this.discoveredSymbols.set(exchangeName, new Set());
                        return { exchangeName, symbols: [] };
                    }
                }
            );

            await Promise.all(symbolDiscoveryPromises);

            // Find common USDT pairs
            const commonPairs = this.findCommonUSDTPairs();

            if (commonPairs.length === 0) {
                this.logger.warn('⚠️ No common USDT pairs found! Using fallback pairs from config.');
                // Keep the original pairs from config as fallback
            } else {
                this.tradingPairs = commonPairs;
                this.logger.log(`✅ Discovered ${commonPairs.length} common USDT pairs:`);
                this.logger.log(`   ${commonPairs.join(', ')}`);
            }

        } catch (error) {
            this.logger.error(`❌ Error discovering common USDT pairs: ${error.message}`);
            this.logger.log('🔄 Using fallback pairs from configuration');
        }
    }

    /**
     * Find USDT pairs that exist on at least the minimum number of exchanges
     */
    private findCommonUSDTPairs(): string[] {
        const pairCounts = new Map<string, number>();
        const pairExchanges = new Map<string, string[]>();

        // Count how many exchanges each pair appears on
        for (const [exchangeName, symbols] of this.discoveredSymbols) {
            for (const symbol of symbols) {
                const currentCount = pairCounts.get(symbol) || 0;
                pairCounts.set(symbol, currentCount + 1);

                if (!pairExchanges.has(symbol)) {
                    pairExchanges.set(symbol, []);
                }
                pairExchanges.get(symbol)!.push(exchangeName);
            }
        }

        // Filter pairs that exist on at least minExchangeCount exchanges
        const commonPairs: string[] = [];
        for (const [symbol, count] of pairCounts) {
            if (count >= this.minExchangeCount) {
                commonPairs.push(symbol);
                const exchanges = pairExchanges.get(symbol) || [];
                this.logger.debug(`🔗 ${symbol} available on: ${exchanges.join(', ')}`);
            }
        }

        // Sort pairs by popularity (number of exchanges)
        commonPairs.sort((a, b) => {
            const countA = pairCounts.get(a) || 0;
            const countB = pairCounts.get(b) || 0;
            return countB - countA; // Sort descending
        });

        return commonPairs;
    }

    private async startWebSocketConnections() {
        this.logger.log('🔄 Starting WebSocket connections...');

        // Initialize all exchange services first
        for (const [exchangeName, service] of this.exchangeServices) {
            try {
                await service.initialize();
                this.logger.log(`✅ ${exchangeName} initialized successfully`);
            } catch (error) {
                this.logger.error(`❌ Failed to initialize ${exchangeName}: ${error.message}`);
            }
        }

        // Subscribe to price updates for all trading pairs
        for (const [exchangeName, service] of this.exchangeServices) {
            try {
                for (const pair of this.tradingPairs) {
                    await service.subscribeToTicker(pair, (priceData: PriceData) => {
                        this.handlePriceUpdate(priceData);
                    });
                }

                this.logger.log(`📡 WebSocket subscriptions started for ${exchangeName}`);
            } catch (error) {
                this.logger.error(`❌ Failed to start WebSocket for ${exchangeName}: ${error.message}`);
            }
        }

        // Start periodic health checks
        this.startHealthChecks();
    }

    private handlePriceUpdate(priceData: PriceData) {
        try {
            // Update price in the price service
            this.priceService.updatePrice(priceData);

            // Log price update (debug level to avoid spam)
            this.logger.debug(`💰 Price update: ${priceData.symbol} on ${priceData.exchange} = $${priceData.price}`);
        } catch (error) {
            this.logger.error(`❌ Error handling price update: ${error.message}`);
        }
    }

    /**
     * Get all active exchanges
     */
    getActiveExchanges(): string[] {
        return Array.from(this.exchangeServices.keys());
    }

    /**
     * Get trading pairs being monitored
     */
    getTradingPairs(): string[] {
        return this.tradingPairs;
    }

    /**
     * Get exchange service by name
     */
    getExchangeService(exchangeName: string): any {
        return this.exchangeServices.get(exchangeName);
    }

    /**
     * Check if an exchange is connected
     */
    isExchangeConnected(exchangeName: string): boolean {
        const service = this.exchangeServices.get(exchangeName);
        return service ? service.isConnected() : false;
    }

    /**
     * Get connection status of all exchanges
     */
    getConnectionStatus(): Record<string, boolean> {
        const status: Record<string, boolean> = {};

        for (const [exchangeName, service] of this.exchangeServices) {
            status[exchangeName] = service.isConnected();
        }

        return status;
    }

    /**
     * Reconnect to a specific exchange
     */
    async reconnectExchange(exchangeName: string): Promise<void> {
        const service = this.exchangeServices.get(exchangeName);

        if (!service) {
            throw new Error(`Exchange ${exchangeName} not found`);
        }

        this.logger.log(`🔄 Reconnecting to ${exchangeName}...`);

        try {
            await service.disconnect();
            await service.initialize();

            // Re-subscribe to tickers
            for (const pair of this.tradingPairs) {
                await service.subscribeToTicker(pair, (priceData: PriceData) => {
                    this.handlePriceUpdate(priceData);
                });
            }

            this.logger.log(`✅ Successfully reconnected to ${exchangeName}`);
        } catch (error) {
            this.logger.error(`❌ Failed to reconnect to ${exchangeName}: ${error.message}`);
            throw error;
        }
    }

    private startHealthChecks() {
        // Check exchange health every 5 minutes
        setInterval(() => {
            this.performHealthCheck();
        }, 5 * 60 * 1000); // 5 minutes

        // Initial health check after 30 seconds
        setTimeout(() => {
            this.performHealthCheck();
        }, 30 * 1000);
    }

    private async performHealthCheck() {
        this.logger.log('🏥 Performing exchange health check...');

        const workingExchanges: string[] = [];
        const failedExchanges: string[] = [];

        for (const [exchangeName, service] of this.exchangeServices) {
            try {
                const isConnected = service.isConnected();
                const connectionCount = service.getConnectionCount ? service.getConnectionCount() : 0;

                if (isConnected && connectionCount > 0) {
                    workingExchanges.push(`${exchangeName} (${connectionCount} connections)`);
                } else {
                    failedExchanges.push(exchangeName);

                    // Attempt to reconnect failed exchanges
                    this.logger.warn(`⚠️ ${exchangeName} is not connected, attempting to reconnect...`);
                    try {
                        await this.reconnectExchange(exchangeName);
                        this.logger.log(`✅ ${exchangeName} reconnected successfully`);
                    } catch (error) {
                        this.logger.error(`❌ Failed to reconnect ${exchangeName}: ${error.message}`);
                    }
                }
            } catch (error) {
                failedExchanges.push(exchangeName);
                this.logger.error(`❌ Health check failed for ${exchangeName}: ${error.message}`);
            }
        }

        // Log comprehensive status
        this.logger.log(`🏥 Health Check Results:`);
        this.logger.log(`   ✅ Working: ${workingExchanges.length > 0 ? workingExchanges.join(', ') : 'None'}`);
        this.logger.log(`   ❌ Failed: ${failedExchanges.length > 0 ? failedExchanges.join(', ') : 'None'}`);

        if (workingExchanges.length >= 2) {
            this.logger.log(`🎯 Arbitrage system operational with ${workingExchanges.length} exchanges`);
        } else {
            this.logger.warn(`⚠️ Only ${workingExchanges.length} exchanges working - arbitrage opportunities may be limited`);
        }
    }

    /**
     * Get detailed status of all exchanges
     */
    getDetailedStatus(): Record<string, any> {
        const status: Record<string, any> = {};

        for (const [exchangeName, service] of this.exchangeServices) {
            try {
                status[exchangeName] = {
                    connected: service.isConnected(),
                    connectionCount: service.getConnectionCount ? service.getConnectionCount() : 0,
                    connectedSymbols: service.getConnectedSymbols ? service.getConnectedSymbols() : [],
                    lastUpdate: new Date().toISOString()
                };
            } catch (error) {
                status[exchangeName] = {
                    connected: false,
                    connectionCount: 0,
                    connectedSymbols: [],
                    error: error.message,
                    lastUpdate: new Date().toISOString()
                };
            }
        }

        return status;
    }

    /**
     * Get information about discovered common pairs
     */
    getCommonPairsInfo(): Record<string, any> {
        const pairCounts = new Map<string, number>();
        const pairExchanges = new Map<string, string[]>();

        // Count how many exchanges each pair appears on
        for (const [exchangeName, symbols] of this.discoveredSymbols) {
            for (const symbol of symbols) {
                const currentCount = pairCounts.get(symbol) || 0;
                pairCounts.set(symbol, currentCount + 1);

                if (!pairExchanges.has(symbol)) {
                    pairExchanges.set(symbol, []);
                }
                pairExchanges.get(symbol)!.push(exchangeName);
            }
        }

        const commonPairs: Record<string, any> = {};
        for (const [symbol, count] of pairCounts) {
            if (count >= this.minExchangeCount) {
                commonPairs[symbol] = {
                    exchangeCount: count,
                    exchanges: pairExchanges.get(symbol) || [],
                    isMonitored: this.tradingPairs.includes(symbol)
                };
            }
        }

        return {
            totalDiscoveredPairs: pairCounts.size,
            commonPairs,
            commonPairsCount: Object.keys(commonPairs).length,
            minExchangeCount: this.minExchangeCount,
            activeTradingPairs: this.tradingPairs.length
        };
    }

    /**
     * Refresh discovered pairs and update trading pairs
     */
    async refreshCommonPairs(): Promise<void> {
        this.logger.log('🔄 Refreshing common USDT pairs...');

        const oldPairsCount = this.tradingPairs.length;
        await this.discoverCommonUSDTPairs();
        const newPairsCount = this.tradingPairs.length;

        this.logger.log(`🔄 Pairs refreshed: ${oldPairsCount} → ${newPairsCount}`);

        // Re-subscribe to new pairs if needed
        if (oldPairsCount !== newPairsCount) {
            this.logger.log('🔄 Re-subscribing to updated trading pairs...');
            await this.resubscribeToTradingPairs();
        }
    }

    /**
     * Re-subscribe to trading pairs on all exchanges
     */
    private async resubscribeToTradingPairs(): Promise<void> {
        for (const [exchangeName, service] of this.exchangeServices) {
            try {
                // Disconnect and reconnect to refresh subscriptions
                await service.disconnect();
                await service.initialize();

                // Subscribe to new pairs
                for (const pair of this.tradingPairs) {
                    await service.subscribeToTicker(pair, (priceData: PriceData) => {
                        this.handlePriceUpdate(priceData);
                    });
                }

                this.logger.log(`✅ Re-subscribed ${exchangeName} to ${this.tradingPairs.length} pairs`);
            } catch (error) {
                this.logger.error(`❌ Failed to re-subscribe ${exchangeName}: ${error.message}`);
            }
        }
    }

    /**
     * Get exchanges that have a specific symbol
     */
    getExchangesForSymbol(symbol: string): string[] {
        const exchanges: string[] = [];
        for (const [exchangeName, symbols] of this.discoveredSymbols) {
            if (symbols.has(symbol)) {
                exchanges.push(exchangeName);
            }
        }
        return exchanges;
    }

    /**
     * Check if a symbol is available on minimum required exchanges
     */
    isSymbolEligible(symbol: string): boolean {
        const exchanges = this.getExchangesForSymbol(symbol);
        return exchanges.length >= this.minExchangeCount;
    }
} 