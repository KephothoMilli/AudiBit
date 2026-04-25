/**
 * Specialized AI Agents for Audibit
 *
 * Four specialized agents powered by Gemini 2.0 Flash:
 * 1. UI Agent - Visuals & Branding (~0.005 USDC/scan)
 * 2. UX Agent - Flow & Accessibility (~0.008 USDC/scan)
 * 3. DOM Agent - Structure & Performance (~0.003 USDC/scan)
 * 4. Security Agent - Vulnerabilities (~0.012 USDC/scan)
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import {
  GoogleGenerativeAI,
  GenerativeModel,
  HarmCategory,
  HarmBlockThreshold,
} from "@google/generative-ai";

// Helper to get Firestore instance (called after admin.initializeApp())
const getDb = () => admin.firestore();

// Initialize Gemini AI with proper configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY not found in environment variables");
  throw new Error("GEMINI_API_KEY is required. Set it in functions/.env");
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// ⚠️ IMPORTANT: Always use gemini-3-flash-preview model
// This is the latest Gemini 3 model with best performance
// DO NOT change to other models without testing
const model: GenerativeModel = genAI.getGenerativeModel({
  model: "gemini-3-flash-preview", // ⚠️ REQUIRED: Use this model only
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

// Credit costs per agent (in credits, 1 credit = $0.001 USDC)
const AGENT_COSTS = {
  ui: 5, // 0.005 USDC
  ux: 8, // 0.008 USDC
  dom: 3, // 0.003 USDC
  security: 12, // 0.012 USDC
};

// Agent type definition
export type AgentType = "ui" | "ux" | "dom" | "security";

interface AgentIssue {
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

/**
 * UI Agent - Analyzes visual design and branding
 * Focus: Colors, typography, spacing, visual hierarchy, brand consistency
 */
const UI_AGENT_PROMPT = `You are a UI Design Expert Agent specializing in visual design and branding analysis.

Analyze the provided DOM structure and identify issues related to:

1. **Visual Design**:
   - Color palette consistency and harmony
   - Typography hierarchy and readability
   - Spacing and layout consistency
   - Visual balance and alignment
   - Button and component styling

2. **Branding**:
   - Brand color usage
   - Logo placement and sizing
   - Visual identity consistency
   - Design system adherence

3. **Visual Hierarchy**:
   - Clear information hierarchy
   - Proper use of size, color, and weight
   - Visual flow and scanning patterns

Return your analysis as a JSON array of issues with this exact structure:
[
  {
    "type": "color" | "typography" | "spacing" | "branding" | "hierarchy",
    "severity": "critical" | "high" | "medium" | "low",
    "title": "Brief issue title",
    "description": "Detailed explanation of the visual issue",
    "element": "CSS selector or element description",
    "recommendation": "How to fix this visual issue"
  }
]

DOM to analyze:
`;

/**
 * UX Agent - Analyzes user experience and accessibility
 * Focus: User flow, accessibility, interaction patterns, usability
 */
const UX_AGENT_PROMPT = `You are a UX Expert Agent specializing in user experience and accessibility.

Analyze the provided DOM structure and identify issues related to:

1. **User Flow**:
   - Navigation clarity and intuitiveness
   - User journey optimization
   - Call-to-action placement and clarity
   - Form usability and flow

2. **Accessibility (WCAG 2.1)**:
   - Missing alt text on images
   - Insufficient color contrast (4.5:1 for text, 3:1 for large text)
   - Missing ARIA labels on interactive elements
   - Improper heading hierarchy (h1, h2, h3...)
   - Missing form labels and error messages
   - Keyboard navigation support
   - Screen reader compatibility

3. **Interaction Patterns**:
   - Touch target sizes (minimum 44x44px)
   - Hover and focus states
   - Loading states and feedback
   - Error handling and validation

Return your analysis as a JSON array of issues with this exact structure:
[
  {
    "type": "navigation" | "accessibility" | "interaction" | "usability",
    "severity": "critical" | "high" | "medium" | "low",
    "title": "Brief issue title",
    "description": "Detailed explanation of the UX issue",
    "element": "CSS selector or element description",
    "recommendation": "How to fix this UX issue",
    "wcagCriteria": "WCAG criterion if applicable (e.g., 1.4.3, 2.1.1)"
  }
]

DOM to analyze:
`;

