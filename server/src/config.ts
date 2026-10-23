import "dotenv/config";
import path from "node:path";

function requiredWhenEnabled(name: string, enabled: boolean): string | undefined {
  const value = process.env[name]?.trim();
  if (enabled && !value) throw new Error(`${name} is required when ZOHO_ENABLED=true`);
  return value;
}

const zohoEnabled = process.env.ZOHO_ENABLED === "true";
const configuredGeminiModel = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
const uniqueModels = (models: string[]) => [...new Set(models.filter(Boolean))];

export const config = {
  port: Number(process.env.PORT ?? 4000),
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:3000",
  databasePath: path.resolve(process.cwd(), process.env.SQLITE_PATH ?? "./data/oem-agent.db"),
  geminiApiKey: process.env.GEMINI_API_KEY?.trim(),
  // The configured model is always tried first; fallbacks only apply to unavailable-model errors.
  geminiModel: configuredGeminiModel,
  geminiFallbackModels: uniqueModels([configuredGeminiModel, "gemini-2.5-flash", "gemini-3.8-flash"]),
  geminiRequestTimeoutMs: Number(process.env.GEMINI_REQUEST_TIMEOUT_MS ?? 45_000),
  groqApiKey: process.env.GROQ_API_KEY?.trim(),
  groqModel: process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile",
  groqRequestTimeoutMs: Number(process.env.GROQ_REQUEST_TIMEOUT_MS ?? 15_000),
  zoho: {
    enabled: zohoEnabled,
    clientId: requiredWhenEnabled("ZOHO_CLIENT_ID", zohoEnabled),
    clientSecret: requiredWhenEnabled("ZOHO_CLIENT_SECRET", zohoEnabled),
    refreshToken: requiredWhenEnabled("ZOHO_REFRESH_TOKEN", zohoEnabled),
    dc: process.env.ZOHO_DC ?? "com"
  }
};
