import { DOMMonitor } from "./dom-monitor";
import type { ExtensionMessage } from "../types";
import {
  runProactiveChecks,
  getIssueSummary,
  type LocalIssue,
} from "./proactive-checks";
// Import Wand overlay for voice-first interaction
import "./wand-overlay";
// Import Audit-Wand integration for voice-guided auditing
import "./audit-wand-integration";

console.log("Audibit Content Script Active");

// Mark content script as loaded
(window as any).__AUDIBIT_LOADED__ = true;

// Run proactive checks on page load
let localIssues: LocalIssue[] = [];

function performProactiveChecks() {
  localIssues = runProactiveChecks();
  const summary = getIssueSummary(localIssues);

  console.log("Audibit proactive checks complete:", summary);

  if (localIssues.length > 0) {
    // Show overlay with local issues
    injectOverlay(localIssues);

    // Notify background script
    chrome.runtime.sendMessage({
      type: "LOCAL_ISSUES_FOUND",
      issues: localIssues,
      summary,
    });
  }
}

// Run checks on page load
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", performProactiveChecks);
} else {
  performProactiveChecks();
}

// Monitor DOM changes for new issues
const monitor = new DOMMonitor(() => {
  console.log("Audibit detected DOM changes, re-running checks");
  performProactiveChecks();
});

async function injectOverlay(issues: LocalIssue[]) {
  let container = document.getElementById("audibit-overlay-container");

  if (!container) {
    container = document.createElement("div");
    container.id = "audibit-overlay-container";
    document.body.appendChild(container);

    // Use Shadow DOM for isolation
    const shadow = container.attachShadow({ mode: "open" });
    const root = document.createElement("div");
    root.id = "audibit-root";

    // Add basic styling
    const style = document.createElement("style");
    style.textContent = `
      #audibit-root {
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 16px 20px;
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        cursor: pointer;
        transition: transform 0.2s;
      }
      #audibit-root:hover {
        transform: translateY(-2px);
      }
      .audibit-badge {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .audibit-icon {
        font-size: 24px;
      }
      .audibit-content {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .audibit-title {
        font-weight: 600;
        font-size: 14px;
      }
      .audibit-count {
        font-size: 12px;
        opacity: 0.9;
      }
      @keyframes audibit-shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
    `;
    shadow.appendChild(style);
    shadow.appendChild(root);

    // Create badge content
    const summary = getIssueSummary(issues);
    root.innerHTML = `
      <div class="audibit-badge">
        <div class="audibit-icon">⚠️</div>
        <div class="audibit-content">
          <div class="audibit-title">Issues Detected</div>
          <div class="audibit-count">${summary.total} issue${summary.total !== 1 ? "s" : ""} found</div>
        </div>
      </div>
    `;

    // Click to open DevTools panel
    root.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "OPEN_DEVTOOLS" });
    });
  }

  updateOverlayContent(issues, null);
}

function updateOverlayContent(issues: LocalIssue[], status: any | null) {
  const container = document.getElementById("audibit-overlay-container");
  if (!container || !container.shadowRoot) return;

  const root = container.shadowRoot.getElementById("audibit-root");
  if (!root) return;

  if (status && status.status !== "idle") {
    const icon = getAgentIcon(status.agentType);
    const isBridging = status.status === "bridging";
    const bgGradient = isBridging
      ? "linear-gradient(135deg, #4c1d95 0%, #7c3aed 100%)"
      : "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)";

    root.style.background = bgGradient;
    root.innerHTML = `
      <div class="audibit-badge">
        <div class="audibit-icon">${icon}</div>
        <div class="audibit-content">
          <div class="audibit-title">${status.agentType.toUpperCase()} Agent</div>
          <div class="audibit-count">${status.message}</div>
          ${
            status.progress !== undefined || isBridging
              ? `
            <div style="width: 100%; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; margin-top: 4px; overflow: hidden;">
              <div style="width: ${status.progress || 100}%; height: 100%; background: ${isBridging ? "#a78bfa" : "#3b82f6"}; transition: width 0.3s ease; ${isBridging ? "animation: audibit-shimmer 2s infinite linear;" : ""}"></div>
            </div>
          `
              : ""
          }
        </div>
      </div>
    `;
  } else {
    const summary = getIssueSummary(issues);
    root.style.background = "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";
    root.innerHTML = `
      <div class="audibit-badge">
        <div class="audibit-icon">⚠️</div>
        <div class="audibit-content">
          <div class="audibit-title">Issues Detected</div>
          <div class="audibit-count">${summary.total} issue${summary.total !== 1 ? "s" : ""} found</div>
        </div>
      </div>
    `;
  }
}

