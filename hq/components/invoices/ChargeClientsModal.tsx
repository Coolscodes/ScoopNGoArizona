'use client';

// Charge Clients, the bulk weekly charge flow for /invoices.
// Fetches GET /api/charge for an eligibility preview (card on file, paid this
// week, open invoice amounts), lets the owner pick clients and edit amounts,
// then posts the run with per-client overrides. Charging requires two taps.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, useToast } from '@/components/ui';
import { money } from '@/lib/format';

interface OpenWeek {
  periodStart: string;
  label: string;
  amount: number;
}

interface EligibleClient {
  id: string;
  name: string;
  serviceType: string | null;
  preferredDay: string | null;
  price: number | null;
  hasCard: boolean;
  stripeCustomerId: string | null;
  email: string | null;
  paidThisWeek: boolean;
  openThisWeek: number | null;
  openWeeks: OpenWeek[];
  autoCharge: boolean;
}

interface ChargeRunResult {
  week: string;
  charged: number;
  failed: number;
  skipped: number;
  total: number;
  results: {
    name: string;
    status: 'charged' | 'failed' | 'skipped';
    amount?: number;
    week?: string;
    reason?: string;
  }[];
}

interface RowState {
  checked: boolean;
  amount: string;
  // 'current' = this week; otherwise the period_start of an unpaid past week.
  week: string;
}

const DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

const RESULT_ICON: Record<string, string> = {
  charged: '✅',
  failed: '❌',
  skipped: '⏭',
};

