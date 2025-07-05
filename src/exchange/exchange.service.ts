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
} 