// supabase/functions/_shared/ekart.ts
//
// Ekart Logistics API client wrapper
// Based on Ekart API Documentation v3.8.9

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Initialize Supabase client for any database operations needed
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

export class EkartService {
  private clientId: string;
  private username: string;
  private password: string;
  private apiBase: string;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0; // Unix timestamp in seconds

  constructor() {
    this.clientId = Deno.env.get("EKART_CLIENT_ID") || "";
    this.username = Deno.env.get("EKART_USERNAME") || "";
    this.password = Deno.env.get("EKART_PASSWORD") || "";
    // From docs, the auth endpoint seems consistent
    this.apiBase = "https://api.ekartlogistics.in";
  }

  /**
   * Get valid access token, refreshing if needed
   */
  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid (with 5min buffer)
    if (this.accessToken && Date.now() / 1000 < this.tokenExpiry - 300) {
      return this.accessToken;
    }

    // Fetch new token
    const tokenUrl = `${this.apiBase}/integrations/v2/auth/token/${this.clientId}`;

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: this.username,
        password: this.password
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ekart auth failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    // expires_in is in seconds, convert to Unix timestamp
    this.tokenExpiry = (Date.now() / 1000) + data.expires_in;

    return this.accessToken;
  }

  /**
   * Create a new shipment with Ekart
   */
  async createShipment(shipmentData: any): Promise<any> {
    const token = await this.getAccessToken();

    const response = await fetch(`${this.apiBase}/api/v1/package/create`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(shipmentData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ekart shipment creation failed: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Track a shipment using Ekart tracking ID
   */
  async trackShipment(trackingId: string): Promise<any> {
    const token = await this.getAccessToken();

    const response = await fetch(`${this.apiBase}/api/v1/track/${trackingId}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ekart tracking failed: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Download label PDF(s) for given tracking IDs
   */
  async downloadLabels(trackingIds: string[]): Promise<Blob> {
    const token = await this.getAccessToken();

    const response = await fetch(`${this.apiBase}/api/v1/package/label`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ ids: trackingIds })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ekart label download failed: ${response.status} - ${errorText}`);
    }

    return await response.blob();
  }

  /**
   * Cancel a shipment
   */
  async cancelShipment(trackingId: string): Promise<any> {
    const token = await this.getAccessToken();

    const response = await fetch(`${this.apiBase}/api/v1/package/cancel?tracking_id=${trackingId}`, {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ekart shipment cancellation failed: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Update preferred dispatch date for delayed dispatch shipments
   */
  async updateDispatchDate(trackingIds: string[], dispatchDate: string): Promise<any> {
    const token = await this.getAccessToken();

    const response = await fetch(`${this.apiBase}/data/shipment/dispatch-date`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ids: trackingIds,
        dispatchDate: dispatchDate // YYYY-MM-DD format
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ekart dispatch date update failed: ${response.status} - ${errorText}`);
    }

    return response.json();
  }
}

// Export a singleton instance for convenience
export const ekartService = new EkartService();