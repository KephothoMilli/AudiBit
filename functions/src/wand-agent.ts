/**
 * Wand Agent - Voice-First, Pointer-Aware Browser Assistant
 *
 * Uses Gemini Live API for real-time voice interaction combined with
 * cursor position awareness for natural browser control.
 *
 * Features:
 * - Voice commands with natural language understanding
 * - Cursor position tracking and click automation
 * - Screenshot annotation with pointer location
 * - Real-time context awareness
 * - Multi-modal interaction (voice + vision + cursor)
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import {
  GoogleGenerativeAI,
  GenerativeModel,
  HarmCategory,
  HarmBlockThreshold,
} from "@google/generative-ai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is required for Wand Agent");
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Use Gemini 2.0 Flash for real-time multimodal capabilities
const wandModel: GenerativeModel = genAI.getGenerativeModel({
  model: "gemini-2.0-flash-exp",
  generationConfig: {
    temperature: 0.8,
    topK: 40,
    topP: 0.95,
    maxOutputTokens: 2048,
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

interface WandContext {
  voiceCommand: string;
  cursorPosition?: {
    x: number;
    y: number;
    elementUnderCursor?: string; // CSS selector or element description
  };
  screenshot?: string; // Base64 encoded screenshot
  pageContext: {
    url: string;
    title: string;
    dom?: string; // Simplified DOM structure
    viewport: {
      width: number;
      height: number;
    };
  };
  conversationHistory?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
}

interface WandAction {
  type:
    | "click"
    | "scroll"
    | "navigate"
    | "search"
    | "type"
    | "speak"
    | "annotate"
    | "wait";
  target?: {
    x?: number;
    y?: number;
    selector?: string;
    url?: string;
  };
  value?: string | number;
  description: string;
}

interface WandResponse {
  understanding: string; // What Wand understood from voice + pointer
  actions: WandAction[]; // Actions to execute
  speech: string; // What Wand says back
  confidence: number; // 0-1 confidence score
  needsConfirmation: boolean; // Whether to ask user before executing
}

const WAND_SYSTEM_PROMPT = `You are Wand, a voice-first, pointer-aware browser assistant.

CORE CAPABILITIES:
1. Voice Understanding: Parse natural language commands
2. Pointer Awareness: Understand cursor position and what user is pointing at
3. Vision: Analyze screenshots to identify elements
4. Action Execution: Perform browser actions (click, scroll, navigate, type)
5. Context Awareness: Remember conversation and page context

INTERACTION PATTERNS:

1. POINTING + VOICE:
   - "play this" (pointing at video) → Click at cursor position
   - "what is this?" (pointing) → Analyze element under cursor
   - "zoom in here" (pointing at map) → Scroll at cursor position
   - "click this" (pointing) → Click at exact cursor coordinates

2. VOICE ONLY:
   - "search for hiking boots" → Navigate to shopping site with query
   - "go back" → Browser back navigation
   - "scroll down" → Scroll page down
   - "who invented this?" → Search and answer

3. CONTEXTUAL:
   - "play the next one" → Use page context to find next video
   - "add to cart" → Find and click add to cart button
   - "read this article" → Extract and read text content

RESPONSE FORMAT:
Always respond with:
1. Understanding: What you understood from voice + pointer
2. Actions: Array of actions to execute
3. Speech: Natural response to user
4. Confidence: How confident you are (0-1)
5. NeedsConfirmation: Whether to ask before executing

ACTION TYPES:
- click: Click at coordinates or selector
- scroll: Scroll page or element
- navigate: Go to URL
- search: Perform web search
- type: Type text into input
- speak: Just respond verbally
- annotate: Mark screenshot with pointer location
- wait: Wait for element or time

SAFETY:
- Never execute destructive actions without confirmation
- Always explain what you're about to do
- Ask for confirmation on purchases, deletions, or sensitive actions
- Respect user privacy and security

PERSONALITY:
- Helpful and proactive
- Natural and conversational
- Clear and concise
- Anticipate user needs
- Admit when unsure`;

/**
 * Process voice command with pointer context
 */
async function processWandCommand(context: WandContext): Promise<WandResponse> {
  try {
    // Build multimodal prompt
    const parts: any[] = [];

    // Add system context
    parts.push({
      text: `${WAND_SYSTEM_PROMPT}

CURRENT CONTEXT:
- Page: ${context.pageContext.title}
- URL: ${context.pageContext.url}
- Viewport: ${context.pageContext.viewport.width}x${context.pageContext.viewport.height}
${context.cursorPosition ? `- Cursor: (${context.cursorPosition.x}, ${context.cursorPosition.y})` : ""}
${context.cursorPosition?.elementUnderCursor ? `- Element under cursor: ${context.cursorPosition.elementUnderCursor}` : ""}

USER COMMAND: "${context.voiceCommand}"`,
    });

    // Add screenshot if provided (for "what is this?" queries)
    if (context.screenshot) {
      parts.push({
        inlineData: {
          mimeType: "image/png",
          data: context.screenshot,
        },
      });

      if (context.cursorPosition) {
        parts.push({
          text: `The user is pointing at coordinates (${context.cursorPosition.x}, ${context.cursorPosition.y}) in the screenshot. Analyze what's at that location.`,
        });
      }
    }

    // Add conversation history for context
    if (context.conversationHistory && context.conversationHistory.length > 0) {
      parts.push({
        text: `\nCONVERSATION HISTORY:\n${context.conversationHistory.map((msg) => `${msg.role}: ${msg.content}`).join("\n")}`,
      });
    }

    // Add DOM context if available
    if (context.pageContext.dom) {
      parts.push({
        text: `\nPAGE STRUCTURE:\n${context.pageContext.dom.substring(0, 2000)}...`,
      });
    }

    parts.push({
      text: `\nRespond in JSON format:
{
  "understanding": "What you understood from the command and context",
  "actions": [
    {
      "type": "click|scroll|navigate|search|type|speak|annotate|wait",
      "target": { "x": 100, "y": 200, "selector": ".button", "url": "https://..." },
      "value": "text to type or scroll amount",
      "description": "Human-readable description of action"
    }
  ],
  "speech": "Natural language response to user",
  "confidence": 0.95,
  "needsConfirmation": false
}`,
    });

    // Call Gemini
    const result = await wandModel.generateContent(parts);
    const response = result.response;
    const text = response.text();

    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to parse Wand response");
    }

    const wandResponse: WandResponse = JSON.parse(jsonMatch[0]);

    // Validate confidence
    if (wandResponse.confidence < 0.5) {
      wandResponse.needsConfirmation = true;
      wandResponse.speech = `I'm not quite sure I understood. ${wandResponse.speech} Is that what you meant?`;
    }

    return wandResponse;
  } catch (error) {
    console.error("❌ Wand processing error:", error);

    // Fallback response
    return {
      understanding: `I heard "${context.voiceCommand}" but couldn't process it fully.`,
      actions: [
        {
          type: "speak",
          description: "Apologize and ask for clarification",
        },
      ],
      speech:
        "I'm sorry, I didn't quite catch that. Could you try again or rephrase?",
      confidence: 0.3,
      needsConfirmation: false,
    };
  }
}

