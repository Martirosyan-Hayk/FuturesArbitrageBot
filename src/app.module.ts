import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { ExchangeModule } from './exchange/exchange.module';
import { ArbitrageModule } from './arbitrage/arbitrage.module';
import { TelegramModule } from './telegram/telegram.module';
import { PriceModule } from './price/price.module';
import { ListingsModule } from './listings/listings.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
    imports: [
        // Configuration module
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: '.env',
        }),

        // Schedule module for cron jobs
        ScheduleModule.forRoot(),

        // Bull queue for job processing
        BullModule.forRoot({
            redis: {
                host: process.env.REDIS_HOST || 'localhost',
                port: parseInt(process.env.REDIS_PORT) || 6379,
                password: process.env.REDIS_PASSWORD || undefined,
            },
        }),

        // Feature modules
        ExchangeModule,
        ArbitrageModule,
        TelegramModule,
        PriceModule,
        ListingsModule,
    ],
    controllers: [AppController],
    providers: [AppService],
})
export class AppModule { } 