import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ArbitrageService } from './arbitrage.service';
import { ArbitrageController } from './arbitrage.controller';
import { ArbitrageProcessor } from './arbitrage.processor';
import { PriceModule } from '@/price/price.module';
import { TelegramModule } from '@/telegram/telegram.module';

@Module({
    imports: [
        PriceModule,
        TelegramModule,
        BullModule.registerQueue({
            name: 'arbitrage',
        }),
    ],
    controllers: [ArbitrageController],
    providers: [ArbitrageService, ArbitrageProcessor],
    exports: [ArbitrageService],
})
export class ArbitrageModule { } 