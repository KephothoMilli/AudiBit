import { getConnectedWallet } from "./arc-network";

const BASE_URL = import.meta.env.VITE_FUNCTIONS_BASE_URL;

export async function fetchWithWallet(
  endpoint: string,
  options: RequestInit = {},
) {
  const walletAddress = await getConnectedWallet();
  if (!walletAddress) {
    throw new Error("Wallet not connected");
  }

  const headers = new Headers(options.headers || {});
  headers.set("X-Wallet-Address", walletAddress);
  headers.set("Content-Type", "application/json");

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: "API Request failed" }));
    throw new Error(error.message || "API Request failed");
  }

  return response.json();
}

export const api = {
  getCredits: (walletAddress: string) =>
    fetch(`${BASE_URL}/getCreditsBalance`, {
      headers: {
        "X-Wallet-Address": walletAddress,
      },
    }).then((r) => r.json()),

  getCreditPackages: () =>
    fetch(`${BASE_URL}/getCreditPackages`).then((r) => r.json()),

  purchaseCredits: (data: {
    packageType: string;
    walletAddress: string;
    transactionHash: string;
  }) =>
    fetchWithWallet("/purchaseCredits", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  auditUIUX: (data: { url: string; dom: string; walletAddress: string }) =>
    fetch(`${BASE_URL}/auditUIUX`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wallet-Address": data.walletAddress,
      },
      body: JSON.stringify({ url: data.url, dom: data.dom }),
    }).then((r) => r.json()),

  auditSecurity: (data: {
    url: string;
    headers: Record<string, string>;
    libraries: string[];
    cookies: any[];
    walletAddress: string;
  }) =>
    fetch(`${BASE_URL}/auditSecurity`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wallet-Address": data.walletAddress,
      },
      body: JSON.stringify({
        url: data.url,
        headers: data.headers,
        libraries: data.libraries,
        cookies: data.cookies,
      }),
    }).then((r) => r.json()),
};
