/**
 * Bridge Functions - Cloud Functions for cross-chain USDC bridging
 */

import * as functions from "firebase-functions";
import { bridgeUSDC, estimateBridge } from "./lib/bridge-manager";

/**
 * Bridge USDC from Ethereum Sepolia to Arc Testnet
 */
export const bridgeFromEthereum = functions.https.onRequest(
  async (req, res) => {
    // Enable CORS
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, X-Wallet-Address");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    try {
      const walletAddress = req.headers["x-wallet-address"] as string;
      const { amount } = req.body;

      if (!walletAddress || !amount) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }

      functions.logger.info(
        `Bridge request: ${amount} USDC from Ethereum Sepolia to Arc Testnet for ${walletAddress}`,
      );

      // Execute bridge
      const result = await bridgeUSDC({
        fromChain: "Ethereum_Sepolia",
        toChain: "Arc_Testnet",
        amount,
        walletAddress,
      });

      if (!result.success) {
        res.status(500).json({
          error: "Bridge failed",
          message: result.error,
        });
        return;
      }

      res.json({
        success: true,
        transactionHash: result.transactionHash,
        explorerUrl: result.explorerUrl,
        steps: result.steps,
        message: `Successfully bridged ${amount} USDC from Ethereum Sepolia to Arc Testnet`,
      });
    } catch (error: any) {
      functions.logger.error("Error in bridgeFromEthereum:", error);
      res.status(500).json({
        error: "Failed to bridge tokens",
        message: error.message,
      });
    }
  },
);

/**
 * Bridge USDC from Solana Devnet to Arc Testnet
 */
export const bridgeFromSolana = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, X-Wallet-Address");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const walletAddress = req.headers["x-wallet-address"] as string;
    const { amount } = req.body;

    if (!walletAddress || !amount) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    functions.logger.info(
      `Bridge request: ${amount} USDC from Solana Devnet to Arc Testnet for ${walletAddress}`,
    );

    // Execute bridge
    const result = await bridgeUSDC({
      fromChain: "Solana_Devnet",
      toChain: "Arc_Testnet",
      amount,
      walletAddress,
    });

    if (!result.success) {
      res.status(500).json({
        error: "Bridge failed",
        message: result.error,
      });
      return;
    }

    res.json({
      success: true,
      transactionHash: result.transactionHash,
      explorerUrl: result.explorerUrl,
      steps: result.steps,
      message: `Successfully bridged ${amount} USDC from Solana Devnet to Arc Testnet`,
    });
  } catch (error: any) {
    functions.logger.error("Error in bridgeFromSolana:", error);
    res.status(500).json({
      error: "Failed to bridge tokens",
      message: error.message,
    });
  }
});

/**
 * Get bridge estimate (time and fees)
 */
export const getBridgeEstimate = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  try {
    const { amount } = req.body;

    if (!amount) {
      res.status(400).json({ error: "Amount required" });
      return;
    }

    const estimate = estimateBridge(amount);

    res.json({
      amount,
      estimatedTime: estimate.estimatedTime,
      estimatedFee: estimate.estimatedFee,
      message:
        "Bridge transactions are typically fast on testnets. Mainnet may take longer.",
    });
  } catch (error: any) {
    functions.logger.error("Error in getBridgeEstimate:", error);
    res.status(500).json({
      error: "Failed to get estimate",
      message: error.message,
    });
  }
});

/**
 * Auto-bridge: Detect insufficient Arc balance and automatically bridge from Ethereum
 */
export const autoBridge = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, X-Wallet-Address");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const walletAddress = req.headers["x-wallet-address"] as string;
    const { requiredAmount } = req.body;

    if (!walletAddress || !requiredAmount) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    functions.logger.info(
      `Auto-bridge request: Need ${requiredAmount} USDC on Arc Testnet for ${walletAddress}`,
    );

    // TODO: Check balances on all chains
    // TODO: Determine best source chain
    // TODO: Calculate optimal bridge amount (required + buffer)

    // For now, attempt to bridge from Ethereum Sepolia
    const bridgeAmount = (parseFloat(requiredAmount) + 0.01).toFixed(6); // Add 0.01 buffer

    const result = await bridgeUSDC({
      fromChain: "Ethereum_Sepolia",
      toChain: "Arc_Testnet",
      amount: bridgeAmount,
      walletAddress,
    });

    if (!result.success) {
      res.status(500).json({
        error: "Auto-bridge failed",
        message: result.error,
        suggestion:
          "Please manually add USDC to Arc Testnet using the faucet: https://faucet.circle.com",
      });
      return;
    }

    res.json({
      success: true,
      bridgedAmount: bridgeAmount,
      transactionHash: result.transactionHash,
      explorerUrl: result.explorerUrl,
      message: `Successfully auto-bridged ${bridgeAmount} USDC to Arc Testnet`,
    });
  } catch (error: any) {
    functions.logger.error("Error in autoBridge:", error);
    res.status(500).json({
      error: "Auto-bridge failed",
      message: error.message,
      suggestion:
        "Please manually add USDC to Arc Testnet using the faucet: https://faucet.circle.com",
    });
  }
});
