import type { ExtensionMessage, AuditResponse } from "../types";

console.log("Audibit Service Worker Initialized");

// Track connected wallet address
let connectedWallet: string | null = null;

// Initialize wallet state from storage
chrome.storage.local.get(["circleWalletAddress"], (result) => {
  connectedWallet = (result.circleWalletAddress as string) || null;
  console.log("Wallet state restored:", connectedWallet);
});

// Listen for wallet connection changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes.circleWalletAddress) {
    connectedWallet = (changes.circleWalletAddress.newValue as string) || null;
    console.log("Wallet state updated:", connectedWallet);

    if (connectedWallet) {
      // Fetch credits when wallet connects
      updateCredits(connectedWallet);
    }
  }
});

async function updateCredits(walletAddress: string) {
  try {
    // In a real implementation, this would call your backend API
    // For now, we'll use local storage
    const result = await chrome.storage.local.get([`credits_${walletAddress}`]);
    const credits = (result[`credits_${walletAddress}`] as number) || 0;
    console.log(`Credits for ${walletAddress}:`, credits);
  } catch (error) {
    console.error("Failed to update credits:", error);
  }
}

// Message Listener
chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    if (message.type === "WALLET_STATUS_REQUEST") {
      sendResponse({
        type: "WALLET_STATUS_RESPONSE",
        status: connectedWallet ? "CONNECTED" : "DISCONNECTED",
        walletAddress: connectedWallet || undefined,
      });
      return false; // Sync response — no need to keep channel open
    }

    if (message.type === "GET_CREDITS_REQUEST") {
      if (!connectedWallet) {
        sendResponse({ type: "GET_CREDITS_RESPONSE", credits: 0 });
        return false;
      }

      chrome.storage.local.get([`credits_${connectedWallet}`], (result) => {
        sendResponse({
          type: "GET_CREDITS_RESPONSE",
          credits: (result[`credits_${connectedWallet}`] as number) || 0,
        });
      });
      return true; // Keep channel open for async
    }

    if (message.type === "TRIGGER_AUDIT") {
      // Fire-and-forget — do NOT return true or call sendResponse
      // The popup listens for AGENT_STATUS / AUDIT_COMPLETE broadcasts instead
      handleAudit(message).catch((err) =>
        console.error("handleAudit unhandled error:", err),
      );
      return false;
    }

    return false;
  },
);

