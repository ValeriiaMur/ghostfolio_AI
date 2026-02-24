# Ghostfolio AI — MVP Status

## Hard Gate Requirements (all PASSED)

- [x] **Agent responds to natural language queries in your chosen domain**
  - Finance/Wealth Management domain
  - Agent handles portfolio queries, performance analysis, holdings Q&A, risk analysis, market data lookups
  - System prompt enforces financial data accuracy and disclaimer rules

- [x] **At least 3 functional tools the agent can invoke** (we have 5)
  1. `get_portfolio_summary` — total value, net worth, holdings count, top N holdings, allocation by asset class/sector, accounts
  2. `get_performance_metrics` — net/gross performance, fees, dividends, annualized return for timeframes (1d|1w|1m|3m|6m|ytd|1y|5y|max)
  3. `query_holdings` — filter by symbol, asset class, search term, min/max value; sort by allocation/value/performance/name
  4. `get_market_data` — current price, market state, historical data; symbol search across data providers (Yahoo, CoinGecko, etc.)
  5. `analyze_risk` — concentration risk, diversification score (0-100), sector/geographic breakdown, rule-based suggestions

- [x] **Tool calls execute successfully and return structured results**
  - All tools return JSON via `DynamicStructuredTool` with Zod schemas
  - Tool results include timestamps, error flags, and structured data
  - API returns `toolCalls` metadata in the response for observability

- [x] **Agent synthesizes tool results into coherent responses**
  - LangChain.js tool-calling agent loop (max 3 iterations)
  - LLM (GPT-4o-mini) formats structured JSON tool results into natural language
  - Multi-tool queries supported (e.g., "portfolio summary and risk analysis")

- [x] **Conversation history maintained across turns**
  - Sliding window memory: last 5 turns (10 messages)
  - In-memory per session, keyed by sessionId
  - Supports follow-up queries ("What about just tech stocks?")

- [x] **Basic error handling (graceful failure, not crashes)**
  - Tool execution errors caught and returned as ToolMessage errors
  - Max iteration limit prevents infinite loops
  - Auth retry on 401/403 with token refresh
  - 55s fetch timeout on frontend, 60s Vercel function timeout
  - Service errors (DB down, API timeout) return clear error messages

- [x] **At least one domain-specific verification check**
  - All financial numbers come from tools (DB queries), never LLM-generated
  - System prompt enforces: "All portfolio values, returns, and allocations MUST come from tool results"
  - Tier 1-2 data (portfolio value, returns) is exact-match from PortfolioService
  - Tier 3-4 data (insights, market context) labeled as "analytical" with disclaimers
  - Deterministic Jest tests verify Tier 1-2 accuracy at 100%

- [x] **Simple evaluation: 5+ test cases with expected outcomes** (we have 50+)
  - **Golden set**: 50 test cases in YAML (20 happy path, 10 edge, 10 adversarial, 10 multi-step)
  - **Deterministic Jest evals**: 50+ assertions with mocked services (no AI needed)
    - `tool-routing.spec.ts`: 20 happy path + 10 edge cases + 6 Tier 1-2 accuracy
    - `safety.spec.ts`: 10 adversarial + 15 assertion engine unit tests
  - **CI**: GitHub Actions runs evals on every PR touching `ai/**` files
  - **Thresholds**: 95% overall pass rate, 100% for Tier 1-2 numerical accuracy

- [x] **Deployed and publicly accessible**
  - Backend: Railway (NestJS API with Docker)
  - Frontend: Vercel (Next.js chat app)
  - Anonymous auth flow: security token -> JWT -> API access

---

## Architecture

| Component       | Technology                                    | Location                         |
| --------------- | --------------------------------------------- | -------------------------------- |
| Backend API     | NestJS + Prisma + PostgreSQL + Redis          | Railway                          |
| Agent Framework | LangChain.js (tool-calling agent loop)        | `apps/api/src/app/endpoints/ai/` |
| LLM             | GPT-4o-mini (fast, cheap ~$0.001/query)       | OpenAI API                       |
| Frontend        | Next.js + Vercel AI SDK (useChat)             | Vercel (`ghostfolio-chat/`)      |
| Observability   | Langfuse callbacks                            | `buildLangfuseCallbacks()`       |
| Evals           | Jest (deterministic) + Golden set YAML (live) | `evals/`                         |
| CI              | GitHub Actions                                | `.github/workflows/ai-evals.yml` |

## Tools Detail

| Tool                      | Service Wrapped                                | Key Data Returned                                                                |
| ------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `get_portfolio_summary`   | PortfolioService.getDetails() + AccountService | Total value, net worth, top holdings, allocation by class/sector, accounts       |
| `get_performance_metrics` | PortfolioService.getPerformance()              | Net/gross performance %, annualized return, fees, dividends, chart data          |
| `query_holdings`          | PortfolioService.getDetails() + filtering      | Filtered holdings with symbol, price, quantity, allocation, performance          |
| `get_market_data`         | DataProviderService.getQuotes/search()         | Market price, state, historical data, symbol search results                      |
| `analyze_risk`            | PortfolioService.getDetails/getReport()        | Diversification score, concentration analysis, sector/geo breakdown, suggestions |

## Eval Breakdown

| Category          | Count  | Type                    | Pass Threshold |
| ----------------- | ------ | ----------------------- | -------------- |
| Happy Path        | 20     | Deterministic (Jest)    | 95%            |
| Edge Cases        | 10     | Deterministic (Jest)    | 95%            |
| Adversarial       | 10     | Deterministic (Jest)    | 95%            |
| Multi-Step        | 10     | Golden set (YAML, live) | 95%            |
| Tier 1-2 Accuracy | 6      | Deterministic (Jest)    | **100%**       |
| **Total**         | **56** |                         |                |

## Performance Targets

| Query Type           | Target | Model       |
| -------------------- | ------ | ----------- |
| Portfolio summary    | < 3s   | GPT-4o-mini |
| Performance analysis | < 5s   | GPT-4o-mini |
| Market data lookup   | < 5s   | GPT-4o-mini |
| Complex multi-tool   | < 10s  | GPT-4o-mini |

## Performance Improvements (all implemented):

- **Compound tool** — `get_portfolio_overview` combines summary + performance + risk in ONE call (1 LLM round trip instead of 3)
- **Per-request DetailsCache** — `DetailsCache` wraps `portfolioService.getDetails()` so all tools (summary, holdings, risk, overview) share the same DB result within a single chat request. Caches the Promise itself so even parallel tool calls share one DB query.
- **Parallel tool execution** — agent loop uses `Promise.all()` to execute all tool calls concurrently instead of sequentially. When the LLM requests 2-3 tools, they run simultaneously.
- **GPT-4o-mini** — fast, cheap model (~$0.001/query, ~100ms latency)
- **Shortened system prompt** — reduced from ~200 tokens to ~50 tokens
- **maxTokens 1024** — reduced from 2048 to speed up generation
- **MAX_TOOL_ITERATIONS 3** — reduced from 5 to limit worst-case latency

## Cost

| Metric         | Target  | Actual                |
| -------------- | ------- | --------------------- |
| Per-query cost | < $0.05 | ~$0.001 (GPT-4o-mini) |
| Monthly budget | < $50   | Well under            |

## Run Commands

```bash
# Run all deterministic evals (no AI, no tokens, free)
npm run eval:ai

# Run only tool routing tests
npm run eval:ai:tools

# Run only safety/adversarial tests
npm run eval:ai:safety

# Run only Tier 1-2 accuracy tests (must be 100%)
npm run eval:ai:accuracy

# Run live evals against deployed API (needs tokens)
npm run eval:ai:live
```
