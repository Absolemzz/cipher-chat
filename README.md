Cipher-chat: E2EE Messaging Demo

A project demonstrating end to end encrypted messaging architecture.

Quick Start
docker-compose up --build
Open http://localhost:3000

Architecture:
React + TypeScript - WebSocket - Node.js relay - SQLite (ciphertext only)

Features:
Client side AES-GCM encryption (demo mode)
Real time WebSocket messaging
Dockerized deployment

Security:
Server stores only encrypted messages
Clientside key generation and encryption
Demo mode uses shared secret, production design uses ECDH key exchange
