/**
 * AudiBit Metering System
 * 
 * Calculates the cost of audits based on Compute Units (CU).
 * Prices are denominated in USDC.
 */

export interface AuditSpecs {
  screenshots: number;
  domNodes: number;
  securityRules: number;
  isDeepScan: boolean;
}

export interface AuditCost {
  totalUsdc: string;
  computeUnits: number;
  breakdown: {
    base: string;
    analysis: string;
    security: string;
    premium: string;
  };
}

// Prices in USDC
const BASE_FEE = 0.001;
const PRICE_PER_SCREENSHOT = 0.002;
const PRICE_PER_100_NODES = 0.0005;
const PRICE_PER_SECURITY_RULE = 0.0005;
const DEEP_SCAN_MULTIPLIER = 1.5;

/**
 * Calculates the cost of an audit based on usage specs
 */
export function calculateAuditCost(specs: AuditSpecs): AuditCost {
  const baseCost = BASE_FEE;
  const analysisCost = (specs.screenshots * PRICE_PER_SCREENSHOT) + 
                       (Math.ceil(specs.domNodes / 100) * PRICE_PER_100_NODES);
  const securityCost = specs.securityRules * PRICE_PER_SECURITY_RULE;
  
  let total = baseCost + analysisCost + securityCost;
  let premiumCost = 0;

  if (specs.isDeepScan) {
    const originalTotal = total;
    total *= DEEP_SCAN_MULTIPLIER;
    premiumCost = total - originalTotal;
  }

  // Calculate arbitrary "Compute Units" for display (1 CU = $0.001)
  const computeUnits = Math.round(total * 1000);

  return {
    totalUsdc: total.toFixed(6),
    computeUnits,
    breakdown: {
      base: baseCost.toFixed(6),
      analysis: analysisCost.toFixed(6),
      security: securityCost.toFixed(6),
      premium: premiumCost.toFixed(6),
    }
  };
}
