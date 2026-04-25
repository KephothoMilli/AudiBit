import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from './firebase-init';

const getFirestore = () => getDb();

/**
 * Data Owner registers a new dataset
 */
export const createDataset = functions.https.onCall(async (data, context) => {
    try {
        const { ownerId, name, description, format, priceUsdc, license } = data;

        if (!ownerId || !name || !priceUsdc) {
            throw new functions.https.HttpsError('invalid-argument', 'Missing required fields: ownerId, name, priceUsdc');
        }

        const datasetId = uuidv4();
        const dataset = {
            id: datasetId,
            ownerId,
            name,
            description: description || '',
            format: format || 'json',
            priceUsdc: parseFloat(priceUsdc),
            license: license || 'standard',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        await getFirestore().collection('datasets').doc(datasetId).set(dataset);

        console.log('📦 New dataset registered:', datasetId, 'by owner:', ownerId);

        return { success: true, datasetId };
    } catch (error) {
        console.error('❌ Error creating dataset:', error);
        throw error;
    }
});

/**
 * Get available datasets
 */
export const getDatasets = functions.https.onCall(async (data, context) => {
    try {
        const { limit = 50 } = data;
        const snapshot = await getFirestore().collection('datasets')
            .orderBy('createdAt', 'desc')
            .limit(limit)
            .get();

        const datasets = snapshot.docs.map(doc => doc.data());
        return { success: true, datasets };
    } catch (error) {
        console.error('❌ Error getting datasets:', error);
        throw error;
    }
});

/**
 * Provider purchases a dataset
 */
export const purchaseDataset = functions.https.onCall(async (data, context) => {
    try {
        const { providerId, datasetId } = data;

        if (!providerId || !datasetId) {
            throw new functions.https.HttpsError('invalid-argument', 'Missing providerId or datasetId');
        }

        // Verify dataset exists
        const datasetDoc = await getFirestore().collection('datasets').doc(datasetId).get();
        if (!datasetDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Dataset not found');
        }
        const dataset = datasetDoc.data();

        // Check if already purchased
        const existingPurchase = await getFirestore().collection('dataset_purchases')
            .where('providerId', '==', providerId)
            .where('datasetId', '==', datasetId)
            .get();

        if (!existingPurchase.empty) {
            return { success: true, message: 'Dataset already purchased', purchaseId: existingPurchase.docs[0].id };
        }

        const purchaseId = uuidv4();
        const purchase = {
            id: purchaseId,
            providerId,
            datasetId,
            ownerId: dataset!.ownerId,
            priceUsdc: dataset!.priceUsdc,
            status: 'completed',
            purchasedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        // Batch update: 
        // 1. Create purchase record
        // 2. Add to provider's purchased list (optional, but good for indexing)
        const batch = getFirestore().batch();
        batch.set(getFirestore().collection('dataset_purchases').doc(purchaseId), purchase);
        
        // Also record a payment for the marketplace history
        const paymentId = uuidv4();
        batch.set(getFirestore().collection('payments').doc(paymentId), {
            id: paymentId,
            type: 'dataset_purchase',
            from: providerId,
            to: dataset!.ownerId,
            amountUsdc: dataset!.priceUsdc,
            datasetId: datasetId,
            status: 'completed',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        await batch.commit();

        console.log('💰 Dataset purchased:', datasetId, 'by provider:', providerId);

        return { success: true, purchaseId };
    } catch (error) {
        console.error('❌ Error purchasing dataset:', error);
        throw error;
    }
});
