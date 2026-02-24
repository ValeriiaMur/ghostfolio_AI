'use client';

import { useChat } from 'ai/react';
import { useRef, useEffect } from 'react';

export default function ChatPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading, error } =
    useChat({
      api: '/api/chat'
    });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800">
        <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-sm font-bold">
          G
        </div>
        <div>
          <h1 className="text-lg font-semibold">Ghostfolio AI</h1>
          <p className="text-xs text-zinc-500">Portfolio intelligence agent</p>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500 space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-zinc-800 flex items-center justify-center text-2xl">
              📊
            </div>
            <p className="text-center max-w-md">
              Ask me about your portfolio — value, performance, holdings, risk
              analysis, or market data.
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {[
                'Give me a summary of my portfolio',
                'How is my portfolio performing year to date?',
                'Show me my top 5 holdings by allocation',
                'Analyze my portfolio risk and diversification',
                'What is the current price of AAPL?',
                'Which of my holdings are equities?'
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    const fakeEvent = {
                      target: { value: suggestion }
                    } as React.ChangeEvent<HTMLInputElement>;
                    handleInputChange(fakeEvent);
                    // Submit on next tick after state update
                    setTimeout(() => {
                      const form = document.querySelector('form');
                      form?.requestSubmit();
                    }, 50);
                  }}
                  className="px-3 py-1.5 text-sm rounded-full border border-zinc-700 hover:border-emerald-600 hover:text-emerald-400 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-2xl rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-emerald-700 text-white'
                  : 'bg-zinc-800 text-zinc-200'
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-zinc-800 rounded-2xl px-4 py-3 text-sm text-zinc-400">
              <span className="inline-flex gap-1">
                <span className="animate-bounce">●</span>
                <span
                  className="animate-bounce"
                  style={{ animationDelay: '0.1s' }}
                >
                  ●
                </span>
                <span
                  className="animate-bounce"
                  style={{ animationDelay: '0.2s' }}
                >
                  ●
                </span>
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="flex justify-center">
            <div className="bg-red-900/50 border border-red-700 rounded-lg px-4 py-2 text-sm text-red-300">
              Error: {error.message}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-zinc-800 px-6 py-4">
        <form onSubmit={handleSubmit} className="flex gap-3">
          <input
            value={input}
            onChange={handleInputChange}
            placeholder="Ask about your portfolio..."
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-600 transition-colors"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-5 py-3 rounded-xl text-sm font-medium transition-colors"
          >
            Send
          </button>
        </form>
        <p className="text-xs text-zinc-600 mt-2 text-center">
          Ghostfolio AI provides informational data only, not financial advice.
        </p>
      </div>
    </div>
  );
}
