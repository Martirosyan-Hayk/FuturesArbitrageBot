import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { ListingsService } from './listings.service';
import { TelegramService } from '@/telegram/telegram.service';
import { NewListing, NewListingAlert } from '@/common/types';

@Processor('listings')
export class ListingsProcessor {
    private readonly logger = new Logger(ListingsProcessor.name);

    constructor(
        private readonly listingsService: ListingsService,
        private readonly telegramService: TelegramService,
    ) { }

    @Process('processNewListing')
    async processNewListing(job: Job<NewListing>): Promise<void> {
        const listing = job.data;

        try {
            this.logger.log(`🔄 Processing new listing: ${listing.symbol} on ${listing.exchange}`);

            // Create detailed listing alert
            const alert = await this.listingsService.createNewListingAlert(listing);

            // Send Telegram notification
            await this.telegramService.sendNewListingAlert(alert);

            // If there's arbitrage potential, add to monitoring
            if (alert.potentialArbitrage) {
                this.logger.log(`🎯 Arbitrage potential detected for ${listing.symbol}`);
                // The arbitrage service will automatically pick this up through price monitoring
            }

            this.logger.log(`✅ New listing processed successfully: ${listing.symbol}`);
        } catch (error) {
            this.logger.error(`❌ Error processing new listing: ${error.message}`);
            throw error; // Re-throw to trigger retry mechanism
        }
    }

    @Process('checkArbitrageForListing')
    async checkArbitrageForListing(job: Job<{ symbol: string }>): Promise<void> {
        const { symbol } = job.data;

        try {
            this.logger.log(`🔍 Checking arbitrage potential for new listing: ${symbol}`);

            const availableExchanges = await this.listingsService.checkCrossExchangeAvailability(symbol);

            if (availableExchanges.length >= 2) {
                this.logger.log(`📊 ${symbol} is available on ${availableExchanges.length} exchanges: ${availableExchanges.join(', ')}`);

                // Send notification about cross-exchange availability
                await this.telegramService.sendSystemAlert(
                    `🔄 New listing ${symbol} is now available on multiple exchanges: ${availableExchanges.join(', ')}. Monitoring for arbitrage opportunities.`
                );
            }

        } catch (error) {
            this.logger.error(`❌ Error checking arbitrage for new listing: ${error.message}`);
            throw error;
        }
    }
} 