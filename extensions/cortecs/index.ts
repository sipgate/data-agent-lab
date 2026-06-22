import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default async function (pi: ExtensionAPI) {
  // We fetch the models dynamically so the user always has access to the latest ones
  // without needing to update the extension manually.
  try {
    const response = await fetch("https://api.cortecs.ai/v1/models");
    if (!response.ok) {
      throw new Error(`Failed to fetch models from Cortecs: ${response.statusText}`);
    }
    const payload = (await response.json()) as {
      data: Array<{
        id: string;
        name?: string;
        context_window?: number;
        max_tokens?: number;
      }>;
    };

    pi.registerProvider("cortecs", {
      name: "Cortecs AI",
      baseUrl: "https://api.cortecs.ai/v1",
      apiKey: "$CORTECS_API_KEY",
      api: "openai-completions",
      models: payload.data.map((model) => ({
        id: model.id,
        name: model.name ?? model.id,
        reasoning: false, // Most models are standard chat, but can be adjusted if needed
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: model.context_window ?? 128000,
        maxTokens: model.max_tokens ?? 4096,
      })),
    });
  } catch (error) {
    // If fetching fails (e.g. offline or no internet), we register the provider 
    // with an empty model list or just log it, so Pi doesn't crash.
    console.error("Cortecs Extension: Failed to load models dynamically:", error);
    
    // Fallback to a basic registration so the provider exists even if offline
    pi.registerProvider("cortecs", {
      name: "Cortecs AI (Offline Mode)",
      baseUrl: "https://api.cortecs.ai/v1",
      apiKey: "$CORTECS_API_KEY",
      api: "openai-completions",
      models: [],
    });
  }
}
