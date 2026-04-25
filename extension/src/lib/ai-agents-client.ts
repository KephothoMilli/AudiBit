/**
 * AI Agents Client
 *
 * Client-side interface for interacting with specialized AI agents
 */

const FUNCTIONS_BASE_URL =
  import.meta.env.VITE_FUNCTIONS_BASE_URL ||
  "http://127.0.0.1:5001/w3bn3xt/us-central1";

export type AgentType = "ui" | "ux" | "dom" | "security" | "full";

export interface AgentIssue {
  type: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  element?: string;
  recommendation: string;
  wcagCriteria?: string;
  cve?: string;
  references?: string[];
}

export interface AgentResponse {
  success: boolean;
  analysisId?: string;
  auditId?: string;
  agentType?: AgentType;
  type?: string;
  issues?: AgentIssue[];
  agents?: {
    ui?: { issues: AgentIssue[]; cost: number };
    ux?: { issues: AgentIssue[]; cost: number };
    dom?: { issues: AgentIssue[]; cost: number };
    security?: { issues: AgentIssue[]; cost: number };
  };
  totalIssues?: number;
  creditsUsed: number;
  creditsRemaining: number;
}

export const AGENT_COSTS = {
  ui: 5, // 0.005 USDC
  ux: 8, // 0.008 USDC
  dom: 3, // 0.003 USDC
  security: 12, // 0.012 USDC
  full: 28, // 0.028 USDC (sum of all)
};

export const AGENT_INFO = {
  ui: {
    name: "UI Agent",
    icon: "🎨",
    description: "Visuals & Branding",
    focus: "Colors, typography, spacing, visual hierarchy",
    cost: AGENT_COSTS.ui,
  },
  ux: {
    name: "UX Agent",
    icon: "🧠",
    description: "Flow & Accessibility",
    focus: "User flow, WCAG compliance, interaction patterns",
    cost: AGENT_COSTS.ux,
  },
  dom: {
    name: "DOM Agent",
    icon: "📊",
    description: "Structure & Performance",
    focus: "HTML structure, semantic markup, performance",
    cost: AGENT_COSTS.dom,
  },
  security: {
    name: "Security Agent",
    icon: "🔒",
    description: "Vulnerabilities",
    focus: "Security headers, XSS, CSRF, dependencies",
    cost: AGENT_COSTS.security,
  },
  full: {
    name: "Full Audit",
    icon: "🚀",
    description: "All Agents",
    focus: "Complete analysis with all 4 agents",
    cost: AGENT_COSTS.full,
  },
};

/**
 * Run UI Agent analysis
 */
export async function runUIAgent(params: {
  url: string;
  dom: string;
  walletAddress: string;
}): Promise<AgentResponse> {
  const response = await fetch(`${FUNCTIONS_BASE_URL}/uiAgent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Wallet-Address": params.walletAddress,
    },
    body: JSON.stringify({
      url: params.url,
      dom: params.dom,
    }),
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: "UI Agent failed" }));
    throw new Error(error.message || "UI Agent failed");
  }

  return response.json();
}

/**
 * Run UX Agent analysis
 */
export async function runUXAgent(params: {
  url: string;
  dom: string;
  walletAddress: string;
}): Promise<AgentResponse> {
  const response = await fetch(`${FUNCTIONS_BASE_URL}/uxAgent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Wallet-Address": params.walletAddress,
    },
    body: JSON.stringify({
      url: params.url,
      dom: params.dom,
    }),
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: "UX Agent failed" }));
    throw new Error(error.message || "UX Agent failed");
  }

  return response.json();
}

/**
 * Run DOM Agent analysis
 */
export async function runDOMAgent(params: {
  url: string;
  dom: string;
  walletAddress: string;
}): Promise<AgentResponse> {
  const response = await fetch(`${FUNCTIONS_BASE_URL}/domAgent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Wallet-Address": params.walletAddress,
    },
    body: JSON.stringify({
      url: params.url,
      dom: params.dom,
    }),
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: "DOM Agent failed" }));
    throw new Error(error.message || "DOM Agent failed");
  }

  return response.json();
}

/**
 * Run Security Agent analysis
 */
export async function runSecurityAgent(params: {
  url: string;
  headers: Record<string, string>;
  libraries?: string[];
  cookies?: any[];
  walletAddress: string;
}): Promise<AgentResponse> {
  const response = await fetch(`${FUNCTIONS_BASE_URL}/securityAgent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Wallet-Address": params.walletAddress,
    },
    body: JSON.stringify({
      url: params.url,
      headers: params.headers,
      libraries: params.libraries || [],
      cookies: params.cookies || [],
    }),
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: "Security Agent failed" }));
    throw new Error(error.message || "Security Agent failed");
  }

  return response.json();
}

/**
 * Run full audit (all agents)
 */
export async function runFullAudit(params: {
  url: string;
  dom: string;
  headers: Record<string, string>;
  libraries?: string[];
  cookies?: any[];
  walletAddress: string;
}): Promise<AgentResponse> {
  const response = await fetch(`${FUNCTIONS_BASE_URL}/fullAudit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Wallet-Address": params.walletAddress,
    },
    body: JSON.stringify({
      url: params.url,
      dom: params.dom,
      headers: params.headers,
      libraries: params.libraries || [],
      cookies: params.cookies || [],
    }),
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: "Full audit failed" }));
    throw new Error(error.message || "Full audit failed");
  }

  return response.json();
}

/**
 * Get agent status and availability
 */
export async function getAgentStatus(): Promise<{
  available: boolean;
  agents: AgentType[];
  costs: typeof AGENT_COSTS;
}> {
  // For now, return static status
  // In production, this could check backend health
  return {
    available: true,
    agents: ["ui", "ux", "dom", "security", "full"],
    costs: AGENT_COSTS,
  };
}
