/**
 * Wand Overlay - Voice-First Browser Assistant UI
 *
 * Provides visual feedback for voice commands and cursor tracking
 */

/**
 * Safe wrapper for chrome.runtime.sendMessage.
 * Silently swallows "Extension context invalidated" errors that occur
 * when the extension is reloaded while the content script is still running.
 */
function safeSendMessage(message: object): void {
  try {
    if (chrome?.runtime?.id) {
      chrome.runtime.sendMessage(message);
    }
  } catch {
    // Extension context invalidated — content script is stale, ignore
  }
}

interface WandState {
  isListening: boolean;
  isProcessing: boolean;
  cursorPosition: { x: number; y: number } | null;
  lastCommand: string | null;
  confidence: number;
}

class WandOverlay {
  private state: WandState = {
    isListening: false,
    isProcessing: false,
    cursorPosition: null,
    lastCommand: null,
    confidence: 0,
  };

  private overlayElement: HTMLDivElement | null = null;
  private cursorMarker: HTMLDivElement | null = null;
  private voiceIndicator: HTMLDivElement | null = null;
  private feedbackBox: HTMLDivElement | null = null;

  constructor() {
    this.init();
    this.setupEventListeners();
  }

  private init() {
    // Create overlay container
    this.overlayElement = document.createElement("div");
    this.overlayElement.id = "wand-overlay";
    this.overlayElement.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    `;

    // Create cursor marker (appears when pointing + speaking)
    this.cursorMarker = document.createElement("div");
    this.cursorMarker.id = "wand-cursor-marker";
    this.cursorMarker.style.cssText = `
      position: absolute;
      width: 40px;
      height: 40px;
      border: 3px solid #3b82f6;
      border-radius: 50%;
      background: rgba(59, 130, 246, 0.2);
      transform: translate(-50%, -50%);
      display: none;
      pointer-events: none;
      animation: wand-pulse 1.5s ease-in-out infinite;
    `;

    // Create voice indicator (shows when listening)
    this.voiceIndicator = document.createElement("div");
    this.voiceIndicator.id = "wand-voice-indicator";
    this.voiceIndicator.style.cssText = `
      position: fixed;
      bottom: 30px;
      right: 30px;
      width: 60px;
      height: 60px;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      border-radius: 50%;
      display: none;
      pointer-events: auto;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(59, 130, 246, 0.4);
      transition: all 0.3s ease;
    `;
    this.voiceIndicator.innerHTML = `
      <svg width="60" height="60" viewBox="0 0 60 60" style="padding: 15px;">
        <path d="M30 10 C25 10 22 13 22 18 L22 30 C22 35 25 38 30 38 C35 38 38 35 38 30 L38 18 C38 13 35 10 30 10 Z M18 28 L18 30 C18 37 23 43 30 43 C37 43 42 37 42 30 L42 28 M30 43 L30 50 M24 50 L36 50" 
              stroke="white" stroke-width="2" fill="none" stroke-linecap="round"/>
      </svg>
    `;

    // Create feedback box (shows command understanding)
    this.feedbackBox = document.createElement("div");
    this.feedbackBox.id = "wand-feedback";
    this.feedbackBox.style.cssText = `
      position: fixed;
      top: 30px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(15, 23, 42, 0.95);
      color: white;
      padding: 16px 24px;
      border-radius: 12px;
      display: none;
      pointer-events: none;
      max-width: 500px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(10px);
    `;

    // Add animation styles
    const style = document.createElement("style");
    style.textContent = `
      @keyframes wand-pulse {
        0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        50% { transform: translate(-50%, -50%) scale(1.2); opacity: 0.7; }
      }
      
      @keyframes wand-listening {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.1); }
      }
      
      #wand-voice-indicator.listening {
        animation: wand-listening 1s ease-in-out infinite;
      }
      
      #wand-voice-indicator:hover {
        transform: scale(1.1);
      }
    `;
    document.head.appendChild(style);

    // Append to overlay
    this.overlayElement.appendChild(this.cursorMarker);
    this.overlayElement.appendChild(this.voiceIndicator);
    this.overlayElement.appendChild(this.feedbackBox);

    // Append to body
    document.body.appendChild(this.overlayElement);
  }

  private setupEventListeners() {
    // Track cursor position
    document.addEventListener("mousemove", (e) => {
      this.state.cursorPosition = { x: e.clientX, y: e.clientY };

      if (this.state.isListening && this.cursorMarker) {
        this.cursorMarker.style.left = `${e.clientX}px`;
        this.cursorMarker.style.top = `${e.clientY}px`;
      }
    });

    // Voice indicator click
    this.voiceIndicator?.addEventListener("click", () => {
      this.toggleListening();
    });

    // Keyboard shortcut (Ctrl+Space or Cmd+Space)
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.code === "Space") {
        e.preventDefault();
        this.toggleListening();
      }
    });

    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === "WAND_COMMAND") {
        this.handleCommand(message.command);
      } else if (message.type === "WAND_RESPONSE") {
        this.handleResponse(message.response);
      } else if (message.type === "WAND_ERROR") {
        this.showError(message.error);
      }
    });
  }

  private toggleListening() {
    this.state.isListening = !this.state.isListening;

    if (this.state.isListening) {
      this.startListening();
    } else {
      this.stopListening();
    }
  }

  private startListening() {
    console.log("🎤 Wand: Started listening");

    // Show voice indicator
    if (this.voiceIndicator) {
      this.voiceIndicator.style.display = "block";
      this.voiceIndicator.classList.add("listening");
    }

    // Show cursor marker
    if (this.cursorMarker && this.state.cursorPosition) {
      this.cursorMarker.style.display = "block";
      this.cursorMarker.style.left = `${this.state.cursorPosition.x}px`;
      this.cursorMarker.style.top = `${this.state.cursorPosition.y}px`;
    }

    // Show feedback
    this.showFeedback("Listening... Speak your command", "info");

    // Start voice recognition
    this.startVoiceRecognition();
  }

  private stopListening() {
    console.log("🎤 Wand: Stopped listening");

    // Hide indicators
    if (this.voiceIndicator) {
      this.voiceIndicator.classList.remove("listening");
    }

    if (this.cursorMarker) {
      this.cursorMarker.style.display = "none";
    }

    // Stop voice recognition
    this.stopVoiceRecognition();
  }

  private startVoiceRecognition() {
    // Use Web Speech API
    if (!("webkitSpeechRecognition" in window)) {
      this.showError("Voice recognition not supported in this browser");
      return;
    }

    const recognition = new (window as any).webkitSpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      const isFinal = event.results[0].isFinal;

      if (isFinal) {
        this.handleCommand(transcript);
      } else {
        this.showFeedback(`Hearing: "${transcript}"`, "info");
      }
    };

    recognition.onerror = (event: any) => {
      console.error("Voice recognition error:", event.error);
      this.showError(`Voice error: ${event.error}`);
      this.stopListening();
    };

    recognition.onend = () => {
      if (this.state.isListening) {
        // Restart if still in listening mode
        recognition.start();
      }
    };

    recognition.start();
    (this as any).recognition = recognition;
  }

  private stopVoiceRecognition() {
    if ((this as any).recognition) {
      (this as any).recognition.stop();
      (this as any).recognition = null;
    }
  }

  private async handleCommand(command: string) {
    console.log("🪄 Wand command:", command);

    this.state.lastCommand = command;
    this.state.isProcessing = true;

    this.showFeedback(`Processing: "${command}"`, "processing");

    // Check if in audit mode
    const auditWand = (window as any).__AUDIT_WAND__;
    const isAuditMode = auditWand?.isAuditMode;

    // Get page context
    const pageContext = {
      url: window.location.href,
      title: document.title,
      dom: this.getSimplifiedDOM(),
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    };

    // Get element under cursor
    let elementUnderCursor = null;
    let targetElement = null;
    if (this.state.cursorPosition) {
      targetElement = document.elementFromPoint(
        this.state.cursorPosition.x,
        this.state.cursorPosition.y,
      );
      if (targetElement) {
        elementUnderCursor = this.getElementDescription(targetElement);
      }
    }

    // Route to audit-specific handler if in audit mode
    if (isAuditMode && this.isAuditCommand(command)) {
      this.handleAuditModeCommand(command, targetElement);
      return;
    }

    // Send to background script for regular Wand processing
    safeSendMessage({
      type: "WAND_PROCESS_COMMAND",
      data: {
        voiceCommand: command,
        cursorPosition: this.state.cursorPosition
          ? {
              ...this.state.cursorPosition,
              elementUnderCursor,
            }
          : undefined,
        pageContext,
      },
    });
  }

  private isAuditCommand(command: string): boolean {
    const auditKeywords = [
      "inspect",
      "analyze",
      "check",
      "fix",
      "improve",
      "suggest",
      "explain",
      "compare",
      "contrast",
      "accessibility",
      "performance",
      "semantic",
      "typography",
      "color",
      "layout",
      "navigation",
      "user flow",
      "touch target",
      "keyboard",
      "screen reader",
    ];

    const lowerCommand = command.toLowerCase();
    return auditKeywords.some((keyword) => lowerCommand.includes(keyword));
  }

  private handleAuditModeCommand(command: string, element: Element | null) {
    const auditWand = (window as any).__AUDIT_WAND__;
    if (!auditWand) return;

    // Determine command type
    let commandType:
      | "inspect"
      | "analyze"
      | "fix"
      | "explain"
      | "compare"
      | "suggest" = "analyze";

    if (command.includes("inspect") || command.includes("check")) {
      commandType = "inspect";
    } else if (command.includes("fix") || command.includes("improve")) {
      commandType = "fix";
    } else if (command.includes("explain") || command.includes("why")) {
      commandType = "explain";
    } else if (command.includes("compare")) {
      commandType = "compare";
    } else if (command.includes("suggest")) {
      commandType = "suggest";
    }

    // Get element info
    let target = undefined;
    if (element) {
      const rect = element.getBoundingClientRect();
      target = {
        element,
        selector: this.getElementSelector(element),
        position: {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        },
      };
    }

    // Send to audit Wand integration
    safeSendMessage({
      type: "WAND_AUDIT_COMMAND",
      command: {
        type: commandType,
        target,
        context: command,
        agentType: auditWand.currentAgent,
      },
    });

    this.showFeedback(
      `Analyzing with ${auditWand.currentAgent?.toUpperCase()} Agent...`,
      "processing",
    );
  }

  private getElementSelector(element: Element): string {
    if (element.id) {
      return `#${element.id}`;
    }

    const path: string[] = [];
    let current: Element | null = element;

    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();

      if (current.className) {
        selector += `.${current.className.toString().split(" ").join(".")}`;
      }

      path.unshift(selector);
      current = current.parentElement;
    }

    return path.join(" > ");
  }

  private handleResponse(response: any) {
    console.log("✅ Wand response:", response);

    this.state.isProcessing = false;
    this.state.confidence = response.confidence;

    // Show understanding
    this.showFeedback(response.understanding, "success");

    // Speak response
    this.speak(response.speech);

    // Execute actions
    if (!response.needsConfirmation) {
      this.executeActions(response.actions);
    } else {
      this.requestConfirmation(response);
    }

    // Stop listening after command
    setTimeout(() => {
      this.stopListening();
    }, 2000);
  }

  private async executeActions(actions: any[]) {
    for (const action of actions) {
      console.log("🎯 Executing action:", action.type);

      switch (action.type) {
        case "click":
          await this.executeClick(action);
          break;
        case "scroll":
          await this.executeScroll(action);
          break;
        case "navigate":
          await this.executeNavigate(action);
          break;
        case "type":
          await this.executeType(action);
          break;
        case "wait":
          await this.executeWait(action);
          break;
      }

      // Small delay between actions
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  private async executeClick(action: any) {
    if (action.target?.x && action.target?.y) {
      // Click at coordinates
      const element = document.elementFromPoint(
        action.target.x,
        action.target.y,
      );
      if (element instanceof HTMLElement) {
        element.click();
        this.showClickAnimation(action.target.x, action.target.y);
      }
    } else if (action.target?.selector) {
      // Click by selector
      const element = document.querySelector(action.target.selector);
      if (element instanceof HTMLElement) {
        element.click();
        const rect = element.getBoundingClientRect();
        this.showClickAnimation(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
      }
    }
  }

  private async executeScroll(action: any) {
    const amount = action.value || 300;

    if (action.target?.x && action.target?.y) {
      // Scroll at cursor position
      const element = document.elementFromPoint(
        action.target.x,
        action.target.y,
      );
      if (element) {
        element.scrollBy({ top: amount, behavior: "smooth" });
      }
    } else {
      // Scroll page
      window.scrollBy({ top: amount, behavior: "smooth" });
    }
  }

  private async executeNavigate(action: any) {
    if (action.target?.url) {
      window.location.href = action.target.url;
    }
  }

  private async executeType(action: any) {
    if (action.target?.selector && action.value) {
      const element = document.querySelector(action.target.selector);
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement
      ) {
        element.value = action.value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  }

  private async executeWait(action: any) {
    const duration = action.value || 1000;
    await new Promise((resolve) => setTimeout(resolve, duration));
  }

  private requestConfirmation(response: any) {
    const confirmed = confirm(
      `${response.understanding}\n\nActions:\n${response.actions.map((a: any) => `- ${a.description}`).join("\n")}\n\nProceed?`,
    );

    if (confirmed) {
      this.executeActions(response.actions);
    } else {
      this.showFeedback("Action cancelled", "info");
    }
  }

  private showFeedback(
    message: string,
    type: "info" | "success" | "error" | "processing",
  ) {
    if (!this.feedbackBox) return;

    const colors = {
      info: "#3b82f6",
      success: "#10b981",
      error: "#ef4444",
      processing: "#8b5cf6",
    };

    this.feedbackBox.style.display = "block";
    this.feedbackBox.style.borderLeft = `4px solid ${colors[type]}`;
    this.feedbackBox.textContent = message;

    // Auto-hide after 3 seconds
    setTimeout(() => {
      if (this.feedbackBox) {
        this.feedbackBox.style.display = "none";
      }
    }, 3000);
  }

  private showError(error: string) {
    this.showFeedback(`Error: ${error}`, "error");
    this.speak(`Sorry, there was an error: ${error}`);
  }

  private speak(text: string) {
    if ("speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.1;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    }
  }

  private showClickAnimation(x: number, y: number) {
    const ripple = document.createElement("div");
    ripple.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: 20px;
      height: 20px;
      border: 2px solid #3b82f6;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: 2147483647;
      animation: wand-ripple 0.6s ease-out;
    `;

    const style = document.createElement("style");
    style.textContent = `
      @keyframes wand-ripple {
        0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        100% { transform: translate(-50%, -50%) scale(3); opacity: 0; }
      }
    `;
    document.head.appendChild(style);

    document.body.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  }

  private getSimplifiedDOM(): string {
    // Get simplified DOM structure for context
    const elements: string[] = [];

    // Get interactive elements
    document
      .querySelectorAll("button, a, input, video, [role='button']")
      .forEach((el) => {
        const tag = el.tagName.toLowerCase();
        const text = el.textContent?.trim().substring(0, 50) || "";
        const id = el.id ? `#${el.id}` : "";
        const classes = el.className
          ? `.${el.className.split(" ").join(".")}`
          : "";

        elements.push(`<${tag}${id}${classes}>${text}</${tag}>`);
      });

    return elements.slice(0, 50).join("\n");
  }

  private getElementDescription(element: Element): string {
    const tag = element.tagName.toLowerCase();
    const text = element.textContent?.trim().substring(0, 100) || "";
    const id = element.id ? `#${element.id}` : "";
    const classes = element.className
      ? `.${element.className.toString().split(" ").join(".")}`
      : "";

    return `${tag}${id}${classes}: "${text}"`;
  }

  public show() {
    if (this.voiceIndicator) {
      this.voiceIndicator.style.display = "block";
    }
  }

  public hide() {
    if (this.overlayElement) {
      this.overlayElement.style.display = "none";
    }
  }

  /** Toggle listening on/off. Returns the new active state. */
  public toggle(): boolean {
    this.toggleListening();
    return this.state.isListening;
  }

  public isActive(): boolean {
    return this.state.isListening;
  }
}

// Initialize Wand overlay
const wandOverlay = new WandOverlay();
wandOverlay.show();

// Register globally so content-script message handler can reach it
(window as any).__WAND_OVERLAY__ = wandOverlay;

export default wandOverlay;
