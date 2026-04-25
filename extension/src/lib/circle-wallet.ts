/**
 * Circle Wallet Integration for Audibit
 *
 * Uses Circle's Developer-Controlled Wallets API to create and manage
 * wallets for users. Each user gets a unique wallet address that serves
 * as their authentication identifier.
 *
 * Storage: Uses IndexedDB for persistent wallet storage with localStorage fallback
 */

const FUNCTIONS_BASE_URL =
  import.meta.env.VITE_FUNCTIONS_BASE_URL ||
  "http://127.0.0.1:5001/w3bn3xt/us-central1";

// Enable mock mode for development when backend is not available
const ENABLE_MOCK_MODE = import.meta.env.VITE_ENABLE_MOCK_WALLET === "true";

const DB_NAME = "AudibitWalletDB";
const DB_VERSION = 1;
const WALLET_STORE = "wallets";

export interface CircleWallet {
  id: string;
  address: string;
  blockchain: string;
  state: string;
  createDate: string;
}

export interface StoredWallet extends CircleWallet {
  createdAt: number;
  lastUsed: number;
}

/**
 * Initialize IndexedDB for wallet storage
 */
function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(WALLET_STORE)) {
        const store = db.createObjectStore(WALLET_STORE, {
          keyPath: "address",
        });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
  });
}

/**
 * Save wallet to IndexedDB
 */
async function saveWalletToDB(wallet: StoredWallet): Promise<void> {
  try {
    const db = await initDB();
    const transaction = db.transaction([WALLET_STORE], "readwrite");
    const store = transaction.objectStore(WALLET_STORE);
    store.put(wallet);

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
    });
  } catch (error) {
    console.warn("IndexedDB save failed, falling back to localStorage:", error);
    // Fallback to localStorage
    localStorage.setItem(
      `audibit_wallet_${wallet.address}`,
      JSON.stringify(wallet),
    );
  }
}

/**
 * Get wallet from IndexedDB
 */
async function getWalletFromDB(address: string): Promise<StoredWallet | null> {
  try {
    const db = await initDB();
    const transaction = db.transaction([WALLET_STORE], "readonly");
    const store = transaction.objectStore(WALLET_STORE);
    const request = store.get(address);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        db.close();
        resolve(request.result || null);
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch (error) {
    console.warn("IndexedDB read failed, falling back to localStorage:", error);
    // Fallback to localStorage
    const stored = localStorage.getItem(`audibit_wallet_${address}`);
    return stored ? JSON.parse(stored) : null;
  }
}

/**
 * Get all wallets from IndexedDB
 */
async function getAllWalletsFromDB(): Promise<StoredWallet[]> {
  try {
    const db = await initDB();
    const transaction = db.transaction([WALLET_STORE], "readonly");
    const store = transaction.objectStore(WALLET_STORE);
    const request = store.getAll();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        db.close();
        resolve(request.result || []);
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch (error) {
    console.warn("IndexedDB read failed, falling back to localStorage:", error);
    // Fallback to localStorage
    const wallets: StoredWallet[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("audibit_wallet_")) {
        const stored = localStorage.getItem(key);
        if (stored) wallets.push(JSON.parse(stored));
      }
    }
    return wallets;
  }
}

/**
 * Delete wallet from IndexedDB
 */
async function deleteWalletFromDB(address: string): Promise<void> {
  try {
    const db = await initDB();
    const transaction = db.transaction([WALLET_STORE], "readwrite");
    const store = transaction.objectStore(WALLET_STORE);
    store.delete(address);

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
    });
  } catch (error) {
    console.warn(
      "IndexedDB delete failed, falling back to localStorage:",
      error,
    );
    // Fallback to localStorage
    localStorage.removeItem(`audibit_wallet_${address}`);
  }
}

export interface WalletBalance {
  token: {
    symbol: string;
    decimals: number;
  };
  amount: string;
}

/**
 * Create a mock wallet for development/testing
 */
