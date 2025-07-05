import { Controller, Get, Post, Query, Param, ParseIntPipe } from '@nestjs/common';
import { ListingsService } from './listings.service';

@Controller('listings')
export class ListingsController {
    constructor(private readonly listingsService: ListingsService) { }

    @Get()
    getRecentListings(@Query('limit', ParseIntPipe) limit: number = 50) {
        return {
            listings: this.listingsService.getRecentListings(limit),
        };
    }

    @Get('stats')
    getListingsStats() {
        return this.listingsService.getListingsStats();
    }

    @Get('exchange/:exchange')
    getListingsByExchange(
        @Param('exchange') exchange: string,
        @Query('limit', ParseIntPipe) limit: number = 50,
    ) {
        return {
            exchange,
            listings: this.listingsService.getListingsByExchange(exchange, limit),
        };
    }

    @Get('symbol/:symbol/exchanges')
    async getSymbolAvailability(@Param('symbol') symbol: string) {
        const exchanges = await this.listingsService.checkCrossExchangeAvailability(symbol);
        return {
            symbol,
            availableExchanges: exchanges,
            count: exchanges.length,
        };
    }

    @Get('monitored/:exchange/:symbol')
    isSymbolMonitored(
        @Param('exchange') exchange: string,
        @Param('symbol') symbol: string,
    ) {
        return {
            exchange,
            symbol,
            isMonitored: this.listingsService.isSymbolMonitored(exchange, symbol),
        };
    }

    @Post('refresh')
    async refreshSymbols() {
        await this.listingsService.refreshAllSymbols();
        return {
            message: 'Symbols refreshed successfully',
        };
    }

    @Post('force-check')
    async forceCheck() {
        await this.listingsService.checkForNewListings();
        return {
            message: 'Forced new listings check completed',
        };
    }
} 