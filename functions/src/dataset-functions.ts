import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "./firebase-init";

const getFirestore = () => getDb();

export const createDataset = onCall(async (request) => {
  try {
    const { ownerId, name, description, format, priceUsdc, license } =
      request.data;

    if (!ownerId || !name || !priceUsdc) {
      throw new HttpsError(
        "invalid-argument",
        "Missing required fields: ownerId, name, priceUsdc",
      );
    }

    const datasetId = uuidv4();
    const dataset = {
      id: datasetId,
      ownerId,
      name,
      description: description || "",
      format: format || "json",
      priceUsdc: parseFloat(priceUsdc),
      license: license || "standard",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await getFirestore().collection("datasets").doc(datasetId).set(dataset);
    return { success: true, datasetId };
  } catch (error) {
    console.error("❌ Error creating dataset:", error);
    throw error;
  }
});

export const getDatasets = onCall(async (request) => {
  try {
    const { limit = 50 } = request.data;
    const snapshot = await getFirestore()
      .collection("datasets")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    const datasets = snapshot.docs.map((doc) => doc.data());
    return { success: true, datasets };
  } catch (error) {
    console.error("❌ Error getting datasets:", error);
    throw error;
  }
});

export const purchaseDataset = onCall(async (request) => {
  try {
    const { providerId, datasetId } = request.data;

    if (!providerId || !datasetId) {
      throw new HttpsError(
        "invalid-argument",
        "Missing providerId or datasetId",
      );
    }

    const datasetDoc = await getFirestore()
      .collection("datasets")
      .doc(datasetId)
      .get();
    if (!datasetDoc.exists) {
      throw new HttpsError("not-found", "Dataset not found");
    }
    const dataset = datasetDoc.data();

    const existingPurchase = await getFirestore()
      .collection("dataset_purchases")
      .where("providerId", "==", providerId)
      .where("datasetId", "==", datasetId)
      .get();

    if (!existingPurchase.empty) {
      return {
        success: true,
        message: "Dataset already purchased",
        purchaseId: existingPurchase.docs[0].id,
      };
    }

    const purchaseId = uuidv4();
    const purchase = {
      id: purchaseId,
      providerId,
      datasetId,
      ownerId: dataset!.ownerId,
      priceUsdc: dataset!.priceUsdc,
      status: "completed",
      purchasedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const batch = getFirestore().batch();
    batch.set(
      getFirestore().collection("dataset_purchases").doc(purchaseId),
      purchase,
    );

    const paymentId = uuidv4();
    batch.set(getFirestore().collection("payments").doc(paymentId), {
      id: paymentId,
      type: "dataset_purchase",
      from: providerId,
      to: dataset!.ownerId,
      amountUsdc: dataset!.priceUsdc,
      datasetId,
      status: "completed",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await batch.commit();
    return { success: true, purchaseId };
  } catch (error) {
    console.error("❌ Error purchasing dataset:", error);
    throw error;
  }
});
