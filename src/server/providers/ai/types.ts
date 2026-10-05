import type { CategoryKey, Priority } from "@/server/domain/constants";

export interface ConversationTurn {
  role: "resident" | "assistant";
  text: string;
}

export interface MaintenanceInput {
  /** The resident's request (message text, transcript, or both) */
  text: string;
  language?: "ar" | "en";
  /** Earlier turns for follow-up answers ("المياه كتير") */
  history?: ConversationTurn[];
  /** Findings from the vision provider for attached images */
  imageFindings?: { issue: string; categoryKey?: string | null; confidence: number }[];
  /** Assets known in the resident's unit, to help resolve "the AC in the bedroom" */
  knownAssets?: { assetCode: string; name: string; type: string; location: string }[];
  /** When true the AI must not ask another clarifying question */
  disallowFollowUp?: boolean;
}

export type Severity = "minor" | "moderate" | "severe" | "unknown";

export interface MaintenanceClassification {
  isMaintenanceRequest: boolean;
  category: CategoryKey;
  /** AI-suggested priority — validated by the priority engine, never trusted blindly */
  priority: Priority;
  /** 0..1 */
  confidence: number;
  title: string;
  issue: string;
  issueAr: string | null;
  location: string | null;
  assetType: string | null;
  assetCode: string | null;
  severity: Severity;
  recommendedAction: string;
  reasoning: string;
  needsMoreInfo: boolean;
  followUpQuestion: string | null;
  language: "ar" | "en";
}

export interface ExtractedMaintenanceData {
  location: string | null;
  room: string | null;
  assetType: string | null;
  assetCode: string | null;
  symptoms: string[];
  urgencySignals: string[];
  severity: Severity;
}

export type ResponseKind =
  | "greeting"
  | "ticket_created"
  | "need_info"
  | "info_received"
  | "status"
  | "no_open_tickets"
  | "not_understood"
  | "assigned"
  | "acknowledged"
  | "started"
  | "quotation_pending"
  | "approved"
  | "completed"
  | "closed"
  | "confirmation_thanks"
  | "reopened"
  | "unknown_number"
  | "registration_needed"
  | "registration_unit_not_found"
  | "registration_done"
  | "comment_received"
  | "voice_failed";

export interface ResponseInput {
  kind: ResponseKind;
  language: "ar" | "en";
  data: Record<string, string | number | null | undefined>;
}

export interface AIProvider {
  readonly name: string;
  readonly model?: string;
  classifyMaintenanceRequest(input: MaintenanceInput): Promise<MaintenanceClassification>;
  extractEntities(input: MaintenanceInput): Promise<ExtractedMaintenanceData>;
  generateResponse(input: ResponseInput): Promise<string>;
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}