export function ChargeClientsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<EligibleClient[]>([]);
  const [weekLabel, setWeekLabel] = useState('');
  const [weekStart, setWeekStart] = useState('');
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [dayFilter, setDayFilter] = useState('today');
  const [search, setSearch] = useState('');
  const [armed, setArmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [run, setRun] = useState<ChargeRunResult | null>(null);
  const [linkBusy, setLinkBusy] = useState<string | null>(null);
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  // Load the eligibility preview whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    setRun(null);
    setArmed(false);
    setDayFilter('today');
    setSearch('');
    setError(null);
    setLoading(true);
    fetch('/api/charge')
      .then(async (r) => {
        const d = (await r.json()) as {
          error?: string;
          week?: { label: string; periodStart: string };
          clients?: EligibleClient[];
        };
        if (!r.ok) throw new Error(d.error || 'Could not load clients');
        const list = d.clients ?? [];
        setClients(list);
        setWeekLabel(d.week?.label ?? '');
        setWeekStart(d.week?.periodStart ?? '');
        const init: Record<string, RowState> = {};
        for (const c of list) {
          // Default to the oldest unpaid week (and its owed amount) when the
          // client is behind; otherwise this week at the standing price.
          // Chargeable rows start checked.
          const oldest = c.openWeeks?.[0];
          const amount = oldest?.amount ?? c.openThisWeek ?? c.price;
          init[c.id] = {
            checked: c.hasCard && !c.paidThisWeek && amount != null,
            amount: amount != null ? String(amount) : '',
            week: oldest?.periodStart ?? 'current',
          };
        }
        setRows(init);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    return () => {
      if (disarmTimer.current) clearTimeout(disarmTimer.current);
    };
  }, []);

  // Escape closes the modal (unless a charge run is in flight).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, submitting, onClose]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      if (dayFilter !== 'all') {
        const want = dayFilter === 'today' ? todayName : dayFilter;
        if (c.preferredDay !== want) return false;
      }
      if (q && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [clients, dayFilter, search, todayName]);

  // Current selection over the *visible* rows: valid picks + invalid count.
  const selection = useMemo(() => {
    const picks: { id: string; amount: number; week: string }[] = [];
    let invalid = 0;
    for (const c of visible) {
      const r = rows[c.id];
      if (!r?.checked || !c.hasCard) continue;
      const n = parseFloat(r.amount);
      if (Number.isNaN(n) || n < 1) invalid += 1;
      else
        picks.push({
          id: c.id,
          amount: Math.round(n * 100) / 100,
          week: r.week ?? 'current',
        });
    }
    return { picks, invalid, total: picks.reduce((s, p) => s + p.amount, 0) };
  }, [visible, rows]);

  function disarm() {
    setArmed(false);
    if (disarmTimer.current) clearTimeout(disarmTimer.current);
  }

  function setRow(id: string, patch: Partial<RowState>) {
    disarm();
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function toggleAll(checked: boolean) {
    disarm();
    setRows((prev) => {
      const next = { ...prev };
      for (const c of visible) {
        if (c.hasCard) next[c.id] = { ...next[c.id], checked };
      }
      return next;
    });
  }

  async function sendCardLink(c: EligibleClient) {
    setLinkBusy(c.id);
    try {
      const res = await fetch('/api/stripe/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: c.id,
          customer_name: c.name,
          customer_email: c.email ?? undefined,
          stripe_customer_id: c.stripeCustomerId ?? undefined,
        }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || 'Setup link failed');
      try {
        await navigator.clipboard.writeText(data.url);
        toast('Card setup link copied to clipboard');
      } catch {
        window.open(data.url, '_blank', 'noopener');
        toast('Card setup link opened');
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Setup link failed', 'error');
    } finally {
      setLinkBusy(null);
    }
  }

  async function charge() {
    if (!selection.picks.length || selection.invalid || submitting) return;

    // Two-tap confirm: the first tap arms the button for six seconds.
    if (!armed) {
      setArmed(true);
      disarmTimer.current = setTimeout(() => setArmed(false), 6000);
      return;
    }
    disarm();
    setSubmitting(true);
    try {
      // Every pick sends an explicit week so the server charges exactly what
      // is shown here, "This week" included.
      const amounts: Record<string, number> = {};
      const weeks: Record<string, string> = {};
      for (const p of selection.picks) {
        amounts[p.id] = p.amount;
        const start = p.week === 'current' ? weekStart : p.week;
        if (start) weeks[p.id] = start;
      }
      const res = await fetch('/api/charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_ids: selection.picks.map((p) => p.id),
          amounts,
          weeks,
        }),
      });
      const data = (await res.json()) as ChargeRunResult & { error?: string };
      if (!res.ok) throw new Error(data.error || 'Charge run failed');
      setRun(data);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Charge run failed', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 flex"
      onClick={() => {
        if (!submitting) onClose();
      }}
      role="presentation"
    >
      <div
        className="m-auto w-full max-w-2xl px-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Charge clients"
      >
        <div className="bg-white rounded-card border border-line flex flex-col max-h-[88vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-line">
            <div>
              <h3 className="font-heading font-bold text-ink">⚡ Charge Clients</h3>
              {weekLabel && (
                <p className="text-xs text-muted mt-0.5">Week of {weekLabel}</p>
              )}
            </div>
            <button
              onClick={() => {
                if (!submitting) onClose();
              }}
              aria-label="Close"
              className="text-muted hover:text-ink text-xl leading-none"
            >
              ×
            </button>
          </div>

          {/* Body */}
          <div className="p-5 overflow-y-auto flex-1">
            {run ? (
              <ResultsView run={run} />
            ) : loading ? (
              <p className="text-sm text-muted py-8 text-center">Loading clients…</p>
            ) : error ? (
              <p className="text-sm text-danger py-8 text-center">{error}</p>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-4 flex-wrap">
                  <select
                    value={dayFilter}
                    onChange={(e) => {
                      disarm();
                      setDayFilter(e.target.value);
                    }}
                    aria-label="Filter by service day"
                    className="border-2 border-line rounded-[7px] px-2.5 py-1.5 text-sm bg-white text-ink"
                  >
                    <option value="today">Today&apos;s clients</option>
                    <option value="all">All active clients</option>
                    {DAYS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <input
                    value={search}
                    onChange={(e) => {
                      disarm();
                      setSearch(e.target.value);
                    }}
                    placeholder="Search name…"
                    aria-label="Search clients by name"
                    className="border-2 border-line rounded-[7px] px-2.5 py-1.5 text-sm flex-1 min-w-[140px]"
                  />
                  <Button size="sm" onClick={() => toggleAll(true)}>
                    All
                  </Button>
                  <Button size="sm" onClick={() => toggleAll(false)}>
                    None
                  </Button>
                </div>

                {visible.length === 0 ? (
                  <p className="text-sm text-muted py-8 text-center">
                    No matching active clients. Try &quot;All active clients&quot; or
                    clear the search.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {visible.map((c) => {
                      const r =
                        rows[c.id] ?? { checked: false, amount: '', week: 'current' };
                      const totalOwed = c.openWeeks.reduce((s, w) => s + w.amount, 0);
                      const amountNum = parseFloat(r.amount);
                      const amountBad =
                        r.checked && c.hasCard && (Number.isNaN(amountNum) || amountNum < 1);
                      return (
                        <li
                          key={c.id}
                          className={
                            'flex items-center gap-3 rounded-[8px] border px-3 py-2.5 flex-wrap ' +
                            (c.paidThisWeek
                              ? 'border-brand/40 bg-brand-light/40'
                              : c.hasCard
                                ? 'border-line bg-white'
                                : 'border-line bg-[#fafafa]')
                          }
                        >
                          <input
                            type="checkbox"
                            checked={r.checked && c.hasCard}
                            disabled={!c.hasCard}
                            onChange={(e) => setRow(c.id, { checked: e.target.checked })}
                            aria-label={`Charge ${c.name}`}
                            className="w-4 h-4 accent-brand shrink-0"
                          />
                          <div className="flex-1 min-w-[130px]">
                            <span className="font-heading font-bold text-sm text-ink">
                              {c.name}
                            </span>
                            <span className="block text-xs text-muted">
                              {[c.serviceType, c.preferredDay].filter(Boolean).join(' · ') ||
                                'No schedule'}
                            </span>
                          </div>
                          {c.autoCharge && (
                            <span
                              title="Auto-charge on visit completion is on for this client"
                              className="text-[0.7rem] font-bold rounded-full px-2 py-0.5 bg-brand/10 text-brand-dark whitespace-nowrap"
                            >
                              ⚡ Auto
                            </span>
                          )}
                          {c.paidThisWeek && (
                            <span className="text-[0.7rem] font-bold rounded-full px-2 py-0.5 bg-brand-light text-brand-dark whitespace-nowrap">
                              ✓ Paid this week
                            </span>
                          )}
                          {totalOwed > 0 && (
                            <span className="text-[0.7rem] font-bold rounded-full px-2 py-0.5 bg-info/10 text-info whitespace-nowrap">
                              Owes {money(totalOwed)}
                              {c.openWeeks.length > 1
                                ? ` (${c.openWeeks.length} wks)`
                                : ''}
                            </span>
                          )}
                          {!c.hasCard && (
                            <>
                              <span className="text-[0.7rem] font-bold rounded-full px-2 py-0.5 bg-warn/10 text-warn whitespace-nowrap">
                                No card
                              </span>
                              <Button
                                size="sm"
                                disabled={linkBusy === c.id}
                                onClick={() => sendCardLink(c)}
                              >
                                {linkBusy === c.id ? '…' : '💳 Card link'}
                              </Button>
                            </>
                          )}
                          {c.openWeeks.length > 0 && (
                            <select
                              value={r.week}
                              disabled={!c.hasCard}
                              onChange={(e) => {
                                const w = e.target.value;
                                const wk = c.openWeeks.find(
                                  (o) => o.periodStart === w
                                );
                                // Re-prefill the amount for the chosen week.
                                const amount = wk?.amount ?? c.price;
                                setRow(c.id, {
                                  week: w,
                                  amount: amount != null ? String(amount) : '',
                                });
                              }}
                              aria-label={`Week to charge for ${c.name}`}
                              className="border-2 border-line rounded-[7px] px-2 py-1 text-xs bg-white text-ink max-w-[150px]"
                            >
                              {c.openWeeks.map((w) => (
                                <option key={w.periodStart} value={w.periodStart}>
                                  Owed: {w.label}
                                </option>
                              ))}
                              {!c.paidThisWeek &&
                                !c.openWeeks.some(
                                  (w) => w.periodStart === weekStart
                                ) && (
                                  <option value="current">This week</option>
                                )}
                            </select>
                          )}
                          <span className="flex items-center gap-1">
                            <span className="font-heading font-bold text-brand text-sm">$</span>
                            <input
                              type="number"
                              min={1}
                              step="0.01"
                              inputMode="decimal"
                              value={r.amount}
                              disabled={!c.hasCard}
                              onChange={(e) => setRow(c.id, { amount: e.target.value })}
                              placeholder="0.00"
                              aria-label={`Charge amount for ${c.name}`}
                              className={
                                'w-20 border-2 rounded-[7px] px-2 py-1 text-sm font-heading font-bold text-brand tabular-nums ' +
                                (amountBad ? 'border-danger' : 'border-line')
                              }
                            />
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {selection.invalid > 0 && (
                  <p className="text-xs text-danger font-bold mt-3">
                    {selection.invalid} selected client
                    {selection.invalid > 1 ? 's have' : ' has'} an invalid amount
                    (minimum $1).
                  </p>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-line flex-wrap">
            <span className="font-heading font-bold text-brand text-sm">
              {run
                ? ''
                : selection.picks.length
                  ? `${selection.picks.length} selected · ${money(selection.total)}`
                  : ''}
            </span>
            <div className="flex gap-2">
              {run ? (
                <Button variant="primary" onClick={onClose}>
                  Done
                </Button>
              ) : (
                <>
                  <Button onClick={onClose} disabled={submitting}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    disabled={
                      loading ||
                      submitting ||
                      selection.picks.length === 0 ||
                      selection.invalid > 0
                    }
                    onClick={charge}
                    className={
                      armed ? 'bg-danger hover:bg-danger border-transparent' : undefined
                    }
                  >
                    {submitting
                      ? '⏳ Charging…'
                      : armed
                        ? `Tap again: charge ${money(selection.total)}`
                        : `⚡ Charge selected (${selection.picks.length})`}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResultsView({ run }: { run: ChargeRunResult }) {
  return (
    <div className="space-y-2">
      <div
        className={
          'rounded-[8px] border px-4 py-3 text-sm ' +
          (run.failed
            ? 'border-warn/40 bg-warn/10'
            : 'border-brand/40 bg-brand-light')
        }
      >
        <strong>Week of {run.week}</strong> · ✅ {run.charged} charged ·{' '}
        {money(run.total)}
        {run.failed ? ` · ❌ ${run.failed} failed` : ''}
        {run.skipped ? ` · ⏭ ${run.skipped} skipped` : ''}
      </div>
      {run.results.map((x, i) => (
        <div
          key={i}
          className="flex items-center gap-2.5 rounded-[7px] border border-line px-3 py-2 text-sm"
        >
          <span>{RESULT_ICON[x.status] ?? '•'}</span>
          <strong className="flex-1 font-heading">{x.name}</strong>
          {x.week && <span className="text-xs text-muted">Week of {x.week}</span>}
          {x.amount != null && (
            <span className="font-heading font-bold text-brand">
              {money(x.amount)}
            </span>
          )}
          {x.reason && <span className="text-xs text-muted">{x.reason}</span>}
        </div>
      ))}
    </div>
  );
}
