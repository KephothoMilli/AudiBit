# AudiBit 🎯

> **AI-powered web auditing, paid per query in USDC on Arc.**

AudiBit is a Chrome extension that sends specialized AI agents to audit any website you're browsing — checking visual design, accessibility, DOM structure, and security vulnerabilities — and settles each query as a real USDC nanopayment on the Arc L1 blockchain. No subscriptions. No flat fees. You pay exactly for what you use, down to fractions of a cent.

---

## What it actually does

You open a website, click an agent, and within 20–30 seconds you get a structured report of everything wrong with that page. The moment the AI finishes, a tiny USDC payment settles on-chain from your wallet to the agent's wallet. Every audit is a real blockchain transaction you can verify on the Arc Testnet Explorer.

There are four agents, each with a different specialty and price:

| Agent                 | What it looks for                                                           | Price      |
| --------------------- | --------------------------------------------------------------------------- | ---------- |
| 🎨 **UI Agent**       | Color consistency, typography, spacing, visual hierarchy                    | 0.005 USDC |
| 🧠 **UX Agent**       | Accessibility (WCAG), navigation flow, touch targets, screen reader support | 0.008 USDC |
| 🏗️ **DOM Agent**      | Semantic HTML, performance anti-patterns, broken structure                  | 0.003 USDC |
| 🛡️ **Security Agent** | XSS vectors, header misconfigurations, outdated libraries                   | 0.012 USDC |

You can also talk to the page using **Wand** — a voice-first assistant that lets you point at elements and ask questions out loud. "What is this?", "click this", "zoom in here" — it understands both your voice and where your cursor is pointing.

---

## The payment model

This is the part that makes AudiBit different from every other audit tool.

Before any AI work starts, the extension checks your USDC balance on Arc Testnet. If you have enough, it charges you first, then runs the audit. If you don't have enough, it tells you exactly how much you're short and cancels — no partial charges, no surprises.

If your USDC is on a different chain (Ethereum Sepolia, Solana Devnet), the system automatically bridges it to Arc using Circle's CCTP protocol before charging. You don't have to think about which chain your money is on.

Every payment is recorded in Firestore and cached locally in the extension. When you reopen AudiBit after closing it, your full history — every audit, every settlement, every on-chain transaction hash — is right there waiting for you.

---

## Architecture

```
Chrome Extension (React + TypeScript)
    │
    ├── Popup UI          — wallet, balance, agent cards, logs, settlements
    ├── Content Script    — DOM extraction, Wand overlay, audit mode
    ├── Service Worker    — message routing, API calls, local cache
    └── Wand Overlay      — voice recognition, cursor tracking, visual feedback
         │
         ▼
Firebase Cloud Functions (TypeScript, Node 22)
    │
    ├── Nanopayment Engine   — balance check → bridge if needed → charge → receipt
    ├── Agentic System       — coordinator dispatches to specialized agents in parallel
    ├── Audit Functions      — UI / UX / DOM / Security agents (Gemini 2.0 Flash)
    ├── Wand Agent           — voice + vision + cursor multimodal processing
    ├── Bridge Functions     — Circle App Kit CCTP cross-chain transfers
    └── Circle Wallet Fns    — wallet creation, balance, transactions, payment logs
         │
         ▼
External Services
    ├── Arc Testnet          — L1 blockchain, USDC as gas, sub-second finality
    ├── Circle API           — developer-controlled wallets, USDC transfers
    ├── Circle CCTP          — cross-chain USDC bridging
    ├── Gemini 2.0 Flash     — AI model for all agents
    └── Firestore            — audit history, payment logs, wallet state
```

---

## Project structure

