import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PriceService } from '@/price/price.service';
import { TelegramService } from '@/telegram/telegram.service';
import { ArbitrageOpportunity, PriceData, ArbitrageConfig, ActiveArbitrageOpportunity, ArbitrageOpportunityClosed } from '@/common/types';

@Injectable()
export class ArbitrageService {
    private readonly logger = new Logger(ArbitrageService.name);
    private readonly config: ArbitrageConfig;
    private readonly recentAlerts = new Map<string, number>();
    private readonly opportunityHistory: ArbitrageOpportunity[] = [];
    private readonly activeOpportunities = new Map<string, ActiveArbitrageOpportunity>();
    private readonly closedOpportunityHistory: ArbitrageOpportunityClosed[] = [];
    private readonly maxHistorySize = 1000;

    constructor(
        private readonly configService: ConfigService,
        private readonly priceService: PriceService,
        private readonly telegramService: TelegramService,
        @InjectQueue('arbitrage') private readonly arbitrageQueue: Queue,
    ) {
        this.config = {
            thresholdPercent: parseFloat(this.configService.get<string>('ARBITRAGE_THRESHOLD_PERCENT', '0.7')),
            closeThresholdPercent: parseFloat(this.configService.get<string>('ARBITRAGE_CLOSE_THRESHOLD_PERCENT', '0.5')),
            cooldownMinutes: parseInt(this.configService.get<string>('COOLDOWN_MINUTES', '5')),
            tradingPairs: this.configService.get<string>('TRADING_PAIRS', 'BTC/USDT,ETH/USDT').split(',').map(p => p.trim()),
            minProfitUsd: parseFloat(this.configService.get<string>('MIN_PROFIT_USD', '10')),
            sendClosedAlerts: this.configService.get<string>('SEND_CLOSED_ALERTS', 'true') === 'true',
            minOpportunityDurationForCloseAlert: parseInt(this.configService.get<string>('MIN_OPPORTUNITY_DURATION_FOR_CLOSE_ALERT', '2')),
        };

        this.logger.log(`📊 Arbitrage detector initialized:`);
        this.logger.log(`   - Open threshold: ${this.config.thresholdPercent}%`);
        this.logger.log(`   - Close threshold: ${this.config.closeThresholdPercent}%`);
        this.logger.log(`   - Cooldown: ${this.config.cooldownMinutes} minutes`);
        this.logger.log(`   - Trading pairs: ${this.config.tradingPairs.join(', ')}`);
        this.logger.log(`   - Min profit: $${this.config.minProfitUsd}`);
        this.logger.log(`   - Send closed alerts: ${this.config.sendClosedAlerts}`);
        this.logger.log(`   - Min duration for close alert: ${this.config.minOpportunityDurationForCloseAlert} minutes`);
    }

    @Cron(CronExpression.EVERY_10_SECONDS)
    async detectArbitrageOpportunities(): Promise<void> {
        try {
            // Check for closed opportunities first
            await this.checkForClosedOpportunities();

            // Find new opportunities
            const opportunities = await this.findArbitrageOpportunities();

            if (opportunities.length > 0) {
                this.logger.log(`🔍 Found ${opportunities.length} arbitrage opportunities`);

                for (const opportunity of opportunities) {
                    await this.processArbitrageOpportunity(opportunity);
                }
            }
        } catch (error) {
            this.logger.error(`❌ Error detecting arbitrage opportunities: ${error.message}`);
        }
    }

    private async findArbitrageOpportunities(): Promise<ArbitrageOpportunity[]> {
        const opportunities: ArbitrageOpportunity[] = [];

        for (const symbol of this.config.tradingPairs) {
            const prices = this.priceService.getAllPricesForSymbol(symbol);

            if (prices.length < 2) {
                continue; // Need at least 2 exchanges to compare
            }

            // Filter out stale prices
            const freshPrices = prices.filter(price => !this.priceService.isPriceStale(symbol, price.exchange));

            if (freshPrices.length < 2) {
                continue; // Need at least 2 fresh prices
            }

            // Compare all pairs of prices
            for (let i = 0; i < freshPrices.length; i++) {
                for (let j = i + 1; j < freshPrices.length; j++) {
                    const priceA = freshPrices[i];
                    const priceB = freshPrices[j];

                    const opportunity = this.calculateArbitrageOpportunity(priceA, priceB);

                    if (this.isValidArbitrageOpportunity(opportunity)) {
                        opportunities.push(opportunity);
                    }
                }
            }
        }

        return opportunities;
    }