/**
 * DOM Agent - Analyzes DOM structure and performance
 * Focus: HTML structure, semantic markup, performance, SEO
 */
const DOM_AGENT_PROMPT = `You are a DOM Structure Expert Agent specializing in HTML structure and performance.

Analyze the provided DOM structure and identify issues related to:

1. **HTML Structure**:
   - Semantic HTML usage (header, nav, main, article, section, footer)
   - Proper nesting and hierarchy
   - Valid HTML structure
   - Deprecated tags or attributes

2. **Performance**:
   - DOM depth and complexity
   - Excessive nesting (>15 levels)
   - Large DOM size (>1500 nodes)
   - Inefficient selectors
   - Render-blocking elements

3. **SEO & Metadata**:
   - Missing or duplicate meta tags
   - Missing or improper heading structure
   - Missing alt attributes for SEO
   - Schema markup opportunities

4. **Best Practices**:
   - Proper use of IDs and classes
   - Data attributes usage
   - Script and style placement
   - Resource loading optimization

Return your analysis as a JSON array of issues with this exact structure:
[
  {
    "type": "structure" | "performance" | "seo" | "best-practice",
    "severity": "critical" | "high" | "medium" | "low",
    "title": "Brief issue title",
    "description": "Detailed explanation of the DOM issue",
    "element": "CSS selector or element description",
    "recommendation": "How to fix this DOM issue"
  }
]

DOM to analyze:
`;

/**
 * Security Agent - Analyzes security vulnerabilities
 * Focus: Security headers, XSS, CSRF, dependencies, cookies
 */
const SECURITY_AGENT_PROMPT = `You are a Web Security Expert Agent specializing in vulnerability detection.

Analyze the provided security data and identify vulnerabilities:

1. **HTTP Security Headers**:
   - Missing Content-Security-Policy (CSP)
   - Missing X-Frame-Options (clickjacking protection)
   - Missing Strict-Transport-Security (HSTS)
   - Missing X-Content-Type-Options
   - Missing Referrer-Policy
   - Weak or misconfigured headers

2. **Third-party Libraries**:
   - Known CVEs in detected libraries
   - Outdated library versions
   - Vulnerable dependencies
   - Risky library usage patterns

3. **Cookie Security**:
   - Cookies without Secure flag
   - Cookies without HttpOnly flag
   - Missing SameSite attribute
   - Overly permissive cookie domains
   - Session cookie vulnerabilities

4. **General Security**:
   - Mixed content (HTTP resources on HTTPS pages)
   - Exposed sensitive data in DOM
   - Potential XSS vectors
   - CSRF vulnerabilities
   - Insecure form submissions

Return your analysis as a JSON array of issues with this exact structure:
[
  {
    "type": "headers" | "libraries" | "cookies" | "xss" | "csrf" | "general",
    "severity": "critical" | "high" | "medium" | "low",
    "title": "Brief issue title",
    "description": "Detailed explanation of the vulnerability",
    "element": "Affected component or resource",
    "recommendation": "How to fix this vulnerability",
    "cve": "CVE identifier if applicable",
    "references": ["URL to documentation or CVE details"]
  }
]

Security data to analyze:
`;

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
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      currentChunk = line;
    } else {
      currentChunk += "\n" + line;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Generate content with retry logic for rate limiting and network errors
 */
async function generateWithRetry(
  prompt: string,
  maxRetries: number = 3,
): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      const response = result.response;
      return response.text();
    } catch (error: any) {
      lastError = error;
      const errorMessage = error?.message || String(error);

      // Check if it's a network error
      const isNetworkError =
        errorMessage.includes("fetch failed") ||
        errorMessage.includes("ECONNREFUSED") ||
        errorMessage.includes("ETIMEDOUT") ||
        errorMessage.includes("network") ||
        errorMessage.includes("ENOTFOUND");

      // Check if it's a rate limit error
      const isRateLimit =
        errorMessage.includes("429") ||
        errorMessage.includes("quota") ||
        errorMessage.includes("Too Many Requests");

      if ((isNetworkError || isRateLimit) && attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 2000; // 2s, 4s, 8s
        console.log(
          `⚠️  ${isNetworkError ? "Network error" : "Rate limited"}, retrying in ${delay / 1000}s (attempt ${attempt + 1}/${maxRetries})`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else if (isRateLimit) {
        throw new Error(
          "Gemini API quota exceeded. Please wait a moment and try again, or upgrade your API plan for higher limits.",
        );
      } else if (isNetworkError) {
        throw new Error(
          `Network error connecting to Gemini API: ${errorMessage}. Please check your internet connection and try again.`,
        );
      } else {
        throw error;
      }
    }
  }

  throw new Error(
    `Failed to generate content after ${maxRetries} attempts. ${lastError?.message || "Unknown error"}`,
  );
}

