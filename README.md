# AvaRamp — Seamless fiat ↔ AVAX rails

> The frictionless bridge that turns Vietnamese Dong into AVAX/USDT and back — quietly, reliably, and securely.

`AvaRamp` is a backend for partner integrations to move between fiat (VND) and crypto (AVAX/USDT). It quotes live prices, collects payments through Vietnamese banks via SePay, and settles on the Avalanche C-Chain — without forcing partners to reinvent payment infrastructure.

## 🎯 Philosophy

Financial integrations live or die on **trust, traceability, and uptime**. So `AvaRamp` is built around three commitments:

1. **Secure by architecture** — hot-wallet secrets never sit in the API process; C-Chain payout transactions are signed in-process via GCP Cloud KMS secp256k1 (ADC-backed), so private keys never touch the application.
2. **Predictable by design** — every state change is observable, audited, and delivered to you through signed webhooks.
3. **Resilient by default** — a durable Kafka pipeline absorbs failures and retries until settlement succeeds.

## 🧱 Architecture

### The Conversion Pipeline

```
Partner (Partner-App-Key)
        │ deposit / withdrawal orders
        ▼
   Fastify API ──► Services ──► PostgreSQL / Kafka
                                        │
                                        ▼
                          C-Chain payout (native AVAX / ERC-20 USDT)
                                        ▲
              C-Chain Listener ──► custodial sweep ──► Master Wallet
```

### Components

| Component | Role |
|---|---|
| **Fastify API** | Order lifecycle, quoting, webhook handling, admin |
| **PostgreSQL / Kafka** | Durability for orders and event streams |
| **C-Chain payout** | Sends buy-order AVAX/USDT to the recipient `0x` address via EIP-1559 txs |
| **GCP Cloud KMS** | Signs C-Chain payout txs in-process (secp256k1); private keys never touch the app |
| **C-Chain Listener** | Polls per-sell-order custodial `0x` wallets on Avalanche C-Chain for native AVAX + native USDT deposits and drives the sweep pipeline |

## ✨ Key Features

### 1. Live Price Engine
Buy/sell quotes built on Binance P2P median, with configurable spreads, per-token fees, minimum fees, and an audit trail for every fee change.

### 2. Bank-Payment Collection
SePay integration for Vietnamese bank transfers (QiR) plus NAPAS card/e-wallet checkout — each order gets a unique `payment_code` embedded in the transfer description.

### 3. Resumable Disbursement
Confirmed fiat payments are executed on the Avalanche C-Chain by the payout service; transactions are signed in-process via GCP Cloud KMS, keeping secrets outside the API process.

### 4. Signed, Replay-Safe Callbacks
Every order state change is POSTed to your URL, HMAC-signed, retried (up to 3×), logged, and protected against replay within a 5-minute window.

### 5. Full Admin & CMS
Operate config, secret rotation, statistics, partners, and KYC users through admin routes — with a JWT-secured control plane.

## 🚀 Quick Start

### Prerequisites

- **Node.js** 22+
- **PostgreSQL**
- **Kafka** (for the disbursement pipeline)

### Installation

```bash
npm install
cp .env.example .env
```

Fill in the required credentials (SePay, DB, Kafka, C-Chain, callback secret) inside `.env`.

Payout signing is done in-process via GCP Cloud KMS secp256k1 (ADC auth; requires `GCP_KMS_*` vars) or the dev-only `CCHAIN_PAYOUT_WALLET_PRIVATE_KEY` fallback. Set `CCHAIN_PAYOUT_ENABLED=true` to route buy payouts through the C-Chain payout service.

### Database Migrations

