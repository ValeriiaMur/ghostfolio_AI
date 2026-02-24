#!/usr/bin/env ts-node
/**
 * Ghostfolio AI Agent — Eval Runner
 *
 * Runs golden-set test cases against the live agent API and produces a
 * pass/fail report with per-category breakdowns.
 *
 * Usage:
 *   npx ts-node apps/api/src/app/endpoints/ai/evals/run-evals.ts
 *
 * Environment variables:
 *   GHOSTFOLIO_API_URL    — Base URL (default: http://localhost:3333)
 *   GHOSTFOLIO_SECURITY_TOKEN — Security token for anonymous auth
 *   EVAL_CONCURRENCY      — Parallel requests (default: 1)
 *   EVAL_FILTER_CATEGORY  — Run only this category (optional)
 *   EVAL_FILTER_ID        — Run only this test ID (optional)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { runAssertion } from './assertions';
import type {
  EvalCase,
  EvalResult,
  EvalSummary,
  AgentResponse,
  ToolCallRecord
} from './types';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_URL = process.env.GHOSTFOLIO_API_URL || 'http://localhost:3333';
const SECURITY_TOKEN = process.env.GHOSTFOLIO_SECURITY_TOKEN || '';
const CONCURRENCY = parseInt(process.env.EVAL_CONCURRENCY || '1', 10);
const FILTER_CATEGORY = process.env.EVAL_FILTER_CATEGORY;
const FILTER_ID = process.env.EVAL_FILTER_ID;
const PASS_THRESHOLD = 0.95; // 95% overall
const TIER_1_2_THRESHOLD = 1.0; // 100% for happy path

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

let cachedJwt: string | null = null;

async function getJwt(): Promise<string> {
  if (cachedJwt) return cachedJwt;

  if (!SECURITY_TOKEN) {
    throw new Error(
      'GHOSTFOLIO_SECURITY_TOKEN not set. Get this from your Ghostfolio user settings.'
    );
  }

  const res = await fetch(`${API_URL}/api/v1/auth/anonymous`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: SECURITY_TOKEN })
  });

  if (!res.ok) {
    throw new Error(`Auth failed (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  cachedJwt = data.authToken;
  return cachedJwt!;
}

// ---------------------------------------------------------------------------
// Agent API call (with tool call capture)
// ---------------------------------------------------------------------------

async function callAgent(
  query: string,
  sessionId: string
): Promise<AgentResponse> {
  const jwt = await getJwt();

  const res = await fetch(`${API_URL}/api/v1/ai/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`
    },
    body: JSON.stringify({ query, sessionId })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Agent API error (${res.status}): ${text}`);
  }

  const data = await res.json();

  return {
    answer: data.answer || '',
    sessionId: data.sessionId || sessionId,
    toolCalls: (data.toolCalls || []).map((tc: any) => ({
      name: tc.name,
      args: tc.args || {},
      id: tc.id
    }))
  };
}

// Legacy inference function kept as fallback
function _inferToolCalls(answer: string, _query: string): ToolCallRecord[] {
  const calls: ToolCallRecord[] = [];
  const lower = answer.toLowerCase();

  // Portfolio summary indicators
  if (
    lower.includes('total value') ||
    lower.includes('net worth') ||
    lower.includes('portfolio is worth') ||
    lower.includes('holdings') ||
    lower.includes('allocation') ||
    lower.includes('asset class')
  ) {
    calls.push({ name: 'get_portfolio_summary', args: {} });
  }

  // Performance indicators
  if (
    lower.includes('return') ||
    lower.includes('performance') ||
    lower.includes('gain') ||
    lower.includes('loss') ||
    lower.includes('annualized') ||
    lower.includes('ytd') ||
    lower.includes('year-to-date')
  ) {
    calls.push({ name: 'get_performance_metrics', args: {} });
  }

  // Holdings query indicators
  if (
    lower.includes('found') ||
    lower.includes('position in') ||
    lower.includes('you own') ||
    lower.includes('you hold') ||
    lower.includes('shares of') ||
    lower.includes('filtered')
  ) {
    calls.push({ name: 'query_holdings', args: {} });
  }

  // Market data indicators
  if (
    lower.includes('current price') ||
    lower.includes('trading at') ||
    lower.includes('market price') ||
    lower.includes('per share')
  ) {
    calls.push({ name: 'get_market_data', args: {} });
  }

  // Risk analysis indicators
  if (
    lower.includes('diversification') ||
    lower.includes('concentration') ||
    lower.includes('risk score') ||
    lower.includes('risk analysis') ||
    lower.includes('well-diversified') ||
    lower.includes('balanced')
  ) {
    calls.push({ name: 'analyze_risk', args: {} });
  }

  return calls;
}

// ---------------------------------------------------------------------------
// Run single eval case
// ---------------------------------------------------------------------------

async function runSingleCase(evalCase: EvalCase): Promise<EvalResult> {
  const sessionId = `eval-${evalCase.id}-${Date.now()}`;
  const startTime = Date.now();

  try {
    // Multi-turn case
    if (evalCase.turns && evalCase.turns.length > 0) {
      return await runMultiTurnCase(evalCase, sessionId, startTime);
    }

    // Single-turn case
    const input = evalCase.input!;
    const response = await callAgent(input, sessionId);
    const latencyMs = Date.now() - startTime;

    const assertionResults = (evalCase.assertions || []).map((assertion) =>
      runAssertion(assertion, response.answer, response.toolCalls)
    );

    const passed = assertionResults.every((r) => r.passed);

    return {
      id: evalCase.id,
      category: evalCase.category,
      input,
      passed,
      assertions: assertionResults,
      answer: response.answer,
      toolCalls: response.toolCalls,
      latencyMs
    };
  } catch (error) {
    return {
      id: evalCase.id,
      category: evalCase.category,
      input: evalCase.input || evalCase.turns?.[0]?.input || '',
      passed: false,
      assertions: [],
      answer: '',
      toolCalls: [],
      latencyMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function runMultiTurnCase(
  evalCase: EvalCase,
  sessionId: string,
  startTime: number
): Promise<EvalResult> {
  const allAssertions: { type: string; passed: boolean; message: string }[] = [];
  let lastAnswer = '';
  let allToolCalls: ToolCallRecord[] = [];

  for (const turn of evalCase.turns!) {
    const response = await callAgent(turn.input, sessionId);
    lastAnswer = response.answer;
    allToolCalls = [...allToolCalls, ...response.toolCalls];

    const turnResults = (turn.assertions || []).map((assertion) =>
      runAssertion(assertion, response.answer, response.toolCalls)
    );
    allAssertions.push(...turnResults);
  }

  const passed = allAssertions.every((r) => r.passed);

  return {
    id: evalCase.id,
    category: evalCase.category,
    input: evalCase.turns!.map((t) => t.input).join(' → '),
    passed,
    assertions: allAssertions,
    answer: lastAnswer,
    toolCalls: allToolCalls,
    latencyMs: Date.now() - startTime
  };
}

// ---------------------------------------------------------------------------
// Run all evals with concurrency
// ---------------------------------------------------------------------------

async function runBatch(
  cases: EvalCase[],
  concurrency: number
): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  const queue = [...cases];

  async function worker() {
    while (queue.length > 0) {
      const evalCase = queue.shift()!;
      const label = `[${evalCase.category}] ${evalCase.id}`;
      process.stdout.write(`  Running ${label}...`);

      const result = await runSingleCase(evalCase);
      results.push(result);

      const icon = result.passed ? '✓' : '✗';
      const latency = `${(result.latencyMs / 1000).toFixed(1)}s`;
      console.log(
        ` ${icon} ${result.passed ? 'PASS' : 'FAIL'} (${latency})${result.error ? ` — ${result.error}` : ''}`
      );
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function generateReport(results: EvalResult[], durationMs: number): EvalSummary {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const passRate = total > 0 ? passed / total : 0;

  const byCategory: Record<string, { total: number; passed: number; passRate: number }> = {};

  for (const r of results) {
    if (!byCategory[r.category]) {
      byCategory[r.category] = { total: 0, passed: 0, passRate: 0 };
    }
    byCategory[r.category].total++;
    if (r.passed) byCategory[r.category].passed++;
  }

  for (const cat of Object.values(byCategory)) {
    cat.passRate = cat.total > 0 ? cat.passed / cat.total : 0;
  }

  return {
    total,
    passed,
    failed: total - passed,
    passRate,
    byCategory,
    results,
    timestamp: new Date().toISOString(),
    durationMs
  };
}

function printReport(summary: EvalSummary): void {
  console.log('\n' + '='.repeat(60));
  console.log('GHOSTFOLIO AI AGENT — EVAL REPORT');
  console.log('='.repeat(60));
  console.log(`Timestamp: ${summary.timestamp}`);
  console.log(`Duration:  ${(summary.durationMs / 1000).toFixed(1)}s`);
  console.log(`Total:     ${summary.total}`);
  console.log(`Passed:    ${summary.passed}`);
  console.log(`Failed:    ${summary.failed}`);
  console.log(
    `Pass Rate: ${(summary.passRate * 100).toFixed(1)}% (threshold: ${PASS_THRESHOLD * 100}%)`
  );
  console.log('-'.repeat(60));

  for (const [category, stats] of Object.entries(summary.byCategory)) {
    const icon = stats.passRate >= PASS_THRESHOLD ? '✓' : '✗';
    console.log(
      `  ${icon} ${category}: ${stats.passed}/${stats.total} (${(stats.passRate * 100).toFixed(1)}%)`
    );
  }

  // Show failed cases
  const failures = summary.results.filter((r) => !r.passed);
  if (failures.length > 0) {
    console.log('\n' + '-'.repeat(60));
    console.log('FAILURES:');
    for (const f of failures) {
      console.log(`\n  ${f.id} [${f.category}]`);
      console.log(`    Input: "${f.input.substring(0, 80)}..."`);
      if (f.error) {
        console.log(`    Error: ${f.error}`);
      }
      for (const a of f.assertions.filter((a) => !a.passed)) {
        console.log(`    ✗ ${a.type}: ${a.message}`);
      }
    }
  }

  console.log('\n' + '='.repeat(60));

  // Threshold checks
  const overallPass = summary.passRate >= PASS_THRESHOLD;
  const happyPathRate = summary.byCategory['happy_path']?.passRate ?? 0;
  const happyPathPass = happyPathRate >= TIER_1_2_THRESHOLD;

  console.log(
    `Overall threshold (${PASS_THRESHOLD * 100}%): ${overallPass ? 'PASS ✓' : 'FAIL ✗'}`
  );
  console.log(
    `Happy path threshold (${TIER_1_2_THRESHOLD * 100}%): ${happyPathPass ? 'PASS ✓' : 'FAIL ✗'}`
  );
  console.log('='.repeat(60));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Ghostfolio AI Agent — Eval Runner');
  console.log(`API: ${API_URL}`);
  console.log(`Concurrency: ${CONCURRENCY}`);

  // Load golden set
  const yamlPath = path.join(__dirname, 'golden-set.yaml');
  const raw = fs.readFileSync(yamlPath, 'utf-8');
  let cases = yaml.load(raw) as EvalCase[];

  // Apply filters
  if (FILTER_ID) {
    cases = cases.filter((c) => c.id === FILTER_ID);
    console.log(`Filtered to ID: ${FILTER_ID} (${cases.length} cases)`);
  } else if (FILTER_CATEGORY) {
    cases = cases.filter((c) => c.category === FILTER_CATEGORY);
    console.log(`Filtered to category: ${FILTER_CATEGORY} (${cases.length} cases)`);
  }

  console.log(`Running ${cases.length} eval cases...\n`);

  const startTime = Date.now();
  const results = await runBatch(cases, CONCURRENCY);
  const durationMs = Date.now() - startTime;

  const summary = generateReport(results, durationMs);
  printReport(summary);

  // Save results to JSON
  const outputPath = path.join(__dirname, 'eval-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));
  console.log(`\nResults saved to: ${outputPath}`);

  // Exit with appropriate code
  const overallPass = summary.passRate >= PASS_THRESHOLD;
  process.exit(overallPass ? 0 : 1);
}

main().catch((err) => {
  console.error('Eval runner failed:', err);
  process.exit(1);
});
