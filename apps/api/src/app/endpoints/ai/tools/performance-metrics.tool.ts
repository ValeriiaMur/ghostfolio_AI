import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import type { DateRange } from '@ghostfolio/common/types';

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

export function createPerformanceMetricsTool(
  portfolioService: PortfolioService,
  userId: string
) {
  return new DynamicStructuredTool({
    name: 'get_performance_metrics',
    description:
      'Returns portfolio performance metrics including net/gross performance, ' +
      'total investment, current value, annualized return, fees, and dividends ' +
      'for a given timeframe. Use this when the user asks about returns, performance, ' +
      'how their portfolio is doing, gains/losses, or ROI.',
    schema: z.object({
      dateRange: z
        .enum(['1d', '1w', '1m', '3m', '6m', 'ytd', '1y', '5y', 'max'])
        .optional()
        .default('ytd')
        .describe(
          'Time period for performance calculation. Options: 1d, 1w, 1m, 3m, 6m, ytd, 1y, 5y, max'
        ),
      includeChart: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          'Whether to include chart data points (can be large). Only include if user specifically asks for chart/graph data.'
        )
    }),
    func: async ({ dateRange, includeChart }) => {
      try {
        const perfResponse = await portfolioService.getPerformance({
          dateRange: dateRange as DateRange,
          filters: [],
          impersonationId: undefined,
          userId
        });

        const perf = (perfResponse as any).performance ?? perfResponse;

        const result: Record<string, any> = {
          dateRange,
          netPerformance: perf.netPerformance ?? null,
          netPerformancePercent:
            perf.netPerformancePercentage ?? perf.netPerformancePercent ?? null,
          netPerformanceWithCurrencyEffect:
            perf.netPerformanceWithCurrencyEffect ?? null,
          netPerformancePercentWithCurrencyEffect:
            perf.netPerformancePercentageWithCurrencyEffect ?? null,
          grossPerformance: perf.grossPerformance ?? null,
          grossPerformancePercent:
            perf.grossPerformancePercentage ??
            perf.grossPerformancePercent ??
            null,
          totalInvestment: perf.totalInvestment ?? null,
          currentValue:
            perf.currentValueInBaseCurrency ?? perf.currentNetWorth ?? null,
          annualizedPerformancePercent:
            perf.annualizedPerformancePercent ?? null,
          fees: perf.fees ?? null,
          dividends: perf.dividendInBaseCurrency ?? null,
          firstOrderDate: (perfResponse as any).firstOrderDate ?? null,
          hasErrors: (perfResponse as any).hasErrors ?? false,
          dataAsOf: new Date().toISOString()
        };

        if (includeChart && (perfResponse as any).chart) {
          // Only send last 30 data points to avoid token bloat
          const chart = (perfResponse as any).chart;
          result.chartSample = chart.slice(-30).map((p: any) => ({
            date: p.date,
            netPerformancePercent:
              p.netPerformanceInPercentage ?? p.netPerformancePercent,
            netWorth: p.netWorth,
            value: p.value
          }));
        }

        return JSON.stringify(result);
      } catch (error) {
        return JSON.stringify({
          error: 'Failed to fetch performance metrics',
          details: error.message
        });
      }
    }
  });
}
