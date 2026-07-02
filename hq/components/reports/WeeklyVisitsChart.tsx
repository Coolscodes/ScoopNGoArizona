import { Card, CardBody, EmptyState } from '@/components/ui';
import { shortDate } from '@/lib/format';
import type { WeeklyVisitPoint } from './data';

// Inline SVG bar chart — completed visits per week (last 8 weeks), with a red
// dot marker showing how many of that week's visits were flagged with an issue.
export function WeeklyVisitsChart({ data }: { data: WeeklyVisitPoint[] }) {
  const hasData = data.some((d) => d.count > 0);

  return (
    <Card>
      <CardBody>
        <h2 className="font-heading text-[0.8rem] font-bold text-muted uppercase tracking-wider mb-4">
          Weekly visits
        </h2>
        {!hasData ? (
          <EmptyState
            title="No completed visits yet"
            hint="Completed service logs will show up here week by week."
          />
        ) : (
          <WeeklyBars data={data} />
        )}
      </CardBody>
    </Card>
  );
}

function WeeklyBars({ data }: { data: WeeklyVisitPoint[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  const width = 700;
  const height = 220;
  const barGap = 14;
  const barWidth = (width - barGap * (data.length - 1)) / data.length;
  const chartHeight = 150;
  const baseline = chartHeight + 10;

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        role="img"
        aria-label="Weekly visits bar chart"
      >
        {data.map((d, i) => {
          const barHeight = max > 0 ? (d.count / max) * chartHeight : 0;
          const x = i * (barWidth + barGap);
          const y = baseline - barHeight;
          return (
            <g key={d.weekStart}>
              <text
                x={x + barWidth / 2}
                y={baseline - barHeight - 8}
                textAnchor="middle"
                className="fill-brand-dark"
                style={{ font: '700 12px var(--font-heading), system-ui, sans-serif' }}
              >
                {d.count}
              </text>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(barHeight, 2)}
                rx={4}
                className="fill-brand"
              />
              {d.issues > 0 && (
                <>
                  <circle
                    cx={x + barWidth / 2}
                    cy={y - 20}
                    r={6}
                    className="fill-danger"
                  />
                  <text
                    x={x + barWidth / 2}
                    y={y - 16}
                    textAnchor="middle"
                    className="fill-white"
                    style={{ font: '700 8px var(--font-heading), system-ui, sans-serif' }}
                  >
                    {d.issues}
                  </text>
                </>
              )}
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
      <div className="flex items-center gap-2 mt-2 text-[0.72rem] text-muted">
        <span className="inline-block w-2.5 h-2.5 rounded-full bg-danger" />
        red dot = visits with a flagged issue that week
      </div>
    </div>
  );
}
