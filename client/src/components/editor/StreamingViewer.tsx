import { useEffect, useRef } from 'react';

export function StreamingViewer({ text, label = 'scène' }: { text: string; label?: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);

  if (!text) {
    return (
      <div role="status" className="flex items-center gap-3 rounded-md bg-accent-soft/50 p-4 text-sm text-accent">
        <span aria-hidden="true" className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span key={i} className="thinking-dot h-2 w-2 rounded-full bg-accent" />
          ))}
        </span>
        L'IA réfléchit et structure la {label}…
      </div>
    );
  }
  return (
    <div ref={box} aria-live="off" className="prose-book max-h-[60vh] overflow-y-auto whitespace-pre-wrap">
      {text}
    </div>
  );
}
