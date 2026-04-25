/**
 * Circle Developer-Controlled Wallets Functions
 *
 * Handles wallet creation, balance queries, transactions, and credit purchases
 * using Circle's Developer-Controlled Wallets API.
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

// Arc Testnet USDC contract address
const ARC_TESTNET_USDC = "0x3600000000000000000000000000000000000000";
const ARC_MAINNET_USDC = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d"; // Update with actual mainnet address

import { calculateAuditCost, AuditSpecs } from "./lib/metering";

/**
 * Create a new Circle wallet for a user
 */
export const createWallet = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { blockchain = "ARC-TESTNET" } = req.body;

    functions.logger.info("Creating wallet for blockchain:", blockchain);

    // Check if Circle API credentials are configured
    const apiKey = process.env.CIRCLE_API_KEY;
    const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
    const walletSetId = process.env.CIRCLE_WALLET_SET_ID;

    if (!apiKey || !entitySecret) {
      functions.logger.error("Circle API credentials not configured");
      res.status(500).json({
        error: "Circle API credentials not configured",
        message:
          "Please configure CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET in Firebase Functions environment variables.",
      });
      return;
    }

    if (!walletSetId) {
      functions.logger.error("Wallet Set ID not configured");
      res.status(500).json({
        error: "Wallet Set ID not configured",
        message:
          "Please configure CIRCLE_WALLET_SET_ID in Firebase Functions environment variables.",
      });
      return;
    }

    const client = getCircleClient();

    // Create wallet via Circle API
    functions.logger.info("Calling Circle API to create wallet...");
    const response = await client.createWallets({
      walletSetId,
      blockchains: [blockchain as any],
      count: 1,
      accountType: "EOA",
    });

    const wallet = response.data?.wallets?.[0];

    if (!wallet) {
      functions.logger.error("No wallet returned from Circle API", response);
      res.status(500).json({
        error: "Wallet creation failed",
        message:
          "Circle API did not return a wallet. Please check your Circle API configuration.",
      });
      return;
    }

    // Store wallet in Firestore
    await admin.firestore().collection("wallets").doc(wallet.address).set({
      id: wallet.id,
      address: wallet.address,
      blockchain: wallet.blockchain,
      state: wallet.state,
      createdAt: FieldValue.serverTimestamp(),
      credits: 0,
      lastActive: FieldValue.serverTimestamp(),
    });

    functions.logger.info("Wallet created successfully:", wallet.address);

    res.json({
      wallet: {
        id: wallet.id,
        address: wallet.address,
        blockchain: wallet.blockchain,
        state: wallet.state,
        createDate: wallet.createDate,
      },
    });
  } catch (error: any) {
    functions.logger.error("Error creating wallet:", error);

    // Provide detailed error message
    let errorMessage = "Failed to create wallet";
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
      error: "Failed to create wallet",
      message: errorMessage,
      details: error.toString(),
    });
  }
});

/**
 * Ensure user has wallets on both Ethereum Sepolia and Solana Devnet for bridging
 */
export const ensureMultiChainWallets = functions.https.onRequest(
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, X-Wallet-Address");

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

      const walletSetId = process.env.CIRCLE_WALLET_SET_ID;
      if (!walletSetId) throw new Error("Wallet Set ID not configured");

      const client = getCircleClient();

      // List all wallets
      const walletsResponse = await client.listWallets({ pageSize: 50 });
      const wallets = walletsResponse.data?.wallets || [];

      const blockchains = ["ETH-SEPOLIA", "SOL-DEVNET"];
      const results = [];

      for (const bc of blockchains) {
        const existing = wallets.find((w) => w.blockchain === bc);
        if (!existing) {
          functions.logger.info(`Creating ${bc} wallet for bridge...`);
          const created = await client.createWallets({
            walletSetId,
            blockchains: [bc as any],
            count: 1,
            accountType: "EOA",
          });
          results.push({
            blockchain: bc,
            status: "created",
            wallet: created.data?.wallets?.[0],
          });
        } else {
          results.push({ blockchain: bc, status: "exists", wallet: existing });
        }
      }

      res.json({ success: true, wallets: results });
    } catch (error: any) {
      functions.logger.error("Error ensuring multi-chain wallets:", error);
      res.status(500).json({ error: error.message });
    }
  },
);
/**
 * Get wallet balance from Circle
 */
