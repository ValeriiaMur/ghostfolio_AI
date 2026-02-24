import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

export function createQueryHoldingsTool(
  portfolioService: PortfolioService,
  userId: string
) {
  return new DynamicStructuredTool({
    name: 'query_holdings',
    description:
      'Filters and queries individual holdings/positions in the portfolio. ' +
      'Can filter by symbol, asset class, sector, or value range. ' +
      'Use this when the user asks about specific stocks, a particular asset class, ' +
      'their tech stocks, crypto holdings, or wants to find holdings matching criteria.',
    schema: z.object({
      symbol: z
        .string()
        .optional()
        .describe(
          'Filter by exact symbol (e.g. "AAPL", "BTC"). Case insensitive.'
        ),
      assetClass: z
        .string()
        .optional()
        .describe(
          'Filter by asset class (e.g. "EQUITY", "FIXED_INCOME", "COMMODITY", "REAL_ESTATE", "LIQUIDITY")'
        ),
      searchTerm: z
        .string()
        .optional()
        .describe(
          'Search holdings by name or symbol substring (e.g. "Apple", "tech")'
        ),
      minValueInBaseCurrency: z
        .number()
        .optional()
        .describe('Minimum holding value in base currency'),
      maxValueInBaseCurrency: z
        .number()
        .optional()
        .describe('Maximum holding value in base currency'),
      sortBy: z
        .enum(['allocation', 'value', 'performance', 'name'])
        .optional()
        .default('allocation')
        .describe('Sort results by this field')
    }),
    func: async ({
      symbol,
      assetClass,
      searchTerm,
      minValueInBaseCurrency,
      maxValueInBaseCurrency,
      sortBy
    }) => {
      try {
        const details = await portfolioService.getDetails({
          filters: [],
          impersonationId: undefined,
          userId
        });

        let results = Object.values(details.holdings);

        // Apply filters
        if (symbol) {
          const sym = symbol.toUpperCase();
          results = results.filter((h) => h.symbol.toUpperCase() === sym);
        }

        if (assetClass) {
          const cls = assetClass.toUpperCase();
          results = results.filter((h) => h.assetClass?.toUpperCase() === cls);
        }

        if (searchTerm) {
          const term = searchTerm.toLowerCase();
          results = results.filter(
            (h) =>
              h.name?.toLowerCase().includes(term) ||
              h.symbol.toLowerCase().includes(term)
          );
        }

        if (minValueInBaseCurrency !== undefined) {
          results = results.filter(
            (h) => h.valueInBaseCurrency >= minValueInBaseCurrency
          );
        }

        if (maxValueInBaseCurrency !== undefined) {
          results = results.filter(
            (h) => h.valueInBaseCurrency <= maxValueInBaseCurrency
          );
        }

        // Sort
        switch (sortBy) {
          case 'value':
            results.sort(
              (a, b) => b.valueInBaseCurrency - a.valueInBaseCurrency
            );
            break;
          case 'performance':
            results.sort(
              (a, b) =>
                (b.netPerformancePercentWithCurrencyEffect ?? 0) -
                (a.netPerformancePercentWithCurrencyEffect ?? 0)
            );
            break;
          case 'name':
            results.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
            break;
          case 'allocation':
          default:
            results.sort(
              (a, b) => b.allocationInPercentage - a.allocationInPercentage
            );
            break;
        }

        const holdings = results.map((h) => ({
          name: h.name,
          symbol: h.symbol,
          currency: h.currency,
          assetClass: h.assetClass ?? 'Unknown',
          assetSubClass: h.assetSubClass ?? 'Unknown',
          quantity: h.quantity,
          marketPrice: h.marketPrice,
          valueInBaseCurrency: h.valueInBaseCurrency,
          allocationPercent: +(h.allocationInPercentage * 100).toFixed(2),
          netPerformance: h.netPerformance ?? null,
          netPerformancePercent:
            h.netPerformancePercentWithCurrencyEffect ?? null,
          dividend: h.dividend ?? null,
          sectors: h.sectors?.map((s) => s.name) ?? [],
          countries:
            h.countries?.map((c) => ({
              code: c.code,
              weight: c.weight
            })) ?? [],
          dateOfFirstActivity: h.dateOfFirstActivity ?? null
        }));

        return JSON.stringify({
          matchCount: holdings.length,
          totalHoldings: Object.keys(details.holdings).length,
          holdings,
          dataAsOf: new Date().toISOString()
        });
      } catch (error) {
        return JSON.stringify({
          error: 'Failed to query holdings',
          details: error.message
        });
      }
    }
  });
}
