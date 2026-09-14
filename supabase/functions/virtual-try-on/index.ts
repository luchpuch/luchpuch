// supabase/functions/virtual-try-on/index.ts
//
// POST -> generate virtual try-on image. Requires personImage (base64), garmentImage (base64), productId.
// Uses Replicate API with a virtual try-on model.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"

const REPLICATE_API_TOKEN = Deno.env.get("REPLICATE_API_TOKEN")
const REPLICATE_MODEL = "chtseng/vet:d0323e95c9e6fd3a9b91d9e576d851b302cf337f2b0b0c6f7b3e0e5c1b2a3d4e" // Example version, replace with actual

if (!REPLICATE_API_TOKEN) {
  console.warn("REPLICATE_API_TOKEN is not set. Virtual try-on will not work.")
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders })

  if (req.method === "POST") {
    if (!REPLICATE_API_TOKEN) {
      return json({ error: "Virtual try-on service is not configured" }, 503)
    }

    let body
    try {
      body = await req.json()
    } catch (e) {
      return json({ error: "Invalid JSON body" }, 400)
    }

    const { personImage, garmentImage, productId } = body
    if (!personImage || !garmentImage || !productId) {
      return json({ error: "Missing required fields: personImage, garmentImage, productId" }, 400)
    }

    try {
      // Call Replicate API to create a prediction
      const predictionResponse = await fetch("https://api.replicate.com/v1/predictions", {
        method: "POST",
        headers: {
          "Authorization": `Token ${REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          version: REPLICATE_MODEL,
          input: {
            person_image: personImage,
            garment_image: garmentImage,
            // Additional parameters can be added here based on the model's requirements
          }
        })
      })

      if (!predictionResponse.ok) {
        const errorData = await predictionResponse.json()
        return json({ error: `Replicate API error: ${errorData.detail || predictionResponse.statusText}` }, 502)
      }

      const prediction = await predictionResponse.json()

      // Poll for completion
      const result = await pollingPrediction(prediction.id)

      if (result.error) {
        return json({ error: result.error }, 500)
      }

      // Assuming the model returns an image URL in the output
      const imageUrl = result.output
      return json({ imageUrl, requestId: prediction.id })
    } catch (err) {
      console.error("Virtual try-on error:", err)
      return json({ error: "Failed to generate try-on image" }, 500)
    }
  }

  return json({ error: "Method not allowed" }, 405)
})

async function pollingPrediction(predictionId: string): Promise<{ output?: string; error?: string }> {
  const maxAttempts = 30
  const delayMs = 2000

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
        headers: {
          "Authorization": `Token ${REPLICATE_API_TOKEN}`,
        }
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch prediction: ${response.statusText}`)
      }

      const prediction = await response.json()

      if (prediction.status === "succeeded") {
        // Assuming the output is a single image URL
        const output = prediction.output
        if (typeof output === "string") {
          return { output }
        } else if (Array.isArray(output) && output.length > 0) {
          return { output: output[0] }
        } else {
          return { error: "Unexpected output format from model" }
        }
      }

      if (prediction.status === "failed" || prediction.status === "canceled") {
        return { error: `Prediction ${prediction.status}` }
      }

      // Still processing, wait and retry
      await new Promise(resolve => setTimeout(resolve, delayMs))
    } catch (err) {
      console.error("Polling error:", err)
      return { error: "Error while polling for prediction" }
    }
  }

  return { error: "Prediction timed out" }
}