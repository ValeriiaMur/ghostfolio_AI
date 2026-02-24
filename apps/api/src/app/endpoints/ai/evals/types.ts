/**
 * Eval system types for Ghostfolio AI Agent.
 */

export interface Assertion {
  type: string;
  tool?: string;
  tools?: string[];
  param?: string;
  value?: string;
  values?: string[];
  description?: string;
}

export interface EvalTurn {
  input: string;
  assertions: Assertion[];
}

export interface EvalCase {
  id: string;
  category: 'happy_path' | 'edge_case' | 'adversarial' | 'multi_step';
  tool?: string;
  input?: string;
  description?: string;
  setup?: string;
  expected_tool_calls?: string[];
  assertions?: Assertion[];
  turns?: EvalTurn[];
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  id?: string;
}

export interface AgentResponse {
  answer: string;
  sessionId: string;
  toolCalls: ToolCallRecord[];
}

export interface AssertionResult {
  type: string;
  passed: boolean;
  message: string;
}

export interface EvalResult {
  id: string;
  category: string;
  input: string;
  passed: boolean;
  assertions: AssertionResult[];
  answer: string;
  toolCalls: ToolCallRecord[];
  latencyMs: number;
  error?: string;
}

export interface EvalSummary {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  byCategory: Record<string, { total: number; passed: number; passRate: number }>;
  results: EvalResult[];
  timestamp: string;
  durationMs: number;
}
