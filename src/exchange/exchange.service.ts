import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BinanceService } from './binance.service';
import { BybitService } from './bybit.service';
import { MexcService } from './mexc.service';
import { GateioService } from './gateio.service';
import { LbankService } from './lbank.service';
import { PriceService } from '@/price/price.service';
import { PriceData, SupportedExchanges } from '@/common/types';

@Injectable()
export class ExchangeService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(ExchangeService.name);
    private readonly exchangeServices = new Map<string, any>();
    private readonly tradingPairs: string[] = [];

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

        // Get trading pairs from config
        const pairs = this.configService.get<string>('TRADING_PAIRS', 'BTC/USDT,ETH/USDT');
        this.tradingPairs = pairs.split(',').map(pair => pair.trim());
    }

    async onModuleInit() {
        this.logger.log('🔄 Initializing exchange connections...');

        // Initialize all exchange services
        for (const [exchangeName, service] of this.exchangeServices) {
            try {
                await service.initialize();
                this.logger.log(`✅ ${exchangeName} initialized successfully`);
            } catch (error) {
                this.logger.error(`❌ Failed to initialize ${exchangeName}: ${error.message}`);
            }
        }

        // Start WebSocket connections
        await this.startWebSocketConnections();

        // Start periodic health checks
        this.startHealthChecks();
    }

    async onModuleDestroy() {
        this.logger.log('🔄 Shutting down exchange connections...');

        // Disconnect all exchange services
        for (const [exchangeName, service] of this.exchangeServices) {
            try {
                await service.disconnect();
                this.logger.log(`✅ ${exchangeName} disconnected successfully`);
            } catch (error) {
                this.logger.error(`❌ Failed to disconnect ${exchangeName}: ${error.message}`);
            }
        }
    }

    private async startWebSocketConnections() {
        this.logger.log('🔄 Starting WebSocket connections...');

        for (const [exchangeName, service] of this.exchangeServices) {
            try {
                // Subscribe to price updates for all trading pairs
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
} 