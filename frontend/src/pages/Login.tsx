import React, { useState } from 'react'
import { ensureAuthSigningKey, ensureKeys, signAuthChallenge } from '../crypto/crypto'
import type { User } from '../types'

interface LoginProps {
  onLogin: React.Dispatch<React.SetStateAction<User | null>>;
}

export default function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState('user-' + Math.floor(Math.random() * 1000));
  const [password, setPassword] = useState('');

  async function readJson<T>(res: Response): Promise<T> {
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `request failed with ${res.status}`);
    return data as T;
  }

  async function requestChallenge(
    currentUsername: string,
    purpose: 'register' | 'login',
    authPublicKey?: string
  ): Promise<{ challengeId: string; challenge: string }> {
    const res = await fetch(`${location.protocol}//${location.hostname}:4000/auth/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUsername, purpose, authPublicKey })
    });
    return readJson<{ challengeId: string; challenge: string }>(res);
  }

  async function publishKey(currentUsername: string, userId: string, token: string) {
    const publicKey = await ensureKeys(currentUsername);
    if (!publicKey) return;
    await fetch(`${location.protocol}//${location.hostname}:4000/keys/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ userId, publicKey })
    });
  }

  async function register() {
    const currentUsername = username.trim();
    if (!currentUsername) return alert('username required');
    if (password.length < 12) return alert('password must be at least 12 characters');

    try {
      const authPublicKey = await ensureAuthSigningKey(currentUsername);
      const challenge = await requestChallenge(currentUsername, 'register', authPublicKey);
      const signature = await signAuthChallenge(currentUsername, challenge.challenge);
      const res = await fetch(`${location.protocol}//${location.hostname}:4000/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: currentUsername,
          password,
          authPublicKey,
          challengeId: challenge.challengeId,
          signature
        })
      });
      const data = await readJson<User>(res);
      await publishKey(currentUsername, data.id, data.token);
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify({ id: data.id, username: data.username }));
      onLogin({ id: data.id, username: data.username, token: data.token });
    } catch (error) {
      alert(error instanceof Error ? error.message : 'register failed');
    }
  }

  async function login() {
    const currentUsername = username.trim();
    if (!currentUsername) return alert('username required');
    if (!password) return alert('password required');

    try {
      const challenge = await requestChallenge(currentUsername, 'login');
      const signature = await signAuthChallenge(currentUsername, challenge.challenge);
      const res = await fetch(`${location.protocol}//${location.hostname}:4000/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: currentUsername,
          password,
          challengeId: challenge.challengeId,
          signature
        })
      });
      const data = await readJson<User>(res);
      await publishKey(currentUsername, data.id, data.token);
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify({ id: data.id, username: data.username }));
      onLogin({ id: data.id, username: data.username, token: data.token });
    } catch (error) {
      alert(error instanceof Error ? error.message : 'login failed');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900/90 p-8 shadow-xl shadow-black/40">
        <h1 className="text-center text-xl font-semibold tracking-tight text-zinc-100">Cypher Chat</h1>
        <p className="mt-2 text-center text-sm text-zinc-500">Sign in with your username and password</p>

        <label className="mt-8 block text-xs font-medium uppercase tracking-wider text-zinc-500">
          Username
        </label>
        <input
          value={username}
          onChange={e => setUsername(e.target.value)}
          className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none ring-0 placeholder:text-zinc-600 focus:border-zinc-500"
        />

        <label className="mt-4 block text-xs font-medium uppercase tracking-wider text-zinc-500">
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && login()}
          className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none ring-0 placeholder:text-zinc-600 focus:border-zinc-500"
          placeholder="At least 12 characters"
          autoComplete="current-password"
        />

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={register}
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-100 transition hover:border-zinc-600 hover:bg-zinc-700"
          >
            Register
          </button>
          <button
            type="button"
            onClick={login}
            className="flex-1 rounded-lg border border-zinc-700 bg-transparent px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800"
          >
            Login
          </button>
        </div>
      </div>
    </div>
  );
}
