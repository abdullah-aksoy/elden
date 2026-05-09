/**
 * Lokal geliştirme için varsayılan backend kökü (sonunda / yok).
 * Üretim veya cihaz testinde mutlaka EXPO_PUBLIC_BACKEND_URL tanımlayın.
 */
export const DEFAULT_BACKEND_BASE_URL = 'http://localhost:8001';

export function getBackendBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_BACKEND_URL?.trim();
  if (fromEnv && fromEnv !== 'undefined') {
    return fromEnv.replace(/\/+$/, '');
  }
  return DEFAULT_BACKEND_BASE_URL;
}

/** Android App Links / universal link host eşlemesi için (EXPO_PUBLIC_BACKEND_URL ile aynı host). */
export function getBackendHostname(): string | null {
  const base = getBackendBaseUrl();
  try {
    const withScheme = /:\/\//.test(base) ? base : `https://${base}`;
    return new URL(withScheme).hostname || null;
  } catch {
    return null;
  }
}
