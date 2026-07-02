'use client';

// Briefings module — shared card used for both the morning ops brief and the
// weekly business review. Calls the given endpoint, renders the result as
// plain readable text, and offers browser read-aloud once text exists.

import { useState } from 'react';
import { Card, CardBody, Button } from '@/components/ui';

export function BriefingCard({
  title,
  description,
  actionLabel,
  endpoint,
}: {
  title: string;
  description: string;
  actionLabel: string;
  endpoint: string;
}) {
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  async function generate() {
    setLoading(true);
    setNeedsKey(false);
    try {
      const res = await fetch(endpoint, { method: 'POST' });
      const data = await res.json();
      setText(data.text ?? 'No response.');
      setNeedsKey(Boolean(data.needsKey));
    } catch {
      setText("Couldn't reach the server. Please try again.");
      setNeedsKey(false);
    } finally {
      setLoading(false);
    }
  }

  function readAloud() {
    if (!text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }

  function stopReading() {
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }

  return (
    <Card>
      <CardBody>
        <h2 className="font-heading text-[1.05rem] font-bold text-ink mb-1">{title}</h2>
        <p className="text-sm text-muted mb-4">{description}</p>

        <Button variant="primary" onClick={generate} disabled={loading}>
          {loading ? 'Generating…' : actionLabel}
        </Button>

        {needsKey && text && (
          <div className="mt-4 rounded-[7px] border border-[#ffe0a3] bg-[#fff8e6] px-3.5 py-3 text-sm text-[#8a6100]">
            {text}
          </div>
        )}

        {text && !needsKey && (
          <>
            <div className="mt-4 whitespace-pre-wrap rounded-[7px] border border-line bg-[#fafaf8] px-4 py-3.5 text-sm leading-relaxed text-ink">
              {text}
            </div>
            <div className="mt-3 flex items-center gap-2">
              {!speaking ? (
                <Button variant="outline" size="sm" onClick={readAloud}>
                  Read aloud
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={stopReading}>
                  Stop
                </Button>
              )}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
