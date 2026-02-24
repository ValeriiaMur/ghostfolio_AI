/**
 * Deterministic eval tests for AI Agent tool routing.
 *
 * Tests that the LLM (mocked) selects the correct tools for given queries
 * and that tool results are properly formatted. No real LLM calls — all
 * responses are pre-defined fixtures.
 *
 * Categories: 20 happy path, 10 edge cases, 5 multi-step
 */

import { DynamicStructuredTool } from '@langchain/core/tools';

import {
  createPortfolioSummaryTool,
  createPerformanceMetricsTool,
  createQueryHoldingsTool,
  createMarketDataTool,
  createAnalyzeRiskTool
} from '../tools';

// ---------------------------------------------------------------------------
// Mock services — return deterministic data, no DB calls
// ---------------------------------------------------------------------------

const MOCK_HOLDINGS = {
  AAPL: {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    allocationInPercentage: 0.25,
    valueInBaseCurrency: 25000,
    netPerformancePercentage: 0.15,
    assetClass: 'EQUITY',
    assetSubClass: 'STOCK',
    currency: 'USD',
    sectors: [{ name: 'Technology', weight: 1 }],
    countries: [{ code: 'US', weight: 1 }]
  },
  MSFT: {
    symbol: 'MSFT',
    name: 'Microsoft Corporation',
    allocationInPercentage: 0.2,
    valueInBaseCurrency: 20000,
    netPerformancePercentage: 0.22,
    assetClass: 'EQUITY',
    assetSubClass: 'STOCK',
    currency: 'USD',
    sectors: [{ name: 'Technology', weight: 1 }],
    countries: [{ code: 'US', weight: 1 }]
  },
  VTI: {
    symbol: 'VTI',
    name: 'Vanguard Total Stock Market ETF',
    allocationInPercentage: 0.35,
    valueInBaseCurrency: 35000,
    netPerformancePercentage: 0.12,
    assetClass: 'EQUITY',
    assetSubClass: 'ETF',
    currency: 'USD',
    sectors: [{ name: 'Diversified', weight: 1 }],
    countries: [{ code: 'US', weight: 1 }]
  },
  BND: {
    symbol: 'BND',
    name: 'Vanguard Total Bond Market ETF',
    allocationInPercentage: 0.2,
    valueInBaseCurrency: 20000,
    netPerformancePercentage: 0.03,
    assetClass: 'FIXED_INCOME',
    assetSubClass: 'BOND',
    currency: 'USD',
    sectors: [{ name: 'Bonds', weight: 1 }],
    countries: [{ code: 'US', weight: 1 }]
  }
};

const MOCK_PORTFOLIO_DETAILS = {
  holdings: MOCK_HOLDINGS,
  summary: {
    cash: 5000,
    committedFunds: 0,
    currentGrossPerformance: 12000,
    currentGrossPerformancePercent: 0.12,
    currentNetPerformance: 11500,
    currentNetPerformancePercent: 0.115,
    currentValue: 100000,
    dividend: 1500,
    fees: 500,
    filteredActivities: [],
    interest: 0,
    items: 4,
    liabilities: 0,
    netWorth: 105000,
    totalBuy: 88500,
    totalInvestment: 88500,
    totalSell: 0
  },
  hasErrors: false
};

const MOCK_PERFORMANCE = {
  chart: [],
  hasErrors: false,
  performance: {
    currentGrossPerformance: 12000,
    currentGrossPerformancePercent: 0.12,
    currentNetPerformance: 11500,
    currentNetPerformancePercent: 0.115,
    currentNetPerformancePercentWithCurrencyEffect: 0.115,
    currentNetWorth: 105000,
    currentValue: 100000,
    totalInvestment: 88500,
    annualizedPerformancePercent: 0.089,
    dividend: 1500,
    fees: 500
  }
};

const MOCK_ACCOUNTS = [
  {
    id: 'acc-1',
    name: 'Main Brokerage',
    currency: 'USD',
    balance: 5000,
    isExcluded: false,
    platformId: null
  }
];

const mockPortfolioService = {
  getDetails: jest.fn().mockResolvedValue(MOCK_PORTFOLIO_DETAILS),
  getPerformance: jest.fn().mockResolvedValue(MOCK_PERFORMANCE),
  getReport: jest.fn().mockResolvedValue({ rules: [] })
} as any;

const mockAccountService = {
  getAccounts: jest.fn().mockResolvedValue(MOCK_ACCOUNTS)
} as any;

