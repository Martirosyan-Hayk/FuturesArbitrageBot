import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as TelegramBot from 'node-telegram-bot-api';
import { ArbitrageOpportunity, TelegramMessage, NewListingAlert, ArbitrageOpportunityClosed } from '@/common/types';

@Injectable()
export class TelegramService implements OnModuleInit {
    private readonly logger = new Logger(TelegramService.name);
    private bot: TelegramBot;
    private readonly chatId: string;
    private readonly isEnabled: boolean;

    constructor(private readonly configService: ConfigService) {
        const botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
        this.chatId = this.configService.get<string>('TELEGRAM_CHAT_ID');
        this.isEnabled = !!(botToken && this.chatId);

        if (this.isEnabled) {
            this.bot = new TelegramBot(botToken, { polling: false });
        } else {
            this.logger.warn('⚠️ Telegram bot not configured - notifications will be logged only');
        }
    }

    async onModuleInit() {
        if (this.isEnabled) {
            try {
                const botInfo = await this.bot.getMe();
                this.logger.log(`🤖 Telegram bot connected: @${botInfo.username}`);

                // Send startup message
                await this.sendMessage('🚀 Futures Arbitrage Bot Started!\n\nMonitoring arbitrage opportunities and new listings...');
            } catch (error) {
                this.logger.error(`❌ Failed to connect to Telegram: ${error.message}`);
            }
        }
    }

    async sendArbitrageAlert(opportunity: ArbitrageOpportunity): Promise<void> {
        const message = this.formatArbitrageMessage(opportunity);

        try {
            await this.sendMessage(message);

            // Safe logging with null check
            const percentText = opportunity.priceDifferencePercent !== null
                ? `${opportunity.priceDifferencePercent.toFixed(2)}%`
                : 'N/A';
            this.logger.log(`📱 Arbitrage alert sent: ${opportunity.symbol} - ${percentText}`);
        } catch (error) {
            this.logger.error(`❌ Failed to send arbitrage alert: ${error.message}`);
        }
    }

    async sendArbitrageClosedAlert(closedOpportunity: ArbitrageOpportunityClosed): Promise<void> {
        const message = this.formatArbitrageClosedMessage(closedOpportunity);

        try {
            await this.sendMessage(message);

            const durationText = `${(closedOpportunity.duration / 60000).toFixed(1)}m`;
            this.logger.log(`📱 Arbitrage closed alert sent: ${closedOpportunity.symbol} - Duration: ${durationText}`);
        } catch (error) {
            this.logger.error(`❌ Failed to send arbitrage closed alert: ${error.message}`);
        }
    }

    async sendNewListingAlert(alert: NewListingAlert): Promise<void> {
        const message = this.formatNewListingMessage(alert);

        try {
            await this.sendMessage(message);
            this.logger.log(`📱 New listing alert sent: ${alert.listing.symbol} on ${alert.listing.exchange}`);
        } catch (error) {
            this.logger.error(`❌ Failed to send new listing alert: ${error.message}`);
        }
    }

    async sendSystemAlert(message: string): Promise<void> {
        const formattedMessage = `🔔 System Alert\n\n${message}`;

        try {
            await this.sendMessage(formattedMessage);
            this.logger.log(`📱 System alert sent: ${message}`);
        } catch (error) {
            this.logger.error(`❌ Failed to send system alert: ${error.message}`);
        }
    }

    async sendErrorAlert(error: string): Promise<void> {
        const formattedMessage = `❌ Error Alert\n\n${error}`;

        try {
            await this.sendMessage(formattedMessage);
            this.logger.log(`📱 Error alert sent: ${error}`);
        } catch (error) {
            this.logger.error(`❌ Failed to send error alert: ${error.message}`);
        }
    }

    private async sendMessage(message: string): Promise<void> {
        if (!this.isEnabled) {
            this.logger.log(`📱 [TELEGRAM DISABLED] ${message}`);
            return;
        }

        try {
            await this.bot.sendMessage(this.chatId, message, {
                parse_mode: 'HTML',
                disable_web_page_preview: true,
            });
        } catch (error) {
            this.logger.error(`❌ Failed to send Telegram message: ${error.message}`);
            throw error;
        }
    }

    private formatArbitrageMessage(opportunity: ArbitrageOpportunity): string {
        // Validate opportunity data before formatting
        if (opportunity.action === 'INVALID' ||
            opportunity.priceA === null || opportunity.priceB === null ||
            opportunity.priceDifference === null || opportunity.priceDifferencePercent === null ||
            opportunity.profit === null) {
            return `⚠️ <b>INVALID ARBITRAGE DATA</b> ⚠️\n\n${opportunity.symbol} - Unable to format message due to invalid data.`;
        }

        const buyExchange = opportunity.action === 'BUY_A_SELL_B' ? opportunity.exchangeA : opportunity.exchangeB;
        const sellExchange = opportunity.action === 'BUY_A_SELL_B' ? opportunity.exchangeB : opportunity.exchangeA;
        const buyPrice = opportunity.action === 'BUY_A_SELL_B' ? opportunity.priceA : opportunity.priceB;
        const sellPrice = opportunity.action === 'BUY_A_SELL_B' ? opportunity.priceB : opportunity.priceA;

        return `
🚨 <b>ARBITRAGE OPPORTUNITY</b> 🚨

📊 <b>Pair:</b> ${opportunity.symbol}
📈 <b>Spread:</b> ${opportunity.priceDifferencePercent.toFixed(2)}%
💰 <b>Potential Profit:</b> $${opportunity.profit.toFixed(2)}

🔄 <b>Action:</b>
   🟢 BUY on ${buyExchange.toUpperCase()}: $${buyPrice.toFixed(4)}
   🔴 SELL on ${sellExchange.toUpperCase()}: $${sellPrice.toFixed(4)}

💸 <b>Price Difference:</b> $${opportunity.priceDifference.toFixed(4)}

⏰ <b>Time:</b> ${new Date(opportunity.timestamp).toLocaleString()}

<i>Act quickly! Arbitrage opportunities are time-sensitive.</i>
    `.trim();
    }

    private formatArbitrageClosedMessage(closedOpportunity: ArbitrageOpportunityClosed): string {
        const durationText = `${(closedOpportunity.duration / 60000).toFixed(1)}m`;
        const reasonText = this.getCloseReasonText(closedOpportunity.closeReason);

        const buyExchange = closedOpportunity.action === 'BUY_A_SELL_B' ? closedOpportunity.exchangeA : closedOpportunity.exchangeB;
        const sellExchange = closedOpportunity.action === 'BUY_A_SELL_B' ? closedOpportunity.exchangeB : closedOpportunity.exchangeA;

        return `
📉 <b>ARBITRAGE OPPORTUNITY CLOSED</b> 📉

📊 <b>Pair:</b> ${closedOpportunity.symbol}
⏱️ <b>Duration:</b> ${durationText}
🔚 <b>Reason:</b> ${reasonText}

📈 <b>OPENING DETAILS</b>
   🟢 ${buyExchange.toUpperCase()}: $${closedOpportunity.openPriceA.toFixed(4)}
   🔴 ${sellExchange.toUpperCase()}: $${closedOpportunity.openPriceB.toFixed(4)}
   💰 Spread: ${closedOpportunity.openPriceDifferencePercent.toFixed(2)}%
   💸 Profit: $${closedOpportunity.openProfit.toFixed(2)}
   🕐 Time: ${new Date(closedOpportunity.openTimestamp).toLocaleString()}

📉 <b>CLOSING DETAILS</b>
   🟢 ${buyExchange.toUpperCase()}: $${closedOpportunity.closePriceA.toFixed(4)}
   🔴 ${sellExchange.toUpperCase()}: $${closedOpportunity.closePriceB.toFixed(4)}
   💰 Spread: ${closedOpportunity.closePriceDifferencePercent.toFixed(2)}%
   💸 Profit: $${closedOpportunity.closeProfit.toFixed(2)}
   🕐 Time: ${new Date(closedOpportunity.closeTimestamp).toLocaleString()}

🎯 <b>PEAK PERFORMANCE</b>
   📊 Peak Spread: ${closedOpportunity.peakPriceDifferencePercent.toFixed(2)}%
   💰 Peak Profit: $${closedOpportunity.peakProfit.toFixed(2)}
   🕐 Peak Time: ${new Date(closedOpportunity.peakTimestamp).toLocaleString()}

📊 <b>SUMMARY</b>
   🔔 Alerts Sent: ${closedOpportunity.alertsSent}
   ⏰ Total Duration: ${durationText}

<i>Opportunity successfully tracked and closed.</i>
    `.trim();
    }

    private getCloseReasonText(reason: string): string {
        switch (reason) {
            case 'BELOW_THRESHOLD':
                return 'Spread dropped below threshold';
            case 'PRICE_CONVERGED':
                return 'Prices converged';
            case 'TIMEOUT':
                return 'Maximum duration exceeded';
            case 'MANUAL':
                return 'Manually closed';
            default:
                return 'Unknown reason';
        }
    }

    private formatNewListingMessage(alert: NewListingAlert): string {
        const listing = alert.listing;
        const arbitrageText = alert.potentialArbitrage ?
            `\n🎯 <b>Arbitrage Potential:</b> YES - Available on ${alert.availableExchanges.length} exchanges` :
            `\n📊 <b>Exchanges:</b> ${alert.availableExchanges.length} (${alert.availableExchanges.join(', ')})`;

        let priceInfo = '';
        if (alert.priceData.length > 0) {
            const prices = alert.priceData.map(p => `${p.exchange}: $${p.price.toFixed(4)}`).join('\n   ');
            priceInfo = `\n\n💰 <b>Current Prices:</b>\n   ${prices}`;
        }

        return `
🆕 <b>NEW LISTING DETECTED</b> 🆕

📊 <b>Symbol:</b> ${listing.symbol}
🏷️ <b>Asset:</b> ${listing.baseAsset}/${listing.quoteAsset}
🏢 <b>Exchange:</b> ${listing.exchange.toUpperCase()}
📅 <b>Listed:</b> ${new Date(listing.listingTime).toLocaleString()}
📈 <b>Status:</b> ${listing.status}

${arbitrageText}${priceInfo}

⏰ <b>Detection Time:</b> ${new Date(alert.timestamp).toLocaleString()}

<i>New listings often provide excellent arbitrage opportunities!</i>
    `.trim();
    }

    /**
     * Send a custom message to Telegram
     */
    async sendCustomMessage(message: string): Promise<void> {
        await this.sendMessage(message);
    }

    /**
     * Check if Telegram is enabled
     */
    isReady(): boolean {
        return this.isEnabled;
    }

    /**
     * Get bot information
     */
    async getBotInfo(): Promise<any> {
        if (!this.isEnabled) {
            return null;
        }

        try {
            return await this.bot.getMe();
        } catch (error) {
            this.logger.error(`❌ Failed to get bot info: ${error.message}`);
            return null;
        }
    }
} 