export const getWalletBalance = functions.https.onRequest(async (req, res) => {
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

    if (!walletAddress) {
      res
        .status(400)
        .json({ error: "Wallet address required in X-Wallet-Address header" });
      return;
    }

    // Get wallet from Firestore
    let walletDoc = await admin
      .firestore()
      .collection("wallets")
      .doc(walletAddress)
      .get();

    const client = getCircleClient();
    let walletData: any;

    if (!walletDoc.exists) {
      // Wallet not in Firestore - try to sync from Circle API
      functions.logger.warn(
        `Wallet ${walletAddress} not found in Firestore, attempting to sync from Circle API...`,
      );

      try {
        // Query Circle API for all wallets
        const walletsResponse = await client.listWallets({ pageSize: 50 });
        const wallets = walletsResponse.data?.wallets || [];

        // Find matching wallet by address
        const matchingWallet = wallets.find(
          (w) => w.address?.toLowerCase() === walletAddress.toLowerCase(),
        );

        if (!matchingWallet) {
          functions.logger.error(
            `Wallet ${walletAddress} not found in Circle API either`,
          );
          res.status(404).json({
            error: "Wallet not found",
            message:
              "Wallet not found in Firestore or Circle API. Please create a wallet first.",
          });
          return;
        }

        // Sync wallet to Firestore
        await admin.firestore().collection("wallets").doc(walletAddress).set({
          id: matchingWallet.id,
          address: matchingWallet.address,
          blockchain: matchingWallet.blockchain,
          state: matchingWallet.state,
          createdAt: FieldValue.serverTimestamp(),
          credits: 0,
          lastActive: FieldValue.serverTimestamp(),
        });

        functions.logger.info(`✅ Wallet ${walletAddress} synced to Firestore`);

        walletData = {
          id: matchingWallet.id,
          address: matchingWallet.address,
          blockchain: matchingWallet.blockchain,
          state: matchingWallet.state,
        };
      } catch (syncError: any) {
        functions.logger.error("Error syncing wallet from Circle:", syncError);
        res.status(500).json({
          error: "Failed to sync wallet",
          message: syncError.message,
        });
        return;
      }
    } else {
      walletData = walletDoc.data()!;
    }

    // Get balance from Circle
    const response = await client.getWalletTokenBalance({ id: walletData.id });
    const balances = response.data?.tokenBalances || [];

    // Update last active timestamp
    await admin.firestore().collection("wallets").doc(walletAddress).update({
      lastActive: FieldValue.serverTimestamp(),
    });

    res.json({ balances });
  } catch (error: any) {
    functions.logger.error("Error getting wallet balance:", error);
    res.status(500).json({
      error: "Failed to get wallet balance",
      message: error.message,
    });
  }
});

/**
 * Send USDC from one wallet to another
 */
