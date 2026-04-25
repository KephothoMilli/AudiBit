/**
 * Wallet Import Functions
 *
 * Allows users to import existing Circle wallet addresses
 * into the AudiBit system.
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

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
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * Import an existing Circle wallet by address
 * Verifies the wallet exists in Circle and adds it to Firestore
 */
export const importWallet = functions.https.onRequest(async (req, res) => {
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
    const { walletAddress } = req.body;

    if (!walletAddress) {
      res.status(400).json({ error: "Wallet address is required" });
      return;
    }

    // Validate address format (basic check)
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      res.status(400).json({
        error: "Invalid wallet address format",
        message: "Address must be a valid Ethereum-style address (0x...)",
      });
      return;
    }

    functions.logger.info(`Importing wallet: ${walletAddress}`);

    // Check if wallet already exists in Firestore
    const existingWallet = await admin
      .firestore()
      .collection("wallets")
      .doc(walletAddress)
      .get();

    if (existingWallet.exists) {
      functions.logger.info(`Wallet already imported: ${walletAddress}`);
      res.json({
        success: true,
        wallet: {
          ...existingWallet.data(),
          address: walletAddress,
        },
        message: "Wallet already imported",
      });
      return;
    }

    // Query Circle API to find wallet by address
    const client = getCircleClient();

    functions.logger.info("Querying Circle API for wallet...");
    const walletsResponse = await client.listWallets({
      pageSize: 50, // Fetch up to 50 wallets
    });

    const wallets = walletsResponse.data?.wallets || [];
    functions.logger.info(`Found ${wallets.length} wallets in Circle account`);

    // Find wallet with matching address
    const matchingWallet = wallets.find(
      (w) => w.address?.toLowerCase() === walletAddress.toLowerCase(),
    );

    if (!matchingWallet) {
      functions.logger.warn(
        `Wallet not found in Circle account: ${walletAddress}`,
      );
      res.status(404).json({
        error: "Wallet not found",
        message:
          "This wallet address was not found in your Circle account. Please ensure:\n" +
          "1. The wallet was created with the same Circle API credentials\n" +
          "2. The address is correct\n" +
          "3. The wallet exists on Arc Testnet",
      });
      return;
    }

    functions.logger.info(`Found matching wallet: ${matchingWallet.id}`);

    // Verify wallet is on Arc network
    if (!matchingWallet.blockchain?.includes("ARC")) {
      res.status(400).json({
        error: "Unsupported blockchain",
        message: `This wallet is on ${matchingWallet.blockchain}. Only Arc Testnet and Arc Mainnet wallets are supported.`,
      });
      return;
    }

    // Import wallet to Firestore
    await admin.firestore().collection("wallets").doc(walletAddress).set({
      id: matchingWallet.id,
      address: matchingWallet.address,
      blockchain: matchingWallet.blockchain,
      state: matchingWallet.state,
      createdAt: FieldValue.serverTimestamp(),
      importedAt: FieldValue.serverTimestamp(),
      credits: 0,
      lastActive: FieldValue.serverTimestamp(),
      imported: true, // Flag to indicate this was imported
    });

    functions.logger.info(`✅ Wallet imported successfully: ${walletAddress}`);

    res.json({
      success: true,
      wallet: {
        id: matchingWallet.id,
        address: matchingWallet.address,
        blockchain: matchingWallet.blockchain,
        state: matchingWallet.state,
        createDate: matchingWallet.createDate,
      },
      message: "Wallet imported successfully",
    });
  } catch (error: any) {
    functions.logger.error("Error importing wallet:", error);

    // Provide helpful error messages
    let errorMessage = "Failed to import wallet";
    if (error.message) {
      errorMessage = error.message;
    }

    // Check for specific Circle API errors
    if (error.response) {
      errorMessage = `Circle API error: ${error.response.status} - ${error.response.statusText}`;
      if (error.response.data) {
        errorMessage += ` - ${JSON.stringify(error.response.data)}`;
      }
    }

    res.status(500).json({
      error: "Failed to import wallet",
      message: errorMessage,
      details: error.toString(),
    });
  }
});

/**
 * Verify a wallet address exists in Circle without importing
 * Useful for validation before import
 */
export const verifyWallet = functions.https.onRequest(async (req, res) => {
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
    const { walletAddress } = req.body;

    if (!walletAddress) {
      res.status(400).json({ error: "Wallet address is required" });
      return;
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      res.status(400).json({
        error: "Invalid wallet address format",
        valid: false,
      });
      return;
    }

    // Query Circle API
    const client = getCircleClient();
    const walletsResponse = await client.listWallets({
      pageSize: 50,
    });

    const wallets = walletsResponse.data?.wallets || [];
    const matchingWallet = wallets.find(
      (w) => w.address?.toLowerCase() === walletAddress.toLowerCase(),
    );

    if (!matchingWallet) {
      res.json({
        valid: false,
        exists: false,
        message: "Wallet not found in Circle account",
      });
      return;
    }

    // Check if already imported
    const existingWallet = await admin
      .firestore()
      .collection("wallets")
      .doc(walletAddress)
      .get();

    res.json({
      valid: true,
      exists: true,
      alreadyImported: existingWallet.exists,
      wallet: {
        id: matchingWallet.id,
        address: matchingWallet.address,
        blockchain: matchingWallet.blockchain,
        state: matchingWallet.state,
      },
    });
  } catch (error: any) {
    functions.logger.error("Error verifying wallet:", error);
    res.status(500).json({
      error: "Failed to verify wallet",
      message: error.message,
      valid: false,
    });
  }
});

/**
 * List all wallets in the Circle account
 * Helps users find their wallet addresses
 */
export const listCircleWallets = functions.https.onRequest(async (req, res) => {
  res.set(corsHeaders);

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  try {
    const client = getCircleClient();

    // Get pagination parameters
    const pageSize = parseInt(req.query.pageSize as string) || 10;
    const pageBefore = req.query.pageBefore as string;
    const pageAfter = req.query.pageAfter as string;

    const params: any = { pageSize };
    if (pageBefore) params.pageBefore = pageBefore;
    if (pageAfter) params.pageAfter = pageAfter;

    const walletsResponse = await client.listWallets(params);
    const wallets = walletsResponse.data?.wallets || [];

    // Filter for Arc wallets only
    const arcWallets = wallets.filter((w) => w.blockchain?.includes("ARC"));

    // Check which wallets are already imported
    const walletAddresses = arcWallets.map((w) => w.address).filter(Boolean);

    let importedAddresses = new Set<string>();

    // Only query Firestore if there are wallet addresses
    if (walletAddresses.length > 0) {
      // Firestore 'in' query supports max 10 items, so batch if needed
      const batchSize = 10;
      for (let i = 0; i < walletAddresses.length; i += batchSize) {
        const batch = walletAddresses.slice(i, i + batchSize);
        const importedWallets = await admin
          .firestore()
          .collection("wallets")
          .where(admin.firestore.FieldPath.documentId(), "in", batch)
          .get();

        importedWallets.docs.forEach((doc) => {
          importedAddresses.add(doc.id);
        });
      }
    }

    const walletsWithStatus = arcWallets.map((w) => ({
      id: w.id,
      address: w.address,
      blockchain: w.blockchain,
      state: w.state,
      createDate: w.createDate,
      imported: importedAddresses.has(w.address || ""),
    }));

    res.json({
      wallets: walletsWithStatus,
      total: arcWallets.length,
    });
  } catch (error: any) {
    functions.logger.error("Error listing wallets:", error);
    res.status(500).json({
      error: "Failed to list wallets",
      message: error.message,
    });
  }
});
