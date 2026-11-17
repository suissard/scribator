import { Mic, MicOff, Square, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from './button';
import { cn } from '@/lib/utils';

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      0: { transcript: string };
    };
  };
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function joinSpoken(base: string, spoken: string): string {
  const b = (base ?? '').trimEnd();
  const t = spoken.trim();
  if (!t) return base;
  return b ? `${b} ${t}` : t;
}

/**
 * Bouton de dictée : le texte reconnu est écrit en direct dans le champ
 * (résultats provisoires compris), pour que la personne voie tout de suite
 * que le micro fonctionne et que ce qui est écrit est correct.
 */
export function VoiceDictationButton({
  value,
  onChange,
  label = 'Dicter avec ma voix',
  className,
}: {
  value: string;
  onChange(next: string): void;
  label?: string;
  className?: string;
}) {
  const [listening, setListening] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [live, setLive] = useState('');
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const baseRef = useRef('');
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    return () => {
      recRef.current?.stop();
    };
  }, []);

  const toggle = () => {
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setUnsupported(true);
      return;
    }
    const rec = new Ctor();
    rec.lang = 'fr-FR';
    rec.continuous = true;
    rec.interimResults = true;
    // Le texte déjà présent dans le champ est conservé ; la dictée s'ajoute après.
    baseRef.current = valueRef.current;
    rec.onresult = (e) => {
      let finals = '';
      let interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r) continue;
        if (r.isFinal) finals += r[0].transcript + ' ';
        else interim += r[0].transcript + ' ';
      }
      setLive(interim.trim());
      onChangeRef.current(joinSpoken(baseRef.current, `${finals}${interim}`.replace(/\s+/g, ' ')));
    };
    const finish = () => {
      setListening(false);
      setLive('');
    };
    rec.onerror = finish;
    rec.onend = finish;
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      finish();
    }
  };

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        variant={listening ? 'primary' : 'secondary'}
        onClick={toggle}
        className={cn(
          'h-12 px-5 text-base font-semibold shadow-xs',
          listening && 'bg-danger text-white hover:bg-danger/90',
          className,
        )}
      >
        {listening ? (
          <>
            <MicOff size={20} /> Arrêter la dictée
          </>
        ) : (
          <>
            <Mic size={20} className="text-accent" /> {label}
          </>
        )}
      </Button>
      {listening && (
        <span role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-muted">
          <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-danger" aria-hidden />
          {live ? (
            <span>
              J'entends : <em className="text-ink">« {live} »</em>
            </span>
          ) : (
            'Je vous écoute, parlez maintenant… Le texte s’écrit dans le champ au fur et à mesure.'
          )}
        </span>
      )}
      {unsupported && (
        <span className="text-xs text-danger">
          La dictée vocale n'est pas disponible sur ce navigateur (utilisez Chrome, Edge ou Safari).
        </span>
      )}
    </div>
  );
}

export function SpeakButton({
  text,
  label = 'Écouter le texte',
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text.trim()) return null;

  const toggle = () => {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const clean = text.replace(/[#*_~`>-]/g, ' ').replace(/\s+/g, ' ').trim();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = 'fr-FR';
    utterance.rate = 0.92; // Débit légèrement ralenti pour un confort d'écoute en EHPAD
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <Button
      type="button"
      variant={speaking ? 'primary' : 'secondary'}
      onClick={toggle}
      className={cn('h-12 px-5 text-base font-semibold', className)}
    >
      {speaking ? (
        <>
          <Square size={18} /> Arrêter la lecture
        </>
      ) : (
        <>
          <Volume2 size={20} className="text-accent" /> {label}
        </>
      )}
    </Button>
  );
}
