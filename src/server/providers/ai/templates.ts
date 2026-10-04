import type { ResponseInput, ResponseKind } from "./types";

/**
 * Deterministic, bilingual (Egyptian Arabic / English) WhatsApp reply templates.
 * Outbound messages containing facts (ticket numbers, SLAs, amounts) are rendered
 * from templates by default so an LLM can never hallucinate them.
 */
type Tpl = (d: ResponseInput["data"]) => string;

const AR: Record<ResponseKind, Tpl> = {
  greeting: (d) =>
    `أهلاً ${d.name ?? ""} 👋\nأنا مساعد الصيانة في ${d.compound ?? "الكمبوند"}. ابعتلي المشكلة بالكلام أو فويس أو صورة وأنا هسجل طلب صيانة فوراً.\nلمعرفة حالة طلب ابعت: حالة الطلب`,
  ticket_created: (d) =>
    `تمام، سجلت طلب صيانة رقم ${d.ticketNumber} ✅\nالمشكلة: ${d.issue}\nالتصنيف: ${d.category}\nالأولوية: ${d.priority}\nوقت الاستجابة المتوقع: خلال ${d.sla}${d.technician ? `\nتم تكليف الفني: ${d.technician}` : ""}`,
  need_info: (d) => `تمام، سجلت طلب صيانة رقم ${d.ticketNumber}. ${d.question}`,
  info_received: (d) =>
    `${d.escalated ? `تم تصنيف البلاغ كحالة ${d.priority === "طارئ" ? "طارئة" : d.priority} ` : `شكراً على التوضيح. الأولوية: ${d.priority}. `}${d.action ? `وسيتم ${d.action} فوراً.` : ""}\nرقم الطلب: ${d.ticketNumber} — وقت الاستجابة: خلال ${d.sla}${d.technician ? `\nالفني: ${d.technician}` : ""}`,
  status: (d) => `طلب رقم ${d.ticketNumber}: ${d.status}${d.technician ? `\nالفني: ${d.technician}` : ""}${d.eta ? `\nالموعد المستهدف: ${d.eta}` : ""}`,
  no_open_tickets: () => `مفيش طلبات صيانة مفتوحة حالياً على رقمك. لو في مشكلة ابعتهالي وهسجلها فوراً.`,
  not_understood: () => `معلش مقدرتش أفهم المشكلة. ممكن توضحلي إيه اللي عطلان وفين بالظبط في الشقة؟`,
  assigned: (d) => `تحديث لطلب ${d.ticketNumber}: تم تكليف ${d.technician} بالطلب.`,
  acknowledged: (d) => `تحديث لطلب ${d.ticketNumber}: الفني ${d.technician} استلم الطلب وفي الطريق إليك.`,
  started: (d) => `تحديث لطلب ${d.ticketNumber}: الفني بدأ الشغل دلوقتي 🔧`,
  quotation_pending: (d) => `تحديث لطلب ${d.ticketNumber}: الإصلاح محتاج قطع غيار، وتم رفع عرض سعر للإدارة للموافقة. هنبلغك أول ما يتم الاعتماد.`,
  approved: (d) => `تحديث لطلب ${d.ticketNumber}: تم اعتماد الإصلاح وجاري التنفيذ.`,
  completed: (d) => `تم الانتهاء من طلب الصيانة رقم ${d.ticketNumber} ✅\n${d.notes ? `ملاحظات الفني: ${d.notes}\n` : ""}ممكن تأكدلنا إن المشكلة اتحلت؟ رد بـ "تمام" أو "لسه".`,
  closed: (d) => `تم إغلاق طلب ${d.ticketNumber}. شكراً لتعاونك 🙏`,
  confirmation_thanks: (d) => `شكراً لتأكيدك! تم تسجيل إن طلب ${d.ticketNumber} اتحل.`,
  reopened: (d) => `آسفين إن المشكلة لسه موجودة. أعدنا فتح طلب ${d.ticketNumber} وهيتواصل معاك الفني.`,
  unknown_number: () => `أهلاً بك! رقمك غير مسجل كساكن في النظام. برجاء التواصل مع إدارة الكمبوند لتسجيل رقمك.`,
  registration_needed: () => `أهلاً بيك 👋 رقمك لسه مش مسجل عندنا.\nابعتلي رقم الوحدة بتاعتك (مثال: A01-101) وهسجلك وأسجل طلبك فوراً.`,
  registration_unit_not_found: (d) => `معلش، مش لاقي وحدة برقم ${d.unit}. اتأكد من الرقم وابعته تاني بالشكل ده: A01-101`,
  registration_done: (d) => `تم تسجيلك على الوحدة ${d.unit} ✅ (هيتم التأكيد من إدارة الكمبوند).`,
  voice_failed: () => `معلش مقدرتش أسمع الرسالة الصوتية كويس. ممكن تكتبلي المشكلة؟`,
};

