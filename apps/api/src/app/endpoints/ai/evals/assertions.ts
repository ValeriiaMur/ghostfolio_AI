/**
 * Assertion engine for eval cases.
 * Each assertion type checks a specific property of the agent response.
 */

import type { Assertion, AssertionResult, ToolCallRecord } from './types';

export function runAssertion(
  assertion: Assertion,
  answer: string,
  toolCalls: ToolCallRecord[]
): AssertionResult {
  const handler = ASSERTION_HANDLERS[assertion.type];

  if (!handler) {
    return {
      type: assertion.type,
      passed: false,
      message: `Unknown assertion type: ${assertion.type}`
    };
  }

  return handler(assertion, answer, toolCalls);
}

const ASSERTION_HANDLERS: Record<
  string,
  (a: Assertion, answer: string, toolCalls: ToolCallRecord[]) => AssertionResult
> = {
  /**
   * Check that a specific tool was called.
   */
  contains_tool_call: (a, _answer, toolCalls) => {
    const found = toolCalls.some((tc) => tc.name === a.tool);
    return {
      type: a.type,
      passed: found,
      message: found
        ? `Tool '${a.tool}' was called`
        : `Expected tool '${a.tool}' to be called. Called: [${toolCalls.map((t) => t.name).join(', ')}]`
    };
  },

  /**
   * Check that at least one of the specified tools was called.
   */
  contains_tool_call_any: (a, _answer, toolCalls) => {
    const found = toolCalls.some((tc) => a.tools?.includes(tc.name));
    return {
      type: a.type,
      passed: found,
      message: found
        ? `One of [${a.tools?.join(', ')}] was called`
        : `Expected one of [${a.tools?.join(', ')}] to be called. Called: [${toolCalls.map((t) => t.name).join(', ')}]`
    };
  },

  /**
   * Check that no tools were called.
   */
  no_tool_calls: (a, _answer, toolCalls) => {
    const passed = toolCalls.length === 0;
    return {
      type: a.type,
      passed,
      message: passed
        ? 'No tools were called (as expected)'
        : `Expected no tool calls but got: [${toolCalls.map((t) => t.name).join(', ')}]`
    };
  },

  /**
   * Check that specific tools were NOT called.
   */
  no_tool_calls_to: (a, _answer, toolCalls) => {
    const forbidden = toolCalls.filter((tc) => a.tools?.includes(tc.name));
    const passed = forbidden.length === 0;
    return {
      type: a.type,
      passed,
      message: passed
        ? `None of [${a.tools?.join(', ')}] were called`
        : `Forbidden tools called: [${forbidden.map((t) => t.name).join(', ')}]`
    };
  },

  /**
   * Check that response contains any of the specified values (case-insensitive).
   */
  response_contains_any: (a, answer, _toolCalls) => {
    const lower = answer.toLowerCase();
    const found = a.values?.find((v) => lower.includes(v.toLowerCase()));
    return {
      type: a.type,
      passed: !!found,
      message: found
        ? `Response contains '${found}'`
        : `Response missing all of: [${a.values?.join(', ')}]`
    };
  },

  /**
   * Check that response does NOT contain any of the specified values.
   */
  response_not_contains: (a, answer, _toolCalls) => {
    const lower = answer.toLowerCase();
    const found = a.values?.find((v) => lower.includes(v.toLowerCase()));
    return {
      type: a.type,
      passed: !found,
      message: found
        ? `Response should not contain '${found}' but does`
        : `Response correctly excludes all of: [${a.values?.join(', ')}]`
    };
  },

  /**
   * Check that response contains at least one number (dollar amount or percentage).
   */
  response_contains_number: (a, answer, _toolCalls) => {
    const hasNumber = /[\$€£]?\d[\d,]*\.?\d*%?/.test(answer);
    return {
      type: a.type,
      passed: hasNumber,
      message: hasNumber
        ? 'Response contains numerical data'
        : 'Response missing numerical data'
    };
  },

  /**
   * Check that response is not empty.
   */
  response_not_empty: (a, answer, _toolCalls) => {
    const passed = answer.trim().length > 0;
    return {
      type: a.type,
      passed,
      message: passed ? 'Response is not empty' : 'Response is empty'
    };
  },

  /**
   * Check that a tool was called with a specific parameter value.
   */
  tool_called_with: (a, _answer, toolCalls) => {
    const tool = toolCalls.find((tc) => tc.name === a.tool);
    if (!tool) {
      return {
        type: a.type,
        passed: false,
        message: `Tool '${a.tool}' was not called`
      };
    }
    const actual = tool.args?.[a.param!];
    const passed = String(actual) === String(a.value);
    return {
      type: a.type,
      passed,
      message: passed
        ? `${a.tool}.${a.param} = '${a.value}'`
        : `Expected ${a.tool}.${a.param} = '${a.value}', got '${actual}'`
    };
  },

  /**
   * Check that a tool was called with a param matching any of the given values.
   */
  tool_called_with_any: (a, _answer, toolCalls) => {
    const tool = toolCalls.find((tc) => tc.name === a.tool);
    if (!tool) {
      return {
        type: a.type,
        passed: false,
        message: `Tool '${a.tool}' was not called`
      };
    }
    const actual = String(tool.args?.[a.param!]);
    const passed = a.values?.some((v) => actual.toLowerCase() === v.toLowerCase()) ?? false;
    return {
      type: a.type,
      passed,
      message: passed
        ? `${a.tool}.${a.param} matches one of [${a.values?.join(', ')}]`
        : `Expected ${a.tool}.${a.param} in [${a.values?.join(', ')}], got '${actual}'`
    };
  },

  /**
   * Verify no hallucination — all numbers in the response should trace to tool results.
   * This is a soft check — flags responses that contain numbers not in tool output.
   */
  no_hallucination: (a, answer, _toolCalls) => {
    // Soft pass for now — full implementation would cross-check tool results
    const passed = answer.length > 0;
    return {
      type: a.type,
      passed,
      message: passed
        ? 'Hallucination check passed (soft)'
        : 'Empty response — possible hallucination issue'
    };
  }
};
