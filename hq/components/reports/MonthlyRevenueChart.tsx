import { Card, CardBody, EmptyState } from '@/components/ui';
import { money } from '@/lib/format';
import type { MonthlyRevenuePoint } from './data';

// Inline SVG bar chart, last 6 calendar months of collected payments.
export function MonthlyRevenueChart({ data }: { data: MonthlyRevenuePoint[] }) {
  const hasData = data.some((d) => d.total > 0);

  return (
    <Card>
      <CardBody>
        <h2 className="font-heading text-[0.8rem] font-bold text-muted uppercase tracking-wider mb-4">
          Monthly revenue
        </h2>
        {!hasData ? (
          <EmptyState
            title="No revenue yet"
            hint="Payments collected each month will show up here."
          />
        ) : (
          <div className="overflow-x-auto overscroll-x-contain">
            <MonthlyBars data={data} />
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function MonthlyBars({ data }: { data: MonthlyRevenuePoint[] }) {
  const max = Math.max(...data.map((d) => d.total), 1);
  const width = 700;
  const height = 220;
  const barGap = 24;
  const barWidth = (width - barGap * (data.length - 1)) / data.length;
  const chartHeight = 150;
  // Headroom above the tallest bar so its value label isn't clipped by the
  // viewBox (label sits 8px above the bar and the 12px text ascends from there).
  const topPad = 26;
  const baseline = topPad + chartHeight;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto min-w-[480px]"
      role="img"
      aria-label="Monthly revenue bar chart"
    >
      {data.map((d, i) => {
        const barHeight = max > 0 ? (d.total / max) * chartHeight : 0;
        const x = i * (barWidth + barGap);
        const y = baseline - barHeight;
        return (
          <g key={d.month}>
            <text
              x={x + barWidth / 2}
              y={baseline - barHeight - 8}
              textAnchor="middle"
              className="fill-brand-dark"
              style={{ font: '700 12px var(--font-heading), system-ui, sans-serif' }}
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
              style={{ font: '600 12px var(--font-heading), system-ui, sans-serif' }}
            >
              {d.month}
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
  );
}
