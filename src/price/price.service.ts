import { Injectable, Logger } from '@nestjs/common';
import { PriceData } from '@/common/types';

@Injectable()
export class PriceService {
    private readonly logger = new Logger(PriceService.name);
    private readonly priceStore = new Map<string, PriceData>();
    private readonly priceHistory = new Map<string, PriceData[]>();
    private readonly maxHistorySize = 100;

    /**
     * Update price data for a specific symbol and exchange
     */
    updatePrice(priceData: PriceData): void {
        const key = this.getPriceKey(priceData.symbol, priceData.exchange);

        // Store latest price
        this.priceStore.set(key, priceData);

        // Update price history
        this.updatePriceHistory(key, priceData);

        this.logger.debug(`Updated price for ${priceData.symbol} on ${priceData.exchange}: $${priceData.price}`);
    }

    /**
     * Get latest price for a specific symbol and exchange
     */
    getPrice(symbol: string, exchange: string): PriceData | undefined {
        const key = this.getPriceKey(symbol, exchange);
        return this.priceStore.get(key);
    }

    /**
     * Get all prices for a specific symbol across all exchanges
     */
    getAllPricesForSymbol(symbol: string): PriceData[] {
        const prices: PriceData[] = [];

        for (const [key, priceData] of this.priceStore) {
            if (priceData.symbol === symbol) {
                prices.push(priceData);
            }
        }

        return prices;
    }

    /**
     * Get all current prices
     */
    getAllPrices(): PriceData[] {
        return Array.from(this.priceStore.values());
    }

    /**
     * Get price history for a specific symbol and exchange
     */
    getPriceHistory(symbol: string, exchange: string): PriceData[] {
        const key = this.getPriceKey(symbol, exchange);
        return this.priceHistory.get(key) || [];
    }

    /**
     * Get all available symbols
     */
    getAvailableSymbols(): string[] {
        const symbols = new Set<string>();

        for (const priceData of this.priceStore.values()) {
            symbols.add(priceData.symbol);
        }

        return Array.from(symbols);
    }

    /**
     * Get all available exchanges
     */
    getAvailableExchanges(): string[] {
        const exchanges = new Set<string>();

        for (const priceData of this.priceStore.values()) {
            exchanges.add(priceData.exchange);
        }

        return Array.from(exchanges);
    }

    /**
     * Check if price data is stale (older than 60 seconds)
     */
    isPriceStale(symbol: string, exchange: string): boolean {
        const priceData = this.getPrice(symbol, exchange);
        if (!priceData) return true;

        const now = Date.now();
        const ageInSeconds = (now - priceData.timestamp) / 1000;

        return ageInSeconds > 60;
    }

    /**
     * Clean up stale prices (older than 5 minutes)
     */
    cleanupStalePrices(): void {
        const now = Date.now();
        const staleThreshold = 5 * 60 * 1000; // 5 minutes

        for (const [key, priceData] of this.priceStore) {
            if (now - priceData.timestamp > staleThreshold) {
                this.priceStore.delete(key);
                this.priceHistory.delete(key);
                this.logger.warn(`Removed stale price data for ${priceData.symbol} on ${priceData.exchange}`);
            }
        }
    }

    private getPriceKey(symbol: string, exchange: string): string {
        return `${symbol}-${exchange}`;
    }

    private updatePriceHistory(key: string, priceData: PriceData): void {
        if (!this.priceHistory.has(key)) {
            this.priceHistory.set(key, []);
        }

        const history = this.priceHistory.get(key)!;
        history.push(priceData);

        // Keep only the last N prices
        if (history.length > this.maxHistorySize) {
            history.shift();
        }
    }
} 