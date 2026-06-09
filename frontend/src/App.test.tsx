import { describe, expect, it } from 'vitest';
import { restoreStoredUser } from './App';

function makeStorage(initial: Record<string, string>) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    storage: {
      getItem: (key: string) => data.get(key) ?? null,
      removeItem: (key: string) => {
        data.delete(key);
      },
    } as Pick<Storage, 'getItem' | 'removeItem'>,
  };
}

describe('session restore', () => {
  it('restores a stored user when token and user payload are valid', () => {
    const { storage } = makeStorage({
      token: 'jwt-token',
      user: JSON.stringify({ id: 'user-id', username: 'alice' }),
    });

    expect(restoreStoredUser(storage)).toEqual({
      id: 'user-id',
      username: 'alice',
      token: 'jwt-token',
    });
  });

  it('clears invalid stored user data', () => {
    const { data, storage } = makeStorage({
      token: 'jwt-token',
      user: JSON.stringify({ id: 'user-id' }),
    });

    expect(restoreStoredUser(storage)).toBeNull();
    expect(data.has('token')).toBe(false);
    expect(data.has('user')).toBe(false);
  });
});
