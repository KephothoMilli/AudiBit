import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { createCircleTransfer } from "./circle-api";
import { getDb } from "./firebase-init";

const getFirestore = () => getDb();

// Credit pricing (in USDC)
const CREDIT_PACKAGES = {
  small: { credits: 10, price: 1.0 },
  medium: { credits: 50, price: 4.5 },
  large: { credits: 100, price: 8.0 },
};

/**
 * GET /credits/balance - Get user's credit balance
 */
export const getCreditsBalance = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    // Verify authentication
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const token = authHeader.split("Bearer ")[1];
    const decodedToken = await admin.auth().verifyIdToken(token);
    const userId = decodedToken.uid;

    // Get or create user document
    const userDoc = await getFirestore().collection("users").doc(userId).get();

    if (!userDoc.exists) {
      // Create new user with initial credits
      await getFirestore().collection("users").doc(userId).set({
        credits: 5, // Free trial credits
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastAuditAt: null,
      });

      res.status(200).json({
        credits: 5,
        isTrial: true,
      });
      return;
    }

    const userData = userDoc.data();
    res.status(200).json({
      credits: userData?.credits || 0,
      isTrial: false,
    });
  } catch (error) {
    console.error("❌ Error in getCreditsBalance:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /credits/purchase - Purchase credits with USDC
 */
export const purchaseCredits = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    // Verify authentication
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const token = authHeader.split("Bearer ")[1];
    const decodedToken = await admin.auth().verifyIdToken(token);
    const userId = decodedToken.uid;

    const { packageType, walletAddress, transactionHash } = req.body;

    if (!packageType || !walletAddress || !transactionHash) {
      res
        .status(400)
        .json({
          error:
            "Missing required fields: packageType, walletAddress, transactionHash",
        });
      return;
    }

    const creditPackage =
      CREDIT_PACKAGES[packageType as keyof typeof CREDIT_PACKAGES];
    if (!creditPackage) {
      res.status(400).json({ error: "Invalid package type" });
      return;
    }

    console.log(
      `💳 Credit purchase: ${packageType} (${creditPackage.credits} credits) for user ${userId}`,
    );

    // Create purchase record
    const purchaseId = getFirestore().collection("purchases").doc().id;
    await getFirestore().collection("purchases").doc(purchaseId).set({
      id: purchaseId,
      userId,
      packageType,
      credits: creditPackage.credits,
      priceUsdc: creditPackage.price,
      walletAddress,
      transactionHash,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Add credits to user account (optimistic - should verify transaction first in production)
    await getFirestore()
      .collection("users")
      .doc(userId)
      .update({
        credits: admin.firestore.FieldValue.increment(creditPackage.credits),
      });

    // Update purchase status
    await getFirestore().collection("purchases").doc(purchaseId).update({
      status: "completed",
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(
      `✅ Credits added: ${creditPackage.credits} credits to user ${userId}`,
    );

    res.status(200).json({
      success: true,
      purchaseId,
      creditsAdded: creditPackage.credits,
      transactionHash,
    });
  } catch (error) {
    console.error("❌ Error in purchaseCredits:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /webhook/circle - Handle Circle payment confirmations
 */
export const circleWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    // Verify webhook signature
    const signature = req.headers["x-circle-signature"];
    const webhookSecret = process.env.ARC_WEBHOOK_SECRET;

    if (!signature || !webhookSecret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // In production, verify the signature properly
    // For now, we'll accept the webhook

    const { type, data } = req.body;

    console.log(`📨 Circle webhook received: ${type}`);

    if (type === "transfer.completed") {
      const { id, transactionHash, amount, destinationAddress } = data;

      // Find the purchase by transaction hash
      const purchasesSnapshot = await getFirestore()
        .collection("purchases")
        .where("transactionHash", "==", transactionHash)
        .where("status", "==", "pending")
        .limit(1)
        .get();

      if (!purchasesSnapshot.empty) {
        const purchaseDoc = purchasesSnapshot.docs[0];
        const purchase = purchaseDoc.data();

        // Update purchase status
        await purchaseDoc.ref.update({
          status: "confirmed",
          circleId: id,
          confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(
          `✅ Payment confirmed: ${purchase.credits} credits for user ${purchase.userId}`,
        );
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error("❌ Error in circleWebhook:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /credits/packages - Get available credit packages
 */
export const getCreditPackages = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  res.status(200).json({
    packages: CREDIT_PACKAGES,
    platformWallet: process.env.PLATFORM_WALLET_ADDRESS || "",
  });
});
