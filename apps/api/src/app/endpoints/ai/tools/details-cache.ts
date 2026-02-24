import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';

/**
 * Per-request cache for portfolioService.getDetails().
 * Multiple tools (summary, holdings, risk, overview) all call getDetails()
 * with the same params. This cache ensures the expensive DB computation
 * only happens once per chat request, even when tools run in parallel.
 *
 * Create a new instance for each chat() invocation, then pass it to tools.
 */
export class DetailsCache {
  private cache = new Map<string, Promise<any>>();

  constructor(
    private readonly portfolioService: PortfolioService,
    private readonly userId: string
  ) {}

  /**
   * Returns cached getDetails() result. Uses the serialised options as cache key.
   * Caches the Promise itself (not the resolved value) so parallel calls
   * that start before the first resolves still share the same DB call.
   */
  getDetails(options?: { withSummary?: boolean; filters?: any[] }): Promise<any> {
    const key = JSON.stringify({
      userId: this.userId,
      withSummary: options?.withSummary ?? false,
      filters: options?.filters ?? []
    });

    if (!this.cache.has(key)) {
      const promise = this.portfolioService.getDetails({
        filters: options?.filters ?? [],
        impersonationId: undefined,
        userId: this.userId,
        withSummary: options?.withSummary
      });
      this.cache.set(key, promise);
    }

    return this.cache.get(key)!;
  }
}
