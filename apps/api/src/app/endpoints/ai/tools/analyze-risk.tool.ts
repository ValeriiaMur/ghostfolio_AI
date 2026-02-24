import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

import { DetailsCache } from './details-cache';

export function createAnalyzeRiskTool(
  portfolioService: PortfolioService,
  userId: string,
  detailsCache?: DetailsCache
) {
  return new DynamicStructuredTool({
    name: 'analyze_risk',
    description:
      'Analyzes portfolio risk including concentration risk, diversification scores, ' +
      'top holding weight, sector/geographic diversification, and rule-based suggestions. ' +
      'Use this when the user asks about risk, diversification, concentration, ' +
      'whether their portfolio is balanced, or asks for improvement suggestions.',
    schema: z.object({
      includeRules: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          'Whether to include Ghostfolio X-ray rule evaluations (emergency fund, fees, etc.)'
        )
    }),
    func: async ({ includeRules }) => {
      try {
        const details = detailsCache
          ? await detailsCache.getDetails({ withSummary: true })
          : await portfolioService.getDetails({
              filters: [],
              impersonationId: undefined,
              userId,
              withSummary: true
            });

        const allHoldings = Object.values(details.holdings);
        const holdingsSorted = [...allHoldings].sort(
          (a, b) => b.allocationInPercentage - a.allocationInPercentage
        );

        // Concentration risk
        const topHolding = holdingsSorted[0];
        const top5Allocation = holdingsSorted
          .slice(0, 5)
          .reduce((sum, h) => sum + h.allocationInPercentage, 0);
        const top10Allocation = holdingsSorted
          .slice(0, 10)
          .reduce((sum, h) => sum + h.allocationInPercentage, 0);

        // Asset class diversification
        const assetClassBreakdown: Record<string, number> = {};
        for (const h of allHoldings) {
          const cls = h.assetClass ?? 'Unknown';
          assetClassBreakdown[cls] =
            (assetClassBreakdown[cls] ?? 0) + h.allocationInPercentage;
        }
        const assetClassCount = Object.keys(assetClassBreakdown).filter(
          (k) => k !== 'Unknown'
        ).length;

        // Geographic diversification
        const regionBreakdown: Record<string, number> = {};
        for (const h of allHoldings) {
          if (h.countries && h.countries.length > 0) {
            for (const c of h.countries) {
              regionBreakdown[c.code] =
                (regionBreakdown[c.code] ?? 0) +
                c.weight * h.allocationInPercentage;
            }
          }
        }

        // Sector diversification
        const sectorBreakdown: Record<string, number> = {};
        for (const h of allHoldings) {
          if (h.sectors && h.sectors.length > 0) {
            for (const s of h.sectors) {
              sectorBreakdown[s.name] =
                (sectorBreakdown[s.name] ?? 0) +
                s.weight * h.allocationInPercentage;
            }
          }
        }
        const sectorCount = Object.keys(sectorBreakdown).length;

        // Simple diversification score (0-100)
        // Penalize: high concentration, few asset classes, few sectors
        let diversificationScore = 100;

        // Top holding concentration penalty
        if (topHolding?.allocationInPercentage > 0.3)
          diversificationScore -= 25;
        else if (topHolding?.allocationInPercentage > 0.2)
          diversificationScore -= 15;
        else if (topHolding?.allocationInPercentage > 0.1)
          diversificationScore -= 5;

        // Top 5 concentration penalty
        if (top5Allocation > 0.8) diversificationScore -= 20;
        else if (top5Allocation > 0.6) diversificationScore -= 10;

        // Asset class diversity bonus/penalty
        if (assetClassCount <= 1) diversificationScore -= 20;
        else if (assetClassCount === 2) diversificationScore -= 10;

        // Holdings count factor
        if (allHoldings.length < 5) diversificationScore -= 15;
        else if (allHoldings.length < 10) diversificationScore -= 5;

        diversificationScore = Math.max(0, Math.min(100, diversificationScore));

        // Rules evaluation (X-ray report)
        let rules = undefined;
        if (includeRules) {
          try {
            const report = await portfolioService.getReport({
              impersonationId: undefined,
              userId
            });

            rules = {
              rules: (report as any).rules?.map((r: any) => ({
                name: r.name,
                key: r.key,
                passed: r.value,
                evaluation: r.evaluation,
                isActive: r.isActive
              }))
            };
          } catch {
            rules = { error: 'X-ray report unavailable' };
          }
        }

        const result = {
          totalHoldings: allHoldings.length,
          concentrationRisk: {
            topHolding: topHolding
              ? {
                  name: topHolding.name,
                  symbol: topHolding.symbol,
                  allocationPercent: +(
                    topHolding.allocationInPercentage * 100
                  ).toFixed(2)
                }
              : null,
            top5AllocationPercent: +(top5Allocation * 100).toFixed(2),
            top10AllocationPercent: +(top10Allocation * 100).toFixed(2)
          },
          diversificationScore,
          assetClassBreakdown: Object.fromEntries(
            Object.entries(assetClassBreakdown).map(([k, v]) => [
              k,
              +(v * 100).toFixed(2)
            ])
          ),
          sectorCount,
          topSectors: Object.entries(sectorBreakdown)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([name, weight]) => ({
              name,
              allocationPercent: +(weight * 100).toFixed(2)
            })),
          geographicDiversification: {
            countryCount: Object.keys(regionBreakdown).length,
            topCountries: Object.entries(regionBreakdown)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 5)
              .map(([code, weight]) => ({
                code,
                allocationPercent: +(weight * 100).toFixed(2)
              }))
          },
          suggestions: generateSuggestions(
            diversificationScore,
            topHolding?.allocationInPercentage ?? 0,
            assetClassCount,
            allHoldings.length,
            top5Allocation
          ),
          xrayReport: rules,
          dataAsOf: new Date().toISOString()
        };

        return JSON.stringify(result);
      } catch (error) {
        return JSON.stringify({
          error: 'Failed to analyze risk',
          details: error.message
        });
      }
    }
  });
}

function generateSuggestions(
  score: number,
  topHoldingAlloc: number,
  assetClassCount: number,
  holdingCount: number,
  top5Alloc: number
): string[] {
  const suggestions: string[] = [];

  if (topHoldingAlloc > 0.25) {
    suggestions.push(
      `Your top holding represents ${(topHoldingAlloc * 100).toFixed(1)}% of your portfolio. ` +
        'Consider whether this concentration aligns with your risk tolerance.'
    );
  }

  if (top5Alloc > 0.7) {
    suggestions.push(
      `Your top 5 holdings make up ${(top5Alloc * 100).toFixed(1)}% of the portfolio. ` +
        'Broader diversification could reduce single-stock risk.'
    );
  }

  if (assetClassCount <= 1) {
    suggestions.push(
      'Portfolio is concentrated in a single asset class. ' +
        'Consider adding other asset classes (bonds, real estate, commodities) for diversification.'
    );
  }

  if (holdingCount < 5) {
    suggestions.push(
      `With only ${holdingCount} holding(s), the portfolio has limited diversification. ` +
        'Adding more positions could reduce idiosyncratic risk.'
    );
  }

  if (score >= 80) {
    suggestions.push(
      'Portfolio shows good diversification overall. Continue monitoring for drift.'
    );
  }

  return suggestions;
}
