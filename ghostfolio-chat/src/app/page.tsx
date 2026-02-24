'use client';

import { useChat } from 'ai/react';
import { useRef, useEffect } from 'react';
import Image from 'next/image';

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
    <div className="flex flex-col h-screen dot-grid-bg text-zinc-100">
      {/* Keyframes for floating */}
      <style jsx global>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
      `}</style>

      {/* Header */}
      <header className="flex items-center gap-3 px-6 py-4 border-b" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'rgba(10, 10, 26, 0.85)', backdropFilter: 'blur(12px)' }}>
        <Image
          src="/logo.png"
          alt="Ghostfolio AI"
          width={32}
          height={32}
          className="rounded-lg"
        />
        <div>
          <h1 className="text-lg font-semibold">Ghostfolio AI</h1>
          <p className="text-xs text-zinc-500">Portfolio intelligence agent</p>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500 space-y-4">
            {/* Floating logo with shadow */}
            <div
              className="w-20 h-20 rounded-2xl overflow-hidden"
              style={{
                animation: 'float 3s ease-in-out infinite',
                boxShadow: '0 8px 32px rgba(139, 92, 246, 0.3), 0 4px 16px rgba(0, 0, 0, 0.5)'
              }}
            >
              <Image
                src="/logo.png"
                alt="Ghostfolio AI"
                width={80}
                height={80}
                className="w-full h-full object-cover"
              />
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
                  className="px-3 py-1.5 text-sm rounded-full border transition-colors hover:text-violet-300"
                  style={{ borderColor: 'var(--border-subtle)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.5)')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.15)')}
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
                  ? 'text-white'
                  : 'text-zinc-200'
              }`}
              style={{
                backgroundColor: m.role === 'user' ? 'rgba(139, 92, 246, 0.35)' : 'var(--bg-surface)',
                border: `1px solid ${m.role === 'user' ? 'rgba(139, 92, 246, 0.4)' : 'var(--border-subtle)'}`
              }}
            >
              {m.content}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-4 py-3 text-sm text-zinc-400" style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
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
      <div className="px-6 py-4" style={{ borderTop: '1px solid var(--border-subtle)', backgroundColor: 'rgba(10, 10, 26, 0.85)', backdropFilter: 'blur(12px)' }}>
        <form onSubmit={handleSubmit} className="flex gap-3">
          <input
            value={input}
            onChange={handleInputChange}
            placeholder="Ask about your portfolio..."
            className="flex-1 rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none transition-colors"
            style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.5)')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.15)')}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="text-white px-5 py-3 rounded-xl text-sm font-medium transition-colors disabled:opacity-40"
            style={{ background: isLoading || !input.trim() ? 'rgba(139, 92, 246, 0.2)' : 'rgba(139, 92, 246, 0.6)' }}
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