function createMockWallet(): CircleWallet {
  const randomHex = () => Math.floor(Math.random() * 16).toString(16);
  const address = "0x" + Array.from({ length: 40 }, randomHex).join("");

  return {
    id: `mock-wallet-${Date.now()}`,
    address,
    blockchain: "ARC-TESTNET",
    state: "LIVE",
    createDate: new Date().toISOString(),
  };
}

/**
 * Create a new Circle wallet for a user
 * This calls the backend which uses Circle's API to create a dev-controlled wallet
 */
export async function createCircleWallet(): Promise<CircleWallet> {
  try {
    console.log("Creating Circle wallet...");
    console.log("Functions URL:", FUNCTIONS_BASE_URL);

    const response = await fetch(`${FUNCTIONS_BASE_URL}/createWallet`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        blockchain: "ARC-TESTNET", // Use Arc Testnet for development
      }),
    });

    console.log("Response status:", response.status);
    console.log(
      "Response headers:",
      Object.fromEntries((response.headers as any).entries()),
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        error: "Failed to create wallet",
        message: `HTTP ${response.status}: ${response.statusText}`,
      }));

      console.error("Wallet creation failed:", error);

      // Provide more helpful error messages
      if (response.status === 500) {
        throw new Error(
          error.message ||
            "Server error. Please ensure Circle API credentials are configured in Firebase Functions.",
        );
      } else if (response.status === 404) {
        throw new Error(
          "Wallet creation endpoint not found. Please ensure Firebase Functions are deployed.",
        );
      } else {
        throw new Error(
          error.message || error.error || "Failed to create wallet",
        );
      }
    }

    const data = await response.json();
    console.log("Wallet created successfully:", data.wallet);
    return data.wallet;
  } catch (error) {
    console.error("Error creating Circle wallet:", error);

    // Log detailed error information
    if (error instanceof TypeError && error.message.includes("fetch")) {
      console.error("Network error - possible causes:");
      console.error("1. Firebase Functions not running");
      console.error("2. CORS issue");
      console.error("3. Invalid Functions URL:", FUNCTIONS_BASE_URL);

      // If mock mode is enabled, create a mock wallet for testing
      if (ENABLE_MOCK_MODE) {
        console.warn("⚠️ MOCK MODE: Creating mock wallet for development");
        const mockWallet = createMockWallet();
        console.log("Mock wallet created:", mockWallet);
        return mockWallet;
      }

      throw new Error(
        "Network error: Cannot connect to backend. Please ensure Firebase Functions are running.",
      );
    }

    if (error instanceof Error) {
      throw error;
    }
    throw new Error(
      "Failed to create wallet. Please check your internet connection and try again.",
    );
  }
}

/**
 * Get wallet balance from Circle API
 */
export async function getWalletBalance(
  walletAddress: string,
): Promise<WalletBalance[]> {
  try {
    const response = await fetch(`${FUNCTIONS_BASE_URL}/getWalletBalance`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wallet-Address": walletAddress,
      },
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: "Failed to get balance" }));
      throw new Error(error.message || "Failed to get balance");
    }

    const data = await response.json();
    return data.balances;
  } catch (error) {
    console.error("Error getting wallet balance:", error);
    throw error;
  }
}

/**
 * Send USDC from one wallet to another
 */
export async function sendUSDC(params: {
  fromAddress: string;
  toAddress: string;
  amount: string;
}): Promise<{ transactionId: string; txHash?: string }> {
  try {
    const response = await fetch(`${FUNCTIONS_BASE_URL}/sendUSDC`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wallet-Address": params.fromAddress,
      },
      body: JSON.stringify({
        destinationAddress: params.toAddress,
        amount: params.amount,
      }),
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: "Failed to send USDC" }));
      throw new Error(error.message || "Failed to send USDC");
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error sending USDC:", error);
    throw error;
  }
}

