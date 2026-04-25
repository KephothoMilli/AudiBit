/**
 * Arc Network Integration for USDC Payments
 * Handles wallet connection and micro-payment flows
 */

export interface ArcWallet {
  address: string;
  connected: boolean;
}

export interface PaymentResult {
  success: boolean;
  transactionHash?: string;
  error?: string;
}

/**
 * Connect to Arc Network wallet
 */
export async function connectArcWallet(): Promise<ArcWallet> {
  try {
    // Check if Arc wallet extension is available
    if (!(window as any).arc) {
      throw new Error(
        "Arc wallet extension not found. Please install Arc wallet.",
      );
    }

    const arc = (window as any).arc;

    // Request account access
    const accounts = await arc.request({ method: "eth_requestAccounts" });

    if (!accounts || accounts.length === 0) {
      throw new Error("No accounts found");
    }

    const address = accounts[0];

    // Store wallet address in chrome storage
    await chrome.storage.local.set({ arcWalletAddress: address });

    console.log("✅ Arc wallet connected:", address);

    return {
      address,
      connected: true,
    };
  } catch (error) {
    console.error("❌ Failed to connect Arc wallet:", error);
    throw error;
  }
}

/**
 * Disconnect Arc wallet
 */
export async function disconnectArcWallet(): Promise<void> {
  await chrome.storage.local.remove("arcWalletAddress");
  console.log("🔌 Arc wallet disconnected");
}

/**
 * Get connected wallet address
 */
export async function getConnectedWallet(): Promise<string | null> {
  const result = await chrome.storage.local.get("arcWalletAddress");
  return (result.arcWalletAddress as string) || null;
}

/**
 * Send USDC payment via Arc Network
 */
export async function sendUSDCPayment(
  recipientAddress: string,
  amountUsdc: number,
): Promise<PaymentResult> {
  try {
    if (!(window as any).arc) {
      throw new Error("Arc wallet extension not found");
    }

    const arc = (window as any).arc;
    const usdcContractAddress = import.meta.env
      .VITE_CIRCLE_USDC_CONTRACT_ADDRESS;

    if (!usdcContractAddress) {
      throw new Error("USDC contract address not configured");
    }

    // Convert USDC amount to smallest unit (6 decimals)
    const amountInSmallestUnit = Math.floor(amountUsdc * 1_000_000);

    // ERC-20 transfer function signature
    const transferData =
      "0xa9059cbb" + // transfer(address,uint256) function signature
      recipientAddress.slice(2).padStart(64, "0") + // recipient address
      amountInSmallestUnit.toString(16).padStart(64, "0"); // amount

    // Send transaction
    const txHash = await arc.request({
      method: "eth_sendTransaction",
      params: [
        {
          to: usdcContractAddress,
          from: await getConnectedWallet(),
          data: transferData,
          value: "0x0",
        },
      ],
    });

    console.log("✅ USDC payment sent:", txHash);

    return {
      success: true,
      transactionHash: txHash,
    };
  } catch (error) {
    console.error("❌ Failed to send USDC payment:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get USDC balance
 */
export async function getUSDCBalance(): Promise<number> {
  try {
    if (!(window as any).arc) {
      throw new Error("Arc wallet extension not found");
    }

    const arc = (window as any).arc;
    const usdcContractAddress = import.meta.env
      .VITE_CIRCLE_USDC_CONTRACT_ADDRESS;
    const walletAddress = await getConnectedWallet();

    if (!walletAddress) {
      throw new Error("Wallet not connected");
    }

    // ERC-20 balanceOf function signature
    const balanceOfData =
      "0x70a08231" + // balanceOf(address) function signature
      walletAddress.slice(2).padStart(64, "0"); // wallet address

    const result = await arc.request({
      method: "eth_call",
      params: [
        {
          to: usdcContractAddress,
          data: balanceOfData,
        },
        "latest",
      ],
    });

    // Convert hex result to decimal and adjust for 6 decimals
    const balanceInSmallestUnit = parseInt(result, 16);
    const balance = balanceInSmallestUnit / 1_000_000;

    return balance;
  } catch (error) {
    console.error("❌ Failed to get USDC balance:", error);
    return 0;
  }
}

/**
 * Check if Arc wallet is installed
 */
export function isArcWalletInstalled(): boolean {
  return typeof (window as any).arc !== "undefined";
}