async function handleAudit(
  message: Extract<ExtensionMessage, { type: "TRIGGER_AUDIT" }>,
) {
  console.log("Service Worker: Received TRIGGER_AUDIT", message);

  // Helper function to send status updates
  const sendStatus = (
    status: string,
    statusMessage: string,
    progress?: number,
  ) => {
    chrome.runtime.sendMessage({
      type: "AGENT_STATUS",
      status: {
        agentType: message.auditType,
        status,
        message: statusMessage,
        progress,
        timestamp: Date.now(),
      },
    });
  };

  try {
    const walletAddress = message.walletAddress || connectedWallet;

    if (!walletAddress) {
      sendStatus(
        "error",
        "No wallet connected. Please create a Circle wallet first.",
      );
      chrome.runtime.sendMessage({
        type: "AUDIT_ERROR",
        error: "No wallet connected. Please create a Circle wallet first.",
      });
      return;
    }

    sendStatus("analyzing", "Checking page accessibility...", 10);

    // Get the active tab
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab.id) {
      throw new Error("No active tab found");
    }

    // Check if the tab URL is a restricted page
    if (
      tab.url?.startsWith("chrome://") ||
      tab.url?.startsWith("chrome-extension://") ||
      tab.url?.startsWith("edge://") ||
      tab.url?.startsWith("about:")
    ) {
      throw new Error(
        "Cannot audit browser internal pages. Please navigate to a regular website.",
      );
    }

    sendStatus("analyzing", "Loading content script...", 20);

    // Ensure content script is loaded
    let contentScriptLoaded = false;
    let pingRetries = 5;

    while (!contentScriptLoaded && pingRetries > 0) {
      try {
        // Try to ping the content script
        const pingResponse = await chrome.tabs.sendMessage(tab.id, {
          type: "PING",
        });
        contentScriptLoaded = pingResponse?.pong === true;
        if (contentScriptLoaded) {
          console.log("Content script is loaded and responsive");
          break;
        }
      } catch (error) {
        console.log(
          `Content script not responding, waiting... (${pingRetries} retries left)`,
        );
        pingRetries--;
        if (pingRetries > 0) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }

    // If content script still not loaded, try manual injection as fallback
    if (!contentScriptLoaded) {
      console.log("Attempting manual content script injection...");
      sendStatus("analyzing", "Injecting content script...", 30);

      try {
        // Get the manifest to find the content script file
        const manifest = chrome.runtime.getManifest();
        const contentScriptFile = manifest.content_scripts?.[0]?.js?.[0];

        if (!contentScriptFile) {
          throw new Error("Content script file not found in manifest");
        }

        console.log("Injecting content script:", contentScriptFile);

        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: [contentScriptFile],
        });

        // Wait for script to initialize
        await new Promise((resolve) => setTimeout(resolve, 1500));

        // Try ping again with more retries
        let injectionRetries = 3;
        while (injectionRetries > 0 && !contentScriptLoaded) {
          try {
            const pingResponse = await chrome.tabs.sendMessage(tab.id, {
              type: "PING",
            });
            contentScriptLoaded = pingResponse?.pong === true;
            if (contentScriptLoaded) {
              console.log("Content script manually injected and responsive");
              break;
            }
          } catch (pingError) {
            console.log(`Injection ping retry ${injectionRetries}...`);
            injectionRetries--;
            if (injectionRetries > 0) {
              await new Promise((resolve) => setTimeout(resolve, 500));
            }
          }
        }
      } catch (injectError) {
        console.error("Failed to manually inject content script:", injectError);
      }
    }

    if (!contentScriptLoaded) {
      throw new Error(
        "Content script not loaded. Please refresh the page (F5) and try again.",
      );
    }

    // Enable Audit Mode with Wand integration
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: "ENABLE_AUDIT_MODE",
        agentType: message.auditType,
      });
      console.log(`✅ Audit mode enabled for ${message.auditType} agent`);
    } catch (error) {
      console.warn("Could not enable audit mode:", error);
    }

    sendStatus("analyzing", "Extracting page DOM...", 40);

    // Request DOM from content script with retry
    let response;
    let retries = 3;

    while (retries > 0) {
      try {
        response = await chrome.tabs.sendMessage(tab.id, { type: "GET_DOM" });
        if (response && response.dom) {
          break;
        }
      } catch (error) {
        retries--;
        if (retries === 0) {
          throw new Error(
            "Failed to communicate with page. Please refresh and try again.",
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }

    if (!response || !response.dom) {
      throw new Error("Failed to get DOM from page");
    }

    // Collect page headers and libraries for security agent
    let pageHeaders: Record<string, string> = {};
    let pageLibraries: string[] = [];
    if (message.auditType === "security") {
      try {
        const meta = await chrome.tabs.sendMessage(tab.id, {
          type: "GET_PAGE_META",
        });
        pageHeaders = meta?.headers || {};
        pageLibraries = meta?.libraries || [];
      } catch {
        // Non-fatal — security agent will work with what it has
      }
    }

    console.log("DOM retrieved, calling Coordinator API...");
    sendStatus(
      "bridging",
      `Analyzing cross-chain liquidity & preparing agents...`,
      50,
    );

    // Call audit API
    const auditResult = await callAuditAPI({
      url: message.url,
      dom: response.dom,
      auditType: message.auditType,
      walletAddress,
      headers: pageHeaders,
      libraries: pageLibraries,
    });

    console.log("Audit complete:", auditResult);
    sendStatus("settling", "Settling Arc nano payment...", 90);

    // Flatten issues from agentic results[] or direct issues array
    const flatIssues: any[] = auditResult.results
      ? auditResult.results.flatMap((r: any) => r.issues || [])
      : auditResult.issues || [];

    // Derive cost from payment, settlement, or per-agent results
    const totalCostUsdc =
      auditResult.payment?.amountUsdc ||
      auditResult.settlement?.cost?.totalUsdc ||
      (auditResult.results
        ? auditResult.results
            .reduce(
              (sum: number, r: any) =>
                sum + parseFloat(r.cost?.totalUsdc || "0"),
              0,
            )
            .toFixed(6)
        : "0");

    const txId =
      auditResult.payment?.transactionId ||
      auditResult.settlement?.transactionId ||
      auditResult.results?.[0]?.transactionId ||
      "";

    // Small delay to show settling status
    await new Promise((resolve) => setTimeout(resolve, 500));

    sendStatus(
      "complete",
      `Analysis complete! Found ${flatIssues.length} issues.`,
      100,
    );

    // ── Save audit to persistent history ──────────────────────────────────────
    const historyKey = `audits_${walletAddress}`;
    const historyResult = await chrome.storage.local.get([historyKey]);
    const history = (historyResult[historyKey] as any[]) || [];

    const auditEntry = {
      id: auditResult.auditId || Date.now().toString(),
      url: message.url,
      type: message.auditType,
      issuesCount: flatIssues.length,
      issues: flatIssues,
      // Per-agent breakdown for expandable detail
      agentResults:
        auditResult.results?.map((r: any) => ({
          agentType: r.agentType,
          issues: r.issues || [],
          cost: r.cost?.totalUsdc || "0",
          executionTime: r.executionTime,
          transactionId: r.transactionId,
        })) || [],
      cost: totalCostUsdc,
      transactionId: txId,
      creditsUsed: auditResult.totalCost || auditResult.creditsUsed || 0,
      timestamp: Date.now(),
    };

    history.unshift(auditEntry);
    if (history.length > 50) history.splice(50);
    await chrome.storage.local.set({ [historyKey]: history });

    // ── Cache settlements from Firestore into local storage ───────────────────
    try {
      const FUNCTIONS_BASE_URL =
        (import.meta as any).env?.VITE_FUNCTIONS_BASE_URL ||
        "http://127.0.0.1:5001/w3bn3xt/us-central1";
      const logsResp = await fetch(`${FUNCTIONS_BASE_URL}/getPaymentLogs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Wallet-Address": walletAddress,
        },
      });
      if (logsResp.ok) {
        const logsData = await logsResp.json();
        await chrome.storage.local.set({
          [`settlements_${walletAddress}`]: logsData.logs || [],
        });
      }
    } catch (e) {
      console.warn("Could not refresh settlement cache:", e);
    }

    // Broadcast results
    chrome.runtime.sendMessage({
      type: "AUDIT_COMPLETE",
      results: auditResult,
    });

    // Clear status after 3 seconds
    setTimeout(() => {
      sendStatus("idle", "", 0);
    }, 3000);
  } catch (error: any) {
    console.error("Audit error:", error);
    const errorMessage = error.message || "Audit failed. Please try again.";

    sendStatus("error", errorMessage);

    // Send error to content script for modal display
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (tab.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: "AUDIT_ERROR",
          error: errorMessage,
          details: error,
        });
      } catch (msgError) {
        console.error("Failed to send error to content script:", msgError);
      }
    }

    // Also broadcast to popup
    chrome.runtime.sendMessage({
      type: "AUDIT_ERROR",
      error: errorMessage,
    });

    // Clear error status after 5 seconds
    setTimeout(() => {
      sendStatus("idle", "", 0);
    }, 5000);
  }
}

async function callAuditAPI(params: {
  url: string;
  dom: string;
  auditType: "ui" | "ux" | "dom" | "security";
  walletAddress: string;
  headers?: Record<string, string>;
  libraries?: string[];
}): Promise<AuditResponse> {
  const FUNCTIONS_BASE_URL =
    import.meta.env.VITE_FUNCTIONS_BASE_URL ||
    "http://127.0.0.1:5001/w3bn3xt/us-central1";

  const response = await fetch(`${FUNCTIONS_BASE_URL}/agenticAudit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Wallet-Address": params.walletAddress,
    },
    body: JSON.stringify({
      url: params.url,
      dom: params.dom,
      headers: params.headers || {},
      libs: params.libraries || [],
      agents: [params.auditType],
    }),
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: "API Request failed" }));
    throw new Error(error.message || "API Request failed");
  }

  return response.json();
}

