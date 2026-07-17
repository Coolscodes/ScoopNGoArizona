import { PageHeader } from '@/components/ui';
import { getInvoicesData } from '@/components/invoices/data';
import { InvoicesView } from '@/components/invoices/InvoicesView';

// Live AR + invoice book, always read fresh.
export const dynamic = 'force-dynamic';

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams?: { customer?: string };
}) {
  const customerId = searchParams?.customer;
  const { rows, summary, balances } = await getInvoicesData(
    customerId ? { customerId } : undefined
  );

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle="Accounts receivable, weekly charging, and card-on-file links"
      />
      <InvoicesView rows={rows} summary={summary} balances={balances} />
    </div>
  );
}