    private calculateArbitrageOpportunity(priceA: PriceData, priceB: PriceData): ArbitrageOpportunity {
        // Validate that both prices are valid numbers
        if (!priceA || !priceB ||
            typeof priceA.price !== 'number' || typeof priceB.price !== 'number' ||
            priceA.price <= 0 || priceB.price <= 0 ||
            isNaN(priceA.price) || isNaN(priceB.price)) {

            this.logger.warn(`⚠️ Invalid price data: ${priceA?.symbol} - A: ${priceA?.price}, B: ${priceB?.price}`);

            return {
                symbol: priceA?.symbol || priceB?.symbol || 'UNKNOWN',
                exchangeA: priceA?.exchange || 'UNKNOWN',
                exchangeB: priceB?.exchange || 'UNKNOWN',
                priceA: priceA?.price || null,
                priceB: priceB?.price || null,
                priceDifference: null,
                priceDifferencePercent: null,
                profit: null,
                action: 'INVALID',
                timestamp: Date.now(),
            };
        }

        const priceDifference = Math.abs(priceA.price - priceB.price);
        const avgPrice = (priceA.price + priceB.price) / 2;
        const priceDifferencePercent = (priceDifference / avgPrice) * 100;

        // Determine action (buy low, sell high)
        const action = priceA.price < priceB.price ? 'BUY_A_SELL_B' : 'BUY_B_SELL_A';

        // Calculate potential profit (simplified calculation)
        const profit = priceDifference * 1000; // Assuming 1000 units trade size

        return {
            symbol: priceA.symbol,
            exchangeA: priceA.exchange,
            exchangeB: priceB.exchange,
            priceA: priceA.price,
            priceB: priceB.price,
            priceDifference,
            priceDifferencePercent,
            profit,
            action,
            timestamp: Date.now(),
        };
    }

    private isValidArbitrageOpportunity(opportunity: ArbitrageOpportunity): boolean {
        // Check if opportunity has valid data
        if (opportunity.action === 'INVALID' ||
            opportunity.priceA === null || opportunity.priceB === null ||
            opportunity.priceDifference === null || opportunity.priceDifferencePercent === null ||
            opportunity.profit === null) {
            return false;
        }

        // Check if price difference meets threshold
        if (opportunity.priceDifferencePercent < this.config.thresholdPercent) {
            return false;
        }

        // Check if profit meets minimum requirement
        if (opportunity.profit < this.config.minProfitUsd) {
            return false;
        }

        // Check cooldown period
        const alertKey = `${opportunity.symbol}-${opportunity.exchangeA}-${opportunity.exchangeB}`;
        const lastAlert = this.recentAlerts.get(alertKey);
        const cooldownMs = this.config.cooldownMinutes * 60 * 1000;

        if (lastAlert && Date.now() - lastAlert < cooldownMs) {
            return false; // Still in cooldown period
        }

        return true;
    }