export const sendUSDC = functions.https.onRequest(async (req, res) => {
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
    const { destinationAddress, amount } = req.body;

    if (!walletAddress || !destinationAddress || !amount) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    // Get wallet from Firestore
    const walletDoc = await admin
      .firestore()
      .collection("wallets")
      .doc(walletAddress)
      .get();

    if (!walletDoc.exists) {
      res.status(404).json({ error: "Wallet not found" });
      return;
    }

    const walletData = walletDoc.data()!;
    const client = getCircleClient();

    // Determine USDC contract address based on blockchain
    const usdcAddress =
      walletData.blockchain === "ARC-MAINNET"
        ? ARC_MAINNET_USDC
        : ARC_TESTNET_USDC;

    // Create transaction
    const txResponse = await client.createTransaction({
      walletId: walletData.id,
      destinationAddress,
      amounts: [amount],
      tokenId: usdcAddress,
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    } as any);

    const txId = txResponse.data?.id;

    if (!txId) {
      throw new Error("Transaction creation failed: no ID returned");
    }

    functions.logger.info("Transaction created:", txId);

    // Poll for transaction completion (optional - can be done client-side)
    const terminalStates = new Set([
      "COMPLETE",
      "FAILED",
      "CANCELLED",
      "DENIED",
    ]);
    let currentState = txResponse.data?.state;
    let txHash: string | undefined;

    // Poll up to 30 seconds
    for (
      let i = 0;
      i < 10 && currentState && !terminalStates.has(currentState);
      i++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const poll = await client.getTransaction({ id: txId });
      const tx = poll.data?.transaction;
      currentState = tx?.state;
      txHash = tx?.txHash;
      functions.logger.info("Transaction state:", currentState);
    }

    res.json({
      transactionId: txId,
      state: currentState,
      txHash,
    });
  } catch (error: any) {
    functions.logger.error("Error sending USDC:", error);
    res.status(500).json({
      error: "Failed to send USDC",
      message: error.message,
    });
  }
});

/**
 * Internal helper to purchase credits
 */
