// Load environment variables from .env file
import * as dotenv from "dotenv";
dotenv.config();

import * as admin from "firebase-admin";
import { v4 as uuidv4 } from "uuid";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { calculateSplits, recordSplits } from "./payment-split";
import { createCircleTransfer } from "./circle-api";

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

// ─── Firestore Triggers ───────────────────────────────────────────────────────

export const onNewOffer = onDocumentCreated(
  "offers/{offerId}",
  async (event) => {
    try {
      const offer = event.data?.data();
      const offerId = event.params.offerId;

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
        .catch(() =>
          db
            .collection("aggregates")
            .doc("offers")
            .set({
              total: 1,
              activeOffers: 1,
              byModel: { [offer!.model]: 1 },
              lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            }),
        );

      return { success: true, offerId };
    } catch (error) {
      console.error("❌ Error in onNewOffer:", error);
      throw error;
    }
  },
);

export const onRequestCreate = onDocumentCreated(
  "requests/{requestId}",
  async (event) => {
    try {
      const request = event.data?.data();
      const requestId = event.params.requestId;

      console.log("📨 New request created:", requestId);

      const offerDoc = await db
        .collection("offers")
        .doc(request!.offerId)
        .get();
      if (!offerDoc.exists) throw new Error("Offer not found");

      await event.data!.ref.update({
        status: "forwarded",
        forwardedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await db
        .collection("aggregates")
        .doc("requests")
        .update({
          total: admin.firestore.FieldValue.increment(1),
          pending: admin.firestore.FieldValue.increment(1),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        })
        .catch(() =>
          db.collection("aggregates").doc("requests").set({
            total: 1,
            pending: 1,
            completed: 0,
            failed: 0,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          }),
        );

      return { success: true, requestId };
    } catch (error) {
      console.error("❌ Error in onRequestCreate:", error);
      throw error;
    }
  },
);

export const onProofSubmitted = onDocumentCreated(
  "usage_proofs/{proofId}",
  async (event) => {
    try {
      const proof = event.data?.data();
      const proofId = event.params.proofId;

      console.log("✅ Proof submitted:", proofId);

      const requestDoc = await db
        .collection("requests")
        .doc(proof!.requestId)
        .get();
      if (!requestDoc.exists) throw new Error("Request not found");

      const request = requestDoc.data();
      const datasetIds = request!.datasetIds || [];
      const paymentId = uuidv4();
      const amountUsdc = request!.amountUsdc || 0.005;

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
          amountUsdc,
          datasetIds,
          status: "pending",
          proofId,
          hasSplits: splits.length > 1,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      if (splits.length > 0) await recordSplits(paymentId, splits);

      await requestDoc.ref.update({
        status: "completed",
        proofId,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Reputation update
      const providerRef = db.collection("agents").doc(proof!.providerId);
      const agentSnap = await providerRef.get();
      if (agentSnap.exists) {
        const agent = agentSnap.data();
        const totalInferences = (agent!.totalInferences || 0) + 1;
        const createdAt = request!.createdAt.toDate();
        const responseTimeMs = Date.now() - createdAt.getTime();
        const oldAvg = agent!.averageResponseTime || responseTimeMs;
        const newAvg =
          (oldAvg * (totalInferences - 1) + responseTimeMs) / totalInferences;
        const score = newAvg > 60000 ? 50 : newAvg > 30000 ? 70 : 100;

        await providerRef.update({
          totalInferences,
          averageResponseTime: newAvg,
          reputationScore: score,
          lastActive: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      return { success: true, paymentId };
    } catch (error) {
      console.error("❌ Error in onProofSubmitted:", error);
      throw error;
    }
  },
);

// ─── Callable Functions ───────────────────────────────────────────────────────

export const validateProof = onCall(async (request) => {
  const { requestId, providerId, signature, outputHash } = request.data;

  if (!requestId || !providerId || !signature) {
    throw new HttpsError("invalid-argument", "Missing required fields");
  }

  const [requestDoc, providerDoc] = await Promise.all([
    db.collection("requests").doc(requestId).get(),
    db.collection("agents").doc(providerId).get(),
  ]);

  if (!requestDoc.exists || !providerDoc.exists) {
    throw new HttpsError("not-found", "Request or provider not found");
  }

  if (!signature || !outputHash) {
    throw new HttpsError("permission-denied", "Invalid signature");
  }

  const paymentId = uuidv4();
  const amountUsdc = 0.005;

  await db.collection("payments").doc(paymentId).set({
    id: paymentId,
    requestId,
    providerId,
    amountUsdc,
    status: "pending",
    signature,
    outputHash,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, paymentId, amountUsdc };
});

export const initiateNanoPayment = onCall(async (request) => {
  const { paymentId, recipientAddress, amountUsdc } = request.data;

  if (!paymentId || !recipientAddress || !amountUsdc) {
    throw new HttpsError("invalid-argument", "Missing required fields");
  }

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
      recipientAddress,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

  return {
    success: true,
    transactionId: txId,
    amountUsdc,
    status: circleResponse.data.status,
  };
});

export const reconcilePayment = onCall(async (_request) => {
  const pendingPayments = await db
    .collection("payments")
    .where("status", "==", "pending")
    .limit(100)
    .get();

  let totalAmount = 0;
  const aggregatedPayments: string[] = [];
  const byProvider: Record<string, number> = {};

  pendingPayments.forEach((doc) => {
    const payment = doc.data();
    byProvider[payment.providerId] =
      (byProvider[payment.providerId] || 0) + payment.amountUsdc;
    totalAmount += payment.amountUsdc;
    aggregatedPayments.push(doc.id);
  });

  const settlementId = uuidv4();

  await db
    .collection("settlements")
    .doc(settlementId)
    .set({
      id: settlementId,
      paymentIds: aggregatedPayments,
      totalAmount,
      byProvider,
      status: "settled",
      circleSettlementId: "sim-settle-" + uuidv4().substring(0, 8),
      settledAt: admin.firestore.FieldValue.serverTimestamp(),
    });

  const batch = db.batch();
  aggregatedPayments.forEach((pid) => {
    batch.update(db.collection("payments").doc(pid), {
      status: "reconciled",
      settlementId,
      reconciledAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();

  return {
    success: true,
    settlementId,
    paymentCount: aggregatedPayments.length,
    totalAmount,
    status: "settled",
  };
});

export const getStats = onCall(async (_request) => {
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
    totalUsdc,
  };
});