/**
 * Annotate screenshot with cursor position
 */
function annotateScreenshot(
  screenshot: string,
  cursorX: number,
  cursorY: number,
): string {
  // In a real implementation, this would use image processing
  // to draw a marker at the cursor position
  // For now, return metadata
  return JSON.stringify({
    screenshot,
    annotation: {
      type: "cursor",
      x: cursorX,
      y: cursorY,
      marker: "🎯",
    },
  });
}

/**
 * Main Wand Agent Endpoint
 */
export const wandAgent = functions
  .runWith({
    timeoutSeconds: 120, // 2 minutes for voice processing
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
      const context: WandContext = req.body;

      if (!context.voiceCommand) {
        res.status(400).json({ error: "Voice command required" });
        return;
      }

      if (!context.pageContext) {
        res.status(400).json({ error: "Page context required" });
        return;
      }

      functions.logger.info(
        `🪄 Wand command: "${context.voiceCommand}" at (${context.cursorPosition?.x}, ${context.cursorPosition?.y})`,
      );

      // Process command
      const response = await processWandCommand(context);

      functions.logger.info(
        `✅ Wand response: ${response.actions.length} actions, confidence: ${response.confidence}`,
      );

      // Log to Firestore for analytics
      await admin
        .firestore()
        .collection("wand_interactions")
        .add({
          command: context.voiceCommand,
          cursorPosition: context.cursorPosition,
          pageUrl: context.pageContext.url,
          actions: response.actions.map((a) => a.type),
          confidence: response.confidence,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });

      res.json(response);
    } catch (error: any) {
      functions.logger.error("❌ Wand agent error:", error);
      res.status(500).json({
        error: "Wand agent failed",
        message: error.message,
      });
    }
  });

/**
 * Wand Voice Stream Endpoint (for real-time voice interaction)
 */
export const wandVoiceStream = functions
  .runWith({
    timeoutSeconds: 300, // 5 minutes for streaming
    memory: "1GB",
  })
  .https.onRequest(async (req, res) => {
    // Enable CORS
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    try {
      // Set up Server-Sent Events for streaming
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      // This would integrate with Gemini Live API for real-time streaming
      // For now, send a placeholder response
      res.write(
        `data: ${JSON.stringify({ type: "connected", message: "Wand voice stream ready" })}\n\n`,
      );

      // Keep connection alive
      const keepAlive = setInterval(() => {
        res.write(`data: ${JSON.stringify({ type: "ping" })}\n\n`);
      }, 30000);

      // Clean up on close
      req.on("close", () => {
        clearInterval(keepAlive);
        res.end();
      });
    } catch (error: any) {
      functions.logger.error("❌ Wand voice stream error:", error);
      res.status(500).json({
        error: "Voice stream failed",
        message: error.message,
      });
    }
  });

/**
 * Wand Context Analyzer - Analyzes page for voice-actionable elements
 */
export const wandAnalyzeContext = functions
  .runWith({
    timeoutSeconds: 60,
    memory: "512MB",
  })
  .https.onRequest(async (req, res) => {
    // Enable CORS
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    try {
      const { dom, url, screenshot } = req.body;

      if (!dom || !url) {
        res.status(400).json({ error: "DOM and URL required" });
        return;
      }

      // Analyze page for voice-actionable elements
      const prompt = `Analyze this webpage and identify elements that can be controlled via voice commands.

URL: ${url}
DOM Structure: ${dom.substring(0, 3000)}

Identify:
1. Clickable elements (buttons, links, videos)
2. Input fields (search boxes, forms)
3. Scrollable areas (maps, galleries)
4. Interactive elements (sliders, dropdowns)

For each element, provide:
- Type (button, link, input, etc.)
- Description (what it does)
- Selector (CSS selector)
- Voice commands that could target it
- Bounding box (if available)

Respond in JSON format.`;

      const result = await wandModel.generateContent(prompt);
      const text = result.response.text();

      // Parse response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

      res.json({
        url,
        actionableElements: analysis.elements || [],
        suggestions: analysis.suggestions || [],
        voiceCommands: analysis.voiceCommands || [],
      });
    } catch (error: any) {
      functions.logger.error("❌ Context analysis error:", error);
      res.status(500).json({
        error: "Context analysis failed",
        message: error.message,
      });
    }
  });