/**
 * Run a specialized agent analysis
 */
async function runAgent(
  agentType: AgentType,
  prompt: string,
  data: string,
): Promise<AgentIssue[]> {
  const chunks = chunkContent(data);
  let allIssues: AgentIssue[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const fullPrompt = prompt + chunk;

    console.log(
      `${agentType.toUpperCase()} Agent analyzing chunk ${i + 1}/${chunks.length} (${chunk.length} chars)`,
    );

    try {
      const text = await generateWithRetry(fullPrompt);

      // Parse JSON response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const issues = JSON.parse(jsonMatch[0]);
        allIssues = allIssues.concat(issues);
      }
    } catch (parseError) {
      console.error(
        `${agentType.toUpperCase()} Agent parse error:`,
        parseError,
      );
    }
  }

  return allIssues;
}

/**
 * POST /agents/ui - UI Agent Analysis
 */
export const uiAgent = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, X-Wallet-Address");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const walletAddress = req.headers["x-wallet-address"] as string;
    if (!walletAddress) {
      res.status(401).json({ error: "Wallet address required" });
      return;
    }

    const { url, dom } = req.body;
    if (!url || !dom) {
      res.status(400).json({ error: "Missing required fields: url, dom" });
      return;
    }

    // Check wallet credits
    const walletDoc = await getDb()
      .collection("wallets")
      .doc(walletAddress)
      .get();
    if (!walletDoc.exists) {
      res.status(404).json({ error: "Wallet not found" });
      return;
    }

    const currentCredits = walletDoc.data()!.credits || 0;
    if (currentCredits < AGENT_COSTS.ui) {
      res.status(402).json({
        error: "Insufficient credits",
        required: AGENT_COSTS.ui,
        available: currentCredits,
      });
      return;
    }

    console.log(`🎨 UI Agent analyzing ${url} for wallet ${walletAddress}`);

    // Run UI Agent
    const issues = await runAgent("ui", UI_AGENT_PROMPT, dom);

    // Deduct credits
    await walletDoc.ref.update({
      credits: admin.firestore.FieldValue.increment(-AGENT_COSTS.ui),
      lastAuditAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Store analysis
    const analysisId = getDb().collection("analyses").doc().id;
    await getDb().collection("analyses").doc(analysisId).set({
      id: analysisId,
      walletAddress,
      url,
      agentType: "ui",
      issues,
      creditsUsed: AGENT_COSTS.ui,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`✅ UI Agent complete: ${issues.length} issues found`);

    res.status(200).json({
      success: true,
      analysisId,
      agentType: "ui",
      issues,
      creditsUsed: AGENT_COSTS.ui,
      creditsRemaining: currentCredits - AGENT_COSTS.ui,
    });
  } catch (error) {
    console.error("❌ UI Agent error:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /agents/ux - UX Agent Analysis
 */
export const uxAgent = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, X-Wallet-Address");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const walletAddress = req.headers["x-wallet-address"] as string;
    if (!walletAddress) {
      res.status(401).json({ error: "Wallet address required" });
      return;
    }

    const { url, dom } = req.body;
    if (!url || !dom) {
      res.status(400).json({ error: "Missing required fields: url, dom" });
      return;
    }

    // Check wallet credits
    const walletDoc = await getDb()
      .collection("wallets")
      .doc(walletAddress)
      .get();
    if (!walletDoc.exists) {
      res.status(404).json({ error: "Wallet not found" });
      return;
    }

    const currentCredits = walletDoc.data()!.credits || 0;
    if (currentCredits < AGENT_COSTS.ux) {
      res.status(402).json({
        error: "Insufficient credits",
        required: AGENT_COSTS.ux,
        available: currentCredits,
      });
      return;
    }

    console.log(`🧠 UX Agent analyzing ${url} for wallet ${walletAddress}`);

    // Run UX Agent
    const issues = await runAgent("ux", UX_AGENT_PROMPT, dom);

    // Deduct credits
    await walletDoc.ref.update({
      credits: admin.firestore.FieldValue.increment(-AGENT_COSTS.ux),
      lastAuditAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Store analysis
    const analysisId = getDb().collection("analyses").doc().id;
    await getDb().collection("analyses").doc(analysisId).set({
      id: analysisId,
      walletAddress,
      url,
      agentType: "ux",
      issues,
      creditsUsed: AGENT_COSTS.ux,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`✅ UX Agent complete: ${issues.length} issues found`);

    res.status(200).json({
      success: true,
      analysisId,
      agentType: "ux",
      issues,
      creditsUsed: AGENT_COSTS.ux,
      creditsRemaining: currentCredits - AGENT_COSTS.ux,
    });
  } catch (error) {
    console.error("❌ UX Agent error:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /agents/dom - DOM Agent Analysis
 */
export const domAgent = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, X-Wallet-Address");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const walletAddress = req.headers["x-wallet-address"] as string;
    if (!walletAddress) {
      res.status(401).json({ error: "Wallet address required" });
      return;
    }

    const { url, dom } = req.body;
    if (!url || !dom) {
      res.status(400).json({ error: "Missing required fields: url, dom" });
      return;
    }

    // Check wallet credits
    const walletDoc = await getDb()
      .collection("wallets")
      .doc(walletAddress)
      .get();
    if (!walletDoc.exists) {
      res.status(404).json({ error: "Wallet not found" });
      return;
    }

    const currentCredits = walletDoc.data()!.credits || 0;
    if (currentCredits < AGENT_COSTS.dom) {
      res.status(402).json({
        error: "Insufficient credits",
        required: AGENT_COSTS.dom,
        available: currentCredits,
      });
      return;
    }

    console.log(`📊 DOM Agent analyzing ${url} for wallet ${walletAddress}`);

    // Run DOM Agent
    const issues = await runAgent("dom", DOM_AGENT_PROMPT, dom);

    // Deduct credits
    await walletDoc.ref.update({
      credits: admin.firestore.FieldValue.increment(-AGENT_COSTS.dom),
      lastAuditAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Store analysis
    const analysisId = getDb().collection("analyses").doc().id;
    await getDb().collection("analyses").doc(analysisId).set({
      id: analysisId,
      walletAddress,
      url,
      agentType: "dom",
      issues,
      creditsUsed: AGENT_COSTS.dom,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`✅ DOM Agent complete: ${issues.length} issues found`);

    res.status(200).json({
      success: true,
      analysisId,
      agentType: "dom",
      issues,
      creditsUsed: AGENT_COSTS.dom,
      creditsRemaining: currentCredits - AGENT_COSTS.dom,
    });
  } catch (error) {
    console.error("❌ DOM Agent error:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /agents/security - Security Agent Analysis
 */
export const securityAgent = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, X-Wallet-Address");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const walletAddress = req.headers["x-wallet-address"] as string;
    if (!walletAddress) {
      res.status(401).json({ error: "Wallet address required" });
      return;
    }

    const { url, headers, libraries, cookies } = req.body;
    if (!url || !headers) {
      res.status(400).json({ error: "Missing required fields: url, headers" });
      return;
    }

    // Check wallet credits
    const walletDoc = await getDb()
      .collection("wallets")
      .doc(walletAddress)
      .get();
    if (!walletDoc.exists) {
      res.status(404).json({ error: "Wallet not found" });
      return;
    }

    const currentCredits = walletDoc.data()!.credits || 0;
    if (currentCredits < AGENT_COSTS.security) {
      res.status(402).json({
        error: "Insufficient credits",
        required: AGENT_COSTS.security,
        available: currentCredits,
      });
      return;
    }

    console.log(
      `🔒 Security Agent analyzing ${url} for wallet ${walletAddress}`,
    );

    // Build security data
    const securityData = {
      url,
      headers,
      libraries: libraries || [],
      cookies: cookies || [],
    };

    // Run Security Agent
    const issues = await runAgent(
      "security",
      SECURITY_AGENT_PROMPT,
      JSON.stringify(securityData, null, 2),
    );

    // Deduct credits
    await walletDoc.ref.update({
      credits: admin.firestore.FieldValue.increment(-AGENT_COSTS.security),
      lastAuditAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Store analysis
    const analysisId = getDb().collection("analyses").doc().id;
    await getDb().collection("analyses").doc(analysisId).set({
      id: analysisId,
      walletAddress,
      url,
      agentType: "security",
      issues,
      creditsUsed: AGENT_COSTS.security,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`✅ Security Agent complete: ${issues.length} issues found`);

    res.status(200).json({
      success: true,
      analysisId,
      agentType: "security",
      issues,
      creditsUsed: AGENT_COSTS.security,
      creditsRemaining: currentCredits - AGENT_COSTS.security,
    });
  } catch (error) {
    console.error("❌ Security Agent error:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /agents/full - Run all agents (full audit)
 */
export const fullAudit = functions
  .runWith({
    timeoutSeconds: 300, // 5 minutes
    memory: "1GB",
  })
  .https.onRequest(async (req, res) => {
    // Enable CORS
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, X-Wallet-Address");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    try {
      const walletAddress = req.headers["x-wallet-address"] as string;
      if (!walletAddress) {
        res.status(401).json({ error: "Wallet address required" });
        return;
      }

      const { url, dom, headers, libraries, cookies } = req.body;
      if (!url || !dom || !headers) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }

      // Calculate total cost
      const totalCost =
        AGENT_COSTS.ui +
        AGENT_COSTS.ux +
        AGENT_COSTS.dom +
        AGENT_COSTS.security;

      // Check wallet credits
      const walletDoc = await getDb()
        .collection("wallets")
        .doc(walletAddress)
        .get();
      if (!walletDoc.exists) {
        res.status(404).json({ error: "Wallet not found" });
        return;
      }

      const currentCredits = walletDoc.data()!.credits || 0;
      if (currentCredits < totalCost) {
        res.status(402).json({
          error: "Insufficient credits",
          required: totalCost,
          available: currentCredits,
        });
        return;
      }

      console.log(
        `🚀 Full Audit starting for ${url} by wallet ${walletAddress}`,
      );

      // Run all agents in parallel
      const securityData = {
        url,
        headers,
        libraries: libraries || [],
        cookies: cookies || [],
      };

      const [uiIssues, uxIssues, domIssues, securityIssues] = await Promise.all(
        [
          runAgent("ui", UI_AGENT_PROMPT, dom),
          runAgent("ux", UX_AGENT_PROMPT, dom),
          runAgent("dom", DOM_AGENT_PROMPT, dom),
          runAgent(
            "security",
            SECURITY_AGENT_PROMPT,
            JSON.stringify(securityData, null, 2),
          ),
        ],
      );

      // Deduct credits
      await walletDoc.ref.update({
        credits: admin.firestore.FieldValue.increment(-totalCost),
        lastAuditAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Store full audit
      const auditId = getDb().collection("audits").doc().id;
      await getDb()
        .collection("audits")
        .doc(auditId)
        .set({
          id: auditId,
          walletAddress,
          url,
          type: "full",
          agents: {
            ui: { issues: uiIssues, cost: AGENT_COSTS.ui },
            ux: { issues: uxIssues, cost: AGENT_COSTS.ux },
            dom: { issues: domIssues, cost: AGENT_COSTS.dom },
            security: { issues: securityIssues, cost: AGENT_COSTS.security },
          },
          totalIssues:
            uiIssues.length +
            uxIssues.length +
            domIssues.length +
            securityIssues.length,
          creditsUsed: totalCost,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      console.log(
        `✅ Full Audit complete: ${uiIssues.length + uxIssues.length + domIssues.length + securityIssues.length} total issues`,
      );

      res.status(200).json({
        success: true,
        auditId,
        type: "full",
        agents: {
          ui: { issues: uiIssues, cost: AGENT_COSTS.ui },
          ux: { issues: uxIssues, cost: AGENT_COSTS.ux },
          dom: { issues: domIssues, cost: AGENT_COSTS.dom },
          security: { issues: securityIssues, cost: AGENT_COSTS.security },
        },
        totalIssues:
          uiIssues.length +
          uxIssues.length +
          domIssues.length +
          securityIssues.length,
        creditsUsed: totalCost,
        creditsRemaining: currentCredits - totalCost,
      });
    } catch (error) {
      console.error("❌ Full Audit error:", error);
      res.status(500).json({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
