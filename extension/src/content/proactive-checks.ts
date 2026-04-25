/**
 * Proactive Detection Heuristics
 * No-cost local checks that run before AI audits
 */

export interface LocalIssue {
  type: "accessibility" | "performance" | "seo" | "console";
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  element?: string;
  count?: number;
}

/**
 * Check for missing alt text on images
 */
function checkMissingAltText(): LocalIssue[] {
  const issues: LocalIssue[] = [];
  const images = document.querySelectorAll("img");
  let missingAltCount = 0;

  images.forEach((img) => {
    if (!img.hasAttribute("alt") || img.getAttribute("alt")?.trim() === "") {
      missingAltCount++;
    }
  });

  if (missingAltCount > 0) {
    issues.push({
      type: "accessibility",
      severity: "high",
      title: "Missing Alt Text",
      description: `${missingAltCount} image(s) missing alt text for screen readers`,
      count: missingAltCount,
    });
  }

  return issues;
}

/**
 * Check for poor color contrast
 */
function checkColorContrast(): LocalIssue[] {
  const issues: LocalIssue[] = [];

  // Simple heuristic: check for light text on light background or dark on dark
  const elements = document.querySelectorAll(
    "p, span, a, button, h1, h2, h3, h4, h5, h6",
  );
  let lowContrastCount = 0;

  elements.forEach((el) => {
    const styles = window.getComputedStyle(el);
    const color = styles.color;
    const bgColor = styles.backgroundColor;

    // Parse RGB values
    const colorMatch = color.match(/\d+/g);
    const bgMatch = bgColor.match(/\d+/g);

    if (colorMatch && bgMatch) {
      const [r1, g1, b1] = colorMatch.map(Number);
      const [r2, g2, b2] = bgMatch.map(Number);

      // Calculate relative luminance (simplified)
      const l1 = 0.299 * r1 + 0.587 * g1 + 0.114 * b1;
      const l2 = 0.299 * r2 + 0.587 * g2 + 0.114 * b2;

      // Check if contrast is too low (threshold: 50)
      if (Math.abs(l1 - l2) < 50) {
        lowContrastCount++;
      }
    }
  });

  if (lowContrastCount > 0) {
    issues.push({
      type: "accessibility",
      severity: "medium",
      title: "Low Color Contrast",
      description: `${lowContrastCount} element(s) may have insufficient color contrast`,
      count: lowContrastCount,
    });
  }

  return issues;
}

/**
 * Check for missing form labels
 */
function checkFormLabels(): LocalIssue[] {
  const issues: LocalIssue[] = [];
  const inputs = document.querySelectorAll(
    'input:not([type="hidden"]), textarea, select',
  );
  let missingLabelCount = 0;

  inputs.forEach((input) => {
    const id = input.getAttribute("id");
    const ariaLabel = input.getAttribute("aria-label");
    const ariaLabelledBy = input.getAttribute("aria-labelledby");

    // Check if input has associated label
    const hasLabel = id && document.querySelector(`label[for="${id}"]`);

    if (!hasLabel && !ariaLabel && !ariaLabelledBy) {
      missingLabelCount++;
    }
  });

  if (missingLabelCount > 0) {
    issues.push({
      type: "accessibility",
      severity: "high",
      title: "Missing Form Labels",
      description: `${missingLabelCount} form field(s) missing accessible labels`,
      count: missingLabelCount,
    });
  }

  return issues;
}

/**
 * Check for console errors
 */
function checkConsoleErrors(): LocalIssue[] {
  const issues: LocalIssue[] = [];

  // This would require intercepting console.error calls
  // For now, we'll check if there are any visible error messages
  const errorElements = document.querySelectorAll(
    '[class*="error"], [class*="Error"]',
  );

  if (errorElements.length > 0) {
    issues.push({
      type: "console",
      severity: "medium",
      title: "Potential Errors Detected",
      description: `${errorElements.length} element(s) with error-related classes found`,
      count: errorElements.length,
    });
  }

  return issues;
}

/**
 * Check for broken links
 */
function checkBrokenLinks(): LocalIssue[] {
  const issues: LocalIssue[] = [];
  const links = document.querySelectorAll("a[href]");
  let emptyLinkCount = 0;

  links.forEach((link) => {
    const href = link.getAttribute("href");
    if (!href || href === "#" || href === "javascript:void(0)" || href === "") {
      emptyLinkCount++;
    }
  });

  if (emptyLinkCount > 0) {
    issues.push({
      type: "accessibility",
      severity: "low",
      title: "Empty or Placeholder Links",
      description: `${emptyLinkCount} link(s) with no destination or placeholder href`,
      count: emptyLinkCount,
    });
  }

  return issues;
}

/**
 * Check for missing page title
 */
function checkPageTitle(): LocalIssue[] {
  const issues: LocalIssue[] = [];
  const title = document.title;

  if (!title || title.trim() === "") {
    issues.push({
      type: "seo",
      severity: "high",
      title: "Missing Page Title",
      description:
        "Page is missing a title tag, important for SEO and accessibility",
    });
  }

  return issues;
}

/**
 * Check for missing meta description
 */
function checkMetaDescription(): LocalIssue[] {
  const issues: LocalIssue[] = [];
  const metaDesc = document.querySelector('meta[name="description"]');

  if (!metaDesc || !metaDesc.getAttribute("content")?.trim()) {
    issues.push({
      type: "seo",
      severity: "medium",
      title: "Missing Meta Description",
      description: "Page is missing a meta description tag, important for SEO",
    });
  }

  return issues;
}

/**
 * Check for heading hierarchy
 */
function checkHeadingHierarchy(): LocalIssue[] {
  const issues: LocalIssue[] = [];
  const headings = Array.from(
    document.querySelectorAll("h1, h2, h3, h4, h5, h6"),
  );

  if (headings.length === 0) {
    return issues;
  }

  // Check for multiple h1 tags
  const h1Count = document.querySelectorAll("h1").length;
  if (h1Count > 1) {
    issues.push({
      type: "accessibility",
      severity: "medium",
      title: "Multiple H1 Tags",
      description: `Page has ${h1Count} H1 tags. Should have only one main heading.`,
      count: h1Count,
    });
  }

  // Check for missing h1
  if (h1Count === 0) {
    issues.push({
      type: "accessibility",
      severity: "high",
      title: "Missing H1 Tag",
      description: "Page is missing a main H1 heading",
    });
  }

  return issues;
}

/**
 * Run all proactive checks
 */
export function runProactiveChecks(): LocalIssue[] {
  const allIssues: LocalIssue[] = [];

  try {
    allIssues.push(...checkMissingAltText());
    allIssues.push(...checkColorContrast());
    allIssues.push(...checkFormLabels());
    allIssues.push(...checkConsoleErrors());
    allIssues.push(...checkBrokenLinks());
    allIssues.push(...checkPageTitle());
    allIssues.push(...checkMetaDescription());
    allIssues.push(...checkHeadingHierarchy());
  } catch (error) {
    console.error("Error running proactive checks:", error);
  }

  return allIssues;
}

/**
 * Get issue count by severity
 */
export function getIssueSummary(issues: LocalIssue[]): {
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
} {
  return {
    critical: issues.filter((i) => i.severity === "critical").length,
    high: issues.filter((i) => i.severity === "high").length,
    medium: issues.filter((i) => i.severity === "medium").length,
    low: issues.filter((i) => i.severity === "low").length,
    total: issues.length,
  };
}