export async function purchaseCreditsInternal(
  walletAddress: string,
  packageType: "small" | "medium" | "large" = "small",
): Promise<{ success: boolean; credits: number; error?: string }> {
  try {
    // Define credit packages
    const packages: Record<string, { credits: number; price: string }> = {
      small: { credits: 10, price: "1" },
      medium: { credits: 50, price: "4" },
      large: { credits: 100, price: "7" },
    };

    const pkg = packages[packageType];
    if (!pkg) throw new Error("Invalid package type");

    const walletDoc = await admin
      .firestore()
      .collection("wallets")
      .doc(walletAddress)
      .get();
    if (!walletDoc.exists) throw new Error("Wallet not found");

    const walletData = walletDoc.data()!;
    const client = getCircleClient();
    const platformWallet = process.env.PLATFORM_WALLET_ADDRESS;
    if (!platformWallet) throw new Error("Platform wallet not configured");

    // Dynamically fetch Token ID
    const balancesResponse = await client.getWalletTokenBalance({
      id: walletData.id,
    });
    const usdcToken = balancesResponse.data?.tokenBalances?.find(
      (b: any) =>
        b.token?.symbol === "USDC" ||
        b.token?.name?.toLowerCase().includes("usdc"),
    );

    if (!usdcToken || !usdcToken.token?.id) {
      throw new Error(`USDC token not found in wallet ${walletAddress}`);
    }

    const tokenId = usdcToken.token.id;

    const txResponse = await client.createTransaction({
      walletId: walletData.id,
      destinationAddress: platformWallet,
      amounts: [pkg.price],
      tokenId,
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    } as any);

    const txId = txResponse.data?.id;
    if (!txId) throw new Error("Transaction creation failed");

    // Add credits to user account (optimistic for internal calls to keep it fast)
    await walletDoc.ref.update({
      credits: admin.firestore.FieldValue.increment(pkg.credits),
      lastActive: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { success: true, credits: pkg.credits };
  } catch (error: any) {
    console.error("Internal credit purchase failed:", error);
    return { success: false, credits: 0, error: error.message };
  }
}

/**
 * Purchase credits with USDC
 */
export const purchaseCredits = functions.https.onRequest(async (req, res) => {
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
    const { packageType } = req.body;

    if (!walletAddress || !packageType) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    // Define credit packages
    const packages: Record<string, { credits: number; price: string }> = {
      small: { credits: 10, price: "1" },
      medium: { credits: 50, price: "4" },
      large: { credits: 100, price: "7" },
    };

    const pkg = packages[packageType];

    if (!pkg) {
      res.status(400).json({ error: "Invalid package type" });
      return;
    }

    // Get wallet from Firestore
    const walletDoc = await admin
      .firestore()
      .collection("wallets")
      .doc(walletAddress)
      .get();

    if (!walletDoc.exists) {
      res.status(404).json({ error: "Wallet not found" });
      return;
    }

    const walletData = walletDoc.data()!;
    const client = getCircleClient();

    // Platform wallet address (where payments go)
    const platformWallet = process.env.PLATFORM_WALLET_ADDRESS;

    if (!platformWallet) {
      throw new Error("Platform wallet not configured");
    }

    // Determine USDC contract address
    const usdcAddress =
      walletData.blockchain === "ARC-MAINNET"
        ? ARC_MAINNET_USDC
        : ARC_TESTNET_USDC;

    // Create USDC transaction to platform wallet
    const txResponse = await client.createTransaction({
      walletId: walletData.id,
      destinationAddress: platformWallet,
      amounts: [pkg.price],
      tokenId: usdcAddress,
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    } as any);

    const txId = txResponse.data?.id;

    if (!txId) {
      throw new Error("Transaction creation failed");
    }

    // Create payment record
    const paymentRef = await admin
      .firestore()
      .collection("payments")
      .add({
        walletAddress,
        packageType,
        amount: parseFloat(pkg.price),
        credits: pkg.credits,
        transactionId: txId,
        status: "pending",
        createdAt: FieldValue.serverTimestamp(),
      });

    // Poll for transaction completion
    const terminalStates = new Set([
      "COMPLETE",
      "FAILED",
      "CANCELLED",
      "DENIED",
    ]);
    let currentState = txResponse.data?.state;
    let txHash: string | undefined;

    // Poll up to 30 seconds
    for (
      let i = 0;
      i < 10 && currentState && !terminalStates.has(currentState);
      i++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const poll = await client.getTransaction({ id: txId });
      const tx = poll.data?.transaction;
      currentState = tx?.state;
      txHash = tx?.txHash;
    }

    if (currentState === "COMPLETE") {
      // Add credits to user account
      await walletDoc.ref.update({
        credits: FieldValue.increment(pkg.credits),
        lastActive: FieldValue.serverTimestamp(),
      });

      // Update payment record
      await paymentRef.update({
        status: "completed",
        txHash,
        completedAt: FieldValue.serverTimestamp(),
      });

      functions.logger.info("Credits purchased:", {
        walletAddress,
        credits: pkg.credits,
        txId,
      });

      res.json({
        transactionId: txId,
        txHash,
        credits: pkg.credits,
        status: "completed",
      });
    } else {
      // Update payment record with failure
      await paymentRef.update({
        status: currentState === "FAILED" ? "failed" : "pending",
        txHash,
      });

      res.json({
        transactionId: txId,
        txHash,
        credits: 0,
        status: currentState,
      });
    }
  } catch (error: any) {
    functions.logger.error("Error purchasing credits:", error);
    res.status(500).json({
      error: "Failed to purchase credits",
      message: error.message,
    });
  }
});

/**
 * Get credits balance for a wallet
 */
export const getCreditsBalance = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, X-Wallet-Address");

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

    const walletDoc = await admin
      .firestore()
      .collection("wallets")
      .doc(walletAddress)
      .get();

    if (!walletDoc.exists) {
      res.status(404).json({ error: "Wallet not found" });
      return;
    }

    const credits = walletDoc.data()!.credits || 0;

    res.json({ credits });
  } catch (error: any) {
    functions.logger.error("Error getting credits balance:", error);
    res.status(500).json({
      error: "Failed to get credits balance",
      message: error.message,
    });
  }
});

/**
 * Check if wallet has sufficient USDC balance for a transaction
 */
