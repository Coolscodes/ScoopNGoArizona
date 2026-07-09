'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from '@hello-pangea/dnd';
import { Button, EmptyState, StatusPill, Avatar, Select, useToast, cn } from '@/components/ui';
import { fullName, initials, phone, money } from '@/lib/format';

export interface RouteStop {
  id: string;
  customer_id: string;
  scheduled_at: string;
  status: 'scheduled' | 'completed' | 'skipped' | 'cancelled';
  route_position: number | null;
  service_type: string | null;
  notes: string | null;
  customer: {
    id: string;
    first_name: string;
    last_name: string;
    address?: string;
    city?: string;
    zip?: string;
    phone?: string;
    gate_code?: string;
  } | null;
  dog_count: number;
  flags: string[];
  auto_charge: boolean;
}

// Charge outcome returned by PATCH /api/route when a stop is marked done
// (charge-on-completion for opted-in clients).
interface ChargeOutcome {
  attempted: boolean;
  reason?: string;
  result?:
    | { name: string; status: 'charged'; amount: number }
    | { name: string; status: 'skipped' | 'failed'; reason: string };
}

function addressLine(c: RouteStop['customer']): string {
  if (!c) return 'No address on file';
  const parts = [c.address, c.city, c.zip].filter(Boolean);
  return parts.length ? parts.join(', ') : 'No address on file';
}

function chargeFailed(charge: ChargeOutcome | null): boolean {
  return Boolean(charge?.attempted && charge.result?.status === 'failed');
}

function doneMessage(
  next: RouteStop['status'],
  noCharge: boolean,
  charge: ChargeOutcome | null
): string {
  if (next === 'skipped') return 'Stop skipped';
  if (next === 'scheduled') return 'Stop reopened';
  if (noCharge) return 'Stop marked done, no charge';
  if (charge?.attempted && charge.result) {
    const r = charge.result;
    if (r.status === 'charged') return `Stop marked done, charged ${money(r.amount)}`;
    if (r.status === 'failed') return `Stop done, but card charge failed: ${r.reason}`;
    return `Stop marked done, charge skipped: ${r.reason}`;
  }
  return 'Stop marked done';
}

// Flags that read as a warning get a red badge; the rest are neutral/amber.
function flagClass(flag: string): string {
  const f = flag.toLowerCase();
  if (f.includes('aggress') || f.startsWith('do not') || f.includes('hazard')) {
    return 'bg-[#ffebee] text-danger';
  }
  return 'bg-[#fff8e1] text-[#f57f17]';
}

