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
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#000000", // Black background
      }}
    >
      <div style={{ padding: 20, backgroundColor: "#1f2937", borderRadius: 8 }}>
        <h2 style={{ color: "white", textAlign: "center", margin: "0 0 20px 0" }}>Cypher chat (demo)</h2>
        <div>
          <input
            value={username}
            onChange={e => setUsername(e.target.value)}
            style={{
              width: "200px",
              padding: "6px 8px",
              borderRadius: 4,
              border: "none",
              outline: "none",
              marginTop: 10,
            }}
          />
        </div>
        <div style={{ marginTop: 10, width: "200px", display: "flex", gap: "8px" }}>
          <button 
            onClick={register} 
            style={{ 
              flex: 1,
              padding: "8px 12px",
              backgroundColor: "#374151",
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: "pointer"
            }}
          >
            Register
          </button>
          <button 
            onClick={login}
            style={{ 
              flex: 1,
              padding: "8px 12px",
              backgroundColor: "#374151",
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: "pointer"
            }}
          >
            Login
          </button>
        </div>
      </div>
    </div>
  );
}