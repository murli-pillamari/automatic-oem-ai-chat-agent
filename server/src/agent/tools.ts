import { db } from "../db/database.js";
import { zohoClient } from "../crm/zohoClient.js";
import type { LifecycleStage, Session } from "../types/index.js";

export type LifecycleTool = { name: string; description: string; parameters: Record<string, unknown> };
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
export const MAHINDRA_MODELS = ["Thar", "XUV700", "Scorpio-N"] as const;
const vehicleSchema = { type: "string", enum: [...MAHINDRA_MODELS] };

// JSON Schema is shared unchanged by Gemini's current SDK and Groq's OpenAI-compatible API.
export const lifecycleTools: LifecycleTool[] = [
  { name: "identify_customer", description: "Find a customer by phone before account-specific help.", parameters: object({ phone: { type: "string" } }, ["phone"]) },
  { name: "capture_lead", description: "When a user asks about a vehicle or wants a test drive, collect ONLY Full Name, Phone, Email, and Preferred City. Do NOT ask for dates, times, or dealership preferences. Once these four details are present, create the lead.", parameters: object({ name: { type: "string", description: "Customer full name" }, phone: { type: "string" }, email: { type: "string" }, preferredCity: { type: "string" }, vehicle: vehicleSchema }, ["name", "phone", "email", "preferredCity"]) },
  { name: "search_vehicles", description: "Search the approved local vehicle catalogue.", parameters: object({ query: { type: "string" }, budget: { type: "number" } }) },
  { name: "schedule_test_drive", description: "Reserved for a dealer-confirmed follow-up. Never use this for a new vehicle or test-drive inquiry; use capture_lead instead.", parameters: object({ vehicle: vehicleSchema, dateTime: { type: "string" }, location: { type: "string" }, confirmed: { type: "boolean" } }, ["vehicle", "dateTime", "confirmed"]) },
  { name: "check_deal_status", description: "Look up an existing pipeline deal using a phone number, customer name, deal name, or deal ID. Searches Deals first, then a phone-matched Contact and finally Leads.", parameters: object({ query: { type: "string", description: "Phone number, customer name, deal name, or deal ID" } }, ["query"]) },
  { name: "get_delivery_status", description: "Find delivery status for the supplied phone number using the pipeline deal lookup.", parameters: object({ phone: { type: "string" } }, ["phone"]) },
  { name: "get_booking_details", description: "Find booking details from a supplied booking ID. Do not request a phone number when a booking ID is available.", parameters: object({ bookingId: { type: "string", description: "Booking ID, for example MAH-9921" } }, ["bookingId"]) },
  { name: "track_booking", description: "Immediately track a supplied booking ID without requesting a phone number.", parameters: object({ bookingId: { type: "string", description: "Booking ID, for example MAH-9921 or #MAH-9921" } }, ["bookingId"]) },
  { name: "create_service_case", description: "Open a service case only after explicit confirmation.", parameters: object({ subject: { type: "string" }, description: { type: "string" }, phone: { type: "string" }, priority: { type: "string", enum: ["Low", "Normal", "High", "Urgent"] }, confirmed: { type: "boolean" } }, ["subject", "description", "confirmed"]) }
];

const catalogue = [
  { model: "Thar", type: "SUV" },
  { model: "XUV700", type: "SUV" },
  { model: "Scorpio-N", type: "SUV" }
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
      const name = String(args.name); const email = String(args.email); const preferredCity = String(args.preferredCity); const vehicle = args.vehicle ? String(args.vehicle) : undefined;
      requireLeadDetails({ name, phone, email, preferredCity });
      if (vehicle) requireMahindraModel(vehicle);
      db.updateSession(session.id, { name, phone, stage: "lead" });
      const lead = await safeZoho("create lead", () => zohoClient.createLead({ name, phone, email, preferredCity, vehicle }));
      return { stage: "lead", result: { saved: true, crmLead: lead, message: lead ? "Lead saved to Zoho CRM." : "Lead saved locally; live Zoho sync is unavailable." } };
    }
    case "search_vehicles": {
      const query = String(args.query ?? "").toLowerCase();
      const matches = catalogue.filter((vehicle) => JSON.stringify(vehicle).toLowerCase().includes(query));
      return { stage: "sales", result: { vehicles: matches.length ? matches : catalogue, message: "Contact a dealer for current variant and pricing details." } };
    }
    case "schedule_test_drive": {
      requireConfirmed(args);
      requireMahindraModel(String(args.vehicle));
      const start = String(args.dateTime); const end = new Date(new Date(start).getTime() + 45 * 60_000).toISOString();
      const event = await safeZoho("create test-drive event", () => zohoClient.createEvent({ subject: `Test drive — ${String(args.vehicle)}`, start, end, description: `Location: ${args.location ?? "to be confirmed"}; session: ${session.id}` }));
      return { stage: "sales", result: { requested: true, appointment: event, vehicle: args.vehicle, start, message: event ? "Test drive reserved in Zoho CRM." : "Test-drive request recorded; a dealer will confirm availability." } };
    }
    case "get_delivery_status": {
      const deal = await safeZoho("find delivery deal", () => zohoClient.getDealStatus(phone));
      return { stage: "ownership", result: deal ? { found: true, deal } : { found: false, message: "No delivery record is available yet. I can arrange a dealer callback." } };
    }
    case "check_deal_status": {
      const query = String(args.query ?? "").trim();
      if (!query) throw new Error("A phone number, customer name, deal name, or deal ID is required to find a deal.");
      const record = await safeZoho("check deal status", () => zohoClient.getDealStatus(query));
      return { stage: "sales", result: record ? { found: true, record } : { found: false, message: "No matching deal or lead record was found." } };
    }
    case "get_booking_details":
    case "track_booking": {
      const bookingId = String(args.bookingId ?? "");
      const booking = await safeZoho("find booking details", () => zohoClient.getBookingDetails({ bookingId }));
      return { stage: "ownership", result: booking ? { found: true, booking } : { found: false, message: "No booking record is available for that booking ID." } };
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

function requireLeadDetails(details: Record<string, string>) {
  for (const [field, value] of Object.entries(details)) {
    if (!value.trim()) throw new Error(`${field} is required to create a lead.`);
  }
}

function requireMahindraModel(vehicle: string) {
  if (!(MAHINDRA_MODELS as readonly string[]).includes(vehicle)) {
    throw new Error(`Vehicle must be one of: ${MAHINDRA_MODELS.join(", ")}.`);
  }
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
