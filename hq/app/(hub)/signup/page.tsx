import { PageHeader } from '@/components/ui';
import { SignupFlow } from '@/components/signup/SignupFlow';

export const dynamic = 'force-dynamic';

export default function SignupPage() {
  return (
    <div className="max-w-2xl">
      <PageHeader
        title="New signup"
        subtitle="Put a new client on the books, send the card link, take the signup payment."
      />
      <SignupFlow />
    </div>
  );
}
