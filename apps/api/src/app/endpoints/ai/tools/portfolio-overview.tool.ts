import { AccountService } from '@ghostfolio/api/app/account/account.service';
import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

import { DetailsCache } from './details-cache';

/**
 * Compound tool: combines portfolio summary + performance + risk in a single call.
 * This avoids 3 separate LLM→tool round trips for the most common queries.
 * Uses a single getDetails() call and derives all data from it.
 */
export function createPortfolioOverviewTool(
  portfolioService: PortfolioService,
  accountService: AccountService,
  userId: string,
  detailsCache?: DetailsCache
) {
  return new DynamicStructuredTool({
    name: 'get_portfolio_overview',
    description:
      'Returns a COMPLETE portfolio overview in one call: value, holdings, allocation, ' +
      'performance, risk score, and suggestions. USE THIS as the DEFAULT tool for general ' +
      'portfolio questions like "how is my portfolio", "give me an overview", "summarize my investments", ' +
      '"what do I own", "portfolio review". Only use individual tools (get_performance_metrics, ' +
      'query_holdings, etc.) when the user asks a SPECIFIC narrow question.',
    schema: z.object({
      dateRange: z
        .enum(['1d', 'ytd', '1y', '5y', 'max'])
        .optional()
        .default('ytd')
        .describe('Timeframe for performance metrics'),
      topN: z
        .number()
        .optional()
        .default(5)
        .describe('Number of top holdings to include')
    }),
    func: async ({ dateRange, topN }) => {
      try {
        // Single DB call — getDetails with summary gives us almost everything
        const [details, performance, accounts] = await Promise.all([
          detailsCache
            ? detailsCache.getDetails({ withSummary: true })
            : portfolioService.getDetails({
                filters: [],
                impersonationId: undefined,
                userId,
                withSummary: true
              }),
          portfolioService.getPerformance({
            dateRange: dateRange as any,
            filters: [],
            impersonationId: undefined,
            userId,
            withItems: false
          }),
          accountService.getAccounts(userId)
        ]);

        const allHoldings = Object.values(details.holdings);
        const sorted = [...allHoldings].sort(
          (a, b) => b.allocationInPercentage - a.allocationInPercentage
        );

        // Top holdings
        const topHoldings = sorted.slice(0, topN).map((h) => ({
          name: h.name,
          symbol: h.symbol,
          assetClass: h.assetClass ?? 'Unknown',
          allocationPercent: +(h.allocationInPercentage * 100).toFixed(2),
          valueInBaseCurrency: h.valueInBaseCurrency
        }));

        // Allocation by asset class
        const allocationByAssetClass: Record<string, number> = {};
        for (const h of allHoldings) {
          const cls = h.assetClass ?? 'Unknown';
          allocationByAssetClass[cls] =
            (allocationByAssetClass[cls] ?? 0) +
            +(h.allocationInPercentage * 100).toFixed(2);
        }

        // Allocation by sector
        const allocationBySector: Record<string, number> = {};
        for (const h of allHoldings) {
          if (h.sectors?.length) {
            for (const s of h.sectors) {
              allocationBySector[s.name] =
                (allocationBySector[s.name] ?? 0) +
                +(s.weight * h.allocationInPercentage * 100).toFixed(2);
            }
          }
        }

        // Risk / diversification
        const topHoldingWeight = sorted[0]
          ? +(sorted[0].allocationInPercentage * 100).toFixed(2)
          : 0;
        const top5Weight = sorted
          .slice(0, 5)
          .reduce((sum, h) => sum + h.allocationInPercentage * 100, 0);
        const assetClassCount = Object.keys(allocationByAssetClass).length;
        const sectorCount = Object.keys(allocationBySector).length;

        let diversificationScore = 50;
        if (topHoldingWeight > 40) diversificationScore -= 20;
        else if (topHoldingWeight > 25) diversificationScore -= 10;
        if (top5Weight > 80) diversificationScore -= 15;
        if (assetClassCount >= 3) diversificationScore += 15;
        else if (assetClassCount >= 2) diversificationScore += 5;
        if (sectorCount >= 5) diversificationScore += 15;
        else if (sectorCount >= 3) diversificationScore += 5;
        if (allHoldings.length >= 10) diversificationScore += 10;
        else if (allHoldings.length >= 5) diversificationScore += 5;
        diversificationScore = Math.max(0, Math.min(100, diversificationScore));

        // Performance
        const perf = (performance as any)?.performance ?? performance;

        const summary = (details as any).summary;

        const result = {
          // Summary
          totalValue: summary?.currentValueInBaseCurrency ?? null,
          netWorth: summary?.netWorth ?? null,
          totalInvestment: summary?.totalInvestment ?? null,
          cash: summary?.cash ?? null,
          totalHoldings: allHoldings.length,
          accountCount: accounts.length,

          // Performance
          performance: {
            dateRange,
            netPerformance: perf?.currentNetPerformance ?? null,
            netPerformancePercent: perf?.currentNetPerformancePercent
              ? +((perf.currentNetPerformancePercent as number) * 100).toFixed(2)
              : null,
            grossPerformance: perf?.currentGrossPerformance ?? null,
            fees: perf?.fees ?? summary?.fees ?? null,
            dividends: perf?.dividend ?? summary?.dividendInBaseCurrency ?? null
          },

          // Top holdings
          topHoldings,
          allocationByAssetClass,

          // Risk
          risk: {
            diversificationScore,
            topHoldingWeight,
            top5ConcentrationPercent: +top5Weight.toFixed(2),
            assetClassCount,
            sectorCount,
            holdingCount: allHoldings.length
          },

          dataAsOf: new Date().toISOString()
        };

        return JSON.stringify(result);
      } catch (error) {
        return JSON.stringify({
          error: 'Failed to fetch portfolio overview',
          details: error.message
        });
      }
    }
  });
}
