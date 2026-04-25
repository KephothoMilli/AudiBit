export interface HeuristicResult {
  type: 'accessibility' | 'ux' | 'security' | 'performance';
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  selector: string;
}

export class DOMMonitor {
  private observer: MutationObserver | null = null;
  private debounceTimer: number | null = null;
  private onIssueDetected: (issues: HeuristicResult[]) => void;

  constructor(onIssueDetected: (issues: HeuristicResult[]) => void) {
    this.onIssueDetected = onIssueDetected;
  }

  public start() {
    this.observer = new MutationObserver(() => this.handleMutations());
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    // Initial run
    this.runHeuristics();
  }

  public stop() {
    if (this.observer) this.observer.disconnect();
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
  }

  private handleMutations() {
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => {
      this.runHeuristics();
    }, 2000); // 2-second debounce as per spec
  }

  private runHeuristics() {
    const issues: HeuristicResult[] = [];

    // 1. Alt Text Missing
    document.querySelectorAll('img:not([alt])').forEach((img) => {
      issues.push({
        type: 'accessibility',
        severity: 'high',
        title: 'Missing Alternative Text',
        description: 'Images should have descriptive alt text for screen readers.',
        selector: this.getSelector(img),
      });
    });

    // 2. Small Touch Targets
    document.querySelectorAll('button, a').forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44)) {
        issues.push({
          type: 'ux',
          severity: 'medium',
          title: 'Small Touch Target',
          description: 'Element is smaller than 44x44px, which may be difficult for mobile users.',
          selector: this.getSelector(el),
        });
      }
    });

    // 3. Form Label Missing
    document.querySelectorAll('input:not([type="hidden"]):not([aria-label]):not([aria-labelledby])').forEach((input) => {
      const id = input.id;
      const label = id ? document.querySelector(`label[for="${id}"]`) : input.closest('label');
      if (!label) {
        issues.push({
          type: 'accessibility',
          severity: 'high',
          title: 'Missing Form Label',
          description: 'Input elements should have associated labels for accessibility.',
          selector: this.getSelector(input),
        });
      }
    });

    if (issues.length > 0) {
      this.onIssueDetected(issues);
    }
  }

  private getSelector(el: Element): string {
    const path: string[] = [];
    let current: Element | null = el;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let selector = current.nodeName.toLowerCase();
      if (current.id) {
        selector += '#' + current.id;
        path.unshift(selector);
        break;
      } else {
        let sibling = current;
        let nth = 1;
        while (sibling.previousElementSibling) {
          sibling = sibling.previousElementSibling;
          if (sibling.nodeName.toLowerCase() === selector) nth++;
        }
        if (nth !== 1) selector += `:nth-of-type(${nth})`;
      }
      path.unshift(selector);
      current = current.parentElement;
    }
    return path.join(' > ');
  }
}
