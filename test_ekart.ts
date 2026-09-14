import { ekartService } from "./supabase/functions/_shared/ekart.ts";

// Test Ekart authentication
async function testEkartAuth() {
  try {
    console.log("Testing Ekart authentication...");
    const token = await ekartService.getAccessToken();
    console.log("Authentication successful!");
    console.log(`Token: ${token.substring(0, 20)}...`); // Show first 20 chars
    return true;
  } catch (error) {
    console.error("Ekart authentication failed:", error.message);
    return false;
  }
}

testEkartAuth();