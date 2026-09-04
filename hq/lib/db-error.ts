// Turns a Postgres / PostgREST error into a message an operator can act on.
// Supabase errors arrive as plain objects with a `code`, not as Error instances,
// so the raw text ("null value in column \"email\" of relation \"customers\"
// violates not-null constraint") is what would otherwise reach the UI.

const COLUMN_LABELS: Record<string, string> = {
  first_name: 'First name',
  last_name: 'Last name',
  phone: 'Phone',
  email: 'Email',
  price_per_visit: 'Price per visit',
};

function label(column: string): string {
  return COLUMN_LABELS[column] ?? column.replace(/_/g, ' ');
}

export function describeDbError(err: unknown, fallback: string): string {
  const e = err as { code?: string; message?: string } | null;
  const message = e?.message || fallback;

  // 23502: not-null violation. Name the field instead of the constraint.
  if (e?.code === '23502') {
    const column = /column "([^"]+)"/.exec(message)?.[1];
    return column ? `${label(column)} is required.` : 'A required field is missing.';
  }
  // 23505: unique violation.
  if (e?.code === '23505') {
    return 'A record with those details already exists.';
  }
  return message;
}