function getAgentIcon(type: string) {
  switch (type) {
    case "ui":
      return "🎨";
    case "ux":
      return "🧠";
    case "dom":
      return "🏗️";
    case "security":
      return "🛡️";
    default:
      return "🤖";
  }
}

// Listen for messages from background (e.g., audit results)
chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage | any, _sender, sendResponse) => {
    if (message.type === "PING") {
      // Respond to ping to confirm content script is loaded
      sendResponse({ pong: true });
      return true;
    } else if (message.type === "AUDIT_COMPLETE") {
      // Show results in overlay
      console.log("Audit complete, showing results:", message.results);
      // Update overlay with AI audit results
    } else if (message.type === "AUDIT_ERROR") {
      // Show error modal
      console.log("Audit error:", message.error);
      injectErrorModal(message.error, message.details);
    } else if (message.type === "REMOVE_OVERLAY") {
      const container = document.getElementById("audibit-overlay-container");
      if (container) {
        container.remove();
      }
    } else if (message.type === "REMOVE_ERROR_MODAL") {
      const modal = document.getElementById("audibit-error-modal-container");
      if (modal) {
        modal.remove();
      }
    } else if (message.type === "GET_DOM") {
      // DevTools panel requesting DOM content
      const dom = document.documentElement.outerHTML;
      sendResponse({ dom });
      return true;
    } else if (message.type === "HIGHLIGHT_ELEMENT") {
      // DevTools panel requesting to highlight an element
      highlightElement(message.selector);
    } else if (message.type === "AGENT_STATUS") {
      // Update overlay with current agent status
      injectOverlay(localIssues);
      updateOverlayContent(localIssues, message.status);
    }
  },
);

function highlightElement(selector: string) {
  // Remove previous highlights
  document.querySelectorAll(".audibit-highlight").forEach((el) => {
    el.classList.remove("audibit-highlight");
  });

  // Add highlight to target element
  try {
    const element = document.querySelector(selector);
    if (element) {
      element.classList.add("audibit-highlight");
      element.scrollIntoView({ behavior: "smooth", block: "center" });

      // Inject highlight styles if not already present
      if (!document.getElementById("audibit-highlight-styles")) {
        const style = document.createElement("style");
        style.id = "audibit-highlight-styles";
        style.textContent = `
          .audibit-highlight {
            outline: 3px solid #228be6 !important;
            outline-offset: 2px !important;
            background: rgba(34, 139, 230, 0.1) !important;
            animation: audibit-pulse 1s ease-in-out 3;
          }
          @keyframes audibit-pulse {
            0%, 100% { outline-color: #228be6; }
            50% { outline-color: #4dabf7; }
          }
        `;
        document.head.appendChild(style);
      }

      // Remove highlight after 3 seconds
      setTimeout(() => {
        element.classList.remove("audibit-highlight");
      }, 3000);
    }
  } catch (error) {
    console.error("Failed to highlight element:", error);
  }
}