    private async processArbitrageOpportunity(opportunity: ArbitrageOpportunity): Promise<void> {
        try {
            const opportunityId = this.generateOpportunityId(opportunity);
            const now = Date.now();

            // Check if this is an existing active opportunity
            let activeOpportunity = this.activeOpportunities.get(opportunityId);

            if (activeOpportunity) {
                // Update existing active opportunity
                this.updateActiveOpportunity(activeOpportunity, opportunity, now);

                // Check if we should send another alert (based on cooldown)
                const alertKey = `${opportunity.symbol}-${opportunity.exchangeA}-${opportunity.exchangeB}`;
                const lastAlert = this.recentAlerts.get(alertKey);
                const cooldownMs = this.config.cooldownMinutes * 60 * 1000;

                if (!lastAlert || now - lastAlert >= cooldownMs) {
                    // Send alert and update counter
                    await this.arbitrageQueue.add('processOpportunity', opportunity, {
                        priority: Math.floor(opportunity.priceDifferencePercent * 10),
                        attempts: 3,
                    });

                    this.recentAlerts.set(alertKey, now);
                    activeOpportunity.alertsSent++;

                    this.logger.log(`📈 Arbitrage opportunity update: ${opportunity.symbol} - ${opportunity.priceDifferencePercent.toFixed(2)}% (Alert #${activeOpportunity.alertsSent})`);
                }
            } else {
                // New opportunity - create active tracking
                activeOpportunity = {
                    ...opportunity,
                    id: opportunityId,
                    openTimestamp: now,
                    lastUpdatedTimestamp: now,
                    peakPriceDifferencePercent: opportunity.priceDifferencePercent || 0,
                    peakProfit: opportunity.profit || 0,
                    peakTimestamp: now,
                    alertsSent: 1,
                };

                this.activeOpportunities.set(opportunityId, activeOpportunity);

                // Send initial alert
                await this.arbitrageQueue.add('processOpportunity', opportunity, {
                    priority: Math.floor(opportunity.priceDifferencePercent * 10),
                    attempts: 3,
                });

                // Update recent alerts
                const alertKey = `${opportunity.symbol}-${opportunity.exchangeA}-${opportunity.exchangeB}`;
                this.recentAlerts.set(alertKey, now);

                this.logger.log(`📈 New arbitrage opportunity: ${opportunity.symbol} - ${opportunity.priceDifferencePercent.toFixed(2)}%`);
            }

            // Store in history
            this.addToHistory(opportunity);

        } catch (error) {
            this.logger.error(`❌ Error processing arbitrage opportunity: ${error.message}`);
        }
    }

    private generateOpportunityId(opportunity: ArbitrageOpportunity): string {
        // Create a unique ID based on symbol and exchanges (order-independent)
        const exchanges = [opportunity.exchangeA, opportunity.exchangeB].sort();
        return `${opportunity.symbol}-${exchanges[0]}-${exchanges[1]}`;
    }

    private addToHistory(opportunity: ArbitrageOpportunity): void {
        this.opportunityHistory.push(opportunity);

        // Keep only the last N opportunities
        if (this.opportunityHistory.length > this.maxHistorySize) {
            this.opportunityHistory.shift();
        }
    }

    private async checkForClosedOpportunities(): Promise<void> {
        if (!this.config.sendClosedAlerts) {
            return; // Skip if closed alerts are disabled
        }

        const now = Date.now();
        const closedOpportunities: ArbitrageOpportunityClosed[] = [];

        for (const [opportunityId, activeOpportunity] of this.activeOpportunities) {
            // Get current prices for this opportunity
            const currentOpportunity = await this.getCurrentOpportunityState(
                activeOpportunity.symbol,
                activeOpportunity.exchangeA,
                activeOpportunity.exchangeB
            );

            if (!currentOpportunity) {
                // Prices not available, mark as closed due to data unavailability
                const closedOpportunity = this.createClosedOpportunity(
                    activeOpportunity,
                    null,
                    null,
                    'PRICE_CONVERGED',
                    now
                );
                closedOpportunities.push(closedOpportunity);
                continue;
            }

            // Check if opportunity should be closed
            const shouldClose = this.shouldCloseOpportunity(currentOpportunity, activeOpportunity);

            if (shouldClose.close) {
                const closedOpportunity = this.createClosedOpportunity(
                    activeOpportunity,
                    currentOpportunity.priceA,
                    currentOpportunity.priceB,
                    shouldClose.reason,
                    now
                );
                closedOpportunities.push(closedOpportunity);
            } else {
                // Update active opportunity with current data
                this.updateActiveOpportunity(activeOpportunity, currentOpportunity, now);
            }
        }

        // Process closed opportunities
        for (const closedOpportunity of closedOpportunities) {
            await this.processClosedOpportunity(closedOpportunity);
            this.activeOpportunities.delete(closedOpportunity.id);
        }
    }

