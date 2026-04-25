/**
 * AudiBit Nanopayment Engine
 *
 * Implements Circle Gateway Nanopayments on Arc for per-query agent billing.
 *
 * Architecture (from goal.txt + circle_llms.txt + arc_llms.txt):
 *  - Arc is the settlement layer: USDC is the native gas token, sub-second finality
 *  - Circle Gateway enables gasless nanopayments down to $0.000001
 *  - Each agent query triggers a USDC micropayment to the agent's wallet
 *  - If user wallet is on a different chain, bridge via Circle CCTP before settling
 *  - If balance is insufficient, cancel the query and notify the user
 *
 * Payment flow per query:
 *  1. Resolve user wallet + agent wallet (both must be on Arc Testnet)
 *  2. Check USDC balance ≥ query price + gas buffer
 *  3. If balance low → reject with structured error (no query runs)
 *  4. If different chain → bridge USDC to Arc via Circle App Kit CCTP
 *  5. Execute nanopayment: user wallet → agent wallet (Circle createTransaction)
 *  6. Record payment log in Firestore
 *  7. Return payment receipt to caller → caller proceeds with agent query
 */

import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import { FieldValue } from "firebase-admin/firestore";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

// AppKit and adapter are lazy-loaded inside bridgeUSDC to avoid slow startup

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum USDC buffer kept in wallet to cover Arc gas (USDC is gas on Arc) */
const GAS_BUFFER_USDC = 0.001;

/** Agent wallet addresses — each agent has its own on-chain identity on Arc */
export const AGENT_WALLETS: Record<string, string> = {
  ui: process.env.AGENT_WALLET_UI || process.env.PLATFORM_WALLET_ADDRESS || "",
  ux: process.env.AGENT_WALLET_UX || process.env.PLATFORM_WALLET_ADDRESS || "",
  dom:
    process.env.AGENT_WALLET_DOM || process.env.PLATFORM_WALLET_ADDRESS || "",
  security:
    process.env.AGENT_WALLET_SECURITY ||
    process.env.PLATFORM_WALLET_ADDRESS ||
    "",
  wand:
    process.env.AGENT_WALLET_WAND || process.env.PLATFORM_WALLET_ADDRESS || "",
};

/** Per-agent query prices in USDC (nanopayment amounts) */
export const AGENT_PRICES: Record<string, number> = {
  ui: 0.005, // UI visual audit
  ux: 0.008, // UX / accessibility audit
  dom: 0.003, // DOM structure audit
  security: 0.012, // Security vulnerability scan
  wand: 0.002, // Wand voice query
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PaymentQuote {
  agentType: string;
  priceUsdc: number;
  gasBuffer: number;
  totalRequired: number;
  agentWallet: string;
  userWallet: string;
  userBalance: number;
  canProceed: boolean;
  needsBridge: boolean;
  sourceChain?: string;
}

export interface PaymentReceipt {
  success: true;
  transactionId: string;
  agentType: string;
  amountUsdc: string;
  fromWallet: string;
  toWallet: string;
  chain: string;
  timestamp: number;
}

export interface PaymentRejection {
  success: false;
  reason:
    | "insufficient_balance"
    | "wallet_not_found"
    | "bridge_failed"
    | "payment_failed";
  agentType: string;
  required: number;
  available: number;
  shortfall: number;
  userMessage: string;
  faucetUrl: string;
}

export type PaymentResult = PaymentReceipt | PaymentRejection;

// ─── Circle client helpers ────────────────────────────────────────────────────

function getCircleClient() {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey || !entitySecret)
    throw new Error("Circle API credentials not configured");
  return initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
}

function getAppKit() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { AppKit } = require("@circle-fin/app-kit");
  return new AppKit();
}

function getCircleWalletsAdapter() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {
    createCircleWalletsAdapter,
  } = require("@circle-fin/adapter-circle-wallets");
  const apiKey = process.env.CIRCLE_API_KEY!;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET!;
  return createCircleWalletsAdapter({ apiKey, entitySecret });
}

// ─── Core helpers ─────────────────────────────────────────────────────────────

/**
 * Resolve wallet data from Firestore, auto-syncing from Circle API if missing.
 */
async function resolveWallet(walletAddress: string): Promise<{
  id: string;
  address: string;
  blockchain: string;
  state: string;
} | null> {
  const db = admin.firestore();
  let doc = await db.collection("wallets").doc(walletAddress).get();

  if (!doc.exists) {
    // Auto-sync from Circle API
    const client = getCircleClient();
    const resp = await client.listWallets({ pageSize: 50 });
    const match = resp.data?.wallets?.find(
      (w) => w.address?.toLowerCase() === walletAddress.toLowerCase(),
    );
    if (!match) return null;

    await db.collection("wallets").doc(walletAddress).set({
      id: match.id,
      address: match.address,
      blockchain: match.blockchain,
      state: match.state,
      createdAt: FieldValue.serverTimestamp(),
      credits: 0,
      lastActive: FieldValue.serverTimestamp(),
    });
    doc = await db.collection("wallets").doc(walletAddress).get();
  }

  const data = doc.data()!;
  return {
    id: data.id,
    address: data.address,
    blockchain: data.blockchain,
    state: data.state,
  };
}

/**
 * Get USDC balance and token ID for a wallet.
 * Returns { balance, tokenId } — tokenId is the Circle UUID needed for createTransaction.
 */
async function getUsdcBalance(
  walletId: string,
): Promise<{ balance: number; tokenId: string | null }> {
  const client = getCircleClient();
  const resp = await client.getWalletTokenBalance({ id: walletId });
  const balances = resp.data?.tokenBalances || [];

  const usdc = balances.find(
    (b: any) =>
      b.token?.symbol === "USDC" ||
      b.token?.name?.toLowerCase().includes("usdc"),
  );

  return {
    balance: parseFloat(usdc?.amount || "0"),
    tokenId: usdc?.token?.id || null,
  };
}

/**
 * Bridge USDC from source chain to Arc Testnet using Circle App Kit (CCTP).
 * Only called when user wallet is NOT on Arc Testnet.
 */
async function bridgeToArc(
  walletAddress: string,
  amount: number,
  sourceChain: "Ethereum_Sepolia" | "Solana_Devnet",
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    functions.logger.info(
      `🌉 Bridging ${amount} USDC from ${sourceChain} → Arc_Testnet for ${walletAddress}`,
    );

    const kit = getAppKit();
    const adapter = getCircleWalletsAdapter();

    const result = await kit.bridge({
      from: { adapter, chain: sourceChain, address: walletAddress },
      to: { adapter, chain: "Arc_Testnet", address: walletAddress },
      amount: amount.toFixed(6),
    });

    const lastStep = result.steps?.[result.steps.length - 1];
    functions.logger.info(`✅ Bridge complete: ${lastStep?.txHash}`);

    return { success: true, txHash: lastStep?.txHash };
  } catch (err: any) {
    functions.logger.error("❌ Bridge failed:", err.message);
    return { success: false, error: err.message };
  }
}

// ─── Main payment gate ────────────────────────────────────────────────────────

/**
 * chargeAgent — the single entry point for all agent nanopayments.
 *
 * Call this BEFORE running any agent query. It will:
 *  - Check balance
 *  - Bridge if needed
 *  - Execute the nanopayment
 *  - Return a receipt (proceed) or rejection (cancel query)
 */