/**
 * Get or create a wallet for the current user
 * Stores wallet in IndexedDB and chrome.storage for redundancy
 */
export async function getOrCreateWallet(): Promise<string> {
  try {
    // Check chrome.storage first (fastest)
    const result = await chrome.storage.local.get(["circleWalletAddress"]);

    if (result.circleWalletAddress) {
      const address = result.circleWalletAddress as string;
      console.log("Wallet found in chrome.storage:", address);

      // Verify wallet exists in IndexedDB
      const storedWallet = await getWalletFromDB(address);
      if (storedWallet) {
        // Update last used timestamp
        storedWallet.lastUsed = Date.now();
        await saveWalletToDB(storedWallet);
        return address;
      }
    }

    // Check IndexedDB for any existing wallets
    const allWallets = await getAllWalletsFromDB();
    if (allWallets.length > 0) {
      // Use the most recently used wallet
      const latestWallet = allWallets.sort(
        (a, b) => b.lastUsed - a.lastUsed,
      )[0];
      console.log("Wallet found in IndexedDB:", latestWallet.address);

      // Sync to chrome.storage
      await chrome.storage.local.set({
        circleWalletAddress: latestWallet.address,
        circleWalletId: latestWallet.id,
        circleWalletBlockchain: latestWallet.blockchain,
      });

      // Update last used
      latestWallet.lastUsed = Date.now();
      await saveWalletToDB(latestWallet);

      return latestWallet.address;
    }

    // No existing wallet found, create new one
    console.log("No existing wallet found, creating new one...");
    const wallet = await createCircleWallet();

    // Create stored wallet object
    const storedWallet: StoredWallet = {
      ...wallet,
      createdAt: Date.now(),
      lastUsed: Date.now(),
    };

    // Store in IndexedDB
    await saveWalletToDB(storedWallet);
    console.log("Wallet saved to IndexedDB");

    // Store in chrome.storage for quick access
    await chrome.storage.local.set({
      circleWalletAddress: wallet.address,
      circleWalletId: wallet.id,
      circleWalletBlockchain: wallet.blockchain,
    });
    console.log("Wallet saved to chrome.storage");

    return wallet.address;
  } catch (error) {
    console.error("Error in getOrCreateWallet:", error);
    throw error;
  }
}

/**
 * Get the current wallet address from storage
 */
export async function getConnectedWallet(): Promise<string | null> {
  try {
    const result = await chrome.storage.local.get(["circleWalletAddress"]);
    return (result.circleWalletAddress as string) || null;
  } catch (error) {
    console.error("Error getting connected wallet:", error);
    return null;
  }
}

/**
 * Get full wallet details from storage
 */
export async function getWalletDetails(): Promise<StoredWallet | null> {
  try {
    const address = await getConnectedWallet();
    if (!address) return null;

    return await getWalletFromDB(address);
  } catch (error) {
    console.error("Error getting wallet details:", error);
    return null;
  }
}

/**
 * Disconnect wallet (clear from storage)
 */
export async function disconnectWallet(): Promise<void> {
  try {
    // Clear from chrome.storage
    await chrome.storage.local.remove([
      "circleWalletAddress",
      "circleWalletId",
      "circleWalletBlockchain",
    ]);

    // Optionally keep in IndexedDB for future use
    // If you want to delete from IndexedDB too, uncomment:
    // const address = await getConnectedWallet();
    // if (address) await deleteWalletFromDB(address);

    console.log("Wallet disconnected");
  } catch (error) {
    console.error("Error disconnecting wallet:", error);
    throw error;
  }
}

/**
 * Delete wallet permanently from all storage
 */
export async function deleteWallet(address: string): Promise<void> {
  try {
    await deleteWalletFromDB(address);

    const currentAddress = await getConnectedWallet();
    if (currentAddress === address) {
      await disconnectWallet();
    }

    console.log("Wallet deleted permanently:", address);
  } catch (error) {
    console.error("Error deleting wallet:", error);
    throw error;
  }
}

