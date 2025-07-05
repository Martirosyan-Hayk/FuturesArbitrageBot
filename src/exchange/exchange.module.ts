import { Module } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { BinanceService } from './binance.service';
import { BybitService } from './bybit.service';
import { MexcService } from './mexc.service';
import { GateioService } from './gateio.service';
import { LbankService } from './lbank.service';
import { PriceModule } from '@/price/price.module';

@Module({
    imports: [PriceModule],
    providers: [
        ExchangeService,
        BinanceService,
        BybitService,
        MexcService,
        GateioService,
        LbankService,
    ],
    exports: [ExchangeService],
})
export class ExchangeModule { } 