function injectErrorModal(errorMessage: string, _details?: any) {
  // Remove existing modal if any
  const existingModal = document.getElementById(
    "audibit-error-modal-container",
  );
  if (existingModal) {
    existingModal.remove();
  }

  // Parse error message to determine type and extract details
  let errorType:
    | "insufficient_funds"
    | "insufficient_credits"
    | "api_error"
    | "network_error"
    | "general_error" = "general_error";
  let title = "Audit Failed";
  let message = errorMessage;
  let walletAddress: string | undefined;
  let requiredAmount: string | undefined;
  let currentBalance: string | undefined;

  // Check for insufficient funds error
  if (
    errorMessage.includes("Insufficient USDC balance") ||
    errorMessage.includes("Insufficient funds")
  ) {
    errorType = "insufficient_funds";
    title = "Insufficient Funds";

    // Extract wallet address
    const walletMatch = errorMessage.match(
      /wallet address: (0x[a-fA-F0-9]{40})/,
    );
    if (walletMatch) {
      walletAddress = walletMatch[1];
    }

    // Extract required amount
    const requiredMatch = errorMessage.match(/Required: ([\d.]+) USDC/);
    if (requiredMatch) {
      requiredAmount = requiredMatch[1];
    }

    // Extract current balance
    const currentMatch = errorMessage.match(/Current: ([\d.]+) USDC/);
    if (currentMatch) {
      currentBalance = currentMatch[1];
    }

    message = "Your wallet does not have enough USDC to complete this audit.";
  }
  // Check for insufficient credits
  else if (errorMessage.includes("Insufficient compute credits")) {
    errorType = "insufficient_credits";
    title = "Insufficient Credits";
    message = "You need more compute credits to run this agentic audit.";
  }
  // Check for API errors
  else if (
    errorMessage.includes("Gemini API") ||
    errorMessage.includes("rate limit") ||
    errorMessage.includes("API key")
  ) {
    errorType = "api_error";
    title = "AI Service Error";
    message = errorMessage;
  }
  // Check for network errors
  else if (
    errorMessage.includes("Network error") ||
    errorMessage.includes("fetch failed") ||
    errorMessage.includes("connection")
  ) {
    errorType = "network_error";
    title = "Connection Error";
    message = errorMessage;
  }

  // Create modal container
  const container = document.createElement("div");
  container.id = "audibit-error-modal-container";
  document.body.appendChild(container);

  // Create modal HTML
  const modalHTML = createErrorModalHTML({
    title,
    message,
    type: errorType,
    walletAddress,
    requiredAmount,
    currentBalance,
  });

  container.innerHTML = modalHTML;

  // Add event listeners
  const closeBtn = container.querySelector(".audibit-error-close");
  const overlay = container.querySelector(".audibit-error-overlay");
  const primaryBtn = container.querySelector(".audibit-error-btn-primary");
  const secondaryBtn = container.querySelector(".audibit-error-btn-secondary");

  const closeModal = () => {
    container.remove();
  };

  closeBtn?.addEventListener("click", closeModal);
  overlay?.addEventListener("click", closeModal);
  secondaryBtn?.addEventListener("click", closeModal);

  if (errorType === "insufficient_funds" && walletAddress) {
    primaryBtn?.addEventListener("click", () => {
      window.open(
        `https://faucet.circle.com?address=${walletAddress}&network=arc-testnet`,
        "_blank",
      );
    });
  }

  // Copy wallet address button
  const copyBtn = container.querySelector(".audibit-copy-btn");
  if (copyBtn && walletAddress) {
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(walletAddress);
      const originalText = copyBtn.textContent;
      copyBtn.textContent = "✓ Copied!";
      setTimeout(() => {
        copyBtn.textContent = originalText;
      }, 2000);
    });
  }
}

