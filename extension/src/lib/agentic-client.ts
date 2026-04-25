/**
 * Agentic Multi-Agent System Client
 *
 * Client-side interface for the ADK-based agentic architecture
 * with master coordinator and 4 specialized agents
 */

const FUNCTIONS_BASE_URL =
  import.meta.env.VITE_FUNCTIONS_BASE_URL ||
  "http://127.0.0.1:5001/w3bn3xt/us-central1";

export type AgentType = "ui" | "ux" | "dom" | "security" | "coordinator";

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

export interface AgentResult {
  agentType: AgentType;
  issues: AgentIssue[];
  cost: number;
  executionTime: number;
  transactionId?: string;
}

export interface CoordinatorResponse {
  success: boolean;
  auditId: string;
  results: AgentResult[];
  totalIssues: number;
  totalCost: number;
  creditsRemaining: number;
  executionPlan: string;
}

export const AGENT_COSTS = {
  ui: 5, // 0.005 USDC
  ux: 8, // 0.008 USDC
  dom: 3, // 0.003 USDC
  security: 12, // 0.012 USDC
  coordinator: 2, // 0.002 USDC (master agent)
};

export const AGENT_INFO = {
  ui: {
    name: "UI Agent",
    icon: "🎨",
    description: "Visual Design & Branding",
    focus: "Colors, typography, spacing, visual hierarchy, brand consistency",
    cost: AGENT_COSTS.ui,
  },
  ux: {
    name: "UX Agent",
    icon: "🧠",
    description: "User Experience & Accessibility",
    focus: "User flow, WCAG compliance, interaction patterns, usability",
    cost: AGENT_COSTS.ux,
  },
  dom: {
    name: "DOM Agent",
    icon: "📊",
    description: "Structure & Performance",
    focus: "HTML structure, semantic markup, performance, SEO",
    cost: AGENT_COSTS.dom,
  },
  security: {
    name: "Security Agent",
    icon: "🔒",
    description: "Security Vulnerabilities",
    focus: "Security headers, XSS, CSRF, dependencies, cookies",
    cost: AGENT_COSTS.security,
  },
  coordinator: {
    name: "Master Coordinator",
    icon: "🚀",
    description: "Intelligent Agent Orchestration",
    focus: "Analyzes requests and coordinates specialized agents",
    cost: AGENT_COSTS.coordinator,
  },
};

/**
 * Run agentic audit via Master Coordinator
 *
 * The coordinator will:
 * 1. Analyze the request
 * 2. Determine which agents to invoke
 * 3. Coordinate execution (parallel)
 * 4. Aggregate results
 */
export async function runAgenticAudit(params: {
  url: string;
  dom?: string;
  headers?: Record<string, string>;
  libraries?: string[];
  cookies?: any[];
  walletAddress: string;
  agents?: AgentType[]; // Optional: specify which agents to run
}): Promise<CoordinatorResponse> {
  const response = await fetch(`${FUNCTIONS_BASE_URL}/agenticAudit`, {
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
      agents: params.agents, // Optional: let coordinator decide if not specified
    }),
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: "Agentic audit failed" }));
    throw new Error(error.message || "Agentic audit failed");
  }

  return response.json();
}

/**
 * Run UI Agent directly (bypass coordinator)
 */
export async function runUIAgentDirect(params: {
  url: string;
  dom: string;
  walletAddress: string;
}): Promise<AgentResult> {
  const response = await fetch(`${FUNCTIONS_BASE_URL}/agenticUI`, {
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
 * Run UX Agent directly (bypass coordinator)
 */
export async function runUXAgentDirect(params: {
  url: string;
  dom: string;
  walletAddress: string;
}): Promise<AgentResult> {
  const response = await fetch(`${FUNCTIONS_BASE_URL}/agenticUX`, {
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
 * Run DOM Agent directly (bypass coordinator)
 */
export async function runDOMAgentDirect(params: {
  url: string;
  dom: string;
  walletAddress: string;
}): Promise<AgentResult> {
  const response = await fetch(`${FUNCTIONS_BASE_URL}/agenticDOM`, {
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
 * Run Security Agent directly (bypass coordinator)
 */
export async function runSecurityAgentDirect(params: {
  url: string;
  headers: Record<string, string>;
  libraries?: string[];
  cookies?: any[];
  walletAddress: string;
}): Promise<AgentResult> {
  const response = await fetch(`${FUNCTIONS_BASE_URL}/agenticSecurity`, {
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
 * Calculate total cost for requested agents
 */
export function calculateAgentCost(agents: AgentType[]): number {
  return agents.reduce(
    (sum, agent) => sum + AGENT_COSTS[agent],
    AGENT_COSTS.coordinator,
  );
}

/**
 * Get recommended agents based on audit type
 */
export function getRecommendedAgents(
  auditType: "quick" | "standard" | "deep",
): AgentType[] {
  switch (auditType) {
    case "quick":
      return ["ui", "dom"]; // Fast, low-cost
    case "standard":
      return ["ui", "ux", "dom"]; // Balanced
    case "deep":
      return ["ui", "ux", "dom", "security"]; // Complete
    default:
      return ["ui", "ux", "dom", "security"];
  }
}

/**
 * Format agent results for display
 */
export function formatAgentResults(results: AgentResult[]): {
  totalIssues: number;
  bySeverity: Record<string, number>;
  byAgent: Record<string, number>;
  criticalIssues: AgentIssue[];
} {
  const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);

  const bySeverity: Record<string, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  const byAgent: Record<string, number> = {};
  const criticalIssues: AgentIssue[] = [];

  results.forEach((result) => {
    byAgent[result.agentType] = result.issues.length;

    result.issues.forEach((issue) => {
      bySeverity[issue.severity]++;

      if (issue.severity === "critical") {
        criticalIssues.push(issue);
      }
    });
  });

  return {
    totalIssues,
    bySeverity,
    byAgent,
    criticalIssues,
  };
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
    agents: ["ui", "ux", "dom", "security", "coordinator"],
    costs: AGENT_COSTS,
  };
}
