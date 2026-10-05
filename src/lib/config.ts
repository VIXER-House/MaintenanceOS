import { z } from "zod";

/**
 * Typed, validated runtime configuration. Every external integration is optional:
 * with an empty environment the app runs fully on mock providers.
 */
const bool = z
  .string()
  .optional()
  .transform((v) => (v ? ["1", "true", "yes", "on"].includes(v.toLowerCase()) : undefined));

const ConfigSchema = z.object({
  DATABASE_URL: z.string().default("postgresql://postgres:postgres@localhost:5432/maintenanceos"),
  AUTH_SECRET: z.string().default("insecure-dev-secret-change-me-0123456789abcdef"),
  APP_URL: z.string().default("http://localhost:3000"),

  AI_PROVIDER: z.enum(["mock", "ollama", "groq", "openrouter", "openai", "gemini"]).catch("mock").default("mock"),
  AI_API_KEY: z.string().optional(),
  /** One Google AI Studio key for AI + vision + voice when those providers are "gemini" */
  GEMINI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  AI_BASE_URL: z.string().optional(),
  AI_TIMEOUT_MS: z.coerce.number().default(20000),
  /** Use the LLM to phrase WhatsApp replies (facts are still injected). Off = deterministic templates. */
  AI_GENERATE_REPLIES: bool,
  OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),

  WHATSAPP_PROVIDER: z.enum(["mock", "meta", "twilio", "bridge"]).catch("mock").default("mock"),
  /** Shared secret between the app and the PC WhatsApp bridge (whatsapp-bridge/) */
  WHATSAPP_BRIDGE_SECRET: z.string().optional(),
  /** Public URL of the cloud bridge (e.g. https://mos-bridge.onrender.com) — lets the app wake it so updates go out instantly */
  WHATSAPP_BRIDGE_URL: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  /** Twilio WhatsApp Sandbox (no Meta setup): Console → Messaging → Try it out → Send a WhatsApp message */
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().default("+14155238886"),
  TWILIO_VALIDATE_SIGNATURE: bool,
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().default("maintenanceos-verify"),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_API_VERSION: z.string().default("v21.0"),

  SPEECH_PROVIDER: z.enum(["mock", "whisper", "gemini"]).catch("mock").default("mock"),
  SPEECH_BASE_URL: z.string().optional(),
  SPEECH_API_KEY: z.string().optional(),
  SPEECH_MODEL: z.string().default("whisper-large-v3-turbo"),

  VISION_PROVIDER: z.enum(["mock", "ollama", "gemini", "openai"]).catch("mock").default("mock"),
  VISION_API_KEY: z.string().optional(),
  VISION_MODEL: z.string().optional(),
  VISION_BASE_URL: z.string().optional(),

  NOTIFICATION_CHANNELS: z.string().default("in_app"),
  UPLOAD_DIR: z.string().default("./uploads"),
  NODE_ENV: z.string().default("development"),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
  cached = ConfigSchema.parse(env);
  return cached;
}

/** For tests */
export function resetConfig() {
  cached = null;
}