export function RouteList({
  date,
  initialStops,
  activeCustomers,
}: {
  date: string;
  initialStops: RouteStop[];
  activeCustomers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [stops, setStops] = useState<RouteStop[]>(initialStops);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pickId, setPickId] = useState('');
  const [addBusy, setAddBusy] = useState(false);

  // Keep local state in sync when the server re-renders (e.g. after add-stop).
  useEffect(() => {
    setStops(initialStops);
  }, [initialStops]);

  async function persistOrder(ordered: RouteStop[]) {
    setReordering(true);
    try {
      const res = await fetch('/api/route', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reorder', date, order: ordered.map((s) => s.id) }),
      });
      if (!res.ok) throw new Error('reorder failed');
      toast('Route order saved');
    } catch {
      toast('Could not save the new order', 'error');
    } finally {
      setReordering(false);
    }
  }

  function onDragEnd(result: DropResult) {
    const { source, destination } = result;
    if (!destination || destination.index === source.index) return;
    const next = Array.from(stops);
    const [moved] = next.splice(source.index, 1);
    next.splice(destination.index, 0, moved);
    const renumbered = next.map((s, i) => ({ ...s, route_position: i + 1 }));
    setStops(renumbered);
    void persistOrder(renumbered);
  }

  async function setStatus(stop: RouteStop, next: RouteStop['status'], noCharge = false) {
    const prevStatus = stop.status;
    setSavingId(stop.id);
    setStops((prev) => prev.map((s) => (s.id === stop.id ? { ...s, status: next } : s)));
    try {
      const res = await fetch('/api/route', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status', id: stop.id, status: next, no_charge: noCharge }),
      });
      if (!res.ok) throw new Error('status failed');
      const data = (await res.json().catch(() => ({}))) as { charge?: ChargeOutcome | null };
      toast(doneMessage(next, noCharge, data.charge ?? null), chargeFailed(data.charge ?? null) ? 'error' : undefined);
    } catch {
      setStops((prev) => prev.map((s) => (s.id === stop.id ? { ...s, status: prevStatus } : s)));
      toast('Could not update the stop', 'error');
    } finally {
      setSavingId(null);
    }
  }

  async function addStop() {
    if (!pickId) return;
    setAddBusy(true);
    try {
      const res = await fetch('/api/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, customer_id: pickId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || 'Could not add stop', 'error');
        return;
      }
      toast(data.duplicate ? 'Already on this day' : 'Stop added');
      setPickId('');
      setAdding(false);
      router.refresh();
    } catch {
      toast('Could not add stop', 'error');
    } finally {
      setAddBusy(false);
    }
  }

  const onRoute = new Set(stops.map((s) => s.customer_id));
  const addable = activeCustomers.filter((c) => !onRoute.has(c.id));
  const doneCount = stops.filter((s) => s.status === 'completed').length;

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <span className="text-sm text-muted">
          {stops.length} stop{stops.length === 1 ? '' : 's'} · {doneCount} done
          {reordering && ' · saving order…'}
        </span>
        {adding ? (
          <div className="flex items-center gap-2">
            <Select value={pickId} onChange={(e) => setPickId(e.target.value)} className="w-48 py-1.5">
              <option value="">Add a client…</option>
              {addable.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
            <Button variant="primary" size="sm" disabled={!pickId || addBusy} onClick={addStop}>
              {addBusy ? 'Adding…' : 'Add'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>+ Add stop</Button>
        )}
      </div>

      {stops.length === 0 ? (
        <EmptyState
          title="No stops scheduled"
          hint="No visits for this day yet. Use “Add stop”, or the nightly generator will create upcoming appointments."
        />
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="route">
            {(provided) => (
              <ul ref={provided.innerRef} {...provided.droppableProps} className="flex flex-col gap-2">
                {stops.map((stop, index) => {
                  const dimmed = stop.status === 'completed' || stop.status === 'skipped';
                  const cust = stop.customer;
                  return (
                    <Draggable key={stop.id} draggableId={stop.id} index={index}>
                      {(dp, snapshot) => (
                        <li
                          ref={dp.innerRef}
                          {...dp.draggableProps}
                          className={cn(
                            'bg-white rounded-card border border-line flex items-center gap-3 p-3 transition-shadow flex-wrap',
                            snapshot.isDragging && 'shadow-lg border-brand',
                            dimmed && 'opacity-70'
                          )}
                        >
                          <button
                            type="button"
                            aria-label="Drag to reorder"
                            {...dp.dragHandleProps}
                            className="text-muted hover:text-brand cursor-grab active:cursor-grabbing px-1 shrink-0"
                          >
                            <svg width="14" height="20" viewBox="0 0 14 20" fill="currentColor" aria-hidden>
                              <circle cx="4" cy="4" r="1.6" /><circle cx="10" cy="4" r="1.6" />
                              <circle cx="4" cy="10" r="1.6" /><circle cx="10" cy="10" r="1.6" />
                              <circle cx="4" cy="16" r="1.6" /><circle cx="10" cy="16" r="1.6" />
                            </svg>
                          </button>

                          <div className="font-heading font-black text-brand-dark w-6 text-center shrink-0">
                            {index + 1}
                          </div>

                          <Avatar initials={initials(cust ?? undefined)} />

                          <div className="min-w-0 flex-1 basis-[12rem]">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-heading font-bold text-ink truncate">
                                {cust ? fullName(cust) : 'Unknown customer'}
                              </span>
                              <StatusPill status={stop.status} />
                              {stop.flags.map((f) => (
                                <span
                                  key={f}
                                  className={cn('text-[0.68rem] px-2 py-0.5 rounded-full font-heading font-bold', flagClass(f))}
                                >
                                  {f}
                                </span>
                              ))}
                            </div>
                            <div className="text-sm text-muted truncate">{addressLine(cust)}</div>
                            <div className="text-[0.78rem] text-muted mt-0.5 flex items-center gap-2 flex-wrap">
                              <span>{stop.dog_count} dog{stop.dog_count === 1 ? '' : 's'}</span>
                              {cust?.gate_code && (<><span aria-hidden>·</span><span>gate {cust.gate_code}</span></>)}
                              {stop.service_type && (<><span aria-hidden>·</span><span>{stop.service_type}</span></>)}
                              {cust?.phone && (<><span aria-hidden>·</span><span>{phone(cust.phone)}</span></>)}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end ml-auto">
                            {stop.status === 'scheduled' ? (
                              <>
                                <Button variant="primary" size="sm" disabled={savingId === stop.id} onClick={() => setStatus(stop, 'completed')}>
                                  {stop.auto_charge ? 'Done + charge' : 'Mark done'}
                                </Button>
                                {stop.auto_charge && (
                                  <Button variant="outline" size="sm" disabled={savingId === stop.id} onClick={() => setStatus(stop, 'completed', true)}>
                                    Done, no charge
                                  </Button>
                                )}
                                <Button variant="outline" size="sm" disabled={savingId === stop.id} onClick={() => setStatus(stop, 'skipped')}>
                                  Skip
                                </Button>
                              </>
                            ) : (
                              <Button variant="ghost" size="sm" disabled={savingId === stop.id} onClick={() => setStatus(stop, 'scheduled')}>
                                Undo
                              </Button>
                            )}
                          </div>
                        </li>
                      )}
                    </Draggable>
                  );
                })}
                {provided.placeholder}
              </ul>
            )}
          </Droppable>
        </DragDropContext>
      )}
    </div>
  );
}
