import { PageHeader } from '@/components/ui';
import { AssistantChat } from '@/components/assistant/AssistantChat';

export const dynamic = 'force-dynamic';

export default function AssistantPage() {
  return (
    <div>
      <PageHeader title="Assistant" subtitle="Your ops copilot — ask anything about the business" />
      <AssistantChat />
    </div>
  );
}
