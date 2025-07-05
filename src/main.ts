import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    const configService = app.get(ConfigService);
    const logger = new Logger('Bootstrap');

    // Enable validation pipes
    app.useGlobalPipes(new ValidationPipe({
        transform: true,
        whitelist: true,
    }));

    // Get port from config
    const port = configService.get<number>('PORT') || 3000;

    await app.listen(port);
    logger.log(`🚀 Futures Arbitrage Bot is running on port ${port}`);
    logger.log(`📊 Monitoring arbitrage opportunities...`);
}

bootstrap().catch((error) => {
    const logger = new Logger('Bootstrap');
    logger.error('❌ Failed to start application', error);
    process.exit(1);
}); 