```
AudiBit/
├── extension/                    # Chrome extension
│   ├── src/
│   │   ├── popup/
│   │   │   ├── Popup.tsx         # Main UI — dashboard, logs, settlements
│   │   │   └── SplashScreen.tsx  # Startup animation
│   │   ├── content/
│   │   │   ├── content-script.ts # DOM extraction, message handling
│   │   │   ├── wand-overlay.ts   # Voice + cursor UI layer
│   │   │   └── audit-wand-integration.ts  # Voice-guided auditing
│   │   ├── background/
│   │   │   └── service-worker.ts # Audit orchestration, cache management
│   │   ├── components/
│   │   │   ├── PaymentLog.tsx    # Settlement history component
│   │   │   └── AgentStatusPanel.tsx  # Live audit progress
│   │   ├── lib/
│   │   │   └── circle-wallet.ts  # Wallet helpers, balance, bridge calls
│   │   └── types/index.ts        # Shared TypeScript types
│   ├── package.json
│   └── vite.config.ts
│
├── functions/                    # Firebase Cloud Functions
│   ├── src/
│   │   ├── index.ts              # Entry point, exports all functions
│   │   ├── audit-functions.ts    # auditUI, auditUX, auditDOM, auditSecurity
│   │   ├── agentic-system.ts     # Multi-agent coordinator (ADK pattern)
│   │   ├── circle-wallet-functions.ts  # Wallet CRUD, balance, settlements
│   │   ├── wand-agent.ts         # Voice assistant backend
│   │   ├── bridge-functions.ts   # Cross-chain USDC bridging
│   │   ├── nanopayment-functions.ts    # Quote endpoints
│   │   ├── wallet-import-functions.ts  # BYOW — import existing wallets
│   │   └── lib/
│   │       ├── nanopayment-engine.ts   # Core payment gate
│   │       ├── balance-checker.ts      # Pre-flight checks + auto-bridge
│   │       ├── bridge-manager.ts       # Circle App Kit wrapper
│   │       └── metering.ts             # Compute unit pricing
│   ├── package.json
│   └── tsconfig.json
│
├── .firebaserc
├── firebase.json
└── README.md
```

---

## Getting started

### What you need

