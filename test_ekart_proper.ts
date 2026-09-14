// Test Ekart service with proper environment setup
import { ekartService } from "./supabase/functions/_shared/ekart.ts";

async function testEkart() {
  try {
    console.log("Testing Ekart Service...");
    console.log("Client ID:", ekartService.clientId ? "Set" : "Not set");
    console.log("Username:", ekartService.username ? "Set" : "Not set");
    console.log("Password:", ekartService.password ? "Set" : "Not set");

    // Try to get access token
    const token = await ekartService.getAccessToken();
    console.log("✅ Authentication successful!");
    console.log(`Token received (first 30 chars): ${token.substring(0, 30)}...`);

    // Test a simple API call - we'll just test auth for now
    return true;
  } catch (error) {
    console.error("❌ Ekart test failed:", error.message);
    if (error.cause) {
      console.error("Cause:", error.cause);
    }
    return false;
  }
}

testEkart().then(success => {
  if (success) {
    console.log("\n🎉 Ekart integration is working correctly!");
  } else {
    console.log("\n💥 Ekart integration failed.");
  }
});