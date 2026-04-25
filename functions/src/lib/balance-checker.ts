/**
 * Pre-flight Balance Checker
 *
 * Checks wallet USDC balance and compute credits before running audits.
 * Provides clear feedback and top-up instructions.
 * Supports auto-bridging from Ethereum Sepolia when Arc balance is insufficient.
 */

import * as admin from "firebase-admin";
import { calculateAuditCost, AuditSpecs } from "./metering";
import { bridgeUSDC, checkCrossChainBalance } from "./bridge-manager";

export interface BalanceCheckResult {
  canProceed: boolean;
  usdcBalance: string;
  computeCredits: number;
  requiredUsdc: string;
  requiredCredits: number;
  issues: BalanceIssue[];
  recommendations: string[];
  autoBridgeAttempted?: boolean;
  autoBridgeSuccess?: boolean;
  bridgeTransactionHash?: string;
  crossChain?: any;
}

export interface BalanceIssue {
  type:
    | "insufficient_usdc"
    | "insufficient_credits"
    | "wallet_not_found"
    | "wallet_inactive";
  severity: "critical" | "warning";
  message: string;
  actionRequired: string;
}

const MINIMUM_USDC_BUFFER = 0.01; // Keep at least 0.01 USDC for gas
const MINIMUM_CREDIT_BUFFER = 10; // Warn if credits below 10

/**
 * Comprehensive pre-flight check before audit
 */
export async function checkBalanceBeforeAudit(
  walletAddress: string,
  specs: AuditSpecs,
  getCircleClient: () => any,
): Promise<BalanceCheckResult> {
  const issues: BalanceIssue[] = [];
  const recommendations: string[] = [];

  // Calculate required amounts
  const cost = calculateAuditCost(specs);
  const requiredUsdc = parseFloat(cost.totalUsdc);
  const requiredCredits = cost.computeUnits;

  // Get wallet from Firestore
  const walletDoc = await admin
    .firestore()
    .collection("wallets")
    .doc(walletAddress)
    .get();

  if (!walletDoc.exists) {
    issues.push({
      type: "wallet_not_found",
      severity: "critical",
      message: "Wallet not found in system",
      actionRequired:
        'Create a Circle wallet first by clicking "Connect Arc Wallet" in the extension.',
    });

    return {
      canProceed: false,
      usdcBalance: "0",
      computeCredits: 0,
      requiredUsdc: cost.totalUsdc,
      requiredCredits,
      issues,
      recommendations: ["Create a new wallet to get started"],
    };
  }

  const walletData = walletDoc.data()!;

  // Check wallet state
  if (walletData.state !== "LIVE") {
    issues.push({
      type: "wallet_inactive",
      severity: "critical",
      message: `Wallet is not active. Current state: ${walletData.state}`,
      actionRequired: "Contact support or create a new wallet.",
    });
  }

  // Get USDC balance from Circle
  let usdcBalance = 0;
  try {
    const client = getCircleClient();
    const response = await client.getWalletTokenBalance({ id: walletData.id });
    const balances = response.data?.tokenBalances || [];

    const usdcToken = balances.find(
      (b: any) =>
        b.token?.symbol === "USDC" ||
        b.token?.name?.toLowerCase().includes("usdc"),
    );

    usdcBalance = parseFloat(usdcToken?.amount || "0");
  } catch (error) {
    console.error("Failed to fetch USDC balance:", error);
    issues.push({
      type: "insufficient_usdc",
      severity: "warning",
      message: "Unable to verify USDC balance",
      actionRequired: "Check your internet connection and try again.",
    });
  }

  // Get compute credits from Firestore
  const computeCredits = walletData.credits || 0;

  // Check USDC balance (including buffer for gas)
  const totalUsdcNeeded = requiredUsdc + MINIMUM_USDC_BUFFER;
  if (usdcBalance < totalUsdcNeeded) {
    const shortfall = totalUsdcNeeded - usdcBalance;
    issues.push({
      type: "insufficient_usdc",
      severity: "critical",
      message: `Insufficient USDC balance. Need ${shortfall.toFixed(6)} more USDC.`,
      actionRequired:
        "Add USDC to your wallet via Circle Faucet (testnet) or purchase USDC (mainnet).",
    });

    recommendations.push(
      `Visit https://faucet.circle.com to get testnet USDC`,
      `Enter your wallet address: ${walletAddress}`,
      `Select Arc Testnet and request tokens`,
      `Wait 10-30 seconds for tokens to arrive`,
    );
  } else if (usdcBalance < requiredUsdc + 0.05) {
    // Warn if balance is getting low
    recommendations.push(
      `Your USDC balance is getting low (${usdcBalance.toFixed(6)} USDC)`,
      `Consider adding more USDC to avoid interruptions`,
    );
  }

  // Compute credits are no longer used for enforcement in the Nanopayments model.
  // We keep the value for UI display but don't add issues for it.
  if (computeCredits < MINIMUM_CREDIT_BUFFER) {
    recommendations.push(
      `💡 Note: Using direct USDC settlement via Arc Nanopayments.`,
    );
  }

  // Determine if can proceed
  const canProceed =
    issues.filter((i) => i.severity === "critical").length === 0;

  // Get cross-chain balances if needed
  let crossChain;
  if (usdcBalance < totalUsdcNeeded) {
    try {
      const { checkCrossChainBalance } = require("./bridge-manager");
      crossChain = await checkCrossChainBalance(walletAddress, getCircleClient);
    } catch (e) {
      console.error("Failed to fetch cross-chain balances:", e);
    }
  }

  return {
    canProceed,
    usdcBalance: usdcBalance.toFixed(6),
    computeCredits,
    requiredUsdc: cost.totalUsdc,
    requiredCredits,
    issues,
    recommendations,
    crossChain,
  };
}