const EN: Record<ResponseKind, Tpl> = {
  greeting: (d) =>
    `Hi ${d.name ?? ""} 👋\nI'm the maintenance assistant for ${d.compound ?? "the compound"}. Send me the problem as text, a voice note or a photo and I'll log a maintenance request right away.\nTo check a request send: status`,
  ticket_created: (d) =>
    `Done — maintenance request ${d.ticketNumber} is logged ✅\nIssue: ${d.issue}\nCategory: ${d.category}\nPriority: ${d.priority}\nExpected response: within ${d.sla}${d.technician ? `\nAssigned technician: ${d.technician}` : ""}`,
  need_info: (d) => `Logged maintenance request ${d.ticketNumber}. ${d.question}`,
  info_received: (d) =>
    `${d.escalated ? `This has been classified as ${d.priority}. ` : `Thanks for the details. Priority: ${d.priority}. `}${d.action ? `We will ${d.action} right away.` : ""}\nRequest: ${d.ticketNumber} — response within ${d.sla}${d.technician ? `\nTechnician: ${d.technician}` : ""}`,
  status: (d) => `Request ${d.ticketNumber}: ${d.status}${d.technician ? `\nTechnician: ${d.technician}` : ""}${d.eta ? `\nTarget: ${d.eta}` : ""}`,
  no_open_tickets: () => `You have no open maintenance requests. Send me any problem and I'll log it.`,
  not_understood: () => `Sorry, I couldn't understand the problem. Could you describe what's broken and where exactly in the unit?`,
  assigned: (d) => `Update on ${d.ticketNumber}: ${d.technician} has been assigned.`,
  acknowledged: (d) => `Update on ${d.ticketNumber}: ${d.technician} accepted the job and is on the way.`,
  started: (d) => `Update on ${d.ticketNumber}: work has started 🔧`,
  quotation_pending: (d) => `Update on ${d.ticketNumber}: the repair needs parts; a quotation was sent to management for approval. We'll update you once approved.`,
  approved: (d) => `Update on ${d.ticketNumber}: the repair was approved and work is in progress.`,
  completed: (d) => `Maintenance request ${d.ticketNumber} is complete ✅\n${d.notes ? `Technician notes: ${d.notes}\n` : ""}Can you confirm the problem is fixed? Reply "yes" or "no".`,
  closed: (d) => `Request ${d.ticketNumber} is now closed. Thank you 🙏`,
  confirmation_thanks: (d) => `Thanks for confirming! ${d.ticketNumber} is marked as resolved.`,
  reopened: (d) => `Sorry the problem persists. We reopened ${d.ticketNumber} and the technician will follow up.`,
  unknown_number: () => `Welcome! Your number isn't registered as a resident. Please contact compound management to register.`,
  registration_needed: () => `Welcome 👋 Your number isn't registered yet.\nPlease send your unit number (e.g. A01-101) and I'll register you and log your request right away.`,
  registration_unit_not_found: (d) => `Sorry, I couldn't find unit ${d.unit}. Please check and send it like this: A01-101`,
  registration_done: (d) => `You're registered for unit ${d.unit} ✅ (compound management will verify).`,
  voice_failed: () => `Sorry, I couldn't make out the voice note. Could you type the problem?`,
};

export function renderTemplate(input: ResponseInput): string {
  const table = input.language === "en" ? EN : AR;
  return table[input.kind](input.data).replace(/\n{3,}/g, "\n\n").trim();
}
