import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ExchangeService } from '@/exchange/exchange.service';
import { PriceService } from '@/price/price.service';
import { TelegramService } from '@/telegram/telegram.service';
import { NewListing, NewListingAlert, ExchangeSymbol, SupportedExchanges } from '@/common/types';

@Injectable()
export class ListingsService implements OnModuleInit {
    private readonly logger = new Logger(ListingsService.name);
    private readonly knownSymbols = new Map<string, Set<string>>(); // exchange -> symbols
    private readonly newListings: NewListing[] = [];
    private readonly maxListingsHistory = 500;
    private readonly newListingThresholdHours = 24; // Consider symbols new if listed within 24 hours
    private isInitialized = false;

    constructor(
        private readonly configService: ConfigService,
        private readonly exchangeService: ExchangeService,
        private readonly priceService: PriceService,
        private readonly telegramService: TelegramService,
        @InjectQueue('listings') private readonly listingsQueue: Queue,
    ) { }

    async onModuleInit() {
        this.logger.log('🔄 Initializing new listings service...');

        // Initialize known symbols for each exchange
        setTimeout(async () => {
            await this.initializeKnownSymbols();
            this.isInitialized = true;
            this.logger.log('✅ New listings service initialized');
        }, 5000); // Wait for exchange services to initialize first
    }

    @Cron(CronExpression.EVERY_30_MINUTES)
    async checkForNewListings(): Promise<void> {
        if (!this.isInitialized) {
            return;
        }

        try {
            this.logger.log('🔍 Checking for new listings across all exchanges...');

            const exchanges = this.exchangeService.getActiveExchanges();

            for (const exchange of exchanges) {
                await this.checkExchangeForNewListings(exchange);
            }

        } catch (error) {
            this.logger.error(`❌ Error checking for new listings: ${error.message}`);
        }
    }

    private async initializeKnownSymbols(): Promise<void> {
        const exchanges = this.exchangeService.getActiveExchanges();

        for (const exchange of exchanges) {
            try {
                const symbols = await this.getExchangeSymbols(exchange);
                this.knownSymbols.set(exchange, new Set(symbols.map(s => s.symbol)));

                this.logger.log(`📊 Initialized ${symbols.length} symbols for ${exchange}`);
            } catch (error) {
                this.logger.error(`❌ Failed to initialize symbols for ${exchange}: ${error.message}`);
                this.knownSymbols.set(exchange, new Set());
            }
        }
    }

    private async checkExchangeForNewListings(exchange: string): Promise<void> {
        try {
            const currentSymbols = await this.getExchangeSymbols(exchange);
            const knownSymbolsSet = this.knownSymbols.get(exchange) || new Set();

            const newSymbols = currentSymbols.filter(symbol =>
                !knownSymbolsSet.has(symbol.symbol) && this.isRecentListing(symbol)
            );

            if (newSymbols.length > 0) {
                this.logger.log(`🆕 Found ${newSymbols.length} new listings on ${exchange}`);

                for (const symbol of newSymbols) {
                    const newListing = await this.createNewListing(symbol);
                    await this.processNewListing(newListing);

                    // Add to known symbols
                    knownSymbolsSet.add(symbol.symbol);
                }

                // Update known symbols
                this.knownSymbols.set(exchange, knownSymbolsSet);
            }

        } catch (error) {
            this.logger.error(`❌ Error checking new listings for ${exchange}: ${error.message}`);
        }
    }

    private async getExchangeSymbols(exchange: string): Promise<ExchangeSymbol[]> {
        const exchangeService = this.exchangeService.getExchangeService(exchange);

        if (!exchangeService || !exchangeService.getSymbols) {
            this.logger.warn(`⚠️ Exchange ${exchange} does not support symbol listing`);
            return [];
        }

        return await exchangeService.getSymbols();
    }

    private isRecentListing(symbol: ExchangeSymbol): boolean {
        const now = Date.now();
        const thresholdTime = now - (this.newListingThresholdHours * 60 * 60 * 1000);

        return symbol.lastUpdated >= thresholdTime;
    }

    private async createNewListing(symbol: ExchangeSymbol): Promise<NewListing> {
        // Try to get initial price data
        const priceData = this.priceService.getPrice(symbol.symbol, symbol.exchange);

        return {
            symbol: symbol.symbol,
            baseAsset: symbol.baseAsset,
            quoteAsset: symbol.quoteAsset,
            exchange: symbol.exchange,
            listingTime: symbol.lastUpdated,
            status: symbol.status as any,
            isNewListing: true,
            firstPrice: priceData?.price,
            volume24h: priceData?.volume,
            description: `New listing: ${symbol.baseAsset}/${symbol.quoteAsset} on ${symbol.exchange}`,
            tags: ['new-listing', 'futures'],
        };
    }

