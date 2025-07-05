import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
    getHello(): string {
        return '⚡ Futures Arbitrage Bot - Real-time arbitrage trading bot built with Nest.js';
    }

    getHealth() {
        return {
            status: 'OK',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
        };
    }

    getStatus() {
        return {
            service: 'Futures Arbitrage Bot',
            version: '1.0.0',
            status: 'Running',
            exchanges: ['Binance', 'ByBit', 'MEXC', 'Gate.io', 'LBank'],
            features: [
                'Real-time price tracking',
                'Arbitrage detection',
                'Telegram notifications',
                'Multi-exchange support',
            ],
        };
    }
} 