export async function chargeAgent(
  userWalletAddress: string,
  agentType: keyof typeof AGENT_PRICES,
): Promise<PaymentResult> {
  const db = admin.firestore();
  const priceUsdc = AGENT_PRICES[agentType] ?? 0.005;
  const agentWallet = AGENT_WALLETS[agentType];
  const totalRequired = priceUsdc + GAS_BUFFER_USDC;

  const faucetUrl = `https://faucet.circle.com?address=${userWalletAddress}`;

  // ── 1. Resolve user wallet ──────────────────────────────────────────────────
  const wallet = await resolveWallet(userWalletAddress);

  if (!wallet) {
    return {
      success: false,
      reason: "wallet_not_found",
      agentType,
      required: totalRequired,
      available: 0,
      shortfall: totalRequired,
      userMessage:
        "Wallet not found. Please connect your Arc wallet in the extension.",
      faucetUrl,
    };
  }

  if (wallet.state !== "LIVE") {
    return {
      success: false,
      reason: "wallet_not_found",
      agentType,
      required: totalRequired,
      available: 0,
      shortfall: totalRequired,
      userMessage: `Wallet is not active (state: ${wallet.state}). Please contact support.`,
      faucetUrl,
    };
  }

  // ── 2. Check balance ────────────────────────────────────────────────────────
  const { balance, tokenId } = await getUsdcBalance(wallet.id);

  functions.logger.info(
    `💳 ${agentType.toUpperCase()} query — wallet: ${userWalletAddress} | balance: ${balance} USDC | required: ${totalRequired} USDC`,
  );

  // ── 3. Bridge if on wrong chain ─────────────────────────────────────────────
  let effectiveBalance = balance;
  let effectiveTokenId = tokenId;

  if (
    wallet.blockchain !== "ARC-TESTNET" &&
    wallet.blockchain !== "ARC-MAINNET"
  ) {
    functions.logger.warn(
      `⚠️  Wallet on ${wallet.blockchain}, not Arc. Attempting bridge...`,
    );

    if (balance < totalRequired) {
      // Not enough even to bridge
      return buildInsufficientError(
        agentType,
        totalRequired,
        balance,
        userWalletAddress,
        faucetUrl,
      );
    }

    const sourceChain = wallet.blockchain.includes("SOL")
      ? "Solana_Devnet"
      : "Ethereum_Sepolia";
    const bridgeResult = await bridgeToArc(
      userWalletAddress,
      priceUsdc + 0.01,
      sourceChain,
    );

    if (!bridgeResult.success) {
      return {
        success: false,
        reason: "bridge_failed",
        agentType,
        required: totalRequired,
        available: balance,
        shortfall: 0,
        userMessage: `Could not bridge USDC to Arc Testnet: ${bridgeResult.error}. Please add USDC directly on Arc Testnet.`,
        faucetUrl,
      };
    }

    // Wait for bridge to settle (Arc has sub-second finality, but CCTP needs ~20s)
    await new Promise((r) => setTimeout(r, 20_000));

    // Re-check balance on Arc after bridge
    const afterBridge = await getUsdcBalance(wallet.id);
    effectiveBalance = afterBridge.balance;
    effectiveTokenId = afterBridge.tokenId;
  }

  // ── 4. Final balance gate ───────────────────────────────────────────────────
  if (effectiveBalance < totalRequired) {
    return buildInsufficientError(
      agentType,
      totalRequired,
      effectiveBalance,
      userWalletAddress,
      faucetUrl,
    );
  }

  if (!effectiveTokenId) {
    return {
      success: false,
      reason: "insufficient_balance",
      agentType,
      required: totalRequired,
      available: 0,
      shortfall: totalRequired,
      userMessage:
        "USDC not found in your wallet. Please add USDC on Arc Testnet via the faucet.",
      faucetUrl,
    };
  }

  // ── 5. Execute nanopayment ──────────────────────────────────────────────────
  try {
    const client = getCircleClient();

    functions.logger.info(
      `⚡ Nanopayment: ${priceUsdc} USDC | ${userWalletAddress} → ${agentWallet} | agent: ${agentType}`,
    );

    const txResp = await client.createTransaction({
      walletId: wallet.id,
      destinationAddress: agentWallet,
      amounts: [priceUsdc.toFixed(6)],
      tokenId: effectiveTokenId,
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    } as any);

    const txId = txResp.data?.id;
    if (!txId) throw new Error("No transaction ID returned from Circle API");

    // Poll for on-chain txHash (Arc sub-second finality — usually ready in 1-2 polls)
    const terminalStates = new Set([
      "COMPLETE",
      "FAILED",
      "CANCELLED",
      "DENIED",
    ]);
    let txState = txResp.data?.state as string | undefined;
    let txHash: string | undefined;

    for (let i = 0; i < 6 && txState && !terminalStates.has(txState); i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const poll = await client.getTransaction({ id: txId });
      const tx = poll.data?.transaction;
      txState = tx?.state;
      txHash = tx?.txHash ?? undefined;
      functions.logger.info(
        `Nanopayment poll ${i + 1}: state=${txState} txHash=${txHash}`,
      );
    }

    // ── 6. Record payment log ─────────────────────────────────────────────────
    await db.collection("payment_logs").add({
      walletAddress: userWalletAddress,
      agentWallet,
      agentType,
      amount: priceUsdc.toFixed(6),
      computeUnits: Math.round(priceUsdc * 1000),
      description: `${agentType.toUpperCase()} Agent query`,
      transactionId: txId,
      txHash: txHash || null,
      chain: wallet.blockchain,
      status: txState === "COMPLETE" ? "confirmed" : "pending",
      createdAt: FieldValue.serverTimestamp(),
    });

    // Update wallet last-active
    await db.collection("wallets").doc(userWalletAddress).update({
      lastActive: FieldValue.serverTimestamp(),
    });

    functions.logger.info(`✅ Nanopayment confirmed: ${txId}`);

    return {
      success: true,
      transactionId: txId,
      agentType,
      amountUsdc: priceUsdc.toFixed(6),
      fromWallet: userWalletAddress,
      toWallet: agentWallet,
      chain: wallet.blockchain,
      timestamp: Date.now(),
    };
  } catch (err: any) {
    functions.logger.error("❌ Nanopayment failed:", err.message);
    return {
      success: false,
      reason: "payment_failed",
      agentType,
      required: totalRequired,
      available: effectiveBalance,
      shortfall: 0,
      userMessage: `Payment failed: ${err.message}. Please try again.`,
      faucetUrl,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildInsufficientError(
  agentType: string,
  required: number,
  available: number,
  walletAddress: string,
  faucetUrl: string,
): PaymentRejection {
  const shortfall = Math.max(0, required - available);
  return {
    success: false,
    reason: "insufficient_balance",
    agentType,
    required,
    available,
    shortfall,
    userMessage:
      `Insufficient USDC balance for ${agentType.toUpperCase()} Agent.\n` +
      `Required: ${required.toFixed(6)} USDC\n` +
      `Available: ${available.toFixed(6)} USDC\n` +
      `Shortfall: ${shortfall.toFixed(6)} USDC\n\n` +
      `Top up at: https://faucet.circle.com\n` +
      `Your wallet: ${walletAddress}`,
    faucetUrl,
  };
}

/**
 * getPaymentQuote — preview cost before committing (used by the popup UI).
 */
export async function getPaymentQuote(
  userWalletAddress: string,
  agentType: string,
): Promise<PaymentQuote> {
  const priceUsdc = AGENT_PRICES[agentType] ?? 0.005;
  const agentWallet = AGENT_WALLETS[agentType] || "";
  const totalRequired = priceUsdc + GAS_BUFFER_USDC;

  const wallet = await resolveWallet(userWalletAddress);
  if (!wallet) {
    return {
      agentType,
      priceUsdc,
      gasBuffer: GAS_BUFFER_USDC,
      totalRequired,
      agentWallet,
      userWallet: userWalletAddress,
      userBalance: 0,
      canProceed: false,
      needsBridge: false,
    };
  }

  const { balance } = await getUsdcBalance(wallet.id);
  const onArc =
    wallet.blockchain === "ARC-TESTNET" || wallet.blockchain === "ARC-MAINNET";

  return {
    agentType,
    priceUsdc,
    gasBuffer: GAS_BUFFER_USDC,
    totalRequired,
    agentWallet,
    userWallet: userWalletAddress,
    userBalance: balance,
    canProceed: balance >= totalRequired,
    needsBridge: !onArc,
    sourceChain: onArc ? undefined : wallet.blockchain,
  };
}