export const checkWalletBalance = async (
  walletAddress: string,
  requiredAmount: string,
): Promise<{
  hasBalance: boolean;
  currentBalance: string;
  message: string;
}> => {
  try {
    // Get wallet from Firestore
    const walletDoc = await admin
      .firestore()
      .collection("wallets")
      .doc(walletAddress)
      .get();

    if (!walletDoc.exists) {
      // Try to fetch wallet from Circle API and create Firestore entry
      functions.logger.warn(
        `Wallet ${walletAddress} not found in Firestore, attempting to sync from Circle API...`,
      );

      try {
        const client = getCircleClient();

        // List all wallets and find the one with matching address
        const walletsResponse = await client.listWallets({});
        const wallet = walletsResponse.data?.wallets?.find(
          (w) => w.address?.toLowerCase() === walletAddress.toLowerCase(),
        );

        if (wallet) {
          // Create Firestore entry for existing wallet
          await admin.firestore().collection("wallets").doc(walletAddress).set({
            id: wallet.id,
            address: wallet.address,
            blockchain: wallet.blockchain,
            state: wallet.state,
            createdAt: FieldValue.serverTimestamp(),
            credits: 0,
            lastActive: FieldValue.serverTimestamp(),
          });

          functions.logger.info(
            `✅ Wallet ${walletAddress} synced to Firestore`,
          );

          // Continue with balance check using the newly synced wallet
          // Re-fetch the document
          const syncedWalletDoc = await admin
            .firestore()
            .collection("wallets")
            .doc(walletAddress)
            .get();

          if (syncedWalletDoc.exists) {
            // Continue with the rest of the function using syncedWalletDoc
            const walletData = syncedWalletDoc.data()!;

            // Check if wallet is active
            if (walletData.state !== "LIVE") {
              return {
                hasBalance: false,
                currentBalance: "0",
                message: `Wallet is not active. Current state: ${walletData.state}`,
              };
            }

            const client = getCircleClient();

            // Get balance from Circle
            const response = await client.getWalletTokenBalance({
              id: walletData.id,
            });
            const balances = response.data?.tokenBalances || [];

            // Find USDC balance
            const usdcBalance = balances.find(
              (b) =>
                b.token?.symbol === "USDC" ||
                b.token?.name?.toLowerCase().includes("usdc"),
            );

            const currentBalance = usdcBalance?.amount || "0";
            const currentBalanceNum = parseFloat(currentBalance);
            const requiredAmountNum = parseFloat(requiredAmount);

            if (currentBalanceNum < requiredAmountNum) {
              return {
                hasBalance: false,
                currentBalance,
                message:
                  `Insufficient USDC balance.\n\n` +
                  `Required: ${requiredAmount} USDC\n` +
                  `Current: ${currentBalance} USDC\n\n` +
                  `Please add USDC to your wallet:\n` +
                  `1. Visit: https://faucet.circle.com\n` +
                  `2. Enter your wallet address: ${walletAddress}\n` +
                  `3. Request testnet USDC on Arc Testnet\n` +
                  `4. Wait 10-30 seconds for tokens to arrive\n` +
                  `5. Try your audit again`,
              };
            }

            return {
              hasBalance: true,
              currentBalance,
              message: `Balance sufficient: ${currentBalance} USDC`,
            };
          }
        }
      } catch (syncError: any) {
        functions.logger.error("Failed to sync wallet from Circle:", syncError);
      }

      // If sync failed or wallet not found in Circle
      return {
        hasBalance: false,
        currentBalance: "0",
        message:
          "Wallet not found in Circle API. Please create a new wallet by clicking 'Connect Arc Wallet' in the extension, or if you just created a wallet, please wait a moment and try again.",
      };
    }

    const walletData = walletDoc.data()!;

    // Check if wallet is active
    if (walletData.state !== "LIVE") {
      return {
        hasBalance: false,
        currentBalance: "0",
        message: `Wallet is not active. Current state: ${walletData.state}`,
      };
    }

    const client = getCircleClient();

    // Get balance from Circle
    const response = await client.getWalletTokenBalance({ id: walletData.id });
    const balances = response.data?.tokenBalances || [];

    // Find USDC balance
    const usdcBalance = balances.find(
      (b) =>
        b.token?.symbol === "USDC" ||
        b.token?.name?.toLowerCase().includes("usdc"),
    );

    const currentBalance = usdcBalance?.amount || "0";
    const currentBalanceNum = parseFloat(currentBalance);
    const requiredAmountNum = parseFloat(requiredAmount);

    if (currentBalanceNum < requiredAmountNum) {
      return {
        hasBalance: false,
        currentBalance,
        message:
          `Insufficient USDC balance.\n\n` +
          `Required: ${requiredAmount} USDC\n` +
          `Current: ${currentBalance} USDC\n\n` +
          `Please add USDC to your wallet:\n` +
          `1. Visit: https://faucet.circle.com\n` +
          `2. Enter your wallet address: ${walletAddress}\n` +
          `3. Request testnet USDC on Arc Testnet\n` +
          `4. Wait 10-30 seconds for tokens to arrive\n` +
          `5. Try your audit again`,
      };
    }

    return {
      hasBalance: true,
      currentBalance,
      message: `Balance sufficient: ${currentBalance} USDC`,
    };
  } catch (error: any) {
    functions.logger.error("Error checking wallet balance:", error);
    return {
      hasBalance: false,
      currentBalance: "0",
      message: `Failed to check wallet balance: ${error.message}`,
    };
  }
};

/**
 * Deduct credits for an audit
 */
export const deductCredits = async (
  walletAddress: string,
  amount: number,
): Promise<boolean> => {
  try {
    const walletRef = admin
      .firestore()
      .collection("wallets")
      .doc(walletAddress);

    return await admin.firestore().runTransaction(async (transaction) => {
      const walletDoc = await transaction.get(walletRef);

      if (!walletDoc.exists) {
        throw new Error("Wallet not found");
      }

      const currentCredits = walletDoc.data()!.credits || 0;

      if (currentCredits < amount) {
        return false; // Insufficient credits
      }

      transaction.update(walletRef, {
        credits: FieldValue.increment(-amount),
        lastActive: FieldValue.serverTimestamp(),
      });

      return true;
    });
  } catch (error) {
    functions.logger.error("Error deducting credits:", error);
    return false;
  }
};

/**
 * Settle a usage job via Circle Nanopayments on Arc
 */
export const settleUsage = async (
  walletAddress: string,
  specs: AuditSpecs,
  description: string,
): Promise<any> => {
  try {
    const cost = calculateAuditCost(specs);

    // Get sender wallet from Firestore
    const walletDoc = await admin
      .firestore()
      .collection("wallets")
      .doc(walletAddress)
      .get();

    // Wallet must exist - no mock wallets allowed
    if (!walletDoc.exists) {
      throw new Error(
        "Wallet not found. Please create a Circle wallet first by clicking 'Connect Arc Wallet' in the extension.",
      );
    }

    const walletData = walletDoc.data()!;

    // Platform wallet address (where payments go)
    const platformWallet = process.env.PLATFORM_WALLET_ADDRESS;

    if (!platformWallet) {
      throw new Error("Platform wallet not configured");
    }

    const client = getCircleClient();

    // Dynamically fetch the correct Token ID (UUID) for USDC on this chain
    // Using contract address directly in tokenId fails with 400 Bad Request for Programmable Wallets
    const balancesResponse = await client.getWalletTokenBalance({
      id: walletData.id,
    });
    const usdcToken = balancesResponse.data?.tokenBalances?.find(
      (b: any) =>
        b.token?.symbol === "USDC" ||
        b.token?.name?.toLowerCase().includes("usdc"),
    );

    if (!usdcToken || !usdcToken.token?.id) {
      throw new Error(
        `USDC token not found in wallet ${walletAddress}. Please ensure you have USDC on Arc Testnet.`,
      );
    }

    const tokenId = usdcToken.token.id;

    // Create transaction on Arc
    functions.logger.info(
      `💰 Settling ${cost.totalUsdc} USDC (Token ID: ${tokenId}) for ${description}`,
    );

    const response = await client.createTransaction({
      walletId: walletData.id,
      destinationAddress: platformWallet,
      amounts: [cost.totalUsdc],
      tokenId,
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    } as any);

    const txId = response.data?.id;

    if (!txId) {
      throw new Error(
        "Transaction creation failed: no ID returned from Circle API",
      );
    }

    // Poll for on-chain txHash (Arc has sub-second finality, usually ready in 1-2 polls)
    const terminalStates = new Set([
      "COMPLETE",
      "FAILED",
      "CANCELLED",
      "DENIED",
    ]);
    let txState = response.data?.state as string | undefined;
    let txHash: string | undefined;

    for (let i = 0; i < 6 && txState && !terminalStates.has(txState); i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const poll = await client.getTransaction({ id: txId });
      const tx = poll.data?.transaction;
      txState = tx?.state;
      txHash = tx?.txHash ?? undefined;
      functions.logger.info(
        `Settlement poll ${i + 1}: state=${txState} txHash=${txHash}`,
      );
    }

    // Record the settlement in a log for the UI
    await admin
      .firestore()
      .collection("payment_logs")
      .add({
        walletAddress,
        amount: cost.totalUsdc,
        computeUnits: cost.computeUnits,
        description,
        status: txState === "COMPLETE" ? "confirmed" : "pending",
        transactionId: txId,
        txHash: txHash || null,
        createdAt: FieldValue.serverTimestamp(),
      });

    functions.logger.info(
      `✅ Settlement created: ${txId} for ${cost.totalUsdc} USDC`,
    );

    return {
      success: true,
      transactionId: txId,
      cost,
    };
  } catch (error: any) {
    functions.logger.error("❌ Settlement failed:", error);
    throw error;
  }
};

/**
 * Purchase compute credits with USDC
 * Uses Circle Gateway for instant, gasless settlement
 */
export const topUpCredits = functions.https.onRequest(async (req, res) => {
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
    const { creditAmount } = req.body; // Number of credits to purchase

    if (!walletAddress || !creditAmount) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    // Validate credit amount
    const credits = parseInt(creditAmount);
    if (isNaN(credits) || credits < 10 || credits > 10000) {
      res.status(400).json({
        error: "Invalid credit amount",
        message: "Credit amount must be between 10 and 10,000",
      });
      return;
    }

    // Calculate USDC cost (1 credit = 0.001 USDC)
    const usdcCost = (credits * 0.001).toFixed(6);

    functions.logger.info(
      `Top-up request: ${credits} credits (${usdcCost} USDC) for ${walletAddress}`,
    );

    // Get wallet from Firestore
    const walletDoc = await admin
      .firestore()
      .collection("wallets")
      .doc(walletAddress)
      .get();

    if (!walletDoc.exists) {
      res.status(404).json({ error: "Wallet not found" });
      return;
    }

    const walletData = walletDoc.data()!;
    const client = getCircleClient();

    // Platform wallet address (where payments go)
    const platformWallet = process.env.PLATFORM_WALLET_ADDRESS;

    if (!platformWallet) {
      throw new Error("Platform wallet not configured");
    }

    // Dynamically fetch Token ID
    const balancesResponse = await client.getWalletTokenBalance({
      id: walletData.id,
    });
    const usdcToken = balancesResponse.data?.tokenBalances?.find(
      (b: any) =>
        b.token?.symbol === "USDC" ||
        b.token?.name?.toLowerCase().includes("usdc"),
    );

    if (!usdcToken || !usdcToken.token?.id) {
      throw new Error(`USDC token not found in wallet ${walletAddress}`);
    }

    const tokenId = usdcToken.token.id;

    // Create USDC transaction to platform wallet
    functions.logger.info(
      `Creating transaction: ${usdcCost} USDC (Token ID: ${tokenId}) from ${walletAddress} to ${platformWallet}`,
    );

    const txResponse = await client.createTransaction({
      walletId: walletData.id,
      destinationAddress: platformWallet,
      amounts: [usdcCost],
      tokenId,
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    } as any);

    const txId = txResponse.data?.id;

    if (!txId) {
      throw new Error("Transaction creation failed");
    }

    // Create top-up record
    const topUpRef = await admin
      .firestore()
      .collection("credit_topups")
      .add({
        walletAddress,
        credits,
        usdcCost: parseFloat(usdcCost),
        transactionId: txId,
        status: "pending",
        createdAt: FieldValue.serverTimestamp(),
      });

    functions.logger.info(`Top-up record created: ${topUpRef.id}`);

    // Poll for transaction completion (up to 30 seconds)
    const terminalStates = new Set([
      "COMPLETE",
      "FAILED",
      "CANCELLED",
      "DENIED",
    ]);
    let currentState = txResponse.data?.state;
    let txHash: string | undefined;

    for (
      let i = 0;
      i < 10 && currentState && !terminalStates.has(currentState);
      i++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const poll = await client.getTransaction({ id: txId });
      const tx = poll.data?.transaction;
      currentState = tx?.state;
      txHash = tx?.txHash;
      functions.logger.info(`Transaction state: ${currentState}`);
    }

    if (currentState === "COMPLETE") {
      // Add credits to user account
      await walletDoc.ref.update({
        credits: FieldValue.increment(credits),
        lastActive: FieldValue.serverTimestamp(),
      });

      // Update top-up record
      await topUpRef.update({
        status: "completed",
        txHash,
        completedAt: FieldValue.serverTimestamp(),
      });

      functions.logger.info(
        `✅ Credits added: ${credits} credits for ${walletAddress}`,
      );

      res.json({
        success: true,
        transactionId: txId,
        txHash,
        credits,
        usdcCost,
        status: "completed",
      });
    } else {
      // Update top-up record with failure
      await topUpRef.update({
        status: currentState === "FAILED" ? "failed" : "pending",
        txHash,
      });

      res.json({
        success: false,
        transactionId: txId,
        txHash,
        credits: 0,
        status: currentState,
        message:
          currentState === "FAILED"
            ? "Transaction failed. Please try again."
            : "Transaction is still pending. Check back later.",
      });
    }
  } catch (error: any) {
    functions.logger.error("Error topping up credits:", error);
    res.status(500).json({
      error: "Failed to top up credits",
      message: error.message,
    });
  }
});

/**
 * Get payment logs for a wallet
 */
export const getPaymentLogs = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, X-Wallet-Address");

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

    let result: any[] = [];

    try {
      // Try the ordered query (requires composite index)
      const logs = await admin
        .firestore()
        .collection("payment_logs")
        .where("walletAddress", "==", walletAddress)
        .orderBy("createdAt", "desc")
        .limit(50)
        .get();

      result = logs.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toMillis() || Date.now(),
      }));
    } catch (indexError: any) {
      // Index still building — fall back to unordered query and sort in memory
      if (indexError.code === 9 || indexError.message?.includes("index")) {
        functions.logger.warn(
          "Index not ready, falling back to unordered query",
        );
        const logs = await admin
          .firestore()
          .collection("payment_logs")
          .where("walletAddress", "==", walletAddress)
          .limit(50)
          .get();

        result = logs.docs
          .map((doc) => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toMillis() || Date.now(),
          }))
          .sort((a, b) => b.createdAt - a.createdAt);
      } else {
        throw indexError;
      }
    }

    res.json({ logs: result });
  } catch (error: any) {
    functions.logger.error("Error getting payment logs:", error);
    res.status(500).json({ error: error.message });
  }
});
