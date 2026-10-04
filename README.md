# MaintenanceOS

**WhatsApp-first AI maintenance management for compounds.**

Residents of a residential compound report maintenance problems on WhatsApp — in Egyptian Arabic, Arabic or English, as text, voice notes or photos. MaintenanceOS understands the request, classifies it, validates the priority against business rules, stamps an SLA, assigns the right technician, runs the quotation → approval loop, tracks the work to completion, keeps the asset's maintenance history, and keeps the resident updated on WhatsApp.

This is a working MVP, not a static demo. Every screen reads from PostgreSQL, and every action runs through the same service layer. External services (WhatsApp, LLMs, speech, vision, notifications) sit behind interfaces. Each has a local mock, so **the whole product runs offline with zero paid services**.

---

## Contents

1. [Product overview](#1-product-overview)
2. [Architecture](#2-architecture)
3. [Tech stack](#3-tech-stack)
4. [Local setup](#4-local-setup)
5. [Environment variables](#5-environment-variables)
6. [Database setup](#6-database-setup)
7. [Seed data & demo accounts](#7-seed-data--demo-accounts)
8. [Running](#8-running)
9. [Using the WhatsApp simulator](#9-using-the-whatsapp-simulator)
10. [How the AI provider abstraction works](#10-how-the-ai-provider-abstraction-works)
11. [Connecting the real Meta WhatsApp Cloud API](#11-connecting-the-real-meta-whatsapp-cloud-api)
12. [Replacing MockAIProvider with a real LLM](#12-replacing-mockaiprovider-with-a-real-llm)
13. [Deploying](#13-deploying)
14. [Future production architecture](#14-future-production-architecture)
15. [Known MVP limitations](#15-known-mvp-limitations)
16. [Engineering decisions](#16-engineering-decisions)

---

## 1. Product overview

| Resident sends on WhatsApp | What the system does |
|---|---|
| `المياه بتسرب من سقف الحمام` | Plumbing · Water leakage · Bathroom · **High** · respond within 2 h · plumber auto-assigned · `MAINT-000123` |
| `فيه تسريب مياه في المطبخ` | Opens the ticket, then asks *«محتاج أعرف هل التسريب بسيط ولا المياه بتغرق المكان؟»* |
| `المياه كتير` (the answer) | Re-analyses the request, escalates to **Emergency**, resets the SLA to 30 min, and replies *«تم تصنيف البلاغ كحالة طارئة وسيتم إرسال فني سباكة فوراً»* |
| 🎙️ voice note | Speech-to-text, then the same pipeline |
| 📷 photo | Vision analysis is added to the classification as extra evidence (never required) |
| `حالة الطلب` | Replies with the status of the resident's open tickets |
| `تمام` after completion | Records resident confirmation (`لسه` reopens the ticket) |

**Core workflow:** resident message → AI analysis → ticket → priority engine → SLA → assignment engine → technician acknowledges → starts work → quotation → manager approval (with approval limits) → completion → asset history → resident confirmation → close. Every step writes a `TicketEvent` to the audit timeline.

**Human-in-the-loop by design:**
- The AI *suggests* a priority. The rules engine validates it, and a manager can override it (the SLA is recalculated).
- The AI's extraction (category, issue, location, asset, action) is shown in the UI, and managers can edit it. Edits are audited.
- Internal technicians are auto-assigned. **Contractors are only suggested**, because they cost money, so a manager has to confirm them.
- **Only humans approve money.** Quotations need a manager. Maintenance managers can approve up to 10,000 EGP; anything above that needs the compound manager.

**Screens:** Dashboard · Tickets · Ticket detail (AI analysis, SLA clocks, assignment ranking, quotation, timeline, WhatsApp history, attachments, asset history) · WhatsApp simulator · Run Demo · Technicians · Contractors (performance) · Assets (+history) · Residents · Notifications · Settings (SLA, rules, integration status) · Technician "My jobs" · Resident "My requests". The UI is fully bilingual, with **Arabic (RTL) / English (LTR)** switching.

## 2. Architecture

This is a modular monolith (Next.js App Router). The business logic lives in plain TypeScript services and pure engines. React components contain no business rules.

```
src/
  app/                      Next.js routes (pages + /api route handlers)
    (app)/                  authenticated pages
    api/                    REST API (Zod-validated)
  components/               UI primitives (shadcn-style) + domain badges
  features/                 page-level client components (dashboard, tickets, whatsapp, demo…)
  lib/                      db client, auth/session, config, i18n, formatting, Arabic normalization
  server/
    domain/                 constants, category catalog, labels (shared, no I/O)
    engines/                PURE business logic — unit tested
      priority/             rules + AI arbitration
      sla/                  deadlines + live SLA state
      assignment/           technician/contractor scoring
      lifecycle/            ticket state machine + role permissions
      quotation/            totals, VAT, approval limits
    providers/              ADAPTERS to the outside world
      ai/                   AIProvider → Mock | Ollama/Groq/OpenRouter/OpenAI | Gemini
      whatsapp/             WhatsAppProvider → Mock | Meta Cloud API
      speech/               SpeechToTextProvider → Mock | Whisper (OpenAI-compatible)
      vision/               VisionProvider → Mock | Ollama/OpenAI | Gemini
      notifications/        NotificationProvider → Mock (in-app, simulated WhatsApp/SMS/email)
    services/               use cases: intake, ticket lifecycle, messaging, SLA sweep, dashboard, demo…
    http/                   route wrapper + uniform error contract
prisma/                     schema, migrations, seed
tests/unit                  engine/parser/NLU tests
tests/integration           end-to-end workflow against PostgreSQL
```

**Dependency rule:** `services → engines` and `services → provider interfaces`. Services never import a vendor SDK, and no vendor SDK is installed: real providers use `fetch`.

```
WhatsApp (Meta webhook) ─┐
Simulator (/api/whatsapp/simulate) ─┴─► WhatsAppProvider.receiveMessage() → normalized InboundMessage
      │
      ▼
intake.service  ── speech/vision providers (with fallback)
      │  conversation state machine: IDLE → AWAITING_INFO → … → AWAITING_CONFIRMATION
      ▼
ai.service (primary provider → retry → MockAIProvider fallback)
      ▼
ticket.service ── priority engine ── SLA engine ── assignment engine ── lifecycle state machine
      │                                                     │
      ├─► TicketEvent (audit)  ├─► AIAnalysis  ├─► Notification (NotificationProvider)
      └─► messaging.service → WhatsAppProvider.sendMessage() → TicketMessage (persisted)
```

**Resilience:** every external call has a timeout, one retry with backoff, and a fallback (mock AI, mock speech, mock vision). Delivery failures are recorded on the message and never break the workflow. If an LLM returns invalid JSON, it is rejected by a strict Zod parser and the mock provider takes over. Status changes use the current status as an optimistic lock (`409` on conflict). If AI is unavailable, a ticket can still be created manually (`/tickets/new`).

## 3. Tech stack

- **Next.js 15** (App Router, route handlers, middleware) · **React 19** · **TypeScript** (strict)
- **PostgreSQL 16** · **Prisma 6** in driver-adapter mode (`@prisma/adapter-pg` + TypeScript query compiler, so no native query engine at runtime)
- **Zod** for config, API input and LLM output validation
- **TailwindCSS** · shadcn-style components (Radix primitives) · **Lucide** icons · **Recharts**
- Auth: credentials + bcrypt + signed JWT session cookie (`jose`)
- Tests: **Vitest** (unit + DB integration)

## 4. Local setup

Prerequisites: **Node.js ≥ 20.9**, **pnpm** (`npm i -g pnpm` or `corepack enable`), and **PostgreSQL 14+** (Docker is the easiest way).

```bash
# 1. Database
docker compose up -d                 # or use your own PostgreSQL and edit DATABASE_URL

# 2. Configuration
cp .env.example .env                 # defaults work as-is with the docker database

# 3. Install
pnpm install                         # also runs `prisma generate`

# 4. Schema + demo data
pnpm db:setup                        # = prisma migrate deploy && prisma db seed

# 5. Run
pnpm dev                             # http://localhost:3000
```

On Windows, run the same commands in PowerShell (`copy .env.example .env` if `cp` is unavailable).

## 5. Environment variables

The full annotated list is in [`.env.example`](.env.example). **Only `DATABASE_URL` matters** for local runs; everything else defaults to mock providers.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | local postgres | PostgreSQL connection |
| `AUTH_SECRET` | dev value | JWT session signing — **change outside local dev** |
| `AI_PROVIDER` | `mock` | `mock` · `ollama` · `groq` · `openrouter` · `gemini` · `openai` |
| `AI_API_KEY` / `AI_MODEL` / `AI_BASE_URL` | – | Provider credentials/overrides |
| `AI_GENERATE_REPLIES` | `false` | Let the LLM phrase resident replies (facts still verified) |
| `WHATSAPP_PROVIDER` | `mock` | `mock` · `meta` |
| `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_VERIFY_TOKEN` / `WHATSAPP_APP_SECRET` | – | Meta Cloud API |
| `SPEECH_PROVIDER` | `mock` | `mock` · `whisper` (+ `SPEECH_BASE_URL`, `SPEECH_API_KEY`, `SPEECH_MODEL`) |
| `VISION_PROVIDER` | `mock` | `mock` · `ollama` · `gemini` · `openai` |
| `NOTIFICATION_CHANNELS` | `in_app` | Simulated staff channels: `in_app,whatsapp,sms,email` |
| `UPLOAD_DIR` | `./uploads` | Attachment storage |

A misconfigured provider (for example `AI_PROVIDER=groq` with no key) logs a warning and falls back to the mock instead of crashing. `/settings` and `GET /api/health` show the active provider for each integration.

## 6. Database setup

- Schema: [`prisma/schema.prisma`](prisma/schema.prisma). It contains User, Compound, Building, Unit, Resident, Category, SLA (`SlaPolicy`), Team, Technician, Contractor, Ticket, Conversation, TicketMessage, TicketAttachment, TicketEvent, AIAnalysis, Asset, AssetMaintenance, Quotation, QuotationItem and Notification, with relations and indexes on the hot query paths.
- Migrations live in `prisma/migrations`. Commands:
  - `pnpm db:deploy` applies migrations (CI/prod)
  - `pnpm db:migrate` creates a new migration after editing the schema (dev)
  - `pnpm db:reset` drops, re-migrates and re-seeds
  - `pnpm db:studio` opens a DB browser
- Money is `Decimal(12,2)` in EGP. Ticket numbers come from a DB sequence (`MAINT-000123`).

## 7. Seed data & demo accounts

`pnpm db:seed` is idempotent: it wipes and recreates the data. It creates **Palm Hills Demo Compound**: buildings A01–A03, 18 units, 11 residents with Arabic names (one English-speaking), 8 technicians, 7 contractors, 27 assets with preventive maintenance history, and **34 historical tickets**. The tickets span all the main statuses (new, waiting for info, assigned, acknowledged, in progress, waiting approval, completed, closed, cancelled), SLA breaches, quotations (approved and pending) and WhatsApp history. They are generated **through the real engines** (NLU → priority → SLA), so the dashboard is consistent with live behaviour.

Password for every account: **`demo1234`**

| Email | Role |
|---|---|
| `manager@demo.com` | Compound Manager (approval limit 100k EGP) |
| `maintenance@demo.com` | Maintenance Manager (approval limit 10k EGP) |
| `mohamed@demo.com` | Technician — HVAC/Appliances |
| `ahmed@demo.com` | Technician — Plumbing |
| `omar@demo.com` | Technician — Electrical/Security |
| `mahmoud@demo.com`, `tarek@demo.com`, `youssef@demo.com`, `sayed@demo.com`, `khaled.n@demo.com` | Technicians |
| `contractor@demo.com` | Contractor user (Nile HVAC) |
| `resident@demo.com` | Resident (Mona, A01-101) |
| `admin@demo.com` | Admin |

The login page has one-click buttons for the main accounts.

## 8. Running

```bash
pnpm dev          # development
pnpm build && pnpm start   # production mode
pnpm test         # unit + integration (integration needs a seeded DB)
pnpm test:unit    # engines / parser / NLU only — no DB needed
pnpm typecheck
```

### 5-minute walkthrough (Definition of Done)

1. Log in as **manager@demo.com** and you land on the dashboard, populated with data.
2. Open **WhatsApp Simulator** and pick a resident, e.g. *منى عبد العزيز*.
3. Send `التكييف مش شغال`. The AI reply with the ticket number appears, and the right panel shows category, AI-vs-final priority, SLA, asset, confidence and the assigned technician (a real row in PostgreSQL).
4. Open the ticket and log out. Log in as the assigned technician (e.g. **mohamed@demo.com**), then **Acknowledge** → **Start work** → **Create quotation** (`الكمبروسر محتاج تغيير`).
5. Log in as **maintenance@demo.com**, then **Approve** the quotation (the ticket goes APPROVED → IN_PROGRESS).
6. As the technician, **Complete** the work: asset history is updated and the resident is asked to confirm.
7. As the manager, **Close** the ticket. The **Timeline** tab has the full audit trail and the **Asset history** tab has the new record.
8. Back in the simulator, you can see every WhatsApp update the resident received.

Or click **Run Demo**, which runs the same lifecycle through the real backend, live, in about 15 seconds. It covers all 12 demo steps, grouped into 7 actions.

## 9. Using the WhatsApp simulator

`/whatsapp` has three panes:
- **Left:** residents (search; open-ticket badge).
- **Center:** a WhatsApp-style chat. You can type a message (or tap a quick prompt), attach a photo 📷, or send a **voice note** 🎙️. For a voice note you can upload any audio file and type what it "says"; the mock speech provider returns that text as the transcript, and with Whisper configured the real audio is transcribed instead.
- **Right:** live AI and ticket state (category, issue in EN/AR, location, AI-suggested vs rules-validated priority, asset, confidence, recommended action, reasoning, model/latency, SLA countdown, assignee, latest events).

The simulator posts to `POST /api/whatsapp/simulate`, which uses **the same normalized pipeline as the public webhook**: `MockWhatsAppProvider.receiveMessage()` → `intake.service` → AI → ticket engine → PostgreSQL. Outbound replies are "sent" through `MockWhatsAppProvider.sendMessage()` and stored as `TicketMessage` rows, which the chat renders. Nothing is faked in React state.

You can also drive it without the UI:

```bash
curl -X POST http://localhost:3000/api/whatsapp/webhook \
  -H 'Content-Type: application/json' \
  -d '{"from":"+201010001234","type":"text","text":"الحنفية بتسرب"}'
```

(The mock payload format is accepted on the public webhook only outside production / in mock mode.)

## 10. How the AI provider abstraction works

```ts
interface AIProvider {
  classifyMaintenanceRequest(input): Promise<MaintenanceClassification>;
  extractEntities(input): Promise<ExtractedMaintenanceData>;
  generateResponse(input): Promise<string>;
}
```

- **`MockAIProvider`** (default and fallback) is a deterministic NLU for Egyptian Arabic, MSA and English. It handles Arabic normalization (alef/yaa/taa-marbuta, diacritics, Arabic-Indic digits) and proclitic stripping (`و/ف/ب/ل/ال`). Category detection uses weighted vocabularies, plus symptom patterns, location and asset resolution against the unit's assets, severity cues, and targeted follow-up questions. It never confuses `نار` (fire) with `إنارة` (lighting).
- **`LLMProvider`** base class: real providers only implement `complete()`. The output goes through `parseClassificationResponse()`, which extracts JSON from fenced or prose output, maps Arabic/synonym labels to enum keys, normalizes confidence and drops hallucinated asset codes.
- **`ai.service.classifyRequest()`** is the only entry point business logic uses. It calls the primary provider (one retry), falls back to the mock on any error, and records provider/model/latency/fallback on the `AIAnalysis` row.
- **The AI is advisory.** `evaluatePriority()` applies global safety rules (burst pipe, fire, gas, sparks, person trapped → Emergency floor) and configurable per-category rules (stored in the DB). AI escalation is capped at one level above the rule baseline. The AI can never reach Emergency without rule evidence, and can never go below a safety floor.
- **Replies are template-first.** Ticket numbers, SLAs and amounts are injected from data. With `AI_GENERATE_REPLIES=true` the LLM may rephrase, but the result is rejected if the ticket number goes missing.

## 11. Connecting the real Meta WhatsApp Cloud API

Meta offers a **free developer test number** that can message up to 5 verified recipient numbers, which is enough for a pilot. The app does not depend on it.

1. Create an app at <https://developers.facebook.com> → add the **WhatsApp** product → *API Setup*. Copy the **temporary access token** and the **Phone number ID**, and add your phone as a test recipient.
2. Set in `.env`:
   ```env
   WHATSAPP_PROVIDER=meta
   WHATSAPP_TOKEN=EAAG...
   WHATSAPP_PHONE_NUMBER_ID=1234567890
   WHATSAPP_VERIFY_TOKEN=pick-any-string
   WHATSAPP_APP_SECRET=...   # optional, enables signature verification
   ```
3. Expose your local server with a tunnel, e.g. `ngrok http 3000` or `cloudflared tunnel --url http://localhost:3000`.
4. In *WhatsApp → Configuration → Webhook*, set the callback URL to `https://<tunnel>/api/whatsapp/webhook` with the same verify token, and subscribe to **messages**.
5. Register a resident with your real number (E.164, e.g. `+2010…`) — via Prisma Studio or by editing a seeded resident.
6. Message the test number. `MetaWhatsAppProvider.receiveMessage()` normalizes the webhook payload, `downloadMedia()` fetches voice notes and photos, and replies go out through the Graph API.

Business logic is unchanged. Only the adapter differs. Simulator residents keep being answered by the mock provider; each conversation remembers which provider it came from.

**Production notes:** messages outside the 24-hour customer-service window need **approved templates** (`sendTemplate()` is implemented). Use a permanent System User token, and keep `WHATSAPP_APP_SECRET` set.

### Alternative: Twilio WhatsApp Sandbox (no Meta setup)

1. Sign up at <https://www.twilio.com/try-twilio> (free trial, includes test WhatsApp messages).
2. Console → **Messaging → Try it out → Send a WhatsApp message**. From your phone, send the shown `join <code>` to the sandbox number (+1 415 523 8886).
3. In **Sandbox settings**, set *When a message comes in* to `https://<your-app>/api/whatsapp/twilio` (POST).
4. Set `WHATSAPP_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and redeploy.

Sandbox sessions expire 3 days after joining (send `join <code>` again).

## 12. Replacing MockAIProvider with a real LLM

All options below have a free path:

| Option | Config | Notes |
|---|---|---|
| **Ollama (local, free)** | `AI_PROVIDER=ollama` · `ollama pull qwen2.5:7b` | Qwen 2.5 handles Arabic well; any model works (`AI_MODEL=`) |
| **Google Gemini (free tier, recommended)** | `AI_PROVIDER=gemini` `VISION_PROVIDER=gemini` `SPEECH_PROVIDER=gemini` · `GEMINI_API_KEY=…` | one key covers text, photos and voice notes; default `gemini-2.5-flash` |
| **Groq (free tier)** | `AI_PROVIDER=groq` · `AI_API_KEY=gsk_…` | default `openai/gpt-oss-120b` (Llama left Groq's free tier in Aug 2026); Groq also hosts Whisper for `SPEECH_PROVIDER=whisper` |
| **OpenRouter (free models)** | `AI_PROVIDER=openrouter` · `AI_API_KEY=…` | default `meta-llama/llama-3.3-70b-instruct:free` |
| OpenAI | `AI_PROVIDER=openai` | paid |

Free-tier availability and model names change. Override them with `AI_MODEL` / `AI_BASE_URL`.

To add a brand-new vendor, subclass `LLMProvider` (implement `complete(system, user, json)`) or implement `AIProvider` directly, then register it in `src/server/providers/ai/index.ts`. Nothing else changes. Speech (`SpeechToTextProvider`), vision (`VisionProvider`) and notifications (`NotificationProvider`) follow the same pattern.

## 13. Deploying

Any Node host plus managed PostgreSQL works (Railway, Render, Fly.io, a VPS, Azure, or AWS with RDS):

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm db:deploy        # run migrations on release
pnpm start            # PORT env var supported by Next
```

- Set `DATABASE_URL`, a strong `AUTH_SECRET`, and `APP_URL` (https).
- Attachments are written to `UPLOAD_DIR`. On ephemeral/serverless hosts, mount a volume or swap `storage.service.ts` for S3/R2.
- Run `sweepSlaBreaches()` from a scheduler every minute (it currently runs lazily on dashboard/list loads).
- Seeding is for demos only. Don't run `db:seed` against production.

## 14. Future production architecture

- **Async processing:** move AI/speech/vision and outbound WhatsApp to a job queue (BullMQ/Redis or Postgres-based pg-boss). The webhook should ack within 200 ms and process asynchronously, with retries and dead-letter handling.
- **Scheduler:** SLA breach sweeps, escalation chains (notify the supervisor at 75%, the compound manager on breach), preventive-maintenance work orders from asset schedules.
- **Real-time UI:** server-sent events or WebSockets instead of polling.
- **Multi-tenancy:** a `companyId` on every row + row-level security; per-compound SLA/rule configuration UI.
- **WhatsApp at scale:** approved message templates, opt-in tracking, interactive buttons/lists (confirm completion, rate the technician), per-compound phone numbers.
- **AI:** a labeled evaluation set of real Egyptian requests, confidence-based routing (low confidence → human triage queue), RAG over the asset/ticket history, cost/latency tracking per provider.
- **Field app:** PWA for technicians with offline mode, before/after photos, signature capture, parts inventory.
- **Finance:** purchase orders, contractor invoices, budget per building/category, ERP export.
- **Security & ops:** SSO/2FA for staff, granular permissions table, rate limiting on the webhook, structured logging + tracing (OpenTelemetry), backups, object storage with signed URLs.

## 15. Known MVP limitations

- Speech and vision are **simulated** by default. The mock speech provider uses the typed transcript or the file name; the mock vision provider uses the file name/caption. Real recognition requires configuring Whisper / Ollama / Gemini.
- Live updates use polling (2–20 s), not push.
- The SLA breach sweep is lazy (on page/API load), not cron-driven. SLA clocks run on calendar time (no business hours or pauses while waiting for approval).
- Ticket titles/issues generated by the mock NLU are in English, with the Arabic issue shown alongside. Category/priority/status labels are fully localized.
- Notifications are in-app only. WhatsApp/SMS/email to staff is simulated (logged and stored with a channel tag).
- Single compound in the UI. The schema supports more, but there is no tenant switcher.
- Roles are an enum (no custom permission editor). Auth is credentials only (no password reset or 2FA).
- Attachments are stored on local disk.
- The mock NLU covers common maintenance vocabulary well. Unusual phrasing falls back to "Other" plus a clarifying question; a real LLM handles the long tail.

## 16. Engineering decisions

- **Driver-adapter Prisma client** (`engineType = "client"`): no native query-engine binary at runtime, simpler deploys, and the same approach Prisma 7 adopts by default.
- **Response SLA vs resolution SLA:** the headline figures (Emergency 30 min, Critical 1 h, High 2 h, Medium 8 h, Low 48 h) are *response* targets: time to acknowledge or dispatch. Resolution targets are separate (4 h / 8 h / 24 h / 48 h / 120 h). The stricter of the priority policy and the category's default applies. Both are editable in the `SLA` and `Category` tables.
- **Contractors need confirmation; technicians don't.** Assigning an internal technician is an operational decision. Engaging a vendor has cost implications.
- **Templates over free-form LLM replies** for anything containing facts.
- **Roles as an enum**, documented in the schema: fixed by the product for the MVP.
- **Egyptian VAT 14%** on quotations; approval limits are defined in `quotation-engine.ts`.
