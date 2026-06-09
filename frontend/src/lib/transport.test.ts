import { afterEach, describe, expect, it, vi } from 'vitest';
import { getApiBaseUrl, getApiUrl, getWebSocketUrl } from './transport';

function stubLocation(protocol: 'http:' | 'https:', host: string) {
  vi.stubGlobal('location', { protocol, host });
}

describe('transport URLs', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('uses same-origin API paths by default', () => {
    expect(getApiBaseUrl()).toBe('/api');
    expect(getApiUrl('/auth/login')).toBe('/api/auth/login');
    expect(getApiUrl('rooms')).toBe('/api/rooms');
  });

  it('uses same-origin WebSocket URL with ws for http pages', () => {
    stubLocation('http:', 'chat.example.test');

    expect(getWebSocketUrl()).toBe('ws://chat.example.test/ws');
  });

  it('uses same-origin WebSocket URL with wss for https pages', () => {
    stubLocation('https:', 'chat.example.test');

    expect(getWebSocketUrl()).toBe('wss://chat.example.test/ws');
  });

  it('honors API base URL overrides', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://api.example.test/root/');

    expect(getApiBaseUrl()).toBe('http://api.example.test/root');
    expect(getApiUrl('/keys/publish')).toBe('http://api.example.test/root/keys/publish');
  });

  it('honors WebSocket base URL overrides and normalizes http schemes', () => {
    vi.stubEnv('VITE_WS_BASE_URL', 'https://api.example.test/ws/');

    expect(getWebSocketUrl()).toBe('wss://api.example.test/ws');
    expect(getWebSocketUrl('/relay')).toBe('wss://api.example.test/ws/relay');
  });
});
