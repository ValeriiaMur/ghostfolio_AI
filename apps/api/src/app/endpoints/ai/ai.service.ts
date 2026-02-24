import { AccountService } from '@ghostfolio/api/app/account/account.service';
import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';
import { MarketDataService } from '@ghostfolio/api/services/market-data/market-data.service';
import { PropertyService } from '@ghostfolio/api/services/property/property.service';
import {
  PROPERTY_API_KEY_OPENROUTER,
  PROPERTY_OPENROUTER_MODEL
} from '@ghostfolio/common/config';
import { Filter } from '@ghostfolio/common/interfaces';
import type { AiPromptMode } from '@ghostfolio/common/types';

import { Injectable, Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
  ToolMessage
} from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { CallbackHandler } from 'langfuse-langchain';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText } from 'ai';
import type { ColumnDescriptor } from 'tablemark';

import {
  createPortfolioSummaryTool,
  createPerformanceMetricsTool,
  createQueryHoldingsTool,
  createMarketDataTool,
  createAnalyzeRiskTool
} from './tools';

const MAX_TOOL_ITERATIONS = 5;
const MAX_HISTORY_MESSAGES = 10; // sliding window of 5 turns (10 messages)

const SYSTEM_PROMPT = `You are Ghostfolio AI, an expert financial portfolio assistant.

CAPABILITIES:
You have access to tools that query the user's real portfolio data from their Ghostfolio instance.
Always use tools to get data — NEVER guess or hallucinate financial numbers.

RULES:
1. All portfolio values, returns, and allocations MUST come from tool results. Never invent numbers.
2. When presenting financial data, always include the data freshness timestamp from tool results.
3. For Tier 1 (hard facts like portfolio value, holdings count) and Tier 2 (calculations like returns, allocation %): present exactly as returned by tools.
4. For Tier 3 (risk insights, diversification analysis): clearly label as "analytical assessment" based on the data.
5. For Tier 4 (market context, price explanations): label the data source and timestamp.
6. NEVER give specific investment advice (buy/sell recommendations). Present factual data and analytical observations only.
7. If a tool returns an error, tell the user what went wrong. Do not fill in with made-up data.
8. Include a financial disclaimer when providing analytical insights: "This is informational only and not financial advice."
9. Be concise and specific. Format numbers clearly (e.g., $12,345.67, 15.2%).
10. When the user asks a follow-up question, use context from the conversation to understand what they're referring to.

RESPONSE FORMAT:
- Lead with the direct answer to the user's question
- Include relevant numbers and percentages
- Note data freshness (e.g., "as of [timestamp]")
- Add disclaimer for analytical content`;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  private static readonly HOLDINGS_TABLE_COLUMN_DEFINITIONS: ({
    key:
      | 'ALLOCATION_PERCENTAGE'
      | 'ASSET_CLASS'
      | 'ASSET_SUB_CLASS'
      | 'CURRENCY'
      | 'NAME'
      | 'SYMBOL';
  } & ColumnDescriptor)[] = [
    { key: 'NAME', name: 'Name' },
    { key: 'SYMBOL', name: 'Symbol' },
    { key: 'CURRENCY', name: 'Currency' },
    { key: 'ASSET_CLASS', name: 'Asset Class' },
    { key: 'ASSET_SUB_CLASS', name: 'Asset Sub Class' },
    {
      align: 'right',
      key: 'ALLOCATION_PERCENTAGE',
      name: 'Allocation in Percentage'
    }
  ];

  private sessions: Map<string, { role: string; content: string }[]> =
    new Map();

  public constructor(
    private readonly accountService: AccountService,
    private readonly dataProviderService: DataProviderService,
    private readonly marketDataService: MarketDataService,
    private readonly portfolioService: PortfolioService,
    private readonly propertyService: PropertyService
  ) {}

  /**
   * Main chat method with tool-calling agent loop.
   * Supports multi-turn conversation with sliding window memory.
   */
  public async chat({
    query,
    sessionId,
    userId
  }: {
    query: string;
    sessionId?: string;
    userId: string;
  }) {
    const sid = sessionId ?? `${userId}-default`;

    if (!this.sessions.has(sid)) {
      this.sessions.set(sid, []);
    }

    const history = this.sessions.get(sid);
    const callbacks = this.buildLangfuseCallbacks(sid, userId);
    const llm = this.buildLLM(callbacks);

    // Build tools for this user
    const tools = this.buildTools(userId);

    // Bind tools to the LLM
    const llmWithTools = llm.bindTools(tools);

    // Build message history
    const messages: BaseMessage[] = [
      new SystemMessage(SYSTEM_PROMPT),
      ...history.map((m) =>
        m.role === 'user'
          ? new HumanMessage(m.content)
          : new AIMessage(m.content)
      ),
      new HumanMessage(query)
    ];

    // Agent loop: call LLM, execute tools, repeat until final answer
    let iterations = 0;
    let finalAnswer = '';

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

      const response = await llmWithTools.invoke(messages);
      messages.push(response);

      // Check if the LLM wants to call tools
      const toolCalls = response.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        // No tool calls — this is the final answer
        finalAnswer =
          typeof response.content === 'string'
            ? response.content
            : JSON.stringify(response.content);
        break;
      }

      // Execute each tool call
      const toolMap = new Map(tools.map((t) => [t.name, t]));

      for (const toolCall of toolCalls) {
        const tool = toolMap.get(toolCall.name);

        if (!tool) {
          messages.push(
            new ToolMessage({
              toolCallId: toolCall.id,
              content: JSON.stringify({
                error: `Unknown tool: ${toolCall.name}`
              })
            })
          );
          continue;
        }

        this.logger.log(
          `Executing tool: ${toolCall.name} [session=${sid}, iteration=${iterations}]`
        );

        try {
          const result = await tool.invoke(toolCall.args);
          messages.push(
            new ToolMessage({
              toolCallId: toolCall.id,
              content:
                typeof result === 'string' ? result : JSON.stringify(result)
            })
          );
        } catch (error) {
          this.logger.error(
            `Tool ${toolCall.name} failed: ${error.message}`
          );
          messages.push(
            new ToolMessage({
              toolCallId: toolCall.id,
              content: JSON.stringify({
                error: `Tool execution failed: ${error.message}`
              })
            })
          );
        }
      }
    }

    if (!finalAnswer) {
      finalAnswer =
        'I was unable to complete your request within the allowed number of steps. ' +
        'Please try rephrasing your question or breaking it into smaller parts.';
    }

    // Update session history (sliding window)
    history.push({ role: 'user', content: query });
    history.push({ role: 'assistant', content: finalAnswer });

    if (history.length > MAX_HISTORY_MESSAGES) {
      history.splice(0, history.length - MAX_HISTORY_MESSAGES);
    }

    this.logger.log(
      `Chat completed [session=${sid}, iterations=${iterations}]`
    );

    return {
      answer: finalAnswer,
      sessionId: sid
    };
  }

  /**
   * Build the 5 MVP tools for the given user.
   */
  private buildTools(userId: string) {
    return [
      createPortfolioSummaryTool(
        this.portfolioService,
        this.accountService,
        userId
      ),
      createPerformanceMetricsTool(this.portfolioService, userId),
      createQueryHoldingsTool(this.portfolioService, userId),
      createMarketDataTool(this.dataProviderService, this.marketDataService),
      createAnalyzeRiskTool(this.portfolioService, userId)
    ];
  }

  private buildLLM(callbacks: any[]) {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const model = process.env.CHATGPT_MODEL ?? 'gpt-4o-mini';

    if (anthropicKey) {
      this.logger.log('Using Anthropic LLM');
      return new ChatAnthropic({
        anthropicApiKey: anthropicKey,
        modelName: 'claude-sonnet-4-20250514',
        maxTokens: 2048,
        callbacks
      });
    }

    if (openaiKey) {
      this.logger.log(`Using OpenAI LLM (${model})`);
      return new ChatOpenAI({
        openAIApiKey: openaiKey,
        modelName: model,
        maxTokens: 2048,
        callbacks
      });
    }

    throw new Error(
      'No LLM API key configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env'
    );
  }

  private buildLangfuseCallbacks(sessionId: string, userId: string): any[] {
    const langfuseSecretKey = process.env.LANGFUSE_SECRET_KEY;
    const langfusePublicKey = process.env.LANGFUSE_PUBLIC_KEY;
    const langfuseHost = process.env.LANGFUSE_HOST;

    if (langfuseSecretKey && langfusePublicKey) {
      try {
        return [
          new CallbackHandler({
            secretKey: langfuseSecretKey,
            publicKey: langfusePublicKey,
            baseUrl: langfuseHost ?? 'https://us.cloud.langfuse.com',
            sessionId,
            userId
          })
        ];
      } catch (error) {
        this.logger.warn('Failed to initialize Langfuse callback', error);
      }
    }

    return [];
  }

  public async generateText({ prompt }: { prompt: string }) {
    const openRouterApiKey = await this.propertyService.getByKey<string>(
      PROPERTY_API_KEY_OPENROUTER
    );

    const openRouterModel = await this.propertyService.getByKey<string>(
      PROPERTY_OPENROUTER_MODEL
    );

    const openRouterService = createOpenRouter({
      apiKey: openRouterApiKey
    });

    return generateText({
      prompt,
      model: openRouterService.chat(openRouterModel)
    });
  }

  public async getPrompt({
    filters,
    impersonationId,
    languageCode,
    mode,
    userCurrency,
    userId
  }: {
    filters?: Filter[];
    impersonationId: string;
    languageCode: string;
    mode: AiPromptMode;
    userCurrency: string;
    userId: string;
  }) {
    const { holdings } = await this.portfolioService.getDetails({
      filters,
      impersonationId,
      userId
    });

    const holdingsTableColumns: ColumnDescriptor[] =
      AiService.HOLDINGS_TABLE_COLUMN_DEFINITIONS.map(({ align, name }) => {
        return { name, align: align ?? 'left' };
      });

    const holdingsTableRows = Object.values(holdings)
      .sort((a, b) => {
        return b.allocationInPercentage - a.allocationInPercentage;
      })
      .map(
        ({
          allocationInPercentage,
          assetClass,
          assetSubClass,
          currency,
          name: label,
          symbol
        }) => {
          return AiService.HOLDINGS_TABLE_COLUMN_DEFINITIONS.reduce(
            (row, { key, name }) => {
              switch (key) {
                case 'ALLOCATION_PERCENTAGE':
                  row[name] = `${(allocationInPercentage * 100).toFixed(3)}%`;
                  break;

                case 'ASSET_CLASS':
                  row[name] = assetClass ?? '';
                  break;

                case 'ASSET_SUB_CLASS':
                  row[name] = assetSubClass ?? '';
                  break;

                case 'CURRENCY':
                  row[name] = currency;
                  break;

                case 'NAME':
                  row[name] = label;
                  break;

                case 'SYMBOL':
                  row[name] = symbol;
                  break;

                default:
                  row[name] = '';
                  break;
              }

              return row;
            },
            {} as Record<string, string>
          );
        }
      );

    // Dynamic import to load ESM module from CommonJS context
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const dynamicImport = new Function('s', 'return import(s)') as (
      s: string
    ) => Promise<typeof import('tablemark')>;
    const { tablemark } = await dynamicImport('tablemark');

    const holdingsTableString = tablemark(holdingsTableRows, {
      columns: holdingsTableColumns
    });

    if (mode === 'portfolio') {
      return holdingsTableString;
    }

    return [
      `You are a neutral financial assistant. Please analyze the following investment portfolio (base currency being ${userCurrency}) in simple words.`,
      holdingsTableString,
      'Structure your answer with these sections:',
      'Overview: Briefly summarize the portfolio's composition and allocation rationale.',
      'Risk Assessment: Identify potential risks, including market volatility, concentration, and sectoral imbalances.',
      'Advantages: Highlight strengths, focusing on growth potential, diversification, or other benefits.',
      'Disadvantages: Point out weaknesses, such as overexposure or lack of defensive assets.',
      'Target Group: Discuss who this portfolio might suit (e.g., risk tolerance, investment goals, life stages, and experience levels).',
      'Optimization Ideas: Offer ideas to complement the portfolio, ensuring they are constructive and neutral in tone.',
      'Conclusion: Provide a concise summary highlighting key insights.',
      `Provide your answer in the following language: ${languageCode}.`
    ].join('\n');
  }
}
