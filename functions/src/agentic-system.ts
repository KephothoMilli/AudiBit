/**
 * Agentic Multi-Agent System for AudiBit
 *
 * Architecture:
 * - Master Coordinator Agent: Routes requests to specialized agents
 * - 4 Specialized Agents: UI, UX, DOM, Security
 * - LLM-Driven Delegation: Uses transfer_to_agent pattern
 * - Arc Nano Payments: Per-agent usage tracking
 *
 * Based on ADK (Agent Development Kit) patterns:
 * https://github.com/google/adk-samples/tree/main/typescript
 */

import * as functions from "firebase-functions";
import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
  GoogleGenerativeAI,
  GenerativeModel,
  HarmCategory,
  HarmBlockThreshold,
} from "@google/generative-ai";
import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "./firebase-init";
import { settleUsage } from "./circle-wallet-functions";
import { checkBalanceWithAutoBridge } from "./lib/balance-checker";
import { AuditSpecs } from "./lib/metering";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

// ─── CONFIGURATION ───

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY not found in environment variables");
  throw new Error("GEMINI_API_KEY is required. Set it in functions/.env");
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// ⚠️ IMPORTANT: Always use gemini-3-flash-preview model
// This is the latest Gemini 3 model with best performance
// DO NOT change to other models without testing
const MODEL_NAME = "gemini-3-flash-preview";

// Agent costs (in credits, 1 credit = $0.001 USDC)
const AGENT_COSTS = {
  ui: 5,
  ux: 8,
  dom: 3,
  security: 12,
  coordinator: 2, // Master agent coordination cost
};

// ─── TYPES ───

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

export interface AgentContext {
  url: string;
  dom?: string;
  headers?: Record<string, string>;
  libraries?: string[];
  cookies?: any[];
  walletAddress: string;
  requestedAgents?: AgentType[];
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

// ─── AGENT PROMPTS ───

const COORDINATOR_PROMPT = `You are the AudiBit Master Coordinator Agent.

Your role is to:
1. Analyze the user's audit request
2. Determine which specialized agents to invoke
3. Coordinate the execution plan
4. Aggregate results from all agents

Available Specialized Agents:
- UI Agent (5 credits): Visual design, colors, typography, spacing, branding
- UX Agent (8 credits): User flow, accessibility (WCAG), interaction patterns
- DOM Agent (3 credits): HTML structure, semantic markup, performance, SEO
- Security Agent (12 credits): Vulnerabilities, headers, XSS, CSRF, dependencies

User Request: {request}
Available Credits: {credits}

Based on the request, determine:
1. Which agents should be invoked (return as JSON array: ["ui", "ux", "dom", "security"])
2. Execution order (parallel or sequential)
3. Brief execution plan

Return ONLY a JSON object:
{
  "agents": ["ui", "ux"],
  "parallel": true,
  "plan": "Brief explanation of the execution strategy"
}`;

const UI_AGENT_PROMPT = `You are the AudiBit UI Agent - a specialist in visual design and brand integrity.

Your expertise:
- Visual Consistency: Color palettes, typography alignment, design system adherence
- Spacing & Layout: Padding, margin, grid systems, responsive breakpoints
- Component Hierarchy: Visual weight, button prominence, call-to-action clarity
- Branding: Logo placement, brand colors, visual identity consistency

Analyze the DOM and identify visual design issues.

Return a JSON array of issues:
[{
  "type": "color" | "typography" | "spacing" | "branding" | "hierarchy",
  "severity": "critical" | "high" | "medium" | "low",
  "title": "Brief issue title",
  "description": "Detailed explanation",
  "element": "CSS selector or element description",
  "recommendation": "How to fix this issue"
}]

DOM to analyze:
`;

const UX_AGENT_PROMPT = `You are the AudiBit UX Agent - a specialist in user experience and accessibility.

Your expertise:
- User Flow: Navigation clarity, user journey optimization, CTA placement
- WCAG Accessibility: Alt text, color contrast (4.5:1), ARIA labels, heading hierarchy
- Interaction Patterns: Touch targets (44x44px), hover/focus states, loading feedback
- Usability: Form design, error handling, mobile responsiveness

Analyze the DOM and identify UX and accessibility issues.

Return a JSON array of issues:
[{
  "type": "navigation" | "accessibility" | "interaction" | "usability",
  "severity": "critical" | "high" | "medium" | "low",
  "title": "Brief issue title",
  "description": "Detailed explanation",
  "element": "CSS selector or element description",
  "recommendation": "How to fix this issue",
  "wcagCriteria": "WCAG criterion if applicable (e.g., 1.4.3)"
}]

DOM to analyze:
`;

const DOM_AGENT_PROMPT = `You are the AudiBit DOM Agent - a specialist in HTML structure and performance.

Your expertise:
- HTML Structure: Semantic HTML (header, nav, main, article), proper nesting
- Performance: DOM depth (<15 levels), DOM size (<1500 nodes), render-blocking
- SEO & Metadata: Meta tags, heading structure, schema markup
- Best Practices: IDs/classes usage, data attributes, script placement

Analyze the DOM and identify structural and performance issues.

Return a JSON array of issues:
[{
  "type": "structure" | "performance" | "seo" | "best-practice",
  "severity": "critical" | "high" | "medium" | "low",
  "title": "Brief issue title",
  "description": "Detailed explanation",
  "element": "CSS selector or element description",
  "recommendation": "How to fix this issue"
}]

DOM to analyze:
`;

const SECURITY_AGENT_PROMPT = `You are the AudiBit Security Agent - a specialist in web security vulnerabilities.

Your expertise:
- HTTP Security Headers: CSP, X-Frame-Options, HSTS, X-Content-Type-Options
- Third-party Libraries: Known CVEs, outdated versions, vulnerable dependencies
- Cookie Security: Secure flag, HttpOnly flag, SameSite attribute
- General Security: Mixed content, XSS vectors, CSRF vulnerabilities

Analyze the security data and identify vulnerabilities.

Return a JSON array of issues:
[{
  "type": "headers" | "libraries" | "cookies" | "xss" | "csrf" | "general",
  "severity": "critical" | "high" | "medium" | "low",
  "title": "Brief issue title",
  "description": "Detailed explanation",
  "element": "Affected component or resource",
  "recommendation": "How to fix this vulnerability",
  "cve": "CVE identifier if applicable",
  "references": ["URL to documentation"]
}]

Security data to analyze:
`;

// ─── HELPER FUNCTIONS ───

/**
 * Create a Gemini model instance with proper configuration
 */
function createModel(): GenerativeModel {
  return genAI.getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: {
      temperature: 0.7,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 8192,
    },
    safetySettings: [
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
    ],
  });
}

