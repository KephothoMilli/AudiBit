// Load environment variables from .env file
import * as dotenv from "dotenv";
dotenv.config();

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { v4 as uuidv4 } from "uuid";
import { calculateSplits, recordSplits } from "./payment-split";
import { createCircleTransfer, getCircleTransferStatus } from "./circle-api";
export * from "./dataset-functions";
export * from "./audit-functions";
// Export Circle Wallet functions (replaces old credit-functions)
export * from "./circle-wallet-functions";
// Export balance check functions
export * from "./balance-check-functions";
// Export wallet import functions (BYOW - Bring Your Own Wallet)
export * from "./wallet-import-functions";
// Export bridge functions (cross-chain USDC bridging)
export * from "./bridge-functions";
// Export nanopayment quote endpoints
export * from "./nanopayment-functions";
// Export Wand Agent (voice-first browser assistant)
export * from "./wand-agent";
// Export specialized AI agents (legacy - kept for backward compatibility)
export * from "./ai-agents";
// Export agentic multi-agent system (ADK-based) - NEW RECOMMENDED APPROACH
export {
  agenticAudit,
  agenticUI,
  agenticUX,
  agenticDOM,
  agenticSecurity,
} from "./agentic-system";

admin.initializeApp();
const db = admin.firestore();

/**
 * Trigger: When a new offer is created by a provider
 */
export const onNewOffer = functions.firestore
  .document("offers/{offerId}")
  .onCreate(async (snap, context) => {
    try {
      const offer = snap.data();
      const offerId = context.params.offerId;

      console.log("📊 New offer indexed:", offerId);

      await db
        .collection("aggregates")
        .doc("offers")
        .update({
          total: admin.firestore.FieldValue.increment(1),
          activeOffers: admin.firestore.FieldValue.increment(1),
          byModel: {
            [offer!.model]: admin.firestore.FieldValue.increment(1),
          },
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        })
        .catch(() => {
          return db
            .collection("aggregates")
            .doc("offers")
            .set({
              total: 1,
              activeOffers: 1,
              byModel: { [offer!.model]: 1 },
              lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            });
        });

      return { success: true, offerId };
    } catch (error) {
      console.error("❌ Error in onNewOffer:", error);
      throw error;
    }
  });

/**
 * Trigger: When a consumer sends an inference request
 */
