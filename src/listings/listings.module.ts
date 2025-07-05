import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ListingsService } from './listings.service';
import { ListingsController } from './listings.controller';
import { ListingsProcessor } from './listings.processor';
import { ExchangeModule } from '@/exchange/exchange.module';
import { TelegramModule } from '@/telegram/telegram.module';
import { PriceModule } from '@/price/price.module';

@Module({
    imports: [
        ExchangeModule,
        TelegramModule,
        PriceModule,
        BullModule.registerQueue({
            name: 'listings',
        }),
    ],
    controllers: [ListingsController],
    providers: [ListingsService, ListingsProcessor],
    exports: [ListingsService],
})
export class ListingsModule { } 