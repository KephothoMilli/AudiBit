import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import {
  GoogleGenerativeAI,
  GenerativeModel,
  HarmCategory,
  HarmBlockThreshold,
} from "@google/generative-ai";
import { getDb } from "./firebase-init";
import { chargeAgent, AGENT_PRICES } from "./lib/nanopayment-engine";
import { AuditSpecs, calculateAuditCost } from "./lib/metering";

const getFirestore = () => getDb();
const FieldValue = admin.firestore.FieldValue;

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

/**
 * Chunk large DOM content to fit within Gemini's context window
 */
function chunkDOM(dom: string, maxChunkSize: number = 400000): string[] {
  const chunks: string[] = [];
  let currentChunk = "";
  const lines = dom.split("\n");

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

// ─── AGENT PROMPTS ───

const UI_AGENT_PROMPT = `You are the AudiBit UI Agent. Your specialty is visual aesthetics and brand integrity.
Analyze the DOM and identify issues related to:
1. Visual Consistency (Color palettes, typography alignment)
2. Spacing and Layout (Padding, margin inconsistencies)
3. Component Hierarchy (Visual weight, button prominence)
Return a JSON array of issues: [{type: "ui", severity: "high"|"medium"|"low", title, description, recommendation}]`;

const UX_AGENT_PROMPT = `You are the AudiBit UX Agent. Your specialty is user flow and cognitive friction.
Analyze the DOM and identify issues related to:
1. WCAG Accessibility (Missing alt text, ARIA roles, color contrast)
2. User Friction (Confusing labels, missing feedback states)
3. Mobile Usability (Touch targets, responsive breakage)
Return a JSON array of issues: [{type: "ux", severity: "high"|"medium"|"low", title, description, recommendation}]`;

const DOM_AGENT_PROMPT = `You are the AudiBit DOM Agent. Your specialty is structural integrity and technical SEO.
Analyze the DOM and identify issues related to:
1. Semantic HTML (Improper tag usage, h1 hierarchy)
2. Performance (Deep nesting, redundant nodes)
3. Technical Integrity (Broken links, empty containers)
Return a JSON array of issues: [{type: "dom", severity: "high"|"medium"|"low", title, description, recommendation}]`;

const SECURITY_AGENT_PROMPT = `You are the AudiBit Security Agent. Your specialty is vulnerability scanning.
Analyze the DOM, headers, and metadata to identify:
1. XSS Vectors (Insecure input handling, data leakage)
2. Header Misconfigurations (CSP, HSTS, Secure cookies)
3. Library Vulnerabilities (Outdated packages)
Return a JSON array of issues: [{type: "security", severity: "critical"|"high"|"medium"|"low", title, description, recommendation}]`;

// ─── AGENT IMPLEMENTATION FACTORY ───

/**
 * Generate content with retry logic for network errors and rate limits
 * Based on best practices from https://adk.dev/
 */
async function generateWithRetry(
  prompt: string,
  maxRetries: number = 3,
): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      console.log(`🤖 Gemini API call attempt ${attempt + 1}/${maxRetries}`);

      const result = await model.generateContent(prompt);
      const response = result.response;

      // Check if response was blocked
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

      // Check if it's a network error
      const isNetworkError =
        errorMessage.includes("fetch failed") ||
        errorMessage.includes("ECONNREFUSED") ||
        errorMessage.includes("ETIMEDOUT") ||
        errorMessage.includes("network") ||
        errorMessage.includes("ENOTFOUND") ||
        errorMessage.includes("socket hang up");

      // Check if it's a rate limit error
      const isRateLimit =
        errorMessage.includes("429") ||
        errorMessage.includes("quota") ||
        errorMessage.includes("Too Many Requests") ||
        errorMessage.includes("Resource has been exhausted");

      // Check if it's an API key error
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
          "Gemini API rate limit exceeded. Please wait a moment and try again, or upgrade your API plan at https://ai.google.dev/pricing",
        );
      }

      if (isNetworkError) {
        throw new Error(
          `Network error connecting to Gemini API. Please check your internet connection and try again. Error: ${errorMessage}`,
        );
      }

      // For other errors, throw immediately
      throw new Error(`Gemini API error: ${errorMessage}`);
    }
  }

  // If all retries failed
  throw new Error(
    `Failed to generate content after ${maxRetries} attempts. ${lastError?.message || "Unknown error"}. Please check your internet connection and API key.`,
  );
}