/**
 * Wand Agent Message Handling
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "WAND_PROCESS_COMMAND") {
    handleWandCommand(message.data, sender.tab?.id)
      .then((response) => {
        sendResponse({ success: true, response });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }
});

async function handleWandCommand(data: any, tabId?: number) {
  try {
    console.log("🪄 Processing Wand command:", data.voiceCommand);

    // Get wallet address
    const result = await chrome.storage.local.get(["circleWalletAddress"]);
    const walletAddress = result.circleWalletAddress as string;

    if (!walletAddress) {
      throw new Error("No wallet connected. Please connect a wallet first.");
    }

    // Capture screenshot if needed for "what is this?" queries
    let screenshot = null;
    if (
      data.voiceCommand.toLowerCase().includes("what is") ||
      data.voiceCommand.toLowerCase().includes("what's this")
    ) {
      screenshot = await captureScreenshot(tabId);
    }

    // Call Wand Agent API
    const FUNCTIONS_BASE_URL =
      import.meta.env.VITE_FUNCTIONS_BASE_URL ||
      "http://127.0.0.1:5001/w3bn3xt/us-central1";

    const response = await fetch(`${FUNCTIONS_BASE_URL}/wandAgent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wallet-Address": walletAddress,
      },
      body: JSON.stringify({
        ...data,
        screenshot,
      }),
    });

    if (!response.ok) {
      throw new Error(`Wand API error: ${response.statusText}`);
    }

    const wandResponse = await response.json();

    // Send response back to content script
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        type: "WAND_RESPONSE",
        response: wandResponse,
      });
    }

    return wandResponse;
  } catch (error: any) {
    console.error("❌ Wand command error:", error);

    // Send error to content script
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        type: "WAND_ERROR",
        error: error.message,
      });
    }

    throw error;
  }
}

async function captureScreenshot(tabId?: number): Promise<string | null> {
  try {
    if (!tabId) return null;

    const dataUrl = await chrome.tabs.captureVisibleTab(undefined, {
      format: "png",
    });

    // Convert data URL to base64
    return dataUrl.split(",")[1];
  } catch (error) {
    console.error("Screenshot capture failed:", error);
    return null;
  }
}