Knex needs explicit env vars (it doesn't auto-load `.env`):

```bash
DB_HOST=127.0.0.1 DB_USER=admin DB_PASSWORD=123456 DB_NAME=avaramp \
  npx tsx node_modules/.bin/knex migrate:latest --knexfile src/knexfile.ts
```

### Run

```bash
npm run dev              # API server
npx tsx cchain-listener/src/index.ts  # C-Chain deposit listener (sells)
```

## 💵 Usage / Data Flows

### Deposit (Buy AVAX/USDT)

```
Partner → deposit order (amount, asset, 0x recipient, callback)
   → quote + save order (CREATED) → return payment_code
   → user transfers VND (content = payment_code)
   → SePay webhook confirms + validates amount
   → order PROCESSING → C-Chain payout
   → payout wallet sends native AVAX or ERC-20 USDT (EIP-1559) to the recipient
   → order COMPLETED → signed callback to partner
```

### Withdrawal (Sell AVAX/USDT)

```
Partner → withdrawal order (amount, asset, callback, bank info)
   → save order (CREATED) → callback
   → provision unique 0x custodial deposit address for the order
   → user funds it with native AVAX and/or native USDT
   → C-Chain Listener confirms + sweeps to the Master Wallet
   → order correlated by address → PROCESSING → VND payout
   → order COMPLETED → signed callback to partner
```

### C-Chain Buy Payout (Avalanche EVM)

Buy orders settle on the Avalanche **C-Chain**: once fiat is confirmed, the
payout wallet sends the ordered asset to the recipient's `0x` address.

```
Partner → deposit order with 0x recipient
   → user pays VND → SePay webhook confirms
   → order PROCESSING → C-Chain payout service
   → EIP-1559 tx: native AVAX transfer, or ERC-20 USDT transfer
   → waits for configured confirmations → order COMPLETED
```

Signing prefers GCP Cloud KMS (secp256k1); `CCHAIN_PAYOUT_WALLET_PRIVATE_KEY`
is a dev/local fallback. Enable the path with `CCHAIN_PAYOUT_ENABLED=true`.
Buy recipients **must** be EVM `0x` addresses (X-Chain bech32 is rejected).

### C-Chain Custodial Sell (Avalanche EVM)

The sell side can settle on the Avalanche **C-Chain** with a custodial deposit
address per order (correlation by address, since ERC-20 has no memo):

```
Partner → withdrawal order → provision unique 0x custodial wallet (encrypted key at rest)
   → partner returns the deposit address to the user
   → user funds it with native AVAX and/or native USDT
   → C-Chain Listener polls; confirms deposit (dedupe, confirmations)
   → sweep to Master Wallet:
       USDT  = EIP-712 Permit + transferFrom (Master pays AVAX gas)
       AVAX  = self-funded native transfer (gas deducted from user balance)
   → order correlated by address → PROCESSING → COMPLETED (idempotent)
   → signed callback + OrderPaid event
```

All C-Chain transactions use **EIP-1559** gas (`maxFeePerGas` + `maxPriorityFeePerGas`).

## 📡 API Overview

| Prefix | Purpose | Auth |
|---|---|---|
| `/api/orders` | Deposit / withdrawal / status / cancel | Partner-App-Key |
| `/api/rate` | Live buy & sell rates | Partner-App-Key |
| `/api/users` | KYC + payment methods | Partner-App-Key |
| `/api/webhooks` | SePay, SePay IPN, C-Chain incoming | API key / signature |
| `/config` | Fee & spread config | JWT (write) |
| `/admin` | Login, stats, secret rotation | JWT |
| `/cms` | Admin management, orders, partners | JWT |
| `/landing` | Public rates & history | None |

Full request/response examples live in [`docs/API_INTEGRATION.md`](docs/API_INTEGRATION.md). Interactive docs at `/docs` (Swagger UI).

## 🧭 Order Lifecycle

| State | Code | Meaning |
|---|---|---|
| CREATED | 1 | Awaiting payment |
| PROCESSING | 2 | Payment confirmed, processing |
| COMPLETED | 3 | Finished successfully |
| FAILED | 4 | Failed |
| CANCELLED | 5 | Cancelled |

```
CREATED → PROCESSING → COMPLETED
CREATED → PROCESSING → FAILED
CREATED → CANCELLED
PROCESSING → CANCELLED   (only if no irreversible step)
```

## 🔐 Authentication

| Direction | Method |
|---|---|
| Client → Service (orders) | `Partner-App-Key` header |
| Provider → Service (webhooks) | SePay API key / C-Chain bearer / HMAC signature |
| Service → Client (callbacks) | HMAC-SHA256 (`X-Timestamp` + `X-Signature`) |

## 🐳 Docker

Multi-stage `Dockerfile` (builder → production) plus compose files:

```bash
docker compose up -d --build
```

- `avaramp-api` — Fastify API (healthchecked at `/health`)
- `cchain-listener` — C-Chain deposit monitor (Kafka or HTTP fallback)

Migrations run in-process on startup, so production needs no `tsx`. Secrets are injected via `.env`.

## 📁 Project Structure

```
avaramp/
├── src/
│   ├── server.ts               # Entry point
│   ├── app.ts                  # Fastify factory + route registration
│   ├── controllers/            # Request handlers
│   ├── services/               # Business logic (order, price, callback, cchain…)
│   ├── routes/                 # Route + JSON Schema definitions
│   ├── middleware/             # Auth + error handling
│   ├── workers/disburseWorker.ts # Kafka disbursement consumer
│   ├── migrations/             # Knex schema migrations
│   └── db.ts                   # Shared Knex singleton
├── cchain-listener/            # C-Chain incoming-deposit monitor
├── docs/API_INTEGRATION.md     # Full API reference for partners
└── dist/                       # Compiled output (build)
```

## 🤝 Contributing

Contributions welcome!

1. Fork the repo
2. Create your feature branch
3. Commit and push
4. Open a pull request

## 📄 License

MIT License — see [LICENSE](LICENSE). © 2026 Orbit Labs