function createErrorModalHTML(props: {
  title: string;
  message: string;
  type:
    | "insufficient_funds"
    | "insufficient_credits"
    | "api_error"
    | "network_error"
    | "general_error";
  walletAddress?: string;
  requiredAmount?: string;
  currentBalance?: string;
}): string {
  const {
    title,
    message,
    type,
    walletAddress,
    requiredAmount,
    currentBalance,
  } = props;

  let icon = "⚠️";
  let content = "";

  if (type === "insufficient_funds") {
    icon = "💰";
    content = `
      <p class="audibit-error-message">${message}</p>
      
      ${
        requiredAmount && currentBalance
          ? `
        <div class="audibit-balance-info">
          <div class="audibit-balance-row">
            <span class="audibit-label">Required:</span>
            <span class="audibit-value audibit-required">${requiredAmount} USDC</span>
          </div>
          <div class="audibit-balance-row">
            <span class="audibit-label">Current:</span>
            <span class="audibit-value audibit-current">${currentBalance} USDC</span>
          </div>
        </div>
      `
          : ""
      }

      ${
        walletAddress
          ? `
        <div class="audibit-instructions">
          <h3>How to add funds:</h3>
          <ol>
            <li>Visit <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer">Circle Faucet</a></li>
            <li>Enter your wallet address:
              <div class="audibit-wallet-address">
                <code>${walletAddress}</code>
                <button class="audibit-copy-btn" title="Copy address">📋</button>
              </div>
            </li>
            <li>Select <strong>Arc Testnet</strong></li>
            <li>Request testnet USDC</li>
            <li>Wait 10-30 seconds for tokens to arrive</li>
            <li>Try your audit again</li>
          </ol>
        </div>
        <div class="audibit-actions">
          <button class="audibit-error-btn audibit-error-btn-primary">Open Faucet</button>
          <button class="audibit-error-btn audibit-error-btn-secondary">Close</button>
        </div>
      `
          : `
        <div class="audibit-actions">
          <button class="audibit-error-btn audibit-error-btn-secondary">Close</button>
        </div>
      `
      }
    `;
  } else if (type === "insufficient_credits") {
    icon = "⚡";
    content = `
      <p class="audibit-error-message">${message}</p>
      <div class="audibit-instructions">
        <h3>How to get credits:</h3>
        <ul>
          <li>Open the AudiBit extension</li>
          <li>Go to the <strong>Marketplace</strong> or <strong>Wallet</strong> tab</li>
          <li>Click <strong>Purchase Credits</strong></li>
          <li>Credits are consumed per audit to power the AI agents</li>
        </ul>
      </div>
      <div class="audibit-actions">
        <button class="audibit-error-btn audibit-error-btn-secondary">Close</button>
      </div>
    `;
  } else if (type === "api_error") {
    icon = "🤖";
    content = `
      <p class="audibit-error-message">${message}</p>
      <div class="audibit-instructions">
        <h3>Possible causes:</h3>
        <ul>
          <li>Gemini API rate limit exceeded</li>
          <li>Network connectivity issues</li>
          <li>API key configuration problem</li>
        </ul>
        <p class="audibit-help-text">Please wait a moment and try again. If the problem persists, contact support.</p>
      </div>
      <div class="audibit-actions">
        <button class="audibit-error-btn audibit-error-btn-secondary">Close</button>
      </div>
    `;
  } else if (type === "network_error") {
    icon = "🌐";
    content = `
      <p class="audibit-error-message">${message}</p>
      <div class="audibit-instructions">
        <h3>Troubleshooting:</h3>
        <ul>
          <li>Check your internet connection</li>
          <li>Verify Firebase emulator is running</li>
          <li>Ensure backend services are accessible</li>
        </ul>
      </div>
      <div class="audibit-actions">
        <button class="audibit-error-btn audibit-error-btn-secondary">Close</button>
      </div>
    `;
  } else {
    content = `
      <p class="audibit-error-message">${message}</p>
      <div class="audibit-actions">
        <button class="audibit-error-btn audibit-error-btn-secondary">Close</button>
      </div>
    `;
  }

  return `
    <div class="audibit-error-overlay"></div>
    <div class="audibit-error-modal">
      <button class="audibit-error-close">×</button>
      <div class="audibit-error-content">
        <div class="audibit-error-icon">${icon}</div>
        <h2>${title}</h2>
        ${content}
      </div>
    </div>
    ${getErrorModalStyles()}
  `;
}

