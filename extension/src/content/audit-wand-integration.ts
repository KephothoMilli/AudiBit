/**
 * Audit-Wand Integration
 *
 * Enhances UI, UX, and DOM agents with voice-guided interaction.
 * Users can point at elements and ask questions during audits.
 */

interface AuditWandCommand {
  type: "inspect" | "analyze" | "fix" | "explain" | "compare" | "suggest";
  target?: {
    element: Element;
    selector: string;
    position: { x: number; y: number };
  };
  context: string; // Voice command
  agentType: "ui" | "ux" | "dom";
}

interface AuditWandResponse {
  analysis: string;
  issues: Array<{
    severity: "critical" | "warning" | "info";
    description: string;
    suggestion: string;
  }>;
  visualAnnotations?: Array<{
    element: string;
    type: "highlight" | "arrow" | "label";
    color: string;
    message: string;
  }>;
  speech: string;
}

class AuditWandIntegration {
  private isAuditMode: boolean = false;
  private currentAgent: "ui" | "ux" | "dom" | null = null;
  private highlightedElements: Map<Element, HTMLDivElement> = new Map();

  constructor() {
    this.setupAuditCommands();
  }

  /**
   * Enable audit mode with voice commands
   */
  public enableAuditMode(agentType: "ui" | "ux" | "dom") {
    this.isAuditMode = true;
    this.currentAgent = agentType;

    console.log(`🎨 ${agentType.toUpperCase()} Audit Mode enabled with Wand`);

    // Show audit mode indicator
    this.showAuditModeIndicator(agentType);

    // Enable enhanced voice commands
    this.enableAuditVoiceCommands();
  }

  /**
   * Disable audit mode
   */
  public disableAuditMode() {
    this.isAuditMode = false;
    this.currentAgent = null;

    // Clear highlights
    this.clearAllHighlights();

    // Hide indicator
    this.hideAuditModeIndicator();
  }

