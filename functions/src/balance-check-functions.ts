/**
 * Balance Check Cloud Functions
 *
 * Provides endpoints for checking wallet balance and compute credits
 * before running audits.
 */

import * as functions from "firebase-functions";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import {
  checkBalanceWithAutoBridge,
  hasMinimumBalance,
  getComputeCredits,
} from "./lib/balance-checker";
import { AuditSpecs } from "./lib/metering";

// Initialize Circle client
const getCircleClient = () => {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;

  if (!apiKey || !entitySecret) {
    throw new Error("Circle API credentials not configured");
  }

  return initiateDeveloperControlledWalletsClient({
    apiKey,
    entitySecret,
  });
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Wallet-Address",
};

/**
 * Pre-flight balance check before audit
 */
export const checkBalance = functions.https.onRequest(async (req, res) => {
  res.set(corsHeaders);

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
    const { specs } = req.body as { specs: AuditSpecs };

    if (!walletAddress) {
      res
        .status(400)
        .json({ error: "Wallet address required in X-Wallet-Address header" });
      return;
    }

    if (!specs) {
      res.status(400).json({ error: "Audit specs required in request body" });
      return;
    }

    functions.logger.info(`Checking balance for ${walletAddress}`, specs);

    // Use auto-bridge enabled balance check
    const result = await checkBalanceWithAutoBridge(
      walletAddress,
      specs,
      getCircleClient,
      true, // Enable auto-bridge
    );

    functions.logger.info(`Balance check result:`, result);

    res.json(result);
  } catch (error: any) {
    functions.logger.error("Error checking balance:", error);
    res.status(500).json({
      error: "Failed to check balance",
      message: error.message,
    });
  }
});

/**
 * Quick minimum balance check
 */
export const checkMinimumBalance = functions.https.onRequest(
  async (req, res) => {
    res.set(corsHeaders);

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    try {
      const walletAddress = req.headers["x-wallet-address"] as string;

      if (!walletAddress) {
        res.status(400).json({ error: "Wallet address required" });
        return;
      }

      const result = await hasMinimumBalance(walletAddress, getCircleClient);

      res.json(result);
    } catch (error: any) {
      functions.logger.error("Error checking minimum balance:", error);
      res.status(500).json({
        error: "Failed to check minimum balance",
        message: error.message,
      });
    }
  },
);

/**
 * Get compute credits for a wallet
 */
export const getCredits = functions.https.onRequest(async (req, res) => {
  res.set(corsHeaders);

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  try {
    const walletAddress = req.headers["x-wallet-address"] as string;

    if (!walletAddress) {
      res.status(400).json({ error: "Wallet address required" });
      return;
    }

    const credits = await getComputeCredits(walletAddress);

    res.json({ credits });
  } catch (error: any) {
    functions.logger.error("Error getting credits:", error);
    res.status(500).json({
      error: "Failed to get credits",
      message: error.message,
    });
  }
});
