import { Card, CardBody, StatusPill } from '@/components/ui';
import { money, dayMonth, timeOfDay, shortDate, fullName } from '@/lib/format';
import { SkipVisitButton } from './SkipVisitButton';
import { ReferFriend } from './ReferFriend';
import { UpdateCardButton } from './UpdateCardButton';
import type { PortalData } from '@/components/portal/data';

// Presentational account page. All data comes pre-scoped to ONE customer from the
// server page; this component renders it and wires the (client) action buttons.
export function AccountView({ data, token }: { data: PortalData; token: string }) {
  const { customer, nextVisit, lastVisit, balance, invoices } = data;
  const owes = balance > 0.005;

  return (
    <div className="space-y-5">
      {/* Greeting */}
      <div>
        <h1 className="font-heading text-[1.5rem] font-black text-ink leading-tight">
          Hi {customer.first_name || 'there'}
        </h1>
        <p className="text-sm text-muted mt-0.5">
          {customer.service_type ? `${customer.service_type} service` : 'Your service'}
          {customer.address ? ` · ${customer.address}` : ''}
        </p>
      </div>

      {/* Next visit */}
      <Card>
        <CardBody>
          <div className="text-[0.75rem] font-heading font-bold uppercase tracking-wide text-muted mb-1">
            Next visit
          </div>
          {nextVisit ? (
            <div className="flex items-baseline justify-between gap-3">
              <div className="font-heading text-[1.4rem] font-black text-brand-dark">
                {dayMonth(nextVisit.scheduled_at)}
              </div>
              <div className="text-sm text-muted">{timeOfDay(nextVisit.scheduled_at)}</div>
            </div>
          ) : (
            <p className="text-sm text-muted">No upcoming visit is scheduled right now.</p>
          )}
          <div className="mt-3">
            <SkipVisitButton token={token} nextVisitAt={nextVisit?.scheduled_at ?? null} />
          </div>
        </CardBody>
      </Card>

      {/* Last visit + photo */}
      <Card>
        <CardBody>
          <div className="text-[0.75rem] font-heading font-bold uppercase tracking-wide text-muted mb-1">
            Last visit
          </div>
          {lastVisit ? (
            <>
              <div className="font-heading text-base font-bold text-ink">
                {shortDate(lastVisit.completed_at)}
              </div>
              {lastVisit.gate_photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={lastVisit.gate_photo_url}
                  alt="Photo from your last visit"
                  className="mt-3 w-full max-h-72 object-cover rounded-card border border-line"
                />
              ) : (
                <p className="text-sm text-muted mt-2">No photo was uploaded for this visit.</p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted">We have not logged a completed visit yet.</p>
          )}
        </CardBody>
      </Card>

      {/* Balance */}
      <Card>
        <CardBody>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[0.75rem] font-heading font-bold uppercase tracking-wide text-muted mb-1">
                Balance
              </div>
              <div
                className={
                  'font-heading text-[1.6rem] font-black leading-none ' +
                  (owes ? 'text-danger' : 'text-brand')
                }
              >
                {money(balance)}
              </div>
              <div className="text-sm text-muted mt-1">
                {owes
                  ? `${invoices.length} open invoice${invoices.length === 1 ? '' : 's'}`
                  : "You're all paid up. Thank you!"}
              </div>
            </div>
            <div className="text-right">
              <span className="text-xs text-muted block mb-1">
                {customer.has_card_on_file ? 'Card on file' : 'No card on file'}
              </span>
              <UpdateCardButton hasCard={customer.has_card_on_file} />
            </div>
          </div>

          {owes && (
            <div className="mt-4 border-t border-line pt-3 space-y-2">
              {invoices.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted">
                    {inv.period_start && inv.period_end
                      ? `${shortDate(inv.period_start)} to ${shortDate(inv.period_end)}`
                      : inv.due_date
                        ? `Due ${shortDate(inv.due_date)}`
                        : 'Invoice'}
                  </span>
                  <span className="flex items-center gap-2">
                    <StatusPill status={inv.status} />
                    <span className="font-heading font-bold text-ink">{money(inv.amount)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Refer a friend */}
      <Card>
        <CardBody className="flex items-center justify-between gap-3">
          <div>
            <div className="font-heading font-bold text-ink">Love the service?</div>
            <p className="text-sm text-muted">Refer a friend, you both get a free visit.</p>
          </div>
          <ReferFriend firstName={customer.first_name || fullName(customer)} />
        </CardBody>
      </Card>
    </div>
  );
}
