import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { TelegramService } from '@/telegram/telegram.service';
import { ArbitrageOpportunity, ArbitrageOpportunityClosed } from '@/common/types';

@Processor('arbitrage')
export class ArbitrageProcessor {
    private readonly logger = new Logger(ArbitrageProcessor.name);

    constructor(private readonly telegramService: TelegramService) { }

    @Process('processOpportunity')
    async processArbitrageOpportunity(job: Job<ArbitrageOpportunity>): Promise<void> {
        const opportunity = job.data;

        this.logger.log(`🔄 processOpportunity: ${JSON.stringify(job.data)}`);
        try {
            // Validate opportunity data before processing
            if (opportunity.action === 'INVALID' ||
                opportunity.priceA === null || opportunity.priceB === null ||
                opportunity.priceDifference === null || opportunity.priceDifferencePercent === null ||
                opportunity.profit === null) {
                this.logger.warn(`⚠️ Skipping invalid arbitrage opportunity: ${opportunity.symbol}`);
                return;
            }

            this.logger.log(`🔄 Processing arbitrage opportunity: ${opportunity.symbol} - ${opportunity.priceDifferencePercent.toFixed(2)}%`);

            // Send Telegram notification
            await this.telegramService.sendArbitrageAlert(opportunity);

            this.logger.log(`✅ Arbitrage opportunity processed successfully: ${opportunity.symbol}`);
        } catch (error) {
            this.logger.error(`❌ Error processing arbitrage opportunity: ${error.message}`);
            throw error; // Re-throw to trigger retry mechanism
        }
    }

    @Process('processClosedOpportunity')
    async processClosedArbitrageOpportunity(job: Job<ArbitrageOpportunityClosed>): Promise<void> {
        const closedOpportunity = job.data;

        this.logger.log(`🔄 processClosedOpportunity: ${JSON.stringify({
            id: closedOpportunity.id,
            symbol: closedOpportunity.symbol,
            duration: `${(closedOpportunity.duration / 60000).toFixed(1)}m`,
            reason: closedOpportunity.closeReason
        })}`);

        try {
            this.logger.log(`🔄 Processing closed arbitrage opportunity: ${closedOpportunity.symbol} - Duration: ${(closedOpportunity.duration / 60000).toFixed(1)}m`);

            // Send Telegram notification for closed opportunity
            await this.telegramService.sendArbitrageClosedAlert(closedOpportunity);

            this.logger.log(`✅ Closed arbitrage opportunity processed successfully: ${closedOpportunity.symbol}`);
        } catch (error) {
            this.logger.error(`❌ Error processing closed arbitrage opportunity: ${error.message}`);
            throw error; // Re-throw to trigger retry mechanism
        }
    }
} 