  /**
   * Setup audit-specific voice commands
   */
  private setupAuditCommands() {
    // Listen for Wand commands during audit
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === "WAND_AUDIT_COMMAND" && this.isAuditMode) {
        this.handleAuditCommand(message.command);
      }
    });
  }

  /**
   * Enable audit-specific voice commands
   */
  private enableAuditVoiceCommands() {
    const auditCommands = {
      ui: [
        "inspect this element",
        "check colors here",
        "analyze typography",
        "check contrast",
        "what's wrong with this?",
        "suggest improvements",
        "compare with best practices",
      ],
      ux: [
        "check accessibility",
        "test navigation",
        "analyze user flow",
        "check touch targets",
        "test keyboard navigation",
        "check screen reader",
        "suggest UX improvements",
      ],
      dom: [
        "inspect structure",
        "check performance",
        "analyze hierarchy",
        "check semantics",
        "find unused elements",
        "optimize this",
        "check best practices",
      ],
    };

    console.log(
      `📋 Available commands for ${this.currentAgent}:`,
      auditCommands[this.currentAgent!],
    );
  }

  /**
   * Handle audit-specific voice command
   */
  private async handleAuditCommand(command: AuditWandCommand) {
    console.log(`🎤 Audit command: ${command.context}`);

    try {
      // Get element under cursor if pointing
      let targetElement = null;
      if (command.target) {
        targetElement = command.target.element;
      }

      // Route to appropriate agent
      let response: AuditWandResponse;
      switch (command.type) {
        case "inspect":
          response = await this.inspectElement(targetElement, command.context);
          break;
        case "analyze":
          response = await this.analyzeElement(targetElement, command.context);
          break;
        case "fix":
          response = await this.suggestFix(targetElement, command.context);
          break;
        case "explain":
          response = await this.explainIssue(targetElement, command.context);
          break;
        case "compare":
          response = await this.compareWithBestPractices(
            targetElement,
            command.context,
          );
          break;
        case "suggest":
          response = await this.suggestImprovements(
            targetElement,
            command.context,
          );
          break;
        default:
          response = await this.analyzeElement(targetElement, command.context);
      }

      // Display response
      this.displayAuditResponse(response, targetElement);

      // Apply visual annotations
      if (response.visualAnnotations) {
        this.applyVisualAnnotations(response.visualAnnotations);
      }
    } catch (error) {
      console.error("❌ Audit command error:", error);
      this.showError("Failed to process audit command");
    }
  }

  /**
   * Inspect element with agent
   */
  private async inspectElement(
    element: Element | null,
    context: string,
  ): Promise<AuditWandResponse> {
    if (!element) {
      return {
        analysis: "No element selected. Please point at an element.",
        issues: [],
        speech: "Please point at an element to inspect.",
      };
    }

    // Get element details
    const elementInfo = this.getElementInfo(element);

    // Call appropriate agent
    const response = await this.callAuditAgent({
      command: "inspect",
      element: elementInfo,
      context,
      agentType: this.currentAgent!,
    });

    return response;
  }

  /**
   * Analyze element for issues
   */
  private async analyzeElement(
    element: Element | null,
    context: string,
  ): Promise<AuditWandResponse> {
    if (!element) {
      // Analyze entire page
      return await this.analyzeFullPage(context);
    }

    const elementInfo = this.getElementInfo(element);

    const response = await this.callAuditAgent({
      command: "analyze",
      element: elementInfo,
      context,
      agentType: this.currentAgent!,
    });

    return response;
  }

  /**
   * Suggest fix for element
   */
  private async suggestFix(
    element: Element | null,
    context: string,
  ): Promise<AuditWandResponse> {
    if (!element) {
      return {
        analysis: "No element selected for fix suggestions.",
        issues: [],
        speech: "Please point at an element to get fix suggestions.",
      };
    }

    const elementInfo = this.getElementInfo(element);

    const response = await this.callAuditAgent({
      command: "fix",
      element: elementInfo,
      context,
      agentType: this.currentAgent!,
    });

    return response;
  }

  /**
   * Explain issue with element
   */
  private async explainIssue(
    element: Element | null,
    context: string,
  ): Promise<AuditWandResponse> {
    const elementInfo = element ? this.getElementInfo(element) : null;

    const response = await this.callAuditAgent({
      command: "explain",
      element: elementInfo,
      context,
      agentType: this.currentAgent!,
    });

    return response;
  }

  /**
   * Compare with best practices
   */
  private async compareWithBestPractices(
    element: Element | null,
    context: string,
  ): Promise<AuditWandResponse> {
    const elementInfo = element ? this.getElementInfo(element) : null;

    const response = await this.callAuditAgent({
      command: "compare",
      element: elementInfo,
      context,
      agentType: this.currentAgent!,
    });

    return response;
  }

  /**
   * Suggest improvements
   */
  private async suggestImprovements(
    element: Element | null,
    context: string,
  ): Promise<AuditWandResponse> {
    const elementInfo = element ? this.getElementInfo(element) : null;

    const response = await this.callAuditAgent({
      command: "suggest",
      element: elementInfo,
      context,
      agentType: this.currentAgent!,
    });

    return response;
  }

  /**
   * Analyze full page
   */
  private async analyzeFullPage(context: string): Promise<AuditWandResponse> {
    const response = await this.callAuditAgent({
      command: "analyze",
      element: null,
      context,
      agentType: this.currentAgent!,
    });

    return response;
  }

  /**
   * Call audit agent API
   */
  private async callAuditAgent(params: any): Promise<AuditWandResponse> {
    const base =
      (import.meta as any).env?.VITE_FUNCTIONS_BASE_URL ||
      "http://127.0.0.1:5001/w3bn3xt/us-central1";

    const response = await fetch(
      `${base}/audit${params.agentType.toUpperCase()}Wand`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      },
    );

    if (!response.ok) {
      throw new Error(`Agent API error: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Get element information
   */
  private getElementInfo(element: Element): any {
    const rect = element.getBoundingClientRect();
    const styles = window.getComputedStyle(element);

    return {
      tagName: element.tagName.toLowerCase(),
      id: element.id,
      className: element.className,
      textContent: element.textContent?.trim().substring(0, 200),
      attributes: Array.from(element.attributes).map((attr) => ({
        name: attr.name,
        value: attr.value,
      })),
      position: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
      styles: {
        color: styles.color,
        backgroundColor: styles.backgroundColor,
        fontSize: styles.fontSize,
        fontFamily: styles.fontFamily,
        display: styles.display,
        position: styles.position,
        zIndex: styles.zIndex,
      },
      accessibility: {
        role: element.getAttribute("role"),
        ariaLabel: element.getAttribute("aria-label"),
        ariaDescribedBy: element.getAttribute("aria-describedby"),
        tabIndex: element.getAttribute("tabindex"),
      },
    };
  }

  /**
   * Display audit response
   */
  private displayAuditResponse(
    response: AuditWandResponse,
    element: Element | null,
  ) {
    // Create response panel
    const panel = document.createElement("div");
    panel.id = "audit-wand-response";
    panel.style.cssText = `
      position: fixed;
      top: 80px;
      right: 30px;
      width: 400px;
      max-height: 600px;
      background: rgba(15, 23, 42, 0.98);
      color: white;
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      z-index: 2147483646;
      overflow-y: auto;
      backdrop-filter: blur(20px);
      border: 1px solid rgba(59, 130, 246, 0.3);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    `;

    // Agent type badge
    const agentBadge = document.createElement("div");
    agentBadge.style.cssText = `
      display: inline-block;
      padding: 4px 12px;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      border-radius: 20px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 16px;
    `;
    agentBadge.textContent = `${this.currentAgent} Agent`;

    // Analysis
    const analysis = document.createElement("div");
    analysis.style.cssText = `
      font-size: 14px;
      line-height: 1.6;
      margin-bottom: 20px;
      color: rgba(255, 255, 255, 0.9);
    `;
    analysis.textContent = response.analysis;

    // Issues
    const issuesContainer = document.createElement("div");
    if (response.issues.length > 0) {
      const issuesTitle = document.createElement("div");
      issuesTitle.style.cssText = `
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.6);
        margin-bottom: 12px;
        letter-spacing: 0.5px;
      `;
      issuesTitle.textContent = "Issues Found";
      issuesContainer.appendChild(issuesTitle);

      response.issues.forEach((issue) => {
        const issueCard = document.createElement("div");
        issueCard.style.cssText = `
          background: rgba(255, 255, 255, 0.05);
          border-left: 3px solid ${this.getIssueColor(issue.severity)};
          padding: 12px;
          border-radius: 8px;
          margin-bottom: 10px;
        `;

        const severity = document.createElement("div");
        severity.style.cssText = `
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          color: ${this.getIssueColor(issue.severity)};
          margin-bottom: 6px;
        `;
        severity.textContent = issue.severity;

        const description = document.createElement("div");
        description.style.cssText = `
          font-size: 13px;
          margin-bottom: 8px;
          color: rgba(255, 255, 255, 0.9);
        `;
        description.textContent = issue.description;

        const suggestion = document.createElement("div");
        suggestion.style.cssText = `
          font-size: 12px;
          color: rgba(255, 255, 255, 0.7);
          font-style: italic;
        `;
        suggestion.textContent = `💡 ${issue.suggestion}`;

        issueCard.appendChild(severity);
        issueCard.appendChild(description);
        issueCard.appendChild(suggestion);
        issuesContainer.appendChild(issueCard);
      });
    }

    // Close button
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    closeBtn.style.cssText = `
      position: absolute;
      top: 16px;
      right: 16px;
      background: none;
      border: none;
      color: white;
      font-size: 24px;
      cursor: pointer;
      opacity: 0.6;
      transition: opacity 0.2s;
    `;
    closeBtn.onmouseover = () => (closeBtn.style.opacity = "1");
    closeBtn.onmouseout = () => (closeBtn.style.opacity = "0.6");
    closeBtn.onclick = () => panel.remove();

    panel.appendChild(closeBtn);
    panel.appendChild(agentBadge);
    panel.appendChild(analysis);
    panel.appendChild(issuesContainer);

    // Remove existing panel
    document.getElementById("audit-wand-response")?.remove();

    document.body.appendChild(panel);

    // Speak response
    this.speak(response.speech);

    // Highlight element if provided
    if (element) {
      this.highlightElement(element, "audit");
    }
  }

  /**
   * Apply visual annotations
   */
  private applyVisualAnnotations(annotations: any[]) {
    annotations.forEach((annotation) => {
      const element = document.querySelector(annotation.element);
      if (element) {
        switch (annotation.type) {
          case "highlight":
            this.highlightElement(element as Element, annotation.color);
            break;
          case "arrow":
            this.drawArrow(element as Element, annotation.message);
            break;
          case "label":
            this.addLabel(element as Element, annotation.message);
            break;
        }
      }
    });
  }

  /**
   * Highlight element
   */
  private highlightElement(element: Element, color: string = "audit") {
    const colors = {
      audit: "rgba(59, 130, 246, 0.3)",
      critical: "rgba(239, 68, 68, 0.3)",
      warning: "rgba(245, 158, 11, 0.3)",
      info: "rgba(16, 185, 129, 0.3)",
    };

    const highlight = document.createElement("div");
    const rect = element.getBoundingClientRect();

    highlight.style.cssText = `
      position: fixed;
      left: ${rect.left}px;
      top: ${rect.top}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      background: ${colors[color as keyof typeof colors] || colors.audit};
      border: 2px solid ${color === "audit" ? "#3b82f6" : "#ef4444"};
      pointer-events: none;
      z-index: 2147483645;
      border-radius: 4px;
      animation: audit-highlight-pulse 2s ease-in-out infinite;
    `;

    // Add animation
    if (!document.getElementById("audit-highlight-styles")) {
      const style = document.createElement("style");
      style.id = "audit-highlight-styles";
      style.textContent = `
        @keyframes audit-highlight-pulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(highlight);
    this.highlightedElements.set(element, highlight);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      highlight.remove();
      this.highlightedElements.delete(element);
    }, 5000);
  }

  /**
   * Draw arrow to element
   */
  private drawArrow(element: Element, message: string) {
    // Implementation for drawing arrow annotation
    console.log("Drawing arrow to:", element, message);
  }

  /**
   * Add label to element
   */
  private addLabel(element: Element, message: string) {
    const rect = element.getBoundingClientRect();
    const label = document.createElement("div");

    label.style.cssText = `
      position: fixed;
      left: ${rect.left}px;
      top: ${rect.top - 30}px;
      background: rgba(59, 130, 246, 0.95);
      color: white;
      padding: 4px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      pointer-events: none;
      z-index: 2147483646;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    `;
    label.textContent = message;

    document.body.appendChild(label);

    setTimeout(() => label.remove(), 5000);
  }

  /**
   * Clear all highlights
   */
  private clearAllHighlights() {
    this.highlightedElements.forEach((highlight) => highlight.remove());
    this.highlightedElements.clear();
  }

  /**
   * Show audit mode indicator
   */
  private showAuditModeIndicator(agentType: string) {
    const indicator = document.createElement("div");
    indicator.id = "audit-mode-indicator";
    indicator.style.cssText = `
      position: fixed;
      top: 30px;
      left: 30px;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      color: white;
      padding: 12px 20px;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 700;
      z-index: 2147483647;
      box-shadow: 0 10px 30px rgba(59, 130, 246, 0.4);
      display: flex;
      align-items: center;
      gap: 10px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    `;

    const icon = document.createElement("span");
    icon.textContent =
      agentType === "ui" ? "🎨" : agentType === "ux" ? "🧠" : "🏗️";
    icon.style.fontSize = "20px";

    const text = document.createElement("span");
    text.textContent = `${agentType.toUpperCase()} Audit Mode`;

    const pulse = document.createElement("span");
    pulse.style.cssText = `
      width: 8px;
      height: 8px;
      background: #22c55e;
      border-radius: 50%;
      animation: audit-pulse 1.5s ease-in-out infinite;
    `;

    indicator.appendChild(icon);
    indicator.appendChild(text);
    indicator.appendChild(pulse);

    document.body.appendChild(indicator);
  }

  /**
   * Hide audit mode indicator
   */
  private hideAuditModeIndicator() {
    document.getElementById("audit-mode-indicator")?.remove();
  }

  /**
   * Get issue color
   */
  private getIssueColor(severity: string): string {
    const colors = {
      critical: "#ef4444",
      warning: "#f59e0b",
      info: "#10b981",
    };
    return colors[severity as keyof typeof colors] || colors.info;
  }

  /**
   * Speak text
   */
  private speak(text: string) {
    if ("speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.1;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    }
  }

  /**
   * Show error
   */
  private showError(message: string) {
    console.error("❌ Audit Wand error:", message);
    this.speak(`Error: ${message}`);
  }
}

// Export singleton instance
const auditWandIntegration = new AuditWandIntegration();
export default auditWandIntegration;

// Make available globally for Wand overlay
(window as any).__AUDIT_WAND__ = auditWandIntegration;
