import { Controller, Get, Post, Body, Query, ParseIntPipe } from '@nestjs/common';
import { ArbitrageService } from './arbitrage.service';
import { ArbitrageConfig } from '@/common/types';

@Controller('arbitrage')
export class ArbitrageController {
    constructor(private readonly arbitrageService: ArbitrageService) { }

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
} 