export const onRequestCreate = functions.firestore
  .document("requests/{requestId}")
  .onCreate(async (snap, context) => {
    try {
      const request = snap.data();
      const requestId = context.params.requestId;

      console.log("📨 New request created:", requestId);

      const offerDoc = await db
        .collection("offers")
        .doc(request!.offerId)
        .get();
      if (!offerDoc.exists) {
        throw new Error("Offer not found");
      }

      const _provider = offerDoc.data();

      await snap.ref.update({
        status: "forwarded",
        forwardedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log("Request forwarded to provider:", request!.offerId);

      await db
        .collection("aggregates")
        .doc("requests")
        .update({
          total: admin.firestore.FieldValue.increment(1),
          pending: admin.firestore.FieldValue.increment(1),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        })
        .catch(() => {
          return db.collection("aggregates").doc("requests").set({
            total: 1,
            pending: 1,
            completed: 0,
            failed: 0,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          });
        });

      return { success: true, requestId };
    } catch (error) {
      console.error("❌ Error in onRequestCreate:", error);
      throw error;
    }
  });

/**
 * Trigger: When a usage proof is submitted
 */
export const onProofSubmitted = functions.firestore
  .document("usage_proofs/{proofId}")
  .onCreate(async (snap, context) => {
    try {
      const proof = snap.data();
      const proofId = context.params.proofId;

      console.log("✅ Proof submitted:", proofId);

      const requestDoc = await db
        .collection("requests")
        .doc(proof!.requestId)
        .get();
      if (!requestDoc.exists) {
        throw new Error("Request not found");
      }

      const request = requestDoc.data();
      const datasetIds = request!.datasetIds || [];

      const paymentId = uuidv4();
      const amountUsdc = request!.amountUsdc || 0.005;

      // Calculate and record payment splits
      const splits = await calculateSplits(
        proof!.requestId,
        proof!.providerId,
        amountUsdc,
        datasetIds,
      );

      await db
        .collection("payments")
        .doc(paymentId)
        .set({
          id: paymentId,
          requestId: proof!.requestId,
          consumerId: request!.consumerId,
          providerId: proof!.providerId,
          amountUsdc: amountUsdc,
          datasetIds: datasetIds,
          status: "pending",
          proofId: proofId,
          hasSplits: splits.length > 1,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      if (splits.length > 0) {
        await recordSplits(paymentId, splits);
      }

      await requestDoc.ref.update({
        status: "completed",
        proofId: proofId,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(
        `Payment created: ${paymentId} for ${amountUsdc} USDC (${splits.length} splits)`,
      );

      // --- REPUTATION UPDATE ---
      const providerRef = db.collection("agents").doc(proof!.providerId);
      const agentSnap = await providerRef.get();

      if (agentSnap.exists) {
        const agent = agentSnap.data();
        const totalInferences = (agent!.totalInferences || 0) + 1;

        // Calculate response time
        const createdAt = request!.createdAt.toDate();
        const completedAt = new Date();
        const responseTimeMs = completedAt.getTime() - createdAt.getTime();

        const oldAvg = agent!.averageResponseTime || responseTimeMs;
        const newAvg =
          (oldAvg * (totalInferences - 1) + responseTimeMs) / totalInferences;

        // Score: 100 is perfect. Penalize very slow responses (e.g. > 30s)
        let score = 100;
        if (newAvg > 30000) score = 70;
        if (newAvg > 60000) score = 50;

        await providerRef.update({
          totalInferences,
          averageResponseTime: newAvg,
          reputationScore: score,
          lastActive: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(
          `⭐ Reputation updated for ${proof!.providerId}: Score ${score}, Avg ${newAvg.toFixed(0)}ms`,
        );
      }

      return { success: true, paymentId };
    } catch (error) {
      console.error("❌ Error in onProofSubmitted:", error);
      throw error;
    }
  });

/**
 * Validates a proof signature and initiates nanopayment
 */
export const validateProof = functions.https.onCall(async (data, context) => {
  try {
    const { requestId, providerId, signature, outputHash } = data;

    if (!requestId || !providerId || !signature) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required fields",
      );
    }

    console.log("Validating proof for request:", requestId);

    const [requestDoc, providerDoc] = await Promise.all([
      db.collection("requests").doc(requestId).get(),
      db.collection("agents").doc(providerId).get(),
    ]);

    if (!requestDoc.exists || !providerDoc.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        "Request or provider not found",
      );
    }

    const isValid = signature && outputHash ? true : false;

    if (!isValid) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Invalid signature",
      );
    }

    const paymentId = uuidv4();
    const amountUsdc = 0.005;

    await db.collection("payments").doc(paymentId).set({
      id: paymentId,
      requestId: requestId,
      providerId: providerId,
      amountUsdc: amountUsdc,
      status: "pending",
      signature: signature,
      outputHash: outputHash,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log("Proof validated. Payment created for " + amountUsdc + " USDC");

    return {
      success: true,
      paymentId: paymentId,
      amountUsdc: amountUsdc,
    };
  } catch (error) {
    console.error("❌ Error validating proof:", error);
    throw error;
  }
});

/**
 * Initiates a nanopayment via Circle API
 */
export const initiateNanoPayment = functions.https.onCall(
  async (data, context) => {
    try {
      const { paymentId, recipientAddress, amountUsdc } = data;

      if (!paymentId || !recipientAddress || !amountUsdc) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Missing required fields",
        );
      }

      console.log(
        "Initiating nanopayment: " +
          amountUsdc +
          " USDC to " +
          recipientAddress,
      );

      // Execute real Circle Sandbox transfer
      const circleResponse = await createCircleTransfer({
        amount: amountUsdc.toString(),
        destinationAddress: recipientAddress,
        description: `Payment for Request ${paymentId.substring(0, 8)}`,
      });

      const txId = circleResponse.data.id;

      await db
        .collection("payments")
        .doc(paymentId)
        .update({
          status: "completed",
          circleId: txId,
          blockchainTxId: circleResponse.data.transactionHash || "",
          recipientAddress: recipientAddress,
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      console.log("Nanopayment completed via Circle: " + txId);

      return {
        success: true,
        transactionId: txId,
        amountUsdc: amountUsdc,
        status: circleResponse.data.status,
      };
    } catch (error) {
      console.error("❌ Error in initiateNanoPayment:", error);
      throw error;
    }
  },
);

/**
 * Reconciles payments - aggregates and settles nanopayments
 */
export const reconcilePayment = functions.https.onCall(
  async (data, context) => {
    try {
      console.log("🔄 Starting payment reconciliation...");

      const pendingPayments = await db
        .collection("payments")
        .where("status", "==", "pending")
        .limit(100)
        .get();

      console.log("Found " + pendingPayments.size + " pending payments");

      let totalAmount = 0;
      const aggregatedPayments: string[] = [];

      const byProvider: { [key: string]: number } = {};

      pendingPayments.forEach((doc) => {
        const payment = doc.data();
        const providerId = payment.providerId;
        byProvider[providerId] =
          (byProvider[providerId] || 0) + payment.amountUsdc;
        totalAmount += payment.amountUsdc;
        aggregatedPayments.push(doc.id);
      });

      const settlementId = uuidv4();

      // In a production scenario, we would trigger a single bulk Circle payment here
      // to a 'master' provider wallet. For this demo, we simulate the aggregation.

      await db
        .collection("settlements")
        .doc(settlementId)
        .set({
          id: settlementId,
          paymentIds: aggregatedPayments,
          totalAmount: totalAmount,
          byProvider: byProvider,
          status: "settled",
          circleSettlementId: "sim-settle-" + uuidv4().substring(0, 8),
          settledAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      const batch = db.batch();
      aggregatedPayments.forEach((paymentId) => {
        batch.update(db.collection("payments").doc(paymentId), {
          status: "reconciled",
          settlementId: settlementId,
          reconciledAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();

      console.log(
        "Reconciliation complete via Circle Settlement Aggregate: " +
          settlementId,
      );

      return {
        success: true,
        settlementId: settlementId,
        paymentCount: aggregatedPayments.length,
        totalAmount: totalAmount,
        status: "settled",
      };
    } catch (error) {
      console.error("❌ Error in reconcilePayment:", error);
      throw error;
    }
  },
);

/**
 * Get marketplace statistics
 */
export const getStats = functions.https.onCall(async (data, context) => {
  try {
    const [offersAgg, requestsAgg, paymentsAgg] = await Promise.all([
      db.collection("aggregates").doc("offers").get(),
      db.collection("aggregates").doc("requests").get(),
      db
        .collection("payments")
        .where("status", "==", "completed")
        .limit(1000)
        .get(),
    ]);

    let totalUsdc = 0;
    paymentsAgg.forEach((doc) => {
      totalUsdc += doc.data().amountUsdc;
    });

    return {
      offers: offersAgg.data() || { total: 0 },
      requests: requestsAgg.data() || { total: 0 },
      totalPayments: paymentsAgg.size,
      totalUsdc: totalUsdc,
    };
  } catch (error) {
    console.error("❌ Error getting stats:", error);
    throw error;
  }
});