function getErrorModalStyles(): string {
  return `
    <style>
      .audibit-error-overlay {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        background: rgba(0, 0, 0, 0.7) !important;
        backdrop-filter: blur(4px) !important;
        z-index: 2147483646 !important;
        animation: audibitFadeIn 0.2s ease-out !important;
      }

      @keyframes audibitFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      .audibit-error-modal {
        position: fixed !important;
        top: 50% !important;
        left: 50% !important;
        transform: translate(-50%, -50%) !important;
        width: 90% !important;
        max-width: 500px !important;
        max-height: 80vh !important;
        background: #1a1b1e !important;
        border-radius: 16px !important;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5) !important;
        z-index: 2147483647 !important;
        overflow: hidden !important;
        animation: audibitSlideIn 0.3s ease-out !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      }

      @keyframes audibitSlideIn {
        from {
          opacity: 0;
          transform: translate(-50%, -45%);
        }
        to {
          opacity: 1;
          transform: translate(-50%, -50%);
        }
      }

      .audibit-error-close {
        position: absolute !important;
        top: 16px !important;
        right: 16px !important;
        background: none !important;
        border: none !important;
        color: #909296 !important;
        font-size: 28px !important;
        cursor: pointer !important;
        line-height: 1 !important;
        padding: 0 !important;
        width: 32px !important;
        height: 32px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        border-radius: 4px !important;
        transition: all 0.2s !important;
      }

      .audibit-error-close:hover {
        background: #373a40 !important;
        color: #e9ecef !important;
      }

      .audibit-error-content {
        padding: 32px !important;
        color: #ffffff !important;
        overflow-y: auto !important;
        max-height: 80vh !important;
      }

      .audibit-error-icon {
        font-size: 48px !important;
        text-align: center !important;
        margin-bottom: 16px !important;
      }

      .audibit-error-modal h2 {
        font-size: 24px !important;
        font-weight: 700 !important;
        margin: 0 0 16px 0 !important;
        text-align: center !important;
        color: #e9ecef !important;
      }

      .audibit-error-message {
        font-size: 14px !important;
        line-height: 1.6 !important;
        color: #adb5bd !important;
        text-align: center !important;
        margin: 0 0 24px 0 !important;
      }

      .audibit-balance-info {
        background: #25262b !important;
        border-radius: 8px !important;
        padding: 16px !important;
        margin-bottom: 24px !important;
      }

      .audibit-balance-row {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        padding: 8px 0 !important;
      }

      .audibit-balance-row:not(:last-child) {
        border-bottom: 1px solid #333 !important;
      }

      .audibit-label {
        font-size: 13px !important;
        color: #909296 !important;
        font-weight: 500 !important;
      }

      .audibit-value {
        font-size: 14px !important;
        font-weight: 700 !important;
        font-family: monospace !important;
      }

      .audibit-required {
        color: #fa5252 !important;
      }

      .audibit-current {
        color: #ffd43b !important;
      }

      .audibit-instructions {
        background: #25262b !important;
        border-radius: 8px !important;
        padding: 16px !important;
        margin-bottom: 24px !important;
        text-align: left !important;
      }

      .audibit-instructions h3 {
        font-size: 14px !important;
        font-weight: 600 !important;
        margin: 0 0 12px 0 !important;
        color: #4dabf7 !important;
      }

      .audibit-instructions ol,
      .audibit-instructions ul {
        margin: 0 !important;
        padding-left: 20px !important;
        color: #adb5bd !important;
      }

      .audibit-instructions li {
        font-size: 13px !important;
        line-height: 1.6 !important;
        margin-bottom: 8px !important;
      }

      .audibit-instructions a {
        color: #4dabf7 !important;
        text-decoration: none !important;
        font-weight: 600 !important;
      }

      .audibit-instructions a:hover {
        text-decoration: underline !important;
      }

      .audibit-instructions strong {
        color: #e9ecef !important;
        font-weight: 600 !important;
      }

      .audibit-wallet-address {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        background: #2c2e33 !important;
        padding: 8px 12px !important;
        border-radius: 6px !important;
        margin-top: 8px !important;
      }

      .audibit-wallet-address code {
        flex: 1 !important;
        font-size: 11px !important;
        color: #82c91e !important;
        word-break: break-all !important;
        font-family: 'Courier New', monospace !important;
      }

      .audibit-copy-btn {
        background: #373a40 !important;
        border: none !important;
        padding: 4px 8px !important;
        border-radius: 4px !important;
        cursor: pointer !important;
        font-size: 14px !important;
        transition: all 0.2s !important;
        flex-shrink: 0 !important;
      }

      .audibit-copy-btn:hover {
        background: #4dabf7 !important;
        transform: scale(1.1) !important;
      }

      .audibit-help-text {
        font-size: 12px !important;
        color: #909296 !important;
        margin-top: 12px !important;
        font-style: italic !important;
      }

      .audibit-actions {
        display: flex !important;
        gap: 12px !important;
        justify-content: center !important;
      }

      .audibit-error-btn {
        padding: 12px 24px !important;
        border: none !important;
        border-radius: 8px !important;
        font-size: 14px !important;
        font-weight: 600 !important;
        cursor: pointer !important;
        transition: all 0.2s !important;
        font-family: inherit !important;
      }

      .audibit-error-btn-primary {
        background: #228be6 !important;
        color: white !important;
      }

      .audibit-error-btn-primary:hover {
        background: #1c7ed6 !important;
        transform: translateY(-1px) !important;
      }

      .audibit-error-btn-secondary {
        background: #373a40 !important;
        color: #e9ecef !important;
      }

      .audibit-error-btn-secondary:hover {
        background: #495057 !important;
      }

      .audibit-error-content::-webkit-scrollbar {
        width: 8px !important;
      }

      .audibit-error-content::-webkit-scrollbar-track {
        background: #25262b !important;
      }

      .audibit-error-content::-webkit-scrollbar-thumb {
        background: #495057 !important;
        border-radius: 4px !important;
      }

      .audibit-error-content::-webkit-scrollbar-thumb:hover {
        background: #5c5f66 !important;
      }
    </style>
  `;
}