    private async getCurrentOpportunityState(
        symbol: string,
        exchangeA: string,
        exchangeB: string
    ): Promise<ArbitrageOpportunity | null> {
        const prices = this.priceService.getAllPricesForSymbol(symbol);
        const priceA = prices.find(p => p.exchange === exchangeA);
        const priceB = prices.find(p => p.exchange === exchangeB);

        if (!priceA || !priceB ||
            this.priceService.isPriceStale(symbol, exchangeA) ||
            this.priceService.isPriceStale(symbol, exchangeB)) {
            return null;
        }

        return this.calculateArbitrageOpportunity(priceA, priceB);
    }

    private shouldCloseOpportunity(
        currentOpportunity: ArbitrageOpportunity,
        activeOpportunity: ActiveArbitrageOpportunity
    ): { close: boolean; reason: 'BELOW_THRESHOLD' | 'PRICE_CONVERGED' | 'TIMEOUT' } {
        // Check if below close threshold
        if (currentOpportunity.priceDifferencePercent !== null &&
            currentOpportunity.priceDifferencePercent < this.config.closeThresholdPercent) {
            return { close: true, reason: 'BELOW_THRESHOLD' };
        }

        // Check if prices have converged (very small difference)
        if (currentOpportunity.priceDifferencePercent !== null &&
            currentOpportunity.priceDifferencePercent < 0.1) {
            return { close: true, reason: 'PRICE_CONVERGED' };
        }

        // Check for timeout (opportunity active for too long - 2 hours)
        const maxDuration = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
        if (Date.now() - activeOpportunity.openTimestamp > maxDuration) {
            return { close: true, reason: 'TIMEOUT' };
        }

        return { close: false, reason: 'BELOW_THRESHOLD' };
    }

    private updateActiveOpportunity(
        activeOpportunity: ActiveArbitrageOpportunity,
        currentOpportunity: ArbitrageOpportunity,
        now: number
    ): void {
        // Update current values
        activeOpportunity.priceA = currentOpportunity.priceA;
        activeOpportunity.priceB = currentOpportunity.priceB;
        activeOpportunity.priceDifference = currentOpportunity.priceDifference;
        activeOpportunity.priceDifferencePercent = currentOpportunity.priceDifferencePercent;
        activeOpportunity.profit = currentOpportunity.profit;
        activeOpportunity.lastUpdatedTimestamp = now;

        // Update peak values if necessary
        if (currentOpportunity.priceDifferencePercent !== null &&
            currentOpportunity.priceDifferencePercent > activeOpportunity.peakPriceDifferencePercent) {
            activeOpportunity.peakPriceDifferencePercent = currentOpportunity.priceDifferencePercent;
            activeOpportunity.peakProfit = currentOpportunity.profit || 0;
            activeOpportunity.peakTimestamp = now;
        }
    }

