/**
 * Price service for token USD value calculation.
 * Implements memory caching with a 60-second TTL.
 */

const PRICE_CACHE_TTL = 60 * 1000; // 60 seconds
let priceCache: { prices: Record<string, number>; timestamp: number } | null = null;

/**
 * Mapping of token symbols to CoinGecko IDs as requested.
 * These are the primary tokens supported by the application.
 */
export const SYMBOL_TO_GECKO_ID: Record<string, string> = {
  ETH: 'ethereum',
  STRK: 'starknet',
  XLM: 'stellar',
  USDC: 'usd-coin',
  USDT: 'tether',
  DAI: 'dai',
  WBTC: 'wrapped-bitcoin',
};

/**
 * Fetches current prices for the given symbols from the internal /api/prices endpoint.
 * Results are cached in memory for 60 seconds.
 * 
 * @param symbols Array of token symbols (e.g., ['ETH', 'STRK', 'XLM'])
 * @returns A promise resolving to a record of symbol to USD price
 */
export async function getTokenPrices(symbols: string[]): Promise<Record<string, number>> {
  const now = Date.now();
  
  // Use cached data if it exists and is not expired
  if (priceCache && (now - priceCache.timestamp < PRICE_CACHE_TTL)) {
    return priceCache.prices;
  }

  try {
    // Call internal API to avoid CORS issues and protect API keys
    const querySymbols = symbols.join(',');
    const response = await fetch(`/api/prices?symbols=${querySymbols}`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch prices: ${response.statusText}`);
    }

    const data = await response.json();
    
    // API is expected to return a Record<string, number> or { prices: Record<string, number> }
    // Standardizing on Record<string, number> for the cache
    const prices = data.prices || data;
    
    priceCache = {
      prices: prices as Record<string, number>,
      timestamp: now,
    };

    return priceCache.prices;
  } catch (error) {
    console.error('Error in getTokenPrices:', error);
    // Return cached data if available even if expired, or empty object
    return priceCache?.prices || {};
  }
}