async function runAgent(
  walletAddress: string,
  url: string,
  data: string,
  agentType: "ui" | "ux" | "dom" | "security",
  promptTemplate: string,
  specs: AuditSpecs,
) {
  console.log(
    `🤖 Agent [${agentType.toUpperCase()}] starting audit for ${url}`,
  );

  // ─── NANOPAYMENT GATE ─────────────────────────────────────────────────────
  // Charge the user BEFORE running the query. If payment fails, cancel.
  const payment = await chargeAgent(walletAddress, agentType);

  if (!payment.success) {
    functions.logger.error(
      `❌ Payment rejected [${payment.reason}]: ${payment.userMessage}`,
    );
    // Throw a structured error the frontend can parse
    const err: any = new Error(payment.userMessage);
    err.paymentRejection = payment;
    throw err;
  }

  functions.logger.info(
    `✅ Nanopayment confirmed: ${payment.transactionId} | ${payment.amountUsdc} USDC → ${agentType.toUpperCase()} Agent`,
  );
  // ─────────────────────────────────────────────────────────────────────────

  const chunks = chunkDOM(data);
  let allIssues: any[] = [];

  for (const chunk of chunks) {
    try {
      const text = await generateWithRetry(
        promptTemplate + "\n\nDATA:\n" + chunk,
      );
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) allIssues = allIssues.concat(JSON.parse(jsonMatch[0]));
    } catch (e) {
      console.error(`Agent ${agentType} generation error:`, e);
      throw new Error(
        `Agent ${agentType} failed to generate content: ${e instanceof Error ? e.message : "Unknown error"}`,
      );
    }
  }

  const auditId = getFirestore().collection("audits").doc().id;
  await getFirestore()
    .collection("audits")
    .doc(auditId)
    .set({
      id: auditId,
      walletAddress,
      url,
      type: agentType,
      issues: allIssues,
      payment: {
        transactionId: payment.transactionId,
        amountUsdc: payment.amountUsdc,
        chain: payment.chain,
      },
      createdAt: FieldValue.serverTimestamp(),
    });

  return {
    success: true,
    auditId,
    issues: allIssues,
    payment: {
      transactionId: payment.transactionId,
      amountUsdc: payment.amountUsdc,
      agentWallet: payment.toWallet,
    },
  };
}

// ─── CLOUD FUNCTIONS ───

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Wallet-Address",
};

export const auditUI = functions
  .runWith({
    timeoutSeconds: 300, // 5 minutes
    memory: "512MB",
  })
  .https.onRequest(async (req, res) => {
    res.set(corsHeaders);
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    const walletAddress = req.headers["x-wallet-address"] as string;
    const result = await runAgent(
      walletAddress,
      req.body.url,
      req.body.dom,
      "ui",
      UI_AGENT_PROMPT,
      {} as AuditSpecs,
    );
    res.json(result);
  });

export const auditUX = functions
  .runWith({
    timeoutSeconds: 300, // 5 minutes
    memory: "512MB",
  })
  .https.onRequest(async (req, res) => {
    res.set(corsHeaders);
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    const walletAddress = req.headers["x-wallet-address"] as string;
    const result = await runAgent(
      walletAddress,
      req.body.url,
      req.body.dom,
      "ux",
      UX_AGENT_PROMPT,
      {} as AuditSpecs,
    );
    res.json(result);
  });

export const auditDOM = functions
  .runWith({
    timeoutSeconds: 300, // 5 minutes
    memory: "512MB",
  })
  .https.onRequest(async (req, res) => {
    res.set(corsHeaders);
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    const walletAddress = req.headers["x-wallet-address"] as string;
    const result = await runAgent(
      walletAddress,
      req.body.url,
      req.body.dom,
      "dom",
      DOM_AGENT_PROMPT,
      {} as AuditSpecs,
    );
    res.json(result);
  });

export const auditSecurity = functions
  .runWith({
    timeoutSeconds: 300, // 5 minutes
    memory: "512MB",
  })
  .https.onRequest(async (req, res) => {
    res.set(corsHeaders);
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    const walletAddress = req.headers["x-wallet-address"] as string;
    const securityData = JSON.stringify({
      url: req.body.url,
      headers: req.body.headers,
      libs: req.body.libs,
    });
    const result = await runAgent(
      walletAddress,
      req.body.url,
      securityData,
      "security",
      SECURITY_AGENT_PROMPT,
      {} as AuditSpecs,
    );
    res.json(result);
  });
