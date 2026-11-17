import { useSyncExternalStore } from 'react';

export type UiMode = 'simple' | 'expert';
export type FontScale = 'normal' | 'large' | 'xlarge';

const MODE_KEY = 'scribator_ui_mode';
const SCALE_KEY = 'scribator_font_scale';

function readMode(): UiMode {
  const saved = localStorage.getItem(MODE_KEY);
  return saved === 'expert' ? 'expert' : 'simple';
}

function readScale(): FontScale {
  const saved = localStorage.getItem(SCALE_KEY);
  if (saved === 'normal' || saved === 'large' || saved === 'xlarge') return saved;
  return 'large';
}

let currentMode: UiMode = typeof window !== 'undefined' ? readMode() : 'simple';
let currentScale: FontScale = typeof window !== 'undefined' ? readScale() : 'large';
const listeners = new Set<() => void>();

function applyDomAttributes() {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.uiMode = currentMode;
  document.documentElement.dataset.fontScale = currentScale;
}

applyDomAttributes();

function notify() {
  applyDomAttributes();
  listeners.forEach((l) => l());
}

export function getUiMode(): UiMode {
  return currentMode;
}

export function setUiMode(mode: UiMode): void {
  currentMode = mode;
  localStorage.setItem(MODE_KEY, mode);
  notify();
}

export function getFontScale(): FontScale {
  return currentScale;
}

export function setFontScale(scale: FontScale): void {
  currentScale = scale;
  localStorage.setItem(SCALE_KEY, scale);
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUiMode() {
  const mode = useSyncExternalStore(subscribe, getUiMode);
  const fontScale = useSyncExternalStore(subscribe, getFontScale);
  return {
    mode,
    isSimple: mode === 'simple',
    fontScale,
    setMode: setUiMode,
    setFontScale,
  };
}