/**
 * Check if user has a wallet
 */
export async function hasWallet(): Promise<boolean> {
  const address = await getConnectedWallet();
  return address !== null;
}

/**
 * Get all stored wallets (for multi-wallet support)
 */
export async function getAllWallets(): Promise<StoredWallet[]> {
  try {
    return await getAllWalletsFromDB();
  } catch (error) {
    console.error("Error getting all wallets:", error);
    return [];
  }
}

/**
 * Switch to a different wallet
 */
export async function switchWallet(address: string): Promise<void> {
  try {
    const wallet = await getWalletFromDB(address);
    if (!wallet) {
      throw new Error("Wallet not found");
    }

    // Update chrome.storage
    await chrome.storage.local.set({
      circleWalletAddress: wallet.address,
      circleWalletId: wallet.id,
      circleWalletBlockchain: wallet.blockchain,
    });

    // Update last used
    wallet.lastUsed = Date.now();
    await saveWalletToDB(wallet);

    console.log("Switched to wallet:", address);
  } catch (error) {
    console.error("Error switching wallet:", error);
    throw error;
  }
}

/**
 * Purchase credits with USDC
 * Sends USDC to platform wallet and credits user account
 */
export async function purchaseCredits(params: {
  walletAddress: string;
  packageType: "small" | "medium" | "large";
}): Promise<{ transactionId: string; credits: number }> {
  try {
    const response = await fetch(`${FUNCTIONS_BASE_URL}/purchaseCredits`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wallet-Address": params.walletAddress,
      },
      body: JSON.stringify({
        packageType: params.packageType,
      }),
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: "Failed to purchase credits" }));
      throw new Error(error.message || "Failed to purchase credits");
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error purchasing credits:", error);
    throw error;
  }
}

/**
 * Request test USDC from faucet (testnet only)
 */
export async function requestFaucetFunds(walletAddress: string): Promise<void> {
  // Open Circle faucet in new tab
  window.open(
    `https://faucet.circle.com?address=${walletAddress}&network=arc-testnet`,
    "_blank",
  );
}

/**
 * Get payment logs for a wallet
 */
