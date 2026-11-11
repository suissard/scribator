const MOCK_STORAGE_KEY = 'scribator_mock_mode';

function getInitialMockMode(): boolean {
  const stored = localStorage.getItem(MOCK_STORAGE_KEY);
  if (stored !== null) {
    return stored === 'true';
  }
  // Par défaut, si hébergé sur github.io ou si VITE_DEFAULT_MOCK=true, mode mock activé
  if (import.meta.env.VITE_DEFAULT_MOCK === 'true') return true;
  if (typeof window !== 'undefined' && window.location.hostname.endsWith('github.io')) return true;
  return false;
}

let isMockMode = getInitialMockMode();
const listeners = new Set<(mock: boolean) => void>();

export function getMockMode(): boolean {
  return isMockMode;
}

export function setMockMode(enabled: boolean): void {
  isMockMode = enabled;
  localStorage.setItem(MOCK_STORAGE_KEY, String(enabled));
  listeners.forEach((listener) => listener(enabled));
}

export function subscribeMockMode(listener: (mock: boolean) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