- **Node.js 22** — the functions run on Node 22
- **Firebase CLI** — `npm install -g firebase-tools`
- **Google Chrome** — to load the extension
- **Circle Developer Account** — [console.circle.com](https://console.circle.com) — free to sign up, get your API key and entity secret
- **Gemini API Key** — [ai.google.dev](https://ai.google.dev) — free tier works fine for testing

### 1. Clone and install

```bash
git clone <repo-url>
cd AudiBit

# Install function dependencies
cd functions && npm install && cd ..

# Install extension dependencies
cd extension && npm install && cd ..
```

### 2. Configure environment

Create `functions/.env` with your credentials:

```env
# Gemini AI
GEMINI_API_KEY=your_gemini_api_key

# Circle API (from console.circle.com)
CIRCLE_API_KEY=TEST_API_KEY:your_key_here
CIRCLE_ENTITY_SECRET=your_64_char_entity_secret
CIRCLE_WALLET_SET_ID=your_wallet_set_id

# Platform wallet (receives agent fees)
PLATFORM_WALLET_ADDRESS=0x...your_arc_wallet_address

# Optional: separate wallets per agent
# AGENT_WALLET_UI=0x...
# AGENT_WALLET_UX=0x...
# AGENT_WALLET_DOM=0x...
# AGENT_WALLET_SECURITY=0x...
```

### 3. Build

```bash
# Build the backend
cd functions && npm run build && cd ..

# Build the extension
cd extension && npm run build && cd ..
```

### 4. Start the local backend

```bash
firebase emulators:start --only functions,firestore
```

The functions will be available at `http://127.0.0.1:5001/your-project-id/us-central1/`.

### 5. Load the extension in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Turn on **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `extension/dist/` folder
5. The AudiBit icon appears in your toolbar

### 6. Connect a wallet

1. Click the AudiBit icon
2. Click **Connect Arc Wallet** — this creates a Circle developer-controlled wallet on Arc Testnet
3. Copy your wallet address
4. Go to [faucet.circle.com](https://faucet.circle.com), select **Arc Testnet**, paste your address, and request USDC
5. Wait ~15 seconds, then click the refresh button (🔄) in the popup — your balance should appear

You're ready to run audits.

---

## Running an audit

1. Navigate to any website in Chrome
2. Click the AudiBit extension icon
3. On the Overview tab, click one of the four agent cards
4. A payment confirmation modal appears showing the exact cost and your current balance
5. If you have enough USDC, click **Pay & Run** — the audit starts immediately
6. Watch the live status panel at the bottom as the agent works
7. When it finishes, go to the **Logs** tab to see the full report

Each issue in the report is expandable — click it to see the description and a specific recommendation for fixing it. Issues are grouped by which agent found them.

---

## Checking your settlements

The **Settlements** tab shows every USDC payment that has settled on Arc. Click any row to expand it and see:

- The Circle transaction ID
- The on-chain transaction hash (once confirmed)
- Exact amount in USDC and compute units
- Timestamp
- A direct link to the **Arc Testnet Explorer** to verify the transaction on-chain

All of this persists locally — close the extension, reopen it, and everything is still there. The extension caches your audit history and settlement records in `chrome.storage.local` so you never lose them between sessions.

---

## Bring Your Own Wallet (BYOW)

If you already have a Circle developer-controlled wallet on Arc Testnet, you can import it instead of creating a new one:

1. Click your wallet address at the bottom of the popup
2. Click **Import Existing Wallet**
3. Either paste the address manually or select from the list of wallets in your Circle account
4. Click **Verify**, then **Import**

The wallet must be on Arc Testnet or Arc Mainnet and must belong to the same Circle API credentials configured in your backend.

---

## Wand — voice-first browser assistant

Wand is a separate mode that turns your voice and cursor into a browser control interface. Press `Ctrl+Space` (or `Cmd+Space` on Mac) to activate it, then point at anything on screen and speak naturally:

- **"What is this?"** — takes a screenshot, analyzes what's at your cursor, explains it
- **"Play this"** — clicks whatever you're pointing at
- **"Search for hiking boots"** — navigates to a shopping site with that query
- **"Zoom in here"** — scrolls at your cursor position
- **"Who invented this?"** — searches and answers without touching the browser

When you're in an active audit, Wand becomes audit-aware. Point at any element and say **"inspect this"**, **"check contrast"**, or **"suggest improvements"** — the relevant agent analyzes that specific element and speaks the result back to you.

---

## How the payment gate works

Every agent call goes through the same gate before any AI work runs:

```
1. Resolve wallet from Firestore (auto-sync from Circle API if missing)
2. Check USDC balance ≥ agent price + 0.001 USDC gas buffer
3. If wallet is on wrong chain → bridge via Circle CCTP to Arc Testnet
4. If balance still insufficient → return structured rejection, cancel query
5. Execute Circle createTransaction: user wallet → agent wallet
6. Poll for on-chain txHash (Arc finalizes in < 1 second)
7. Write payment_log to Firestore with txHash
8. Return receipt → agent query proceeds
```

If step 4 triggers, you see a clear error in the popup with the exact shortfall and a link to the faucet. Nothing runs, nothing is charged.

---

## Agent pricing

| Agent           | USDC  | Compute Units |
| --------------- | ----- | ------------- |
| UI              | 0.005 | 5 CU          |
| UX              | 0.008 | 8 CU          |
| DOM             | 0.003 | 3 CU          |
| Security        | 0.012 | 12 CU         |
| Wand query      | 0.002 | 2 CU          |
| Coordinator fee | 0.001 | 1 CU          |

1 Compute Unit = 0.001 USDC. The coordinator fee applies when using the full agentic system (which runs multiple agents in parallel and uses an LLM to decide which ones to invoke).

---

## Local development tips

**Watching function logs:**

```bash
firebase functions:log
```

**Rebuilding after changes:**

```bash
# Functions
cd functions && npm run build

# Extension (then reload in chrome://extensions)
cd extension && npm run build
```

**Checking the Firestore emulator:**
Open `http://localhost:4000` while the emulator is running. You can browse `wallets`, `payment_logs`, `audits`, and `agent_sessions` collections directly.

**The extension doesn't need a rebuild to pick up function changes** — the service worker calls the emulator URL at runtime. You only need to rebuild the extension when you change extension source files.

---

## Deploying to production

```bash
# Deploy functions
cd functions
npm run build
firebase deploy --only functions

# The extension is distributed as a Chrome Web Store package
# Build it first:
cd extension
npm run build
# Then zip the dist/ folder and upload to the Chrome Web Store
```

**Before going to mainnet:**

- Switch `ARC-TESTNET` to `ARC-MAINNET` in the wallet creation flow
- Update `CIRCLE_API_KEY` to a production key (remove the `TEST_API_KEY:` prefix)
- Set up Firebase security rules to restrict Firestore access
- Configure separate agent wallet addresses per agent type
- Enable Firestore backups

---

## Tech stack

| Layer        | Technology                                       |
| ------------ | ------------------------------------------------ |
| Extension UI | React 19, TypeScript, Vite, Chrome MV3           |
| Backend      | Firebase Cloud Functions, Node 22, TypeScript    |
| AI           | Gemini 2.0 Flash (Google Generative AI SDK)      |
| Blockchain   | Arc Testnet (EVM-compatible L1, USDC as gas)     |
| Payments     | Circle Developer-Controlled Wallets, Circle CCTP |
| Database     | Firestore                                        |
| Voice        | Web Speech API, Speech Synthesis API             |

---

## Known limitations (testnet)

- **Arc Testnet only** — mainnet support requires updating the blockchain config and Circle API keys
- **Faucet rate limits** — Circle's testnet faucet allows one request per 24 hours per address
- **Bridge time** — cross-chain USDC bridging via CCTP takes 10–30 seconds; the extension waits automatically
- **txHash availability** — on-chain hashes appear after Arc confirms the transaction (usually < 2 seconds); older payment records created before this update won't have a txHash and will show "pending confirmation" in the explorer link

---

## License

Apache 2.0

---

_Built on Arc and Circle infrastructure. USDC payments settle on-chain. Every audit is a real transaction._