    private async processNewListing(listing: NewListing): Promise<void> {
        try {
            // Add to queue for processing
            await this.listingsQueue.add('processNewListing', listing, {
                priority: 100, // High priority for new listings
                attempts: 3,
            });

            // Store in history
            this.addToHistory(listing);

            this.logger.log(`🆕 New listing detected: ${listing.symbol} on ${listing.exchange}`);

        } catch (error) {
            this.logger.error(`❌ Error processing new listing: ${error.message}`);
        }
    }

    private addToHistory(listing: NewListing): void {
        this.newListings.push(listing);

        // Keep only the last N listings
        if (this.newListings.length > this.maxListingsHistory) {
            this.newListings.shift();
        }
    }

    /**
     * Check if a symbol is available across multiple exchanges for arbitrage
     */
    async checkCrossExchangeAvailability(symbol: string): Promise<string[]> {
        const availableExchanges: string[] = [];

        for (const [exchange, symbols] of this.knownSymbols) {
            if (symbols.has(symbol)) {
                availableExchanges.push(exchange);
            }
        }

        return availableExchanges;
    }

    /**
     * Create a new listing alert with arbitrage potential
     */
    async createNewListingAlert(listing: NewListing): Promise<NewListingAlert> {
        const availableExchanges = await this.checkCrossExchangeAvailability(listing.symbol);
        const priceData = availableExchanges.map(exchange =>
            this.priceService.getPrice(listing.symbol, exchange)
        ).filter(Boolean);

        // Check if there's arbitrage potential
        const potentialArbitrage = priceData.length >= 2 && this.hasPriceDifference(priceData);

        return {
            listing,
            availableExchanges,
            potentialArbitrage,
            priceData,
            timestamp: Date.now(),
        };
    }

    private hasPriceDifference(priceData: any[]): boolean {
        if (priceData.length < 2) return false;

        const prices = priceData.map(p => p.price);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const priceDifference = ((maxPrice - minPrice) / minPrice) * 100;

        return priceDifference > 0.5; // 0.5% threshold for potential arbitrage
    }

    /**
     * Get recent new listings
     */
    getRecentListings(limit: number = 50): NewListing[] {
        return this.newListings
            .sort((a, b) => b.listingTime - a.listingTime)
            .slice(0, limit);
    }

    /**
     * Get new listings for a specific exchange
     */
    getListingsByExchange(exchange: string, limit: number = 50): NewListing[] {
        return this.newListings
            .filter(listing => listing.exchange === exchange)
            .sort((a, b) => b.listingTime - a.listingTime)
            .slice(0, limit);
    }

    /**
     * Get listings statistics
     */
    getListingsStats(): any {
        const now = Date.now();
        const last24h = now - 24 * 60 * 60 * 1000;
        const last7d = now - 7 * 24 * 60 * 60 * 1000;

        const listings24h = this.newListings.filter(l => l.listingTime >= last24h);
        const listings7d = this.newListings.filter(l => l.listingTime >= last7d);

        const byExchange = this.newListings.reduce((acc, listing) => {
            acc[listing.exchange] = (acc[listing.exchange] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        return {
            total: this.newListings.length,
            last24h: listings24h.length,
            last7d: listings7d.length,
            byExchange,
            knownSymbolsCount: Object.fromEntries(
                Array.from(this.knownSymbols.entries()).map(([ex, symbols]) => [ex, symbols.size])
            ),
        };
    }

    /**
     * Force refresh symbols for all exchanges
     */
    async refreshAllSymbols(): Promise<void> {
        this.logger.log('🔄 Force refreshing symbols for all exchanges...');
        await this.initializeKnownSymbols();
        this.logger.log('✅ Symbols refreshed successfully');
    }

    /**
     * Add a symbol to monitoring (for testing)
     */
    addSymbolToMonitoring(exchange: string, symbol: string): void {
        const symbols = this.knownSymbols.get(exchange) || new Set();
        symbols.add(symbol);
        this.knownSymbols.set(exchange, symbols);
    }

    /**
     * Check if a symbol is being monitored
     */
    isSymbolMonitored(exchange: string, symbol: string): boolean {
        const symbols = this.knownSymbols.get(exchange);
        return symbols ? symbols.has(symbol) : false;
    }
} 