/**
 * Quick check if wallet has minimum balance
 */
export async function hasMinimumBalance(
  walletAddress: string,
  getCircleClient: () => any,
): Promise<{ hasBalance: boolean; balance: string }> {
  try {
    const walletDoc = await admin
      .firestore()
      .collection("wallets")
      .doc(walletAddress)
      .get();

    if (!walletDoc.exists) {
      return { hasBalance: false, balance: "0" };
    }

    const walletData = walletDoc.data()!;
    const client = getCircleClient();
    const response = await client.getWalletTokenBalance({ id: walletData.id });
    const balances = response.data?.tokenBalances || [];

    const usdcToken = balances.find(
      (b: any) =>
        b.token?.symbol === "USDC" ||
        b.token?.name?.toLowerCase().includes("usdc"),
    );

    const balance = parseFloat(usdcToken?.amount || "0");

    return {
      hasBalance: balance >= MINIMUM_USDC_BUFFER,
      balance: balance.toFixed(6),
    };
  } catch (error) {
    console.error("Error checking minimum balance:", error);
    return { hasBalance: false, balance: "0" };
  }
}

/**
 * Get current compute credits for a wallet
 */
export async function getComputeCredits(
  walletAddress: string,
): Promise<number> {
  try {
    const walletDoc = await admin
      .firestore()
      .collection("wallets")
      .doc(walletAddress)
      .get();

    if (!walletDoc.exists) {
      return 0;
    }

    return walletDoc.data()!.credits || 0;
  } catch (error) {
    console.error("Error getting compute credits:", error);
    return 0;
  }
}

/**
 * Auto-bridge USDC from Ethereum Sepolia or Solana Devnet to Arc Testnet
 * Called when Arc balance is insufficient but funds exist on other chains
 */
export async function attemptAutoBridge(
  walletAddress: string,
  requiredAmount: string,
  getCircleClient: () => any,
): Promise<{
  success: boolean;
  transactionHash?: string;
  error?: string;
}> {
  try {
    console.log(
      `🌉 Analyzing cross-chain balances for auto-bridge: ${walletAddress}`,
    );

    // 1. Check balances on all chains
    const crossChain = await checkCrossChainBalance(walletAddress, getCircleClient);

    if (!crossChain.suggestBridge || !crossChain.bridgeRecommendation) {
      return {
        success: false,
        error: "Insufficient funds on all available source chains (Ethereum, Solana).",
      };
    }

    const { fromChain, amount } = crossChain.bridgeRecommendation;
    
    console.log(
      `🌉 Triggering bridge: ${amount} USDC from ${fromChain} to Arc Testnet`,
    );

    // Add 10% buffer to the required amount for safety
    const bridgeAmount = (parseFloat(requiredAmount) * 1.1).toFixed(6);

    const result = await bridgeUSDC({
      fromChain: fromChain,
      toChain: "Arc_Testnet",
      amount: bridgeAmount,
      walletAddress,
    });

    if (result.success) {
      console.log(
        `✅ Auto-bridge successful: ${bridgeAmount} USDC bridged from ${fromChain}`,
      );
      return {
        success: true,
        transactionHash: result.transactionHash,
      };
    } else {
      console.error(`❌ Auto-bridge failed: ${result.error}`);
      return {
        success: false,
        error: result.error,
      };
    }
  } catch (error: any) {
    console.error("❌ Auto-bridge error:", error);
    return {
      success: false,
      error: error.message || "Bridge failed",
    };
  }
}

/**
 * Enhanced balance check with auto-bridge support
 */
export async function checkBalanceWithAutoBridge(
  walletAddress: string,
  specs: AuditSpecs,
  getCircleClient: () => any,
  enableAutoBridge: boolean = true,
): Promise<BalanceCheckResult> {
  // First, do normal balance check
  const result = await checkBalanceBeforeAudit(
    walletAddress,
    specs,
    getCircleClient,
  );

  // If insufficient USDC and auto-bridge is enabled, attempt to bridge
  if (
    !result.canProceed &&
    enableAutoBridge &&
    result.issues.some((i) => i.type === "insufficient_usdc")
  ) {
    console.log("💡 Insufficient Arc balance detected, attempting auto-bridge");

    const bridgeResult = await attemptAutoBridge(
      walletAddress,
      result.requiredUsdc,
      getCircleClient
    );

    result.autoBridgeAttempted = true;
    result.autoBridgeSuccess = bridgeResult.success;
    result.bridgeTransactionHash = bridgeResult.transactionHash;

    if (bridgeResult.success) {
      // Wait 5 seconds for bridge to complete
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Re-check balance
      const recheckResult = await checkBalanceBeforeAudit(
        walletAddress,
        specs,
        getCircleClient,
      );

      // Update result with new balance
      result.canProceed = recheckResult.canProceed;
      result.usdcBalance = recheckResult.usdcBalance;
      result.issues = recheckResult.issues;

      if (recheckResult.canProceed) {
        result.recommendations = [
          `✅ Auto-bridge successful! ${result.requiredUsdc} USDC bridged from Ethereum Sepolia`,
          `Transaction: ${bridgeResult.transactionHash}`,
          `You can now proceed with your audit`,
        ];
      }
    } else {
      result.recommendations.push(
        `⚠️ Auto-bridge failed: ${bridgeResult.error}`,
        `Please manually add USDC to Arc Testnet using the faucet`,
        `Visit: https://faucet.circle.com`,
      );
    }
  }

  return result;
}
