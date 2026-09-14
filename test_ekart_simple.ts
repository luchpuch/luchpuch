// Simple test for Ekart service without Supabase dependency

// Mock the minimal parts we need
class EkartService {
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

    console.log(`Attempting to authenticate with:`);
    console.log(`  Client ID: ${this.clientId}`);
    console.log(`  Username: ${this.username}`);
    console.log(`  Password: ${this.password ? 'SET' : 'NOT SET'}`);
    console.log(`  Token URL: ${tokenUrl}`);

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: this.username,
        password: this.password
      })
    });

    console.log(`Auth response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ekart auth failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log(`Auth response data:`, data);

    this.accessToken = data.access_token;
    // expires_in is in seconds, convert to Unix timestamp
    this.tokenExpiry = (Date.now() / 1000) + data.expires_in;

    console.log(`✅ Successfully authenticated! Token expires in ${data.expires_in} seconds`);
    return this.accessToken;
  }
}

// Test with the credentials from Supabase
async function testEkartAuth() {
  try {
    // Set environment variables (these should match what's in Supabase)
    Deno.env.set("EKART_CLIENT_ID", "4633ce11e59de21ae877ce63d07b9e4f0969ab804c155edb88b296e8b63a7f98");
    Deno.env.set("EKART_USERNAME", "7939c0a03d8b675abcd74b38f9a2f24513bef00183f7cf1bcd1c2d52ff817454");
    Deno.env.set("EKART_PASSWORD", "Abhi@7645878169"); // The correct password provided by user

    const ekartService = new EkartService();
    console.log("🧪 Testing Ekart authentication with corrected password...\n");

    const token = await ekartService.getAccessToken();
    console.log("\n🎉 AUTHENTICATION SUCCESSFUL!");
    console.log(`   Token: ${token.substring(0, 30)}...`);
    console.log("\n✅ The Ekart password has been verified as CORRECT!");
    console.log("✅ The Ekart integration should now work properly.");

    return true;
  } catch (error) {
    console.error("\n💥 AUTHENTICATION FAILED!");
    console.error(`   Error: ${error.message}`);

    if (error.message.includes("auth failed")) {
      console.error("\n🔍 This indicates the credentials are incorrect.");
      console.log("   Please verify:");
      console.log("   1. EKART_USERNAME is correct");
      console.log("   2. EKART_PASSWORD is correct (should be: Abhi@7645878169)");
      console.log("   3. EKART_CLIENT_ID is correct");
    }

    return false;
  }
}

testEkartAuth().then(success => {
  if (success) {
    console.log("\n" + "=".repeat(50));
    console.log("  EKART CREDENTIALS VERIFICATION: PASSED ✅");
    console.log("  The Ekart password has been successfully updated.");
    console.log("=".repeat(50));
  } else {
    console.log("\n" + "=".repeat(50));
    console.log("  EKART CREDENTIALS VERIFICATION: FAILED ❌");
    console.log("  Please check the Ekart credentials in Supabase.");
    console.log("=".repeat(50));
  }
});