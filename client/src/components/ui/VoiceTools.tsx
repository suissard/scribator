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

export function VoiceDictationButton({
  onTranscript,
  label = 'Dicter avec ma voix',
  className,
}: {
  onTranscript(text: string): void;
  label?: string;
  className?: string;
}) {
  const [listening, setListening] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const callbackRef = useRef(onTranscript);
  callbackRef.current = onTranscript;

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
    rec.interimResults = false;
    rec.onresult = (e) => {
      let chunk = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i]?.isFinal) {
          chunk += e.results[i]![0].transcript + ' ';
        }
      }
      if (chunk.trim()) callbackRef.current(chunk.trim());
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
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
          listening && 'bg-danger text-white hover:bg-danger/90 animate-pulse',
          className,
        )}
      >
        {listening ? (
          <>
            <MicOff size={20} /> Arrêter la dictée (parlez maintenant…)
          </>
        ) : (
          <>
            <Mic size={20} className="text-accent" /> {label}
          </>
        )}
      </Button>
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