/**
 * Generate content with retry logic for network errors and rate limits
 */
async function generateWithRetry(
  prompt: string,
  maxRetries: number = 3,
): Promise<string> {
  const model = createModel();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      console.log(`🤖 Gemini API call attempt ${attempt + 1}/${maxRetries}`);

      const result = await model.generateContent(prompt);
      const response = result.response;

      if (!response) {
        throw new Error("Response was blocked or empty");
      }

      const text = response.text();
      console.log(`✅ Gemini API call successful (${text.length} chars)`);
      return text;
    } catch (error: any) {
      lastError = error;
      const errorMessage = error?.message || String(error);

      console.error(`❌ Attempt ${attempt + 1} failed:`, errorMessage);

      // Check error types
      const isNetworkError =
        errorMessage.includes("fetch failed") ||
        errorMessage.includes("ECONNREFUSED") ||
        errorMessage.includes("ETIMEDOUT") ||
        errorMessage.includes("network") ||
        errorMessage.includes("ENOTFOUND") ||
        errorMessage.includes("socket hang up");

      const isRateLimit =
        errorMessage.includes("429") ||
        errorMessage.includes("quota") ||
        errorMessage.includes("Too Many Requests") ||
        errorMessage.includes("Resource has been exhausted");

      const isAuthError =
        errorMessage.includes("API key") ||
        errorMessage.includes("401") ||
        errorMessage.includes("403") ||
        errorMessage.includes("Unauthorized");

      if (isAuthError) {
        throw new Error(
          `Gemini API authentication failed. Please check your API key in functions/.env. Error: ${errorMessage}`,
        );
      }

      if ((isNetworkError || isRateLimit) && attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 2000; // 2s, 4s, 8s
        console.log(
          `⚠️  ${isNetworkError ? "Network error" : "Rate limited"}, retrying in ${delay / 1000}s...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      if (isRateLimit) {
        throw new Error(
          "Gemini API rate limit exceeded. Please wait a moment and try again.",
        );
      }

      if (isNetworkError) {
        throw new Error(
          `Network error connecting to Gemini API. Please check your internet connection. Error: ${errorMessage}`,
        );
      }

      throw new Error(`Gemini API error: ${errorMessage}`);
    }
  }

  throw new Error(
    `Failed to generate content after ${maxRetries} attempts. ${lastError?.message || "Unknown error"}`,
  );
}

/**
 * Chunk large content for Gemini's context window
 */
function chunkContent(
  content: string,
  maxChunkSize: number = 400000,
): string[] {
  const chunks: string[] = [];
  let currentChunk = "";
  const lines = content.split("\n");

  for (const line of lines) {
    if ((currentChunk + line).length > maxChunkSize) {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = line;
    } else {
      currentChunk += "\n" + line;
    }
  }
  if (currentChunk) chunks.push(currentChunk);
  return chunks;
}

/**
 * Parse JSON from LLM response
 */
function parseJSON(text: string): any {
  // Try to extract JSON from markdown code blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return JSON.parse(codeBlockMatch[1].trim());
  }

  // Try to extract JSON array or object
  const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }

  throw new Error("No valid JSON found in response");
}

// ─── SPECIALIZED AGENTS ───

/**
 * UI Agent - Analyzes visual design and branding
 */
async function runUIAgent(context: AgentContext): Promise<AgentResult> {
  const startTime = Date.now();
  console.log(`🎨 UI Agent starting for ${context.url}`);

  if (!context.dom) {
    throw new Error("DOM data required for UI Agent");
  }

  const chunks = chunkContent(context.dom);
  let allIssues: AgentIssue[] = [];

  for (const chunk of chunks) {
    try {
      const text = await generateWithRetry(UI_AGENT_PROMPT + chunk);
      const issues = parseJSON(text);
      allIssues = allIssues.concat(Array.isArray(issues) ? issues : [issues]);
    } catch (e) {
      console.error("UI Agent parse error:", e);
    }
  }

  // Settle Arc payment
  const settlement = await settleUsage(
    context.walletAddress,
    {
      screenshots: 0,
      domNodes: context.dom.length / 100,
      securityRules: 0,
      isDeepScan: false,
    },
    `UI Agent Audit: ${context.url}`,
  );

  const executionTime = Date.now() - startTime;
  console.log(
    `✅ UI Agent complete: ${allIssues.length} issues in ${executionTime}ms`,
  );

  return {
    agentType: "ui",
    issues: allIssues,
    cost: AGENT_COSTS.ui,
    executionTime,
    transactionId: settlement.transactionId,
  };
}

/**
 * UX Agent - Analyzes user experience and accessibility
 */
async function runUXAgent(context: AgentContext): Promise<AgentResult> {
  const startTime = Date.now();
  console.log(`🧠 UX Agent starting for ${context.url}`);

  if (!context.dom) {
    throw new Error("DOM data required for UX Agent");
  }

  const chunks = chunkContent(context.dom);
  let allIssues: AgentIssue[] = [];

  for (const chunk of chunks) {
    try {
      const text = await generateWithRetry(UX_AGENT_PROMPT + chunk);
      const issues = parseJSON(text);
      allIssues = allIssues.concat(Array.isArray(issues) ? issues : [issues]);
    } catch (e) {
      console.error("UX Agent parse error:", e);
    }
  }

  // Settle Arc payment
  const settlement = await settleUsage(
    context.walletAddress,
    {
      screenshots: 0,
      domNodes: context.dom.length / 100,
      securityRules: 0,
      isDeepScan: false,
    },
    `UX Agent Audit: ${context.url}`,
  );

  const executionTime = Date.now() - startTime;
  console.log(
    `✅ UX Agent complete: ${allIssues.length} issues in ${executionTime}ms`,
  );

  return {
    agentType: "ux",
    issues: allIssues,
    cost: AGENT_COSTS.ux,
    executionTime,
    transactionId: settlement.transactionId,
  };
}

/**
 * DOM Agent - Analyzes HTML structure and performance
 */
async function runDOMAgent(context: AgentContext): Promise<AgentResult> {
  const startTime = Date.now();
  console.log(`📊 DOM Agent starting for ${context.url}`);

  if (!context.dom) {
    throw new Error("DOM data required for DOM Agent");
  }

  const chunks = chunkContent(context.dom);
  let allIssues: AgentIssue[] = [];

  for (const chunk of chunks) {
    try {
      const text = await generateWithRetry(DOM_AGENT_PROMPT + chunk);
      const issues = parseJSON(text);
      allIssues = allIssues.concat(Array.isArray(issues) ? issues : [issues]);
    } catch (e) {
      console.error("DOM Agent parse error:", e);
    }
  }

  // Settle Arc payment
  const settlement = await settleUsage(
    context.walletAddress,
    {
      screenshots: 0,
      domNodes: context.dom.length / 100,
      securityRules: 0,
      isDeepScan: false,
    },
    `DOM Agent Audit: ${context.url}`,
  );

  const executionTime = Date.now() - startTime;
  console.log(
    `✅ DOM Agent complete: ${allIssues.length} issues in ${executionTime}ms`,
  );

  return {
    agentType: "dom",
    issues: allIssues,
    cost: AGENT_COSTS.dom,
    executionTime,
    transactionId: settlement.transactionId,
  };
}

/**
 * Security Agent - Analyzes security vulnerabilities
 */
async function runSecurityAgent(context: AgentContext): Promise<AgentResult> {
  const startTime = Date.now();
  console.log(`🔒 Security Agent starting for ${context.url}`);

  if (!context.headers) {
    throw new Error("Headers data required for Security Agent");
  }

  const securityData = {
    url: context.url,
    headers: context.headers,
    libraries: context.libraries || [],
    cookies: context.cookies || [],
  };

  let allIssues: AgentIssue[] = [];

  try {
    const text = await generateWithRetry(
      SECURITY_AGENT_PROMPT + JSON.stringify(securityData, null, 2),
    );
    const issues = parseJSON(text);
    allIssues = Array.isArray(issues) ? issues : [issues];
  } catch (e) {
    console.error("Security Agent parse error:", e);
  }

  // Settle Arc payment
  const settlement = await settleUsage(
    context.walletAddress,
    {
      screenshots: 0,
      domNodes: 0,
      securityRules: 20,
      isDeepScan: true,
    },
    `Security Agent Audit: ${context.url}`,
  );

  const executionTime = Date.now() - startTime;
  console.log(
    `✅ Security Agent complete: ${allIssues.length} issues in ${executionTime}ms`,
  );

  return {
    agentType: "security",
    issues: allIssues,
    cost: AGENT_COSTS.security,
    executionTime,
    transactionId: settlement.transactionId,
  };
}

// ─── MASTER COORDINATOR AGENT ───

/**
 * Master Coordinator Agent - Routes requests to specialized agents
 *
 * This agent implements the ADK Coordinator/Dispatcher pattern:
 * 1. Analyzes the user's request
 * 2. Determines which specialized agents to invoke
 * 3. Coordinates execution (parallel or sequential)
 * 4. Aggregates results from all agents
 */
async function runCoordinatorAgent(
  context: AgentContext,
): Promise<CoordinatorResponse> {
  console.log(`🚀 Master Coordinator starting for ${context.url}`);

  const reportStatus = async (
    status: string,
    message: string,
    progress?: number,
  ) => {
    try {
      await getDb()
        .collection("agent_sessions")
        .doc(context.walletAddress)
        .set(
          {
            agentType: "coordinator",
            status,
            message,
            progress: progress ?? 0,
            url: context.url,
            timestamp: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
    } catch (e) {
      console.warn("Failed to report status to Firestore:", e);
    }
  };

  await reportStatus("analyzing", "Starting Master Coordinator...");

  // 1. Pre-flight balance check with auto-bridging
  console.log(
    `🔍 Running pre-flight balance check for ${context.walletAddress}`,
  );

  // Dummy specs for the coordinator to check if any audit is possible
  const dummySpecs: AuditSpecs = {
    screenshots: 1,
    domNodes: 1000,
    securityRules: 10,
    isDeepScan: true,
  };

  const getCircleClient = () =>
    initiateDeveloperControlledWalletsClient({
      apiKey: process.env.CIRCLE_API_KEY!,
      entitySecret: process.env.CIRCLE_ENTITY_SECRET!,
    });

  await reportStatus("bridging", "Checking cross-chain liquidity...");

  const balanceCheck = await checkBalanceWithAutoBridge(
    context.walletAddress,
    dummySpecs,
    getCircleClient,
    true, // Enable auto-bridge
  );

  if (balanceCheck.autoBridgeAttempted) {
    console.log(`🌉 Auto-bridge triggered for ${context.walletAddress}`);
    await reportStatus(
      "bridging",
      "Insufficient funds on Arc. Bridging from Ethereum/Solana...",
    );
  }

  if (!balanceCheck.canProceed) {
    const mainIssue = balanceCheck.issues[0] || {
      message: "Insufficient funds for audit operating costs",
    };

    if (balanceCheck.autoBridgeAttempted && !balanceCheck.autoBridgeSuccess) {
      await reportStatus(
        "error",
        `Auto-bridge failed: ${balanceCheck.recommendations[0]}`,
      );
      throw new Error(`Insufficient funds: ${mainIssue.message}`);
    }

    await reportStatus("error", `Insufficient funds: ${mainIssue.message}`);
    throw new Error(`Insufficient funds: ${mainIssue.message}`);
  }

  if (balanceCheck.autoBridgeSuccess) {
    console.log(
      `🌉 Auto-bridge completed successfully! Transaction: ${balanceCheck.bridgeTransactionHash}`,
    );
    await reportStatus(
      "bridging",
      "Bridge successful! Proceeding with audit...",
      100,
    );
  }

  const currentCredits = balanceCheck.computeCredits;
  const walletDoc = await getDb()
    .collection("wallets")
    .doc(context.walletAddress)
    .get();

  // If specific agents requested, use those
  let agentsToRun: AgentType[] = context.requestedAgents || [];
  let executionPlan = "";

  if (agentsToRun.length === 0) {
    // Use LLM to determine which agents to run
    const coordinatorPrompt = COORDINATOR_PROMPT.replace(
      "{request}",
      `Audit ${context.url}`,
    ).replace("{credits}", currentCredits.toString());

    try {
      const text = await generateWithRetry(coordinatorPrompt);
      const plan = parseJSON(text);
      agentsToRun = plan.agents || ["ui", "ux", "dom", "security"];
      executionPlan = plan.plan || "Running all available agents";
    } catch (e) {
      console.error("Coordinator planning error:", e);
      // Fallback: run all agents
      agentsToRun = ["ui", "ux", "dom", "security"];
      executionPlan = "Running all agents (fallback)";
    }
  } else {
    executionPlan = `Running requested agents: ${agentsToRun.join(", ")}`;
  }

  console.log(`📋 Execution plan: ${executionPlan}`);
  console.log(`🎯 Agents to run: ${agentsToRun.join(", ")}`);

  // Calculate total cost
  const totalCost = agentsToRun.reduce(
    (sum, agent) => sum + AGENT_COSTS[agent],
    AGENT_COSTS.coordinator,
  );

  // Check if we can proceed with either credits or USDC
  if (
    currentCredits < totalCost &&
    parseFloat(balanceCheck.usdcBalance) < totalCost * 0.001
  ) {
    throw new Error(
      `Insufficient funds. Required: ${totalCost} CU or ${(totalCost * 0.001).toFixed(4)} USDC.`,
    );
  }

  // Run agents in parallel for better performance
  const agentPromises: Promise<AgentResult>[] = [];

  for (const agentType of agentsToRun) {
    switch (agentType) {
      case "ui":
        agentPromises.push(runUIAgent(context));
        break;
      case "ux":
        agentPromises.push(runUXAgent(context));
        break;
      case "dom":
        agentPromises.push(runDOMAgent(context));
        break;
      case "security":
        agentPromises.push(runSecurityAgent(context));
        break;
    }
  }

  // Wait for all agents to complete
  const results = await Promise.all(agentPromises);

  // Settle coordinator cost
  if (currentCredits >= AGENT_COSTS.coordinator) {
    await walletDoc.ref.update({
      credits: FieldValue.increment(-AGENT_COSTS.coordinator),
      lastAuditAt: FieldValue.serverTimestamp(),
    });
  } else {
    // Settle via USDC Nanopayment
    await reportStatus(
      "settling",
      `Settling coordinator fee (${AGENT_COSTS.coordinator} CU / 0.002 USDC) via Nanopayment...`,
    );
    await settleUsage(
      context.walletAddress,
      { screenshots: 0, domNodes: 0, securityRules: 0, isDeepScan: false },
      "Coordinator Agent Service Fee",
    );
    await walletDoc.ref.update({
      lastAuditAt: FieldValue.serverTimestamp(),
    });
  }

  // Calculate totals
  const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);
  const creditsRemaining = currentCredits - totalCost;

  // Store audit in Firestore
  const auditId = getDb().collection("audits").doc().id;
  await getDb()
    .collection("audits")
    .doc(auditId)
    .set({
      id: auditId,
      walletAddress: context.walletAddress,
      url: context.url,
      type: "agentic",
      executionPlan,
      results: results.map((r) => ({
        agentType: r.agentType,
        issueCount: r.issues.length,
        cost: r.cost,
        executionTime: r.executionTime,
        transactionId: r.transactionId,
      })),
      totalIssues,
      totalCost,
      createdAt: FieldValue.serverTimestamp(),
    });

  console.log(
    `✅ Master Coordinator complete: ${totalIssues} total issues, ${totalCost} credits used`,
  );

  return {
    success: true,
    auditId,
    results,
    totalIssues,
    totalCost,
    creditsRemaining,
    executionPlan,
  };
}

// ─── CLOUD FUNCTIONS ───

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Wallet-Address",
};

/**
 * POST /agentic/audit - Master Coordinator Endpoint
 *
 * This is the main entry point for the agentic system.
 * The coordinator agent will determine which specialized agents to invoke.
 */
export const agenticAudit = onRequest({ timeoutSeconds: 300, memory: "1GiB", cors: true }, async (req, res) => {
    res.set(corsHeaders);

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const walletAddress = req.headers["x-wallet-address"] as string;
    if (!walletAddress) {
      res.status(401).json({ error: "Wallet address required" });
      return;
    }

    try {
      const { url, dom, headers, libraries, cookies, agents } = req.body;

      if (!url) {
        res.status(400).json({ error: "URL is required" });
        return;
      }

      const context: AgentContext = {
        url,
        dom,
        headers,
        libraries,
        cookies,
        walletAddress,
        requestedAgents: agents, // Optional: specific agents to run
      };

      const result = await runCoordinatorAgent(context);

      res.status(200).json(result);
    } catch (error: any) {
      console.error("❌ Agentic Audit error:", error);

      // Attempt to report failure to Firestore
      try {
        await getDb()
          .collection("agent_sessions")
          .doc(walletAddress)
          .set(
            {
              status: "error",
              message: error.message || "Internal server error",
              timestamp: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
      } catch (dbError) {
        console.warn("Failed to report error status to Firestore:", dbError);
      }

      res.status(500).json({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

/**
 * POST /agentic/ui - Direct UI Agent Endpoint (bypass coordinator)
 */
export const agenticUI = onRequest({ timeoutSeconds: 300, memory: "512MiB", cors: true }, async (req, res) => {
    res.set(corsHeaders);

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    try {
      const walletAddress = req.headers["x-wallet-address"] as string;
      const { url, dom } = req.body;

      const result = await runUIAgent({ url, dom, walletAddress });
      res.status(200).json(result);
    } catch (error) {
      console.error("❌ UI Agent error:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

/**
 * POST /agentic/ux - Direct UX Agent Endpoint (bypass coordinator)
 */
export const agenticUX = onRequest({ timeoutSeconds: 300, memory: "512MiB", cors: true }, async (req, res) => {
    res.set(corsHeaders);

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    try {
      const walletAddress = req.headers["x-wallet-address"] as string;
      const { url, dom } = req.body;

      const result = await runUXAgent({ url, dom, walletAddress });
      res.status(200).json(result);
    } catch (error) {
      console.error("❌ UX Agent error:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

/**
 * POST /agentic/dom - Direct DOM Agent Endpoint (bypass coordinator)
 */
export const agenticDOM = onRequest({ timeoutSeconds: 300, memory: "512MiB", cors: true }, async (req, res) => {
    res.set(corsHeaders);

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    try {
      const walletAddress = req.headers["x-wallet-address"] as string;
      const { url, dom } = req.body;

      const result = await runDOMAgent({ url, dom, walletAddress });
      res.status(200).json(result);
    } catch (error) {
      console.error("❌ DOM Agent error:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

/**
 * POST /agentic/security - Direct Security Agent Endpoint (bypass coordinator)
 */
export const agenticSecurity = onRequest({ timeoutSeconds: 300, memory: "512MiB", cors: true }, async (req, res) => {
    res.set(corsHeaders);

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    const walletAddress = req.headers["x-wallet-address"] as string;
    try {
      const { url, headers, libraries, cookies } = req.body;

      const result = await runSecurityAgent({
        url,
        headers,
        libraries,
        cookies,
        walletAddress,
      });
      res.status(200).json(result);
    } catch (error) {
      console.error("❌ Security Agent error:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });



