import { Controller, Get, Post, Body, Query, ParseIntPipe, Param } from '@nestjs/common';
import { ArbitrageService } from './arbitrage.service';
import { ExchangeService } from '@/exchange/exchange.service';
import { ArbitrageConfig } from '@/common/types';

@Controller('arbitrage')
export class ArbitrageController {
    constructor(
        private readonly arbitrageService: ArbitrageService,
        private readonly exchangeService: ExchangeService
    ) {}

    @Get('opportunities')
    getRecentOpportunities(@Query('limit', ParseIntPipe) limit: number = 50) {
        return {
            opportunities: this.arbitrageService.getRecentOpportunities(limit),
        };
    }

    @Get('stats')
    getArbitrageStats() {
        return this.arbitrageService.getArbitrageStats();
    }

    @Post('config')
    updateConfig(@Body() config: Partial<ArbitrageConfig>) {
        this.arbitrageService.updateConfig(config);
        return {
            message: 'Configuration updated successfully',
            config,
        };
    }

    @Post('clear-alerts')
    clearRecentAlerts() {
        this.arbitrageService.clearRecentAlerts();
        return {
            message: 'Recent alerts cleared successfully',
        };
    }

    @Get('exchange-status')
    getExchangeStatus() {
        return {
            exchangeStatus: this.exchangeService.getDetailedStatus(),
            connectionStatus: this.exchangeService.getConnectionStatus(),
            activeExchanges: this.exchangeService.getActiveExchanges(),
            tradingPairs: this.exchangeService.getTradingPairs(),
            timestamp: new Date().toISOString()
        };
    }

    @Get('common-pairs')
    getCommonPairs() {
        return {
            message: 'Common USDT pairs across exchanges',
            ...this.exchangeService.getCommonPairsInfo(),
            timestamp: new Date().toISOString()
        };
    }

    @Post('refresh-pairs')
    async refreshPairs() {
        try {
            await this.exchangeService.refreshCommonPairs();
            return {
                message: 'Trading pairs refreshed successfully',
                tradingPairs: this.exchangeService.getTradingPairs(),
                ...this.exchangeService.getCommonPairsInfo(),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                message: 'Failed to refresh trading pairs',
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    @Get('symbol-info/:symbol')
    getSymbolInfo(@Param('symbol') symbol: string) {
        return {
            symbol,
            exchanges: this.exchangeService.getExchangesForSymbol(symbol),
            isEligible: this.exchangeService.isSymbolEligible(symbol),
            timestamp: new Date().toISOString()
        };
    }
} 