monitor.start();

// Message handler for audit mode and other commands
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "ENABLE_AUDIT_MODE") {
    // Enable audit mode with Wand integration
    const auditWand = (window as any).__AUDIT_WAND__;
    if (auditWand) {
      auditWand.enableAuditMode(message.agentType);
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: "Audit Wand not available" });
    }
    return true;
  }

  if (message.type === "DISABLE_AUDIT_MODE") {
    // Disable audit mode
    const auditWand = (window as any).__AUDIT_WAND__;
    if (auditWand) {
      auditWand.disableAuditMode();
      sendResponse({ success: true });
    }
    return true;
  }

  if (message.type === "PING") {
    sendResponse({ pong: true });
    return true;
  }

  if (message.type === "GET_DOM") {
    sendResponse({
      dom: document.documentElement.outerHTML,
      url: window.location.href,
      title: document.title,
    });
    return true;
  }

  if (message.type === "WAND_TOGGLE") {
    // Toggle the Wand overlay listening state
    const wandOverlay = (window as any).__WAND_OVERLAY__;
    if (wandOverlay) {
      const isNowActive = wandOverlay.toggle();
      sendResponse({ active: isNowActive });
    } else {
      // Wand overlay not yet initialised — trigger keyboard shortcut simulation
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: " ",
          code: "Space",
          ctrlKey: true,
          bubbles: true,
        }),
      );
      sendResponse({ active: true });
    }
    return true;
  }
});
