import { v4 as uuidv4 } from 'uuid';

const CIRCLE_SANDBOX_API = 'https://api-sandbox.circle.com/v1';

// This would typically be stored in Firebase Context/Config
const getApiKey = () => {
    // Falls back to a placeholder for the demo
    return process.env.CIRCLE_API_KEY || 'SAND_API_KEY:f04068579ca6fbe987063cc159a67425:7034c718cc78013289063cc159a67425';
};

export interface CirclePaymentRequest {
    amount: string;
    destinationAddress: string;
    description?: string;
}

export async function createCircleTransfer(request: CirclePaymentRequest) {
    const idempotencyKey = uuidv4();
    const apiKey = getApiKey();

    const body = {
        idempotencyKey,
        amount: {
            amount: request.amount,
            currency: 'USD'
        },
        source: {
            type: 'wallet',
            id: '1000b' // Default master wallet in sandbox
        },
        destination: {
            type: 'blockchain',
            address: request.destinationAddress,
            chain: 'SOL' // Defaulting to Solana for this project's ethos
        },
        description: request.description || 'EDGEWASP Settlement'
    };

    try {
        const response = await fetch(`${CIRCLE_SANDBOX_API}/transfers`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Circle API Error: ${JSON.stringify(errorData)}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Circle Transfer failed:', error);
        throw error;
    }
}

export async function getCircleTransferStatus(transferId: string) {
    const apiKey = getApiKey();
    try {
        const response = await fetch(`${CIRCLE_SANDBOX_API}/transfers/${transferId}`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });

        if (!response.ok) throw new Error('Failed to fetch Circle transfer status');
        return await response.json();
    } catch (error) {
        console.error('Error fetching Circle status:', error);
        throw error;
    }
}