    private createClosedOpportunity(
        activeOpportunity: ActiveArbitrageOpportunity,
        closePriceA: number | null,
        closePriceB: number | null,
        closeReason: 'BELOW_THRESHOLD' | 'PRICE_CONVERGED' | 'MANUAL' | 'TIMEOUT',
        closeTimestamp: number
    ): ArbitrageOpportunityClosed {
        const duration = closeTimestamp - activeOpportunity.openTimestamp;

        // Calculate close values
        let closePriceDifference = 0;
        let closePriceDifferencePercent = 0;
        let closeProfit = 0;

        if (closePriceA !== null && closePriceB !== null) {
            closePriceDifference = Math.abs(closePriceA - closePriceB);
            const avgPrice = (closePriceA + closePriceB) / 2;
            closePriceDifferencePercent = (closePriceDifference / avgPrice) * 100;
            closeProfit = closePriceDifference * 1000; // Assuming 1000 units trade size
        }

        return {
            id: activeOpportunity.id,
            symbol: activeOpportunity.symbol,
            exchangeA: activeOpportunity.exchangeA,
            exchangeB: activeOpportunity.exchangeB,

            // Opening details (from when first detected)
            openPriceA: activeOpportunity.priceA || 0,
            openPriceB: activeOpportunity.priceB || 0,
            openPriceDifference: activeOpportunity.priceDifference || 0,
            openPriceDifferencePercent: activeOpportunity.priceDifferencePercent || 0,
            openProfit: activeOpportunity.profit || 0,
            openTimestamp: activeOpportunity.openTimestamp,

            // Closing details
            closePriceA: closePriceA || 0,
            closePriceB: closePriceB || 0,
            closePriceDifference,
            closePriceDifferencePercent,
            closeProfit,
            closeTimestamp,

            // Peak details
            peakPriceDifferencePercent: activeOpportunity.peakPriceDifferencePercent,
            peakProfit: activeOpportunity.peakProfit,
            peakTimestamp: activeOpportunity.peakTimestamp,

            // Summary
            duration,
            action: activeOpportunity.action === 'INVALID' ? 'BUY_A_SELL_B' : activeOpportunity.action,
            closeReason,
            alertsSent: activeOpportunity.alertsSent,
        };
    }

    private async processClosedOpportunity(closedOpportunity: ArbitrageOpportunityClosed): Promise<void> {
        // Check minimum duration requirement
        const durationMinutes = closedOpportunity.duration / (60 * 1000);
        if (durationMinutes < this.config.minOpportunityDurationForCloseAlert) {
            this.logger.log(`⏱️ Opportunity closed but too short (${durationMinutes.toFixed(1)}m) - no alert sent`);
            return;
        }

        try {
            // Add to closed opportunity queue for processing
            await this.arbitrageQueue.add('processClosedOpportunity', closedOpportunity, {
                priority: Math.floor(closedOpportunity.peakPriceDifferencePercent * 10),
                attempts: 3,
            });

            // Store in history
            this.closedOpportunityHistory.push(closedOpportunity);
            if (this.closedOpportunityHistory.length > this.maxHistorySize) {
                this.closedOpportunityHistory.shift();
            }

            this.logger.log(`📉 Arbitrage opportunity closed: ${closedOpportunity.symbol} - Duration: ${durationMinutes.toFixed(1)}m`);
        } catch (error) {
            this.logger.error(`❌ Error processing closed opportunity: ${error.message}`);
        }
    }

    /**
     * Get recent arbitrage opportunities
     */
    getRecentOpportunities(limit: number = 50): ArbitrageOpportunity[] {
        return this.opportunityHistory
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);
    }

    /**
     * Get arbitrage statistics
     */
    getArbitrageStats(): any {
        const now = Date.now();
        const last24h = now - 24 * 60 * 60 * 1000;
        const last1h = now - 60 * 60 * 1000;

        const opportunities24h = this.opportunityHistory.filter(op => op.timestamp >= last24h);
        const opportunities1h = this.opportunityHistory.filter(op => op.timestamp >= last1h);

        return {
            total: this.opportunityHistory.length,
            last24h: opportunities24h.length,
            last1h: opportunities1h.length,
            avgProfitPercent24h: opportunities24h.length > 0
                ? opportunities24h.reduce((sum, op) => sum + op.priceDifferencePercent, 0) / opportunities24h.length
                : 0,
            maxProfitPercent24h: opportunities24h.length > 0
                ? Math.max(...opportunities24h.map(op => op.priceDifferencePercent))
                : 0,
            config: this.config,
        };
    }

    /**
     * Update arbitrage configuration
     */
    updateConfig(newConfig: Partial<ArbitrageConfig>): void {
        Object.assign(this.config, newConfig);
        this.logger.log(`⚙️ Arbitrage configuration updated: ${JSON.stringify(newConfig)}`);
    }

    /**
     * Clear recent alerts (for testing purposes)
     */
    clearRecentAlerts(): void {
        this.recentAlerts.clear();
        this.logger.log('🧹 Recent alerts cleared');
    }
} 