export async function getPaymentLogs(walletAddress: string): Promise<any[]> {
  try {
    const response = await fetch(`${FUNCTIONS_BASE_URL}/getPaymentLogs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wallet-Address": walletAddress,
      },
    });

    if (!response.ok) {
      throw new Error("Failed to get payment logs");
    }

    const data = await response.json();
    return data.logs;
  } catch (error) {
    console.error("Error getting payment logs:", error);
    return [];
  }
}

/**
 * Verify a wallet address exists in Circle without importing
 */
export async function verifyWalletAddress(walletAddress: string): Promise<{
  valid: boolean;
  exists: boolean;
  alreadyImported?: boolean;
  wallet?: CircleWallet;
  message?: string;
}> {
  try {
    const response = await fetch(`${FUNCTIONS_BASE_URL}/verifyWallet`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ walletAddress }),
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: "Failed to verify wallet" }));
      throw new Error(error.message || "Failed to verify wallet");
    }

    return await response.json();
  } catch (error) {
    console.error("Error verifying wallet:", error);
    throw error;
  }
}

/**
 * Import an existing Circle wallet by address
 */
export async function importWallet(walletAddress: string): Promise<{
  success: boolean;
  wallet: CircleWallet;
  message: string;
}> {
  try {
    const response = await fetch(`${FUNCTIONS_BASE_URL}/importWallet`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ walletAddress }),
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: "Failed to import wallet" }));
      throw new Error(
        error.message || error.error || "Failed to import wallet",
      );
    }

    const data = await response.json();

    // Store imported wallet in IndexedDB and chrome.storage
    const storedWallet: StoredWallet = {
      ...data.wallet,
      createdAt: Date.now(),
      lastUsed: Date.now(),
    };

    await saveWalletToDB(storedWallet);
    await chrome.storage.local.set({
      circleWalletAddress: data.wallet.address,
      circleWalletId: data.wallet.id,
      circleWalletBlockchain: data.wallet.blockchain,
    });

    return data;
  } catch (error) {
    console.error("Error importing wallet:", error);
    throw error;
  }
}

/**
 * List all Circle wallets available for import
 */
export async function listAvailableWallets(): Promise<{
  wallets: Array<CircleWallet & { imported: boolean }>;
  total: number;
}> {
  try {
    const response = await fetch(`${FUNCTIONS_BASE_URL}/listCircleWallets`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: "Failed to list wallets" }));
      throw new Error(error.message || "Failed to list wallets");
    }

    return await response.json();
  } catch (error) {
    console.error("Error listing wallets:", error);
    throw error;
  }
}

/**
 * Bridge USDC from Ethereum Sepolia to Arc Testnet
 */
export async function bridgeFromEthereum(params: {
  walletAddress: string;
  amount: string;
}): Promise<{
  success: boolean;
  transactionHash?: string;
  explorerUrl?: string;
  message: string;
}> {
  try {
    const response = await fetch(`${FUNCTIONS_BASE_URL}/bridgeFromEthereum`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wallet-Address": params.walletAddress,
      },
      body: JSON.stringify({
        amount: params.amount,
      }),
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: "Failed to bridge tokens" }));
      throw new Error(error.message || "Failed to bridge tokens");
    }

    return await response.json();
  } catch (error) {
    console.error("Error bridging from Ethereum:", error);
    throw error;
  }
}

/**
 * Get bridge estimate
 */
export async function getBridgeEstimate(
  amount: string,
): Promise<{ estimatedTime: string; estimatedFee: string; message: string }> {
  try {
    const response = await fetch(`${FUNCTIONS_BASE_URL}/getBridgeEstimate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount }),
    });

    if (!response.ok) {
      throw new Error("Failed to get bridge estimate");
    }

    return await response.json();
  } catch (error) {
    console.error("Error getting bridge estimate:", error);
    throw error;
  }
}
/**
 * Bridge USDC from Solana Devnet to Arc Testnet
 */
export async function bridgeFromSolana(params: {
  walletAddress: string;
  amount: string;
}): Promise<{
  success: boolean;
  transactionHash?: string;
  explorerUrl?: string;
  message: string;
}> {
  try {
    const response = await fetch(`${FUNCTIONS_BASE_URL}/bridgeFromSolana`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wallet-Address": params.walletAddress,
      },
      body: JSON.stringify({
        amount: params.amount,
      }),
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: "Failed to bridge tokens from Solana" }));
      throw new Error(error.message || "Failed to bridge tokens from Solana");
    }

    return await response.json();
  } catch (error) {
    console.error("Error bridging from Solana:", error);
    throw error;
  }
}

/**
 * Ensure multi-chain wallets exist for bridging
 */
export async function ensureMultiChainWallets(walletAddress: string): Promise<any> {
  try {
    const response = await fetch(`${FUNCTIONS_BASE_URL}/ensureMultiChainWallets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wallet-Address": walletAddress,
      },
    });

    if (!response.ok) {
      throw new Error("Failed to ensure multi-chain wallets");
    }

    return await response.json();
  } catch (error) {
    console.error("Error ensuring multi-chain wallets:", error);
    throw error;
  }
}

/**
 * Check balances across all chains
 */
export async function checkCrossChainBalances(walletAddress: string): Promise<any> {
  try {
    const response = await fetch(`${FUNCTIONS_BASE_URL}/checkBalance`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wallet-Address": walletAddress,
      },
      body: JSON.stringify({ 
        specs: { screenshots: 0, domNodes: 0, securityRules: 0, isDeepScan: false } 
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to check cross-chain balances");
    }

    return await response.json();
  } catch (error) {
    console.error("Error checking cross-chain balances:", error);
    throw error;
  }
}
