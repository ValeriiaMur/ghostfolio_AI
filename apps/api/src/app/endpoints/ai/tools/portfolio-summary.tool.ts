import { AccountService } from '@ghostfolio/api/app/account/account.service';
import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

import { DetailsCache } from './details-cache';

export function createPortfolioSummaryTool(
  portfolioService: PortfolioService,
  accountService: AccountService,
  userId: string,
  detailsCache?: DetailsCache
) {
  return new DynamicStructuredTool({
    name: 'get_portfolio_summary',
    description:
      "Returns a summary of the user's investment portfolio including total value, " +
      'account count, holdings count, top holdings by allocation, and allocation breakdown ' +
      'by asset class and sector. Use this when the user asks about their portfolio overview, ' +
      'total value, what they own, or how their money is allocated.',
    schema: z.object({
      includeAccounts: z
        .boolean()
        .optional()
        .default(true)
        .describe('Whether to include account-level breakdown'),
      topN: z
        .number()
        .optional()
        .default(10)
        .describe('Number of top holdings to return, sorted by allocation')
    }),
    func: async ({ includeAccounts, topN }) => {
      try {
        const details = detailsCache
          ? await detailsCache.getDetails({ withSummary: true })
          : await portfolioService.getDetails({
              filters: [],
              impersonationId: undefined,
              userId,
              withSummary: true
            });

        const holdings = Object.values(details.holdings)
          .sort((a, b) => b.allocationInPercentage - a.allocationInPercentage)
          .slice(0, topN)
          .map((h) => ({
            name: h.name,
            symbol: h.symbol,
            assetClass: h.assetClass ?? 'Unknown',
            assetSubClass: h.assetSubClass ?? 'Unknown',
            currency: h.currency,
            allocationPercent: +(h.allocationInPercentage * 100).toFixed(2),
            valueInBaseCurrency: h.valueInBaseCurrency,
            quantity: h.quantity,
            marketPrice: h.marketPrice
          }));

        const allHoldings = Object.values(details.holdings);
        const totalHoldings = allHoldings.length;

        // Allocation by asset class
        const allocationByAssetClass: Record<string, number> = {};
        for (const h of allHoldings) {
          const cls = h.assetClass ?? 'Unknown';
          allocationByAssetClass[cls] =
            (allocationByAssetClass[cls] ?? 0) +
            +(h.allocationInPercentage * 100).toFixed(2);
        }

        // Allocation by sector (from sectors array if available)
        const allocationBySector: Record<string, number> = {};
        for (const h of allHoldings) {
          if (h.sectors && h.sectors.length > 0) {
            for (const s of h.sectors) {
              allocationBySector[s.name] =
                (allocationBySector[s.name] ?? 0) +
                +(s.weight * h.allocationInPercentage * 100).toFixed(2);
            }
          }
        }

        let accounts = undefined;
        if (includeAccounts) {
          const accts = await accountService.getAccounts(userId);
          accounts = accts.map((a) => ({
            name: a.name,
            currency: a.currency,
            balance: a.balance,
            isExcluded: a.isExcluded
          }));
        }

        const summary = (details as any).summary;
        const result = {
          totalValueInBaseCurrency: summary?.currentValueInBaseCurrency ?? null,
          netWorth: summary?.netWorth ?? null,
          totalInvestment: summary?.totalInvestment ?? null,
          cash: summary?.cash ?? null,
          totalHoldings,
          accountCount: accounts?.length ?? null,
          topHoldings: holdings,
          allocationByAssetClass,
          allocationBySector,
          accounts,
          dividendTotal: summary?.dividendInBaseCurrency ?? null,
          feesTotal: summary?.fees ?? null,
          dateOfFirstActivity: summary?.dateOfFirstActivity ?? null,
          dataAsOf: new Date().toISOString()
        };

        return JSON.stringify(result);
      } catch (error) {
        return JSON.stringify({
          error: 'Failed to fetch portfolio summary',
          details: error.message
        });
      }
    }
  });
}
