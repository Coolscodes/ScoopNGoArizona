import { Card, CardBody, EmptyState } from '@/components/ui';
import { money, shortDate } from '@/lib/format';
import type { WeeklyRevenuePoint } from './data';

// Inline SVG bar chart, revenue per week (last 8 weeks), sized and spaced to
// match WeeklyVisitsChart so the two sit side by side and line up week for week.
export function WeeklyRevenueChart({ data }: { data: WeeklyRevenuePoint[] }) {
  const hasData = data.some((d) => d.total > 0);

  return (
    <Card>
      <CardBody>
        <h2 className="font-heading text-[0.8rem] font-bold text-muted uppercase tracking-wider mb-4">
          Weekly revenue
        </h2>
        {!hasData ? (
          <EmptyState
            title="No revenue yet"
            hint="Paid invoices will show up here week by week."
          />
        ) : (
          <WeeklyBars data={data} />
        )}
      </CardBody>
    </Card>
  );
}

function WeeklyBars({ data }: { data: WeeklyRevenuePoint[] }) {
  const max = Math.max(...data.map((d) => d.total), 1);
  const width = 700;
  const height = 220;
  const barGap = 14;
  const barWidth = (width - barGap * (data.length - 1)) / data.length;
  const chartHeight = 140;
  // Same headroom as the visits chart, so both baselines land at the same y and
  // the bars read as one grid across the two cards.
  const topPad = 36;
  const baseline = topPad + chartHeight;

  const total = data.reduce((sum, d) => sum + d.total, 0);
  const weeksWithWork = data.filter((d) => d.visits > 0).length;

  return (
    <div>
      <div className="overflow-x-auto overscroll-x-contain">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto min-w-[560px]"
          role="img"
          aria-label="Weekly revenue bar chart"
        >
          {data.map((d, i) => {
            const barHeight = max > 0 ? (d.total / max) * chartHeight : 0;
            const x = i * (barWidth + barGap);
            const y = baseline - barHeight;
            return (
              <g key={d.weekStart}>
                <text
                  x={x + barWidth / 2}
                  y={y - 8}
                  textAnchor="middle"
                  className="fill-brand-dark"
                  style={{ font: '700 11px var(--font-heading), system-ui, sans-serif' }}
                >
                  {money(d.total)}
                </text>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(barHeight, 2)}
                  rx={4}
                  className="fill-brand"
                />
                <text
                  x={x + barWidth / 2}
                  y={baseline + 20}
                  textAnchor="middle"
                  className="fill-muted"
                  style={{ font: '600 10px var(--font-heading), system-ui, sans-serif' }}
                >
                  {shortDate(d.weekStart).replace(/, \d{4}$/, '')}
                </text>
              </g>
            );
          })}
          <line
            x1={0}
            y1={baseline}
            x2={width}
            y2={baseline}
            className="stroke-line"
            strokeWidth={1}
          />
        </svg>
      </div>
      <div className="mt-2 text-[0.72rem] text-muted">
        {money(total)} over {weeksWithWork} week{weeksWithWork === 1 ? '' : 's'} of work.
        Credited to the week serviced, not the day the money arrived.
      </div>
    </div>
  );
}
