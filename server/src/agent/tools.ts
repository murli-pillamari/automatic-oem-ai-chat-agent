import { db } from "../db/database.js";
import { zohoClient } from "../crm/zohoClient.js";
import type { LifecycleStage, Session } from "../types/index.js";

export type LifecycleTool = { name: string; description: string; parameters: Record<string, unknown> };
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

// JSON Schema is shared unchanged by Gemini's current SDK and Groq's OpenAI-compatible API.
export const lifecycleTools: LifecycleTool[] = [
  { name: "identify_customer", description: "Find a customer by phone before account-specific help.", parameters: object({ phone: { type: "string" } }, ["phone"]) },
  { name: "capture_lead", description: "Create a lead only after explicit customer consent.", parameters: object({ name: { type: "string" }, phone: { type: "string" }, email: { type: "string" }, vehicle: { type: "string" }, confirmed: { type: "boolean" } }, ["name", "phone", "confirmed"]) },
  { name: "search_vehicles", description: "Search the approved local vehicle catalogue.", parameters: object({ query: { type: "string" }, budget: { type: "number" } }) },
  { name: "schedule_test_drive", description: "Book a test drive only after explicit confirmation.", parameters: object({ vehicle: { type: "string" }, dateTime: { type: "string" }, location: { type: "string" }, confirmed: { type: "boolean" } }, ["vehicle", "dateTime", "confirmed"]) },
  { name: "get_delivery_status", description: "Find delivery status for the supplied phone.", parameters: object({ phone: { type: "string" } }, ["phone"]) },
  { name: "create_service_case", description: "Open a service case only after explicit confirmation.", parameters: object({ subject: { type: "string" }, description: { type: "string" }, phone: { type: "string" }, priority: { type: "string", enum: ["Low", "Normal", "High", "Urgent"] }, confirmed: { type: "boolean" } }, ["subject", "description", "confirmed"]) }
];

const catalogue = [
  { model: "EV X1", type: "compact electric SUV", powertrain: "Electric", fromInr: 1899000, range: "465 km (ARAI)" },
  { model: "Urban S", type: "premium hatchback", powertrain: "Petrol", fromInr: 899000, range: "N/A" },
  { model: "Trail 7", type: "seven-seat SUV", powertrain: "Hybrid", fromInr: 2499000, range: "N/A" }
];

type ToolArgs = Record<string, unknown>;
export async function executeLifecycleTool(name: string, args: ToolArgs, session: Session): Promise<{ result: unknown; stage: LifecycleStage }> {
  const phone = String(args.phone ?? session.customer_phone ?? "");
  switch (name) {
    case "identify_customer": {
      const local = db.findLocalCustomer(phone);
      const zoho = await safeZoho("find lead by phone", () => zohoClient.findLeadByPhone(phone));
      return { stage: "lead", result: { localCustomer: local ? redactSession(local) : null, zohoLead: zoho, message: local || zoho ? "Customer record found." : "No customer record found." } };
    }
    case "capture_lead": {
      requireConfirmed(args);
      const name = String(args.name); const vehicle = args.vehicle ? String(args.vehicle) : undefined;
      db.updateSession(session.id, { name, phone, stage: "lead" });
      const lead = await safeZoho("create lead", () => zohoClient.createLead({ name, phone, vehicle, email: args.email ? String(args.email) : undefined }));
      return { stage: "lead", result: { saved: true, crmLead: lead, message: lead ? "Lead saved to Zoho CRM." : "Lead saved locally; live Zoho sync is unavailable." } };
    }
    case "search_vehicles": {
      const query = String(args.query ?? "").toLowerCase(); const budget = typeof args.budget === "number" ? args.budget : Infinity;
      const matches = catalogue.filter((vehicle) => JSON.stringify(vehicle).toLowerCase().includes(query) && vehicle.fromInr <= budget);
      return { stage: "sales", result: { vehicles: matches.length ? matches : catalogue.filter((v) => v.fromInr <= budget), currency: "INR" } };
    }
    case "schedule_test_drive": {
      requireConfirmed(args);
      const start = String(args.dateTime); const end = new Date(new Date(start).getTime() + 45 * 60_000).toISOString();
      const event = await safeZoho("create test-drive event", () => zohoClient.createEvent({ subject: `Test drive — ${String(args.vehicle)}`, start, end, description: `Location: ${args.location ?? "to be confirmed"}; session: ${session.id}` }));
      return { stage: "sales", result: { requested: true, appointment: event, vehicle: args.vehicle, start, message: event ? "Test drive reserved in Zoho CRM." : "Test-drive request recorded; a dealer will confirm availability." } };
    }
    case "get_delivery_status": {
      const deal = await safeZoho("find delivery deal", () => zohoClient.findDealByPhone(phone));
      return { stage: "ownership", result: deal ? { found: true, deal } : { found: false, message: "No delivery record is available yet. I can arrange a dealer callback." } };
    }
    case "create_service_case": {
      requireConfirmed(args);
      const caseRecord = await safeZoho("create service case", () => zohoClient.createCase({ subject: String(args.subject), description: String(args.description), phone: phone || undefined, priority: args.priority ? String(args.priority) : undefined }));
      return { stage: "after_sales", result: { opened: true, case: caseRecord, message: caseRecord ? "Service case opened in Zoho CRM." : "Service request recorded; support will contact you." } };
    }
    default: throw new Error(`Unsupported lifecycle tool: ${name}`);
  }
}

function requireConfirmed(args: ToolArgs) {
  if (args.confirmed !== true) throw new Error("Customer confirmation is required before creating or changing a CRM record.");
}

async function safeZoho<T>(operationName: string, operation: () => Promise<T>): Promise<T | null> {
  const label = `[zoho] tool operation (${operationName})`;
  console.time(label);
  try { return await operation(); }
  catch (error) {
    console.warn(`[zoho] ${operationName} did not complete:`, error instanceof Error ? error.message : error);
    return null;
  } finally { console.timeEnd(label); }
}

function redactSession(session: Session) {
  return { customerName: session.customer_name, stage: session.stage, createdAt: session.created_at };
}
