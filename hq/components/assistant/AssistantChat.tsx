'use client';

import { useState, useRef, useEffect, type FormEvent } from 'react';
import { Card, Button } from '@/components/ui';
import type { ActionProposal } from './proposals';

type ProposalState = 'pending' | 'running' | 'done' | 'failed' | 'dismissed';

interface UiProposal {
  proposal: ActionProposal;
  state: ProposalState;
  resultText?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  actions?: string[];
  needsKey?: boolean;
  proposals?: UiProposal[];
}

const STARTER_PROMPTS = [
  'Who owes me money?',
  "What's today's route?",
  'Any leads I\'m sitting on?',
  'Draft a reminder text for an overdue client',
];

const MAX_HISTORY_TURNS = 12;

export function AssistantChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: trimmed }];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);

    try {
      const history = nextMessages
        .slice(0, -1)
        .slice(-MAX_HISTORY_TURNS)
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, history }),
      });
      const data = await res.json().catch(() => ({}));

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.reply ?? 'Something went wrong. Try again.',
          actions: data.actions ?? [],
          needsKey: !!data.needsKey,
          proposals: ((data.proposals ?? []) as ActionProposal[]).map((p) => ({
            proposal: p,
            state: 'pending' as ProposalState,
          })),
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Something went wrong reaching the assistant. Try again in a moment.' },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  function setProposalState(msgIndex: number, propIndex: number, patch: Partial<UiProposal>) {
    setMessages((prev) =>
      prev.map((m, mi) =>
        mi !== msgIndex
          ? m
          : {
              ...m,
              proposals: m.proposals?.map((p, pi) => (pi === propIndex ? { ...p, ...patch } : p)),
            }
      )
    );
  }

  async function confirmProposal(msgIndex: number, propIndex: number, proposal: ActionProposal) {
    setProposalState(msgIndex, propIndex, { state: 'running' });
    try {
      const res = await fetch('/api/assistant/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposal }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        const dup = data.result?.duplicate ? ' (already existed, nothing changed)' : '';
        setProposalState(msgIndex, propIndex, { state: 'done', resultText: `Done${dup}` });
      } else {
        setProposalState(msgIndex, propIndex, {
          state: 'failed',
          resultText: data.error ?? 'Action failed',
        });
      }
    } catch {
      setProposalState(msgIndex, propIndex, { state: 'failed', resultText: 'Network error' });
    }
  }

  return (
    <Card className="flex flex-col h-[calc(100vh-220px)] min-h-[420px]">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <p className="font-heading font-bold text-ink mb-1">Ask Scoop HQ anything</p>
            <p className="text-sm text-muted mb-5 max-w-sm">
              I can look up clients, check invoices, pull today&apos;s route, and draft texts,
              grounded in your live data.
            </p>
            <div className="flex flex-wrap justify-center gap-2 max-w-md">
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => send(prompt)}
                  className="bg-brand-light text-brand-dark border border-brand/20 rounded-full px-3.5 py-1.5 text-[0.8rem] font-heading font-bold hover:bg-brand hover:text-white transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) =>
            m.needsKey ? (
              <div
                key={i}
                className="bg-[#fff8e1] border border-[#ffe082] text-[#8d6e00] rounded-card px-4 py-3 text-sm font-heading font-bold"
              >
                {m.content}
              </div>
            ) : (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={
                    m.role === 'user'
                      ? 'max-w-[80%] bg-brand text-white rounded-2xl rounded-br-sm px-4 py-2.5 text-sm whitespace-pre-wrap'
                      : 'max-w-[80%] bg-white border border-line rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm whitespace-pre-wrap text-ink'
                  }
                >
                  {m.content}
                  {m.actions && m.actions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {m.actions.map((a, ai) => (
                        <span
                          key={ai}
                          className="inline-block bg-brand-light text-brand-dark rounded-full px-2.5 py-0.5 text-[0.7rem] font-heading font-bold"
                        >
                          {a}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.proposals && m.proposals.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {m.proposals.map((up, pi) => (
                        <div
                          key={pi}
                          className="rounded-card border-2 border-brand/30 bg-brand-light/50 px-3.5 py-3"
                        >
                          <div className="font-heading font-bold text-[0.85rem] text-brand-dark mb-1.5">
                            {up.proposal.label}
                          </div>
                          <div className="text-[0.78rem] text-ink space-y-0.5 mb-2.5">
                            {Object.entries(up.proposal.details).map(([k, v]) => (
                              <div key={k}>
                                <span className="text-muted">{k}:</span> {v}
                              </div>
                            ))}
                          </div>
                          {up.state === 'pending' && (
                            <div className="flex items-center gap-2">
                              <Button
                                variant="primary"
                                onClick={() => confirmProposal(i, pi, up.proposal)}
                              >
                                Confirm &amp; run
                              </Button>
                              <button
                                onClick={() =>
                                  setProposalState(i, pi, { state: 'dismissed' })
                                }
                                className="text-[0.8rem] font-heading font-bold text-muted hover:text-ink px-2 py-1"
                              >
                                Dismiss
                              </button>
                            </div>
                          )}
                          {up.state === 'running' && (
                            <div className="text-[0.8rem] font-heading font-bold text-muted">
                              Running…
                            </div>
                          )}
                          {up.state === 'done' && (
                            <div className="text-[0.8rem] font-heading font-bold text-brand">
                              ✓ {up.resultText ?? 'Done'}
                            </div>
                          )}
                          {up.state === 'failed' && (
                            <div className="text-[0.8rem] font-heading font-bold text-danger">
                              ✕ {up.resultText ?? 'Failed'}
                            </div>
                          )}
                          {up.state === 'dismissed' && (
                            <div className="text-[0.8rem] font-heading font-bold text-muted">
                              Dismissed, nothing was run
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          )
        )}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white border border-line rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm text-muted">
              Scoop HQ is thinking…
            </div>
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="border-t border-line p-4 flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about clients, invoices, the route…"
          disabled={loading}
          className="flex-1 rounded-[7px] border-2 border-line px-3.5 py-2.5 text-sm focus:outline-none focus:border-brand disabled:opacity-60"
        />
        <Button type="submit" variant="primary" disabled={loading || !input.trim()}>
          Send
        </Button>
      </form>
    </Card>
  );
}
