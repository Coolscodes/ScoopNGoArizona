import { Card, CardBody, EmptyState, Table, Th, Td } from '@/components/ui';
import { money } from '@/lib/format';
import type { ClientRevenue } from './data';

// Every client by all-time collected, highest first. Not a top slice: a cutoff
// silently drops clients who are only tied with the ones above them.
export function ClientRevenueTable({ data }: { data: ClientRevenue[] }) {
  return (
    <Card>
      <CardBody>
        <h2 className="font-heading text-[0.8rem] font-bold text-muted uppercase tracking-wider mb-4">
          Client revenue
        </h2>
        {data.length === 0 ? (
          <EmptyState
            title="No client revenue yet"
            hint="Every client will be listed here by lifetime revenue."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Client</Th>
                <Th className="text-right">Lifetime revenue</Th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.customerId}>
                  <Td className="font-semibold text-ink">{c.name}</Td>
                  <Td className="text-right font-heading font-bold text-brand-dark">
                    {money(c.total)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}
