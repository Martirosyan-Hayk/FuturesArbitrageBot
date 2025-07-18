import { Module } from '@nestjs/common';
import { PriceService } from './price.service';
import { PriceController } from './price.controller';

@Module({
    controllers: [PriceController],
    providers: [PriceService],
    exports: [PriceService],
})
export class PriceModule { } 