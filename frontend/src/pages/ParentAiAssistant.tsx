import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Send, Sparkles, User, Lightbulb } from 'lucide-react';

import { useAuth } from '@/contexts/AuthProvider';
import { apiService } from '@services/api';
import type { ParentPortalChild, ParentPortalRecommendation } from '@types';

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm';
const LOADING_TIMEOUT_MS = 30_000;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const QUICK_QUESTIONS = [
  'How is my child doing overall?',
  'Any attendance concerns?',
  'Are there pending assignments?',
  'What are the upcoming tests?',
  'Give me some suggestions to help.',
];

export default function ParentAiAssistant() {
  const { authReady, sessionReady, schoolContextReady, session } = useAuth();
  const canRun = authReady && sessionReady && schoolContextReady && !!session;

  const [children, setChildren] = useState<ParentPortalChild[]>([]);
  const [selectedChildId, setSelectedChildId] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: 'Hello! I am your Parent Assistant. Ask me anything about your child\'s progress — attendance, tests, assignments, or fees.' },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [recommendations, setRecommendations] = useState<ParentPortalRecommendation[]>([]);
  const [loadingRecs, setLoadingRecs] = useState(true);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const sendAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      sendAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!canRun) return;
    void loadData();
  }, [canRun]);

  const loadData = async () => {
    sendAbortRef.current?.abort();
    const controller = new AbortController();
    sendAbortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), LOADING_TIMEOUT_MS);
    try {
      const [childRes, recRes] = await Promise.all([
        apiService.getParentPortalChildren({ signal: controller.signal }),
        apiService.getParentPortalRecommendations(undefined, { signal: controller.signal }),
      ]);
      if (!mountedRef.current || controller.signal.aborted) return;
      const data = childRes.data;
      setChildren(data);
      if (data.length > 0) {
        setSelectedChildId(data[0].student_id);
      }
      setRecommendations(recRes.data);
    } catch {
      // non-critical
    } finally {
      window.clearTimeout(timeout);
      if (sendAbortRef.current === controller) {
        sendAbortRef.current = null;
      }
      if (mountedRef.current) {
        setLoadingRecs(false);
      }
    }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const question = input.trim();
    if (!question || sending) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: question }]);
    setSending(true);

    sendAbortRef.current?.abort();
    const controller = new AbortController();
    sendAbortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), LOADING_TIMEOUT_MS);

    try {
      const history = messages.slice(1).map((m) => ({ role: m.role, content: m.content }));
      const res = await apiService.askParentPortalAi({
        question,
        student_id: selectedChildId || undefined,
        history,
      }, { signal: controller.signal });
      if (mountedRef.current && !controller.signal.aborted) {
        setMessages((prev) => [...prev, { role: 'assistant', content: res.data.answer }]);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      const timedOut = controller.signal.aborted;
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: timedOut
            ? 'This is taking too long. Please try again in a moment.'
            : 'Sorry, I had trouble answering that. Please try again.',
        },
      ]);
    } finally {
      window.clearTimeout(timeout);
      if (sendAbortRef.current === controller) {
        sendAbortRef.current = null;
      }
      if (mountedRef.current) {
        setSending(false);
      }
    }
  }, [input, sending, messages, selectedChildId]);

  const handleQuickQuestion = (q: string) => {
    setInput(q);
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Parent AI Assistant</h1>
          <p className="mt-1 text-sm text-slate-500">Ask about attendance, tests, assignments, and more</p>
        </div>
        {children.length > 1 && (
          <select value={selectedChildId} onChange={(e) => setSelectedChildId(e.target.value)}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold">
            {children.map((c) => (
              <option key={c.student_id} value={c.student_id}>{c.student_name}</option>
            ))}
          </select>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        {/* Chat Area */}
        <section className={`${cardClass} flex flex-col`}>
          <div className="flex-1 space-y-4 overflow-y-auto" style={{ maxHeight: '500px', minHeight: '400px' }}>
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                {msg.role === 'assistant' && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                    <Bot className="h-4 w-4" />
                  </div>
                )}
                <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
                  msg.role === 'user'
                    ? 'bg-violet-600 text-white'
                    : 'bg-slate-100 text-slate-800'
                }`}>
                  {msg.content}
                </div>
                {msg.role === 'user' && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white">
                    <User className="h-4 w-4" />
                  </div>
                )}
              </div>
            ))}
            {sending && (
              <div className="flex gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-500">
                  <span className="animate-pulse">Thinking...</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="mt-4 flex gap-2 border-t border-slate-200 pt-4">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Ask about your child's progress..."
              className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-violet-400"
              disabled={sending}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending}
              className="rounded-xl bg-violet-600 p-3 text-white hover:bg-violet-700 disabled:opacity-50"
            >
              <Send className="h-5 w-5" />
            </button>
          </div>
        </section>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Quick Questions */}
          <section className={cardClass}>
            <h3 className="text-sm font-semibold text-slate-900">Quick Questions</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {QUICK_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => handleQuickQuestion(q)}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {q}
                </button>
              ))}
            </div>
          </section>

          {/* Recommendations */}
          <section className={cardClass}>
            <div className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-600" />
              <h3 className="text-sm font-semibold text-slate-900">Recommendations</h3>
            </div>
            {loadingRecs ? (
              <p className="mt-3 text-xs text-slate-400">Loading...</p>
            ) : recommendations.length > 0 ? (
              <div className="mt-3 space-y-2">
                {recommendations.map((rec) => (
                  <div key={rec.student_id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <p className="text-xs font-bold text-slate-700">{rec.student_name}</p>
                    <ul className="mt-1 space-y-1">
                      {rec.recommendations.map((r, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-xs text-slate-600">
                          <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-400">No recommendations yet.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
