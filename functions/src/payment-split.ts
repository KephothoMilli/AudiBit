import { getDb } from './firebase-init';
import * as admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';

const getFirestore = () => getDb();

interface SplitRecord {
    recipientId: string;
    amountUsdc: number;
    role: 'provider' | 'data_owner';
    datasetId?: string;
}

/**
 * Calculates payment splits between provider and data owners
 */
export async function calculateSplits(
    requestId: string,
    providerId: string,
    totalAmountUsdc: number,
    datasetIds: string[] = []
): Promise<SplitRecord[]> {
    const splits: SplitRecord[] = [];

    if (!datasetIds || datasetIds.length === 0) {
        // 100% to provider if no datasets used
        splits.push({
            recipientId: providerId,
            amountUsdc: totalAmountUsdc,
            role: 'provider',
        });
        return splits;
    }

    // Default: 70% provider, 30% data owners
    const providerShare = totalAmountUsdc * 0.70;
    const dataOwnerTotalShare = totalAmountUsdc * 0.30;
    const sharePerDataset = dataOwnerTotalShare / datasetIds.length;

    splits.push({
        recipientId: providerId,
        amountUsdc: providerShare,
        role: 'provider',
    });

    // Fetch dataset owners
    for (const datasetId of datasetIds) {
        const datasetDoc = await getFirestore().collection('datasets').doc(datasetId).get();
        if (datasetDoc.exists) {
            const dataset = datasetDoc.data();
            splits.push({
                recipientId: dataset!.ownerId,
                amountUsdc: sharePerDataset,
                role: 'data_owner',
                datasetId: datasetId,
            });
        } else {
            // If dataset not found, give back to provider or mark as error?
            // For now, give back to provider for safety
            splits[0].amountUsdc += sharePerDataset;
        }
    }

    return splits;
}

/**
 * Records individual payment splits in Firestore
 */
export async function recordSplits(paymentId: string, splits: SplitRecord[]) {
    const batch = getFirestore().batch();
    
    splits.forEach(split => {
        const splitId = uuidv4();
        batch.set(getFirestore().collection('payment_splits').doc(splitId), {
            id: splitId,
            paymentId,
            recipientId: split.recipientId,
            amountUsdc: split.amountUsdc,
            role: split.role,
            datasetId: split.datasetId || null,
            status: 'pending',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    });

    await batch.commit();
}
