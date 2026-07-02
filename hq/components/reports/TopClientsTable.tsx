import { Card, CardBody, EmptyState, Table, Th, Td } from '@/components/ui';
import { money } from '@/lib/format';
import type { TopClient } from './data';

// Top 8 customers by all-time payments total.
export function TopClientsTable({ data }: { data: TopClient[] }) {
  return (
    <Card>
      <CardBody>
        <h2 className="font-heading text-[0.8rem] font-bold text-muted uppercase tracking-wider mb-4">
          Top clients
        </h2>
        {data.length === 0 ? (
          <EmptyState
            title="No client revenue yet"
            hint="Your highest lifetime-revenue clients will be ranked here."
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
