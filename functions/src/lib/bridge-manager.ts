/**
 * Bridge Manager - Handles cross-chain USDC bridging
 *
 * Uses Circle App Kit to bridge USDC from Ethereum Sepolia to Arc Testnet
 * when users have funds on the wrong chain.
 */

import * as functions from "firebase-functions";

// AppKit and adapter are lazy-loaded inside bridgeUSDC to avoid slow module startup

// Initialize App Kit lazily
function getKit() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { AppKit } = require("@circle-fin/app-kit");
  return new AppKit();
}

export interface BridgeRequest {
  fromChain: "Ethereum_Sepolia" | "Solana_Devnet";
  toChain: "Arc_Testnet";
  amount: string;
  walletAddress: string;
}

export interface BridgeResult {
  success: boolean;
  transactionHash?: string;
  explorerUrl?: string;
  steps?: Array<{
    name: string;
    state: string;
    txHash?: string;
    explorerUrl?: string;
  }>;
  error?: string;
}

/**
 * Bridge USDC from one chain to another using Circle Wallets
 */
export async function bridgeUSDC(
  request: BridgeRequest,
): Promise<BridgeResult> {
  try {
    const apiKey = process.env.CIRCLE_API_KEY;
    const entitySecret = process.env.CIRCLE_ENTITY_SECRET;

    if (!apiKey || !entitySecret) {
      throw new Error("Circle API credentials not configured");
    }

    functions.logger.info(
      `🌉 Starting bridge: ${request.amount} USDC from ${request.fromChain} to ${request.toChain}`,
    );

    // Lazy-load heavy packages
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {
      createCircleWalletsAdapter,
    } = require("@circle-fin/adapter-circle-wallets");
    const kit = getKit();

    // Create Circle Wallets adapter
    const adapter = createCircleWalletsAdapter({
      apiKey,
      entitySecret,
    });

    // Execute bridge transaction
    const result = await kit.bridge({
      from: {
        adapter,
        chain: request.fromChain,
        address: request.walletAddress,
      },
      to: {
        adapter,
        chain: request.toChain,
        address: request.walletAddress, // Same wallet address on both chains
      },
      amount: request.amount,
    });

    functions.logger.info("✅ Bridge completed successfully:", result);

    // Extract transaction details
    const steps = result.steps?.map((step: any) => ({
      name: step.name,
      state: step.state,
      txHash: step.txHash,
      explorerUrl: step.data?.explorerUrl || "",
    }));

    const lastStep = result.steps?.[result.steps.length - 1];

    return {
      success: true,
      transactionHash: lastStep?.txHash || "",
      explorerUrl: (lastStep?.data as any)?.explorerUrl || "",
      steps,
    };
  } catch (error: any) {
    functions.logger.error("❌ Bridge failed:", error);

    return {
      success: false,
      error: error.message || "Bridge transaction failed",
    };
  }
}

/**
 * Check if wallet has USDC on multiple chains and suggest bridging
 */
export async function checkCrossChainBalance(
  walletAddress: string,
  getCircleClient: () => any,
): Promise<{
  hasArcBalance: boolean;
  hasEthereumBalance: boolean;
  hasSolanaBalance: boolean;
  arcBalance: string;
  ethereumBalance: string;
  solanaBalance: string;
  suggestBridge: boolean;
  bridgeRecommendation?: {
    fromChain: "Ethereum_Sepolia" | "Solana_Devnet";
    toChain: "Arc_Testnet";
    amount: string;
  };
}> {
  try {
    const client = getCircleClient();

    // 1. List all wallets in the account to find relevant ones
    const walletsResponse = await client.listWallets({ pageSize: 50 });
    const allWallets = walletsResponse.data?.wallets || [];

    // In a production app, we would associate wallets with users.
    // For this demo, we'll look for wallets that might belong to the same user.
    // Usually, users have the same address across EVM chains.

    const arcWallet = allWallets.find(
      (w: any) =>
        w.blockchain?.includes("ARC") &&
        w.address?.toLowerCase() === walletAddress.toLowerCase(),
    );
    const ethWallet = allWallets.find(
      (w: any) => w.blockchain === "ETH-SEPOLIA",
    ); // Simplified: pick first available
    const solWallet = allWallets.find(
      (w: any) => w.blockchain === "SOL-DEVNET",
    );

    const balances = {
      arc: "0",
      eth: "0",
      sol: "0",
    };

    // Helper to get balance
    const getBalance = async (walletId: string) => {
      const resp = await client.getWalletTokenBalance({ id: walletId });
      const usdc = resp.data?.tokenBalances?.find(
        (b: any) =>
          b.token?.symbol === "USDC" ||
          b.token?.name?.toLowerCase().includes("usdc"),
      );
      return usdc?.amount || "0";
    };

    if (arcWallet) balances.arc = await getBalance(arcWallet.id);
    if (ethWallet) balances.eth = await getBalance(ethWallet.id);
    if (solWallet) balances.sol = await getBalance(solWallet.id);

    const arcBalNum = parseFloat(balances.arc);
    const ethBalNum = parseFloat(balances.eth);
    const solBalNum = parseFloat(balances.sol);

    let recommendation: any = undefined;
    if (arcBalNum < 0.05) {
      // Threshold for bridging
      if (ethBalNum > solBalNum && ethBalNum > 0.1) {
        recommendation = {
          fromChain: "Ethereum_Sepolia",
          toChain: "Arc_Testnet",
          amount: "1.0",
        };
      } else if (solBalNum > 0.1) {
        recommendation = {
          fromChain: "Solana_Devnet",
          toChain: "Arc_Testnet",
          amount: "1.0",
        };
      }
    }

    return {
      hasArcBalance: arcBalNum > 0,
      hasEthereumBalance: ethBalNum > 0,
      hasSolanaBalance: solBalNum > 0,
      arcBalance: balances.arc,
      ethereumBalance: balances.eth,
      solanaBalance: balances.sol,
      suggestBridge: !!recommendation,
      bridgeRecommendation: recommendation,
    };
  } catch (error) {
    functions.logger.error("Error checking cross-chain balances:", error);
    return {
      hasArcBalance: false,
      hasEthereumBalance: false,
      hasSolanaBalance: false,
      arcBalance: "0",
      ethereumBalance: "0",
      solanaBalance: "0",
      suggestBridge: false,
    };
  }
}

/**
 * Estimate bridge time and fees
 */
export function estimateBridge(amount: string): {
  estimatedTime: string;
  estimatedFee: string;
} {
  // Bridge typically takes 10-30 seconds
  // Fees are minimal on testnets
  return {
    estimatedTime: "10-30 seconds",
    estimatedFee: "~0.001 USDC (gas fees)",
  };
}
