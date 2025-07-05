import { Controller, Get, Param, Query } from '@nestjs/common';
import { PriceService } from './price.service';

@Controller('prices')
export class PriceController {
    constructor(private readonly priceService: PriceService) { }

    @Get()
    getAllPrices() {
        return {
            prices: this.priceService.getAllPrices(),
            symbols: this.priceService.getAvailableSymbols(),
            exchanges: this.priceService.getAvailableExchanges(),
        };
    }

    @Get('symbols')
    getSymbols() {
        return {
            symbols: this.priceService.getAvailableSymbols(),
        };
    }

    @Get('exchanges')
    getExchanges() {
        return {
            exchanges: this.priceService.getAvailableExchanges(),
        };
    }

    @Get('symbol/:symbol')
    getPricesForSymbol(@Param('symbol') symbol: string) {
        return {
            symbol,
            prices: this.priceService.getAllPricesForSymbol(symbol),
        };
    }

    @Get('price/:symbol/:exchange')
    getPrice(
        @Param('symbol') symbol: string,
        @Param('exchange') exchange: string,
    ) {
        const price = this.priceService.getPrice(symbol, exchange);

        if (!price) {
            return {
                symbol,
                exchange,
                price: null,
                message: 'Price not found',
            };
        }

        return {
            symbol,
            exchange,
            price,
            isStale: this.priceService.isPriceStale(symbol, exchange),
        };
    }

    @Get('history/:symbol/:exchange')
    getPriceHistory(
        @Param('symbol') symbol: string,
        @Param('exchange') exchange: string,
    ) {
        return {
            symbol,
            exchange,
            history: this.priceService.getPriceHistory(symbol, exchange),
        };
    }
} 