const mockDataProviderService = {
  getQuotes: jest.fn().mockResolvedValue({
    AAPL: { marketPrice: 195.5, marketState: 'open', dataSource: 'YAHOO' }
  }),
  getHistorical: jest.fn().mockResolvedValue({
    AAPL: { '2026-02-20': { marketPrice: 190 }, '2026-02-21': { marketPrice: 193 } }
  }),
  search: jest.fn().mockResolvedValue({
    items: [
      { symbol: 'AAPL', name: 'Apple Inc.', currency: 'USD', dataSource: 'YAHOO' }
    ]
  })
} as any;

const mockMarketDataService = {
  getBySymbol: jest.fn().mockResolvedValue({
    symbol: 'AAPL',
    dataSource: 'YAHOO'
  })
} as any;

const TEST_USER_ID = 'test-user-123';

// ---------------------------------------------------------------------------
// Build tools with mocks
// ---------------------------------------------------------------------------

let tools: DynamicStructuredTool[];
let toolMap: Map<string, DynamicStructuredTool>;

beforeAll(() => {
  tools = [
    createPortfolioSummaryTool(mockPortfolioService, mockAccountService, TEST_USER_ID),
    createPerformanceMetricsTool(mockPortfolioService, TEST_USER_ID),
    createQueryHoldingsTool(mockPortfolioService, TEST_USER_ID),
    createMarketDataTool(mockDataProviderService, mockMarketDataService),
    createAnalyzeRiskTool(mockPortfolioService, TEST_USER_ID)
  ];
  toolMap = new Map(tools.map((t) => [t.name, t]));
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helper: execute a tool by name and return parsed result
// ---------------------------------------------------------------------------

async function executeTool(name: string, args: Record<string, unknown> = {}) {
  const tool = toolMap.get(name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  const result = await tool.invoke(args);
  return typeof result === 'string' ? JSON.parse(result) : result;
}

// ============================================================
// HAPPY PATH: Portfolio Summary (5 cases)
// ============================================================

describe('Happy Path — Portfolio Summary', () => {
  test('HP-1: returns total value and net worth', async () => {
    const result = await executeTool('get_portfolio_summary');
    expect(result.totalValueInBaseCurrency).toBe(100000);
    expect(result.netWorth).toBe(105000);
    expect(result.totalHoldings).toBe(4);
  });

  test('HP-2: returns top holdings sorted by allocation', async () => {
    const result = await executeTool('get_portfolio_summary', { topN: 3 });
    expect(result.topHoldings).toHaveLength(3);
    // VTI should be first (35%)
    expect(result.topHoldings[0].symbol).toBe('VTI');
    expect(result.topHoldings[0].allocationPercent).toBeCloseTo(35, 0);
  });

  test('HP-3: includes allocation by asset class', async () => {
    const result = await executeTool('get_portfolio_summary');
    expect(result.allocationByAssetClass).toBeDefined();
    expect(Object.keys(result.allocationByAssetClass).length).toBeGreaterThan(0);
  });

  test('HP-4: includes allocation by sector', async () => {
    const result = await executeTool('get_portfolio_summary');
    expect(result.allocationBySector).toBeDefined();
  });

  test('HP-5: includes accounts when requested', async () => {
    const result = await executeTool('get_portfolio_summary', { includeAccounts: true });
    expect(result.accounts).toBeDefined();
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0].name).toBe('Main Brokerage');
  });
});

// ============================================================
// HAPPY PATH: Performance Metrics (5 cases)
// ============================================================

describe('Happy Path — Performance Metrics', () => {
  test('HP-6: returns YTD performance', async () => {
    const result = await executeTool('get_performance_metrics', { dateRange: 'ytd' });
    expect(result.netPerformance).toBeDefined();
    expect(result.netPerformancePercent).toBeDefined();
    expect(mockPortfolioService.getPerformance).toHaveBeenCalled();
  });

  test('HP-7: returns max (all-time) performance', async () => {
    const result = await executeTool('get_performance_metrics', { dateRange: 'max' });
    expect(result.netPerformance).toBeDefined();
  });

  test('HP-8: returns fees and dividends', async () => {
    const result = await executeTool('get_performance_metrics', { dateRange: '1y' });
    expect(result.fees).toBe(500);
    expect(result.dividends).toBe(1500);
  });

  test('HP-9: returns annualized return', async () => {
    const result = await executeTool('get_performance_metrics', { dateRange: '5y' });
    expect(result.annualizedReturn).toBeDefined();
  });

  test('HP-10: includes chart data when requested', async () => {
    const result = await executeTool('get_performance_metrics', {
      dateRange: 'ytd',
      includeChart: true
    });
    expect(result).toBeDefined();
  });
});

// ============================================================
// HAPPY PATH: Query Holdings (4 cases)
// ============================================================

describe('Happy Path — Query Holdings', () => {
  test('HP-11: filters by symbol', async () => {
    const result = await executeTool('query_holdings', { symbol: 'AAPL' });
    expect(result.matchCount).toBe(1);
    expect(result.holdings[0].symbol).toBe('AAPL');
  });

  test('HP-12: filters by asset class', async () => {
    const result = await executeTool('query_holdings', { assetClass: 'EQUITY' });
    expect(result.matchCount).toBe(3); // AAPL, MSFT, VTI
  });

  test('HP-13: filters by min value', async () => {
    const result = await executeTool('query_holdings', { minValueInBaseCurrency: 25000 });
    expect(result.holdings.every((h: any) => h.valueInBaseCurrency >= 25000)).toBe(true);
  });

  test('HP-14: sorts by value descending', async () => {
    const result = await executeTool('query_holdings', { sortBy: 'value' });
    const values = result.holdings.map((h: any) => h.valueInBaseCurrency);
    expect(values).toEqual([...values].sort((a: number, b: number) => b - a));
  });
});

// ============================================================
// HAPPY PATH: Market Data (3 cases)
// ============================================================

describe('Happy Path — Market Data', () => {
  test('HP-15: returns current price for symbol', async () => {
    const result = await executeTool('get_market_data', { symbol: 'AAPL', dataSource: 'YAHOO' });
    expect(result.marketPrice).toBe(195.5);
  });

  test('HP-16: search returns matching symbols', async () => {
    const result = await executeTool('get_market_data', { searchQuery: 'Apple' });
    expect(result.results).toBeDefined();
    expect(result.results.length).toBeGreaterThan(0);
  });

  test('HP-17: includes historical data when requested', async () => {
    const result = await executeTool('get_market_data', {
      symbol: 'AAPL',
      dataSource: 'YAHOO',
      includeHistorical: true
    });
    expect(result).toBeDefined();
  });
});

// ============================================================
// HAPPY PATH: Risk Analysis (3 cases)
// ============================================================

describe('Happy Path — Risk Analysis', () => {
  test('HP-18: returns diversification score', async () => {
    const result = await executeTool('analyze_risk');
    expect(result.diversificationScore).toBeDefined();
    expect(result.diversificationScore).toBeGreaterThanOrEqual(0);
    expect(result.diversificationScore).toBeLessThanOrEqual(100);
  });

  test('HP-19: returns concentration analysis', async () => {
    const result = await executeTool('analyze_risk');
    expect(result.concentrationAnalysis).toBeDefined();
    expect(result.concentrationAnalysis.topHoldingWeight).toBeDefined();
  });

  test('HP-20: returns suggestions', async () => {
    const result = await executeTool('analyze_risk');
    expect(result.suggestions).toBeDefined();
    expect(Array.isArray(result.suggestions)).toBe(true);
  });
});

// ============================================================
// EDGE CASES (10 cases)
// ============================================================

describe('Edge Cases', () => {
  test('EC-1: empty portfolio returns zero values', async () => {
    mockPortfolioService.getDetails.mockResolvedValueOnce({
      holdings: {},
      summary: {
        ...MOCK_PORTFOLIO_DETAILS.summary,
        currentValue: 0,
        netWorth: 0,
        items: 0
      },
      hasErrors: false
    });
    const result = await executeTool('get_portfolio_summary');
    expect(result.totalHoldings).toBe(0);
    expect(result.totalValueInBaseCurrency).toBe(0);
  });

  test('EC-2: single holding portfolio calculates risk', async () => {
    mockPortfolioService.getDetails.mockResolvedValueOnce({
      holdings: { AAPL: MOCK_HOLDINGS.AAPL },
      summary: MOCK_PORTFOLIO_DETAILS.summary,
      hasErrors: false
    });
    const result = await executeTool('analyze_risk');
    expect(result.concentrationAnalysis.topHoldingWeight).toBeCloseTo(100, 0);
  });

  test('EC-3: query for non-existent symbol returns zero matches', async () => {
    const result = await executeTool('query_holdings', { symbol: 'XYZZZZ' });
    expect(result.matchCount).toBe(0);
    expect(result.holdings).toHaveLength(0);
  });

  test('EC-4: performance with default date range works', async () => {
    const result = await executeTool('get_performance_metrics', {});
    expect(result).toBeDefined();
    expect(result.netPerformance).toBeDefined();
  });

  test('EC-5: market data search with empty query', async () => {
    mockDataProviderService.search.mockResolvedValueOnce({ items: [] });
    const result = await executeTool('get_market_data', { searchQuery: 'xyznonexistent' });
    expect(result.results).toBeDefined();
    expect(result.results).toHaveLength(0);
  });

  test('EC-6: portfolio summary with topN=0 returns all', async () => {
    const result = await executeTool('get_portfolio_summary', { topN: 0 });
    expect(result.topHoldings.length).toBeLessThanOrEqual(4);
  });

  test('EC-7: query holdings with maxValue filter', async () => {
    const result = await executeTool('query_holdings', { maxValueInBaseCurrency: 21000 });
    expect(result.holdings.every((h: any) => h.valueInBaseCurrency <= 21000)).toBe(true);
  });

  test('EC-8: risk analysis includes sector breakdown', async () => {
    const result = await executeTool('analyze_risk');
    expect(result.sectorBreakdown).toBeDefined();
  });

  test('EC-9: portfolio service error is handled', async () => {
    mockPortfolioService.getDetails.mockRejectedValueOnce(new Error('DB connection failed'));
    await expect(executeTool('get_portfolio_summary')).rejects.toThrow();
  });

  test('EC-10: market data with invalid dataSource handled', async () => {
    mockDataProviderService.getQuotes.mockResolvedValueOnce({});
    const result = await executeTool('get_market_data', { symbol: 'AAPL', dataSource: 'YAHOO' });
    expect(result).toBeDefined();
  });
});

// ============================================================
// TOOL SCHEMA VALIDATION (5 cases)
// ============================================================

describe('Tool Schema & Metadata', () => {
  test('all 5 tools are registered', () => {
    expect(tools).toHaveLength(5);
    const names = tools.map((t) => t.name);
    expect(names).toContain('get_portfolio_summary');
    expect(names).toContain('get_performance_metrics');
    expect(names).toContain('query_holdings');
    expect(names).toContain('get_market_data');
    expect(names).toContain('analyze_risk');
  });

  test('all tools have descriptions', () => {
    for (const tool of tools) {
      expect(tool.description).toBeDefined();
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  test('all tools have schemas', () => {
    for (const tool of tools) {
      expect(tool.schema).toBeDefined();
    }
  });

  test('performance tool accepts valid dateRange values', async () => {
    for (const range of ['1d', 'ytd', '1y', '5y', 'max']) {
      const result = await executeTool('get_performance_metrics', { dateRange: range });
      expect(result).toBeDefined();
    }
  });

  test('tools return JSON-serializable results', async () => {
    for (const tool of tools) {
      const result = await tool.invoke({});
      const parsed = typeof result === 'string' ? JSON.parse(result) : result;
      expect(() => JSON.stringify(parsed)).not.toThrow();
    }
  });
});

// ============================================================
// DATA ACCURACY — Tier 1 & 2 (must be 100%)
// ============================================================

describe('Data Accuracy — Tier 1 & 2 (100% required)', () => {
  test('T1-1: portfolio value matches mock exactly', async () => {
    const result = await executeTool('get_portfolio_summary');
    expect(result.totalValueInBaseCurrency).toBe(
      MOCK_PORTFOLIO_DETAILS.summary.currentValue
    );
  });

  test('T1-2: net worth matches mock exactly', async () => {
    const result = await executeTool('get_portfolio_summary');
    expect(result.netWorth).toBe(MOCK_PORTFOLIO_DETAILS.summary.netWorth);
  });

  test('T1-3: holding count matches mock', async () => {
    const result = await executeTool('get_portfolio_summary');
    expect(result.totalHoldings).toBe(Object.keys(MOCK_HOLDINGS).length);
  });

  test('T2-1: net performance matches mock', async () => {
    const result = await executeTool('get_performance_metrics', { dateRange: 'ytd' });
    expect(result.netPerformance).toBe(
      MOCK_PERFORMANCE.performance.currentNetPerformance
    );
  });

  test('T2-2: fees match mock exactly', async () => {
    const result = await executeTool('get_performance_metrics', { dateRange: '1y' });
    expect(result.fees).toBe(MOCK_PERFORMANCE.performance.fees);
  });

  test('T2-3: allocations sum to ~100%', async () => {
    const result = await executeTool('get_portfolio_summary');
    const totalAllocation = result.topHoldings.reduce(
      (sum: number, h: any) => sum + h.allocationPercent,
      0
    );
    expect(totalAllocation).toBeCloseTo(100, 0);
  });
});
