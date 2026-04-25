/**
 * Nanopayment Cloud Functions
 *
 * Exposes the nanopayment engine over HTTP for the extension popup.
 */

import * as functions from "firebase-functions";
import {
  getPaymentQuote,
  AGENT_PRICES,
  AGENT_WALLETS,
} from "./lib/nanopayment-engine";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Wallet-Address",
};

/**
 * GET /getPaymentQuote?agent=ui
 * Returns price, balance, canProceed, needsBridge for the popup to display
 * before the user clicks an agent card.
 */
export const getAgentQuote = functions
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    res.set(cors);
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    try {
      const walletAddress = req.headers["x-wallet-address"] as string;
      const agentType =
        (req.query.agent as string) || (req.body?.agent as string);

      if (!walletAddress || !agentType) {
        res
          .status(400)
          .json({
            error: "X-Wallet-Address header and agent query param required",
          });
        return;
      }

      if (!AGENT_PRICES[agentType]) {
        res.status(400).json({ error: `Unknown agent type: ${agentType}` });
        return;
      }

      const quote = await getPaymentQuote(walletAddress, agentType);
      res.json(quote);
    } catch (err: any) {
      functions.logger.error("getAgentQuote error:", err);
      res.status(500).json({ error: err.message });
    }
  });

/**
 * GET /getAgentPrices
 * Returns the price list for all agents — used by the popup to render prices.
 */
export const getAgentPrices = functions
  .runWith({ timeoutSeconds: 10, memory: "128MB" })
  .https.onRequest(async (req, res) => {
    res.set(cors);
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    res.json({
      prices: AGENT_PRICES,
      wallets: AGENT_WALLETS,
      currency: "USDC",
      chain: "Arc Testnet",
    });
  });
