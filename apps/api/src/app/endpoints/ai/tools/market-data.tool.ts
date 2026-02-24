import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';
import { MarketDataService } from '@ghostfolio/api/services/market-data/market-data.service';

import { DynamicStructuredTool } from '@langchain/core/tools';
import { DataSource } from '@prisma/client';
import { z } from 'zod';

export function createMarketDataTool(
  dataProviderService: DataProviderService,
  marketDataService: MarketDataService
) {
  return new DynamicStructuredTool({
    name: 'get_market_data',
    description:
      'Gets current market price, price change, and optional historical data for a symbol. ' +
      'Also supports symbol search. Use this when the user asks about current stock/crypto prices, ' +
      'market data, price changes, or wants to look up a symbol.',
    schema: z.object({
      symbol: z
        .string()
        .optional()
        .describe(
          'The ticker symbol to look up (e.g. "AAPL", "MSFT", "BTC-USD"). Required unless using searchQuery.'
        ),
      dataSource: z
        .enum([
          'COINGECKO',
          'EOD_HISTORICAL_DATA',
          'FINANCIAL_MODELING_PREP',
          'GOOGLE_SHEETS',
          'MANUAL',
          'RAPID_API',
          'YAHOO'
        ])
        .optional()
        .default('YAHOO')
        .describe(
          'Data source for the symbol. Most stocks/ETFs use YAHOO, crypto uses COINGECKO.'
        ),
      searchQuery: z
        .string()
        .optional()
        .describe(
          'Search for symbols by name or partial symbol (e.g. "Apple", "Bitcoin"). Returns matching symbols.'
        ),
      includeHistorical: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          'Whether to include historical price data for the last 30 days'
        )
    }),
    func: async ({ symbol, dataSource, searchQuery, includeHistorical }) => {
      try {
        // Symbol search mode
        if (searchQuery && !symbol) {
          const searchResults = await dataProviderService.search({
            query: searchQuery
          });

          return JSON.stringify({
            type: 'search_results',
            results: searchResults.items.slice(0, 10).map((item) => ({
              name: item.name,
              symbol: item.symbol,
              currency: item.currency,
              dataSource: item.dataSource,
              assetClass: item.assetClass,
              assetSubClass: item.assetSubClass
            })),
            dataAsOf: new Date().toISOString()
          });
        }

        if (!symbol) {
          return JSON.stringify({
            error: 'Either symbol or searchQuery is required'
          });
        }

        const ds = dataSource as DataSource;
        const items = [{ dataSource: ds, symbol }];

        // Get current quote
        const quotes = await dataProviderService.getQuotes({ items });
        const quote = quotes[symbol];

        const result: Record<string, any> = {
          type: 'quote',
          symbol,
          dataSource: ds,
          marketPrice: quote?.marketPrice ?? null,
          currency: quote?.currency ?? null,
          marketState: quote?.marketState ?? null,
          dataAsOf: new Date().toISOString()
        };

        // Get historical data if requested
        if (includeHistorical) {
          const to = new Date();
          const from = new Date();
          from.setDate(from.getDate() - 30);

          try {
            const historical = await dataProviderService.getHistorical(
              items,
              'day',
              from,
              to
            );

            const symbolHistory = historical[symbol];
            if (symbolHistory) {
              result.historical = Object.entries(symbolHistory)
                .sort(([a], [b]) => a.localeCompare(b))
                .slice(-15) // Last 15 data points to limit tokens
                .map(([date, data]) => ({
                  date,
                  marketPrice: (data as any).marketPrice
                }));
            }
          } catch {
            result.historicalError =
              'Historical data unavailable for this symbol';
          }
        }

        return JSON.stringify(result);
      } catch (error) {
        return JSON.stringify({
          error: 'Failed to fetch market data',
          details: error.message
        });
      }
    }
  });
}
