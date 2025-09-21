import React, { useState } from 'react'

export default function Login({ onLogin }: any) {
  const [username, setUsername] = useState('user-' + Math.floor(Math.random() * 1000));

  async function register() {
    const publicKeyHash = btoa(username).slice(0, 16);
    const res = await fetch(`${location.protocol}//${location.hostname}:4000/auth/register`, {
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ username, publicKeyHash })
    });
    const data = await res.json();
    if (data.token) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify({ id: data.id, username: data.username }));
      onLogin({ id: data.id, username: data.username, token: data.token });
    } else {
      alert('register failed');
    }
  }

  async function login() {
    const res = await fetch(`${location.protocol}//${location.hostname}:4000/auth/login`, {
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ username })
    });
    const data = await res.json();
    if (data.token) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify({ id: data.id, username: data.username }));
      onLogin({ id: data.id, username: data.username, token: data.token });
    } else {
      alert('login failed');
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>Signal-lite (demo)</h2>
      <div>
        <input value={username} onChange={e => setUsername(e.target.value)} />
      </div>
      <div style={{ marginTop: 10 }}>
        <button onClick={register}>Register</button>
        {' '}
        <button onClick={login}>Login</button>
      </div>
    </div>
  )
}