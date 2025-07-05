export interface PriceData {
    symbol: string;
    price: number;
    exchange: string;
    timestamp: number;
    volume?: number;
    high?: number;
    low?: number;
}

export interface ArbitrageOpportunity {
    symbol: string;
    exchangeA: string;
    exchangeB: string;
    priceA: number | null;
    priceB: number | null;
    priceDifference: number | null;
    priceDifferencePercent: number | null;
    profit: number | null;
    action: 'BUY_A_SELL_B' | 'BUY_B_SELL_A' | 'INVALID';
    timestamp: number;
}

export interface ActiveArbitrageOpportunity extends ArbitrageOpportunity {
    id: string;                           // Unique identifier
    openTimestamp: number;               // When opportunity was first detected
    lastUpdatedTimestamp: number;        // Last time we saw this opportunity
    peakPriceDifferencePercent: number;  // Highest percentage seen
    peakProfit: number;                  // Highest profit seen
    peakTimestamp: number;               // When peak was reached
    alertsSent: number;                  // Number of alerts sent for this opportunity
}

export interface ArbitrageOpportunityClosed {
    id: string;
    symbol: string;
    exchangeA: string;
    exchangeB: string;

    // Opening details
    openPriceA: number;
    openPriceB: number;
    openPriceDifference: number;
    openPriceDifferencePercent: number;
    openProfit: number;
    openTimestamp: number;

    // Closing details
    closePriceA: number;
    closePriceB: number;
    closePriceDifference: number;
    closePriceDifferencePercent: number;
    closeProfit: number;
    closeTimestamp: number;

    // Peak details
    peakPriceDifferencePercent: number;
    peakProfit: number;
    peakTimestamp: number;

    // Summary
    duration: number;                    // Duration in milliseconds
    action: 'BUY_A_SELL_B' | 'BUY_B_SELL_A';
    closeReason: 'BELOW_THRESHOLD' | 'PRICE_CONVERGED' | 'MANUAL' | 'TIMEOUT';
    alertsSent: number;                  // Number of alerts sent during lifetime
}

export interface ExchangeConfig {
    name: string;
    apiKey?: string;
    apiSecret?: string;
    sandbox?: boolean;
    rateLimit?: number;
    enabled: boolean;
}

export interface TelegramMessage {
    type: 'ARBITRAGE_ALERT' | 'ARBITRAGE_CLOSED' | 'SYSTEM_STATUS' | 'ERROR' | 'NEW_LISTING';
    data: any;
    timestamp: number;
}

export enum SupportedExchanges {
    BINANCE = 'binance',
    BYBIT = 'bybit',
    MEXC = 'mexc',
    GATEIO = 'gateio',
    LBANK = 'lbank',
}

export interface WebSocketMessage {
    exchange: string;
    symbol: string;
    price: number;
    timestamp: number;
    data: any;
}

export interface ArbitrageConfig {
    thresholdPercent: number;
    closeThresholdPercent?: number;  // Optional separate close threshold
    cooldownMinutes: number;
    tradingPairs: string[];
    minProfitUsd: number;
    sendClosedAlerts: boolean;
    minOpportunityDurationForCloseAlert: number; // minutes
}

export interface NewListing {
    symbol: string;
    baseAsset: string;
    quoteAsset: string;
    exchange: string;
    listingTime: number;
    status: 'TRADING' | 'BREAK' | 'AUCTION_MATCH' | 'AUCTION_ONLY';
    isNewListing: boolean;
    firstPrice?: number;
    volume24h?: number;
    priceChange24h?: number;
    marketCap?: number;
    description?: string;
    tags?: string[];
}

export interface NewListingAlert {
    listing: NewListing;
    availableExchanges: string[];
    potentialArbitrage: boolean;
    priceData: PriceData[];
    timestamp: number;
}

export interface ExchangeSymbol {
    symbol: string;
    baseAsset: string;
    quoteAsset: string;
    status: string;
    exchange: string;
    minTradeAmount?: number;
    maxTradeAmount?: number;
    tickSize?: number;
    lastUpdated: number;
} 