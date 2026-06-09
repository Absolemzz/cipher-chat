const DEFAULT_API_BASE_URL = '/api';
const DEFAULT_WS_PATH = '/ws';

type RuntimeLocation = Pick<Location, 'protocol' | 'host'>;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizePath(path: string): string {
  if (!path) return '';
  return path.startsWith('/') ? path : `/${path}`;
}

function runtimeLocation(): RuntimeLocation {
  const locationLike = typeof window !== 'undefined' ? window.location : globalThis.location;
  if (!locationLike) {
    throw new Error('browser location is required to build WebSocket URLs');
  }
  return locationLike;
}

function wsProtocolFromPage(protocol: string): 'ws:' | 'wss:' {
  return protocol === 'https:' ? 'wss:' : 'ws:';
}

function toWebSocketBaseUrl(value: string): string {
  const base = trimTrailingSlash(value.trim());
  if (base.startsWith('/')) {
    const loc = runtimeLocation();
    return `${wsProtocolFromPage(loc.protocol)}//${loc.host}${base}`;
  }
  if (base.startsWith('http://')) return `ws://${base.slice('http://'.length)}`;
  if (base.startsWith('https://')) return `wss://${base.slice('https://'.length)}`;
  return base;
}

export function getApiBaseUrl(): string {
  return trimTrailingSlash(import.meta.env.VITE_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL);
}

export function getApiUrl(path: string): string {
  return `${getApiBaseUrl()}${normalizePath(path)}`;
}

export function getWebSocketUrl(path = ''): string {
  const configuredBase = import.meta.env.VITE_WS_BASE_URL;
  if (configuredBase?.trim()) {
    return `${toWebSocketBaseUrl(configuredBase)}${normalizePath(path)}`;
  }

  const loc = runtimeLocation();
  return `${wsProtocolFromPage(loc.protocol)}//${loc.host}${DEFAULT_WS_PATH}${normalizePath(path)}`;
}

export function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  return fetch(getApiUrl(path), options);
}
