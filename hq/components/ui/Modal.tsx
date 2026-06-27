'use client';

import type { ReactNode } from 'react';
import { cn } from './utils';

interface OverlayProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

function Overlay({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 flex"
      onClick={onClose}
      role="presentation"
    >
      {children}
    </div>
  );
}

function Header({ title, onClose }: { title?: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-line">
      <h3 className="font-heading font-bold text-ink">{title}</h3>
      <button
        onClick={onClose}
        aria-label="Close"
        className="text-muted hover:text-ink text-xl leading-none"
      >
        ×
      </button>
    </div>
  );
}

export function Modal({ open, onClose, title, children }: OverlayProps) {
  if (!open) return null;
  return (
    <Overlay onClose={onClose}>
      <div className="m-auto w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="bg-white rounded-card border border-line">
          <Header title={title} onClose={onClose} />
          <div className="p-5">{children}</div>
        </div>
      </div>
    </Overlay>
  );
}

export function Drawer({ open, onClose, title, children }: OverlayProps) {
  if (!open) return null;
  return (
    <Overlay onClose={onClose}>
      <div
        className={cn(
          'ml-auto h-full w-full max-w-md bg-white border-l border-line flex flex-col'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <Header title={title} onClose={onClose} />
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </Overlay>
  );
}
