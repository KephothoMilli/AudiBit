export type Severity = "critical" | "high" | "medium" | "low";
export type IssueType =
  | "accessibility"
  | "ux"
  | "ui"
  | "dom"
  | "security"
  | "performance"
  | "responsive";

export interface AuditIssue {
  id: string;
  type: IssueType;
  severity: Severity;
  title: string;
  description: string;
  element?: string;
  selector?: string; // Legacy support for DevTools
  recommendation: string;
  fix?: {
    type: "code" | "config" | "dependency";
    recommendation: string;
    codeSnippet: string;
  };
  wcagCriteria?: string;
  cve?: string;
  codeSnippet?: string;
}

export interface AuditResponse {
  success: boolean;
  auditId?: string;
  issues: AuditIssue[];
  creditsUsed?: number;
  creditsRemaining?: number;
  totalCost?: number;
  totalIssues?: number;
  executionPlan?: string;
  results?: Array<{
    agentType: string;
    issues: AuditIssue[];
    cost?: { totalUsdc: string; computeUnits: number };
    executionTime?: number;
    transactionId?: string;
  }>;
  payment?: {
    transactionId: string;
    amountUsdc: string;
    agentWallet: string;
  };
  settlement?: {
    transactionId: string;
    cost: {
      totalUsdc: string;
      computeUnits: number;
    };
  };
}

export type ExtensionMessage =
  | { type: "WALLET_STATUS_REQUEST" }
  | {
      type: "WALLET_STATUS_RESPONSE";
      status: "CONNECTED" | "DISCONNECTED";
      walletAddress?: string;
    }
  | { type: "GET_CREDITS_REQUEST" }
  | { type: "GET_CREDITS_RESPONSE"; credits: number }
  | {
      type: "TRIGGER_AUDIT";
      auditType: "ui" | "ux" | "dom" | "security";
      url: string;
      dom?: string;
      walletAddress?: string;
    }
  | { type: "AUDIT_COMPLETE"; results: AuditResponse }
  | { type: "AUDIT_ERROR"; error: string }
  | { type: "GET_DOM" }
  | { type: "DOM_RESPONSE"; dom: string }
  | { type: "HIGHLIGHT_ELEMENT"; selector: string };
