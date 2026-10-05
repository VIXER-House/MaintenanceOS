import { getConfig } from "@/lib/config";
import { fetchJson } from "../http";
import { GEMINI_DEFAULT_MODEL, geminiGenerate, geminiText } from "../gemini";

export interface AudioInput {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  /**
   * Simulator-only: what the voice note "says". Lets testers simulate a voice
   * note without real speech recognition. Real providers ignore it.
   */
  simulatedTranscript?: string | null;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  provider: string;
  confidence?: number;
}

export interface SpeechToTextProvider {
  readonly name: string;
  transcribe(file: AudioInput): Promise<TranscriptionResult>;
}

/** Realistic Egyptian-Arabic voice-note transcripts used when nothing else is known */
const SAMPLE_TRANSCRIPTS = [
  "السلام عليكم، التكييف في أوضة النوم مش بيبرد خالص من امبارح",
  "لو سمحت فيه مية بتنزل من سقف الحمام وبتغرق الأرض",
  "الكهربا قاطعة في الشقة كلها من ساعة",
  "السخان مش شغال ومفيش مية سخنة",
  "الأسانسير واقف في الدور التالت",
];

const FILENAME_HINTS: { keywords: string[]; text: string }[] = [
  { keywords: ["ac", "hvac", "cool", "takyeef"], text: SAMPLE_TRANSCRIPTS[0] },
  { keywords: ["leak", "water", "pipe", "flood"], text: SAMPLE_TRANSCRIPTS[1] },
  { keywords: ["power", "electric", "light"], text: SAMPLE_TRANSCRIPTS[2] },
  { keywords: ["heater", "boiler"], text: SAMPLE_TRANSCRIPTS[3] },
  { keywords: ["elevator", "lift"], text: SAMPLE_TRANSCRIPTS[4] },
];

export class MockSpeechProvider implements SpeechToTextProvider {
  readonly name = "mock";
  async transcribe(file: AudioInput): Promise<TranscriptionResult> {
    if (file.simulatedTranscript?.trim()) {
      return { text: file.simulatedTranscript.trim(), language: "ar", provider: this.name, confidence: 0.95 };
    }
    const lower = file.fileName.toLowerCase();
    const hint = FILENAME_HINTS.find((h) => h.keywords.some((k) => lower.includes(k)));
    if (hint) return { text: hint.text, language: "ar", provider: this.name, confidence: 0.8 };
    const idx = file.buffer.length % SAMPLE_TRANSCRIPTS.length;
    return { text: SAMPLE_TRANSCRIPTS[idx], language: "ar", provider: this.name, confidence: 0.6 };
  }
}

/** Context that helps speech models spell compound vocabulary correctly. */
export const TRANSCRIBE_PROMPT =
  "WhatsApp voice note from a resident of an Egyptian residential compound reporting a maintenance problem. " +
  "Egyptian Arabic, sometimes mixed with English words (AC, unit A01-101, MAINT-000123). " +
  "Common words: تكييف، سباكة، تسريب، كهربا، أسانسير، سخان، حنفية، بلاعة، محبوس.";

/**
 * Whisper via any OpenAI-compatible /audio/transcriptions endpoint:
 * - Groq free tier: https://api.groq.com/openai/v1 (whisper-large-v3-turbo)
 * - Local & free: faster-whisper-server / speaches (http://localhost:8000/v1)
 */
export class WhisperProvider implements SpeechToTextProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly apiKey?: string,
    readonly name = "whisper",
  ) {}

  async transcribe(file: AudioInput): Promise<TranscriptionResult> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }), file.fileName);
    form.append("model", this.model);
    form.append("prompt", TRANSCRIBE_PROMPT);
    form.append("language", "ar");
    const res = await fetchJson<{ text?: string; language?: string }>(`${this.baseUrl.replace(/\/$/, "")}/audio/transcriptions`, {
      method: "POST",
      body: form,
      timeoutMs: 60000,
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : undefined,
    });
    if (!res.text?.trim()) throw new Error(`${this.name}: empty transcription`);
    return { text: res.text.trim(), language: res.language, provider: `${this.name}:${this.model}` };
  }
}

/** Google Gemini transcribes audio natively (free tier via Google AI Studio). */
export class GeminiSpeechProvider implements SpeechToTextProvider {
  readonly name = "gemini";
  constructor(
    private readonly model: string,
    private readonly apiKey: string,
  ) {}

  async transcribe(file: AudioInput): Promise<TranscriptionResult> {
    const res = await geminiGenerate(
      this.model,
      this.apiKey,
      {
        contents: [
          {
            role: "user",
            parts: [
              { text: `Transcribe this audio exactly as spoken, word for word, without summarizing or skipping anything. ${TRANSCRIBE_PROMPT} Output only the transcript, no commentary.` },
              { inline_data: { mime_type: file.mimeType.split(";")[0] || "audio/ogg", data: file.buffer.toString("base64") } },
            ],
          },
        ],
        generationConfig: { temperature: 0 },
      },
      60000,
    );
    const text = geminiText(res).trim();
    if (!text) throw new Error("gemini: empty transcription");
    return { text, provider: this.name };
  }
}

let instance: SpeechToTextProvider | null = null;
const mock = new MockSpeechProvider();

export function getSpeechProvider(): SpeechToTextProvider {
  if (instance) return instance;
  const c = getConfig();
  const geminiKey = c.SPEECH_API_KEY || c.GEMINI_API_KEY;
  if (c.SPEECH_PROVIDER === "gemini" && geminiKey) {
    instance = new GeminiSpeechProvider(c.SPEECH_MODEL.startsWith("gemini") ? c.SPEECH_MODEL : GEMINI_DEFAULT_MODEL, geminiKey);
  } else if (c.SPEECH_PROVIDER === "whisper" && c.SPEECH_BASE_URL) {
    instance = new WhisperProvider(c.SPEECH_BASE_URL, c.SPEECH_MODEL, c.SPEECH_API_KEY);
  } else {
    instance = mock;
  }
  return instance;
}

/**
 * Second chance for a real voice note: Gemini (free) when the primary is something else.
 * Never the mock — a made-up transcript would file a wrong ticket; the resident is asked to type instead.
 */
export function getFallbackSpeechProvider(): SpeechToTextProvider | null {
  const c = getConfig();
  const primary = getSpeechProvider();
  if (primary.name !== "gemini" && c.GEMINI_API_KEY) return new GeminiSpeechProvider(GEMINI_DEFAULT_MODEL, c.GEMINI_API_KEY);
  return null;
}

/** The simulator's stand-in transcriber (uses the typed "simulated transcript"). */
export function getMockSpeechProvider(): SpeechToTextProvider {
  return mock;
}
