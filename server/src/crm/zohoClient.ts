import { config } from "../config.js";

type ZohoListResponse<T> = { data?: T[] };

/** Minimal Zoho CRM v6 client. OAuth tokens are refreshed on demand and kept only in memory. */
export class ZohoClient {
  private accessToken?: string;
  private expiresAt = 0;
  private static readonly REQUEST_TIMEOUT_MS = 8_000;

  private get apiBase() { return `https://www.zohoapis.${config.zoho.dc}/crm/v6`; }
  private get accountsBase() { return `https://accounts.zoho.${config.zoho.dc}/oauth/v2`; }

  /** Enforces the same 8-second ceiling for OAuth refreshes and CRM v6 calls. */
  private async fetchWithTimeout(url: string, init: RequestInit, operation: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ZohoClient.REQUEST_TIMEOUT_MS);
    const label = `[zoho] HTTP ${operation}`;
    console.time(label);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Zoho ${operation} timed out after ${ZohoClient.REQUEST_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      console.timeEnd(label);
    }
  }

  private async token(): Promise<string> {
    if (!config.zoho.enabled) throw new Error("Zoho CRM is not enabled for this environment.");
    if (this.accessToken && Date.now() < this.expiresAt - 60_000) return this.accessToken;

    const body = new URLSearchParams({
      refresh_token: config.zoho.refreshToken!,
      client_id: config.zoho.clientId!,
      client_secret: config.zoho.clientSecret!,
      grant_type: "refresh_token"
    });
    const response = await this.fetchWithTimeout(`${this.accountsBase}/token`, { method: "POST", body }, "OAuth token refresh");
    if (!response.ok) throw new Error(`Zoho token refresh failed (${response.status}): ${await response.text()}`);
    const json = await response.json() as { access_token: string; expires_in?: number };
    this.accessToken = json.access_token;
    this.expiresAt = Date.now() + (json.expires_in ?? 3600) * 1000;
    return this.accessToken;
  }

  private async request<T>(pathname: string, init: RequestInit = {}): Promise<T> {
    const accessToken = await this.token();
    const response = await this.fetchWithTimeout(`${this.apiBase}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "Content-Type": "application/json",
        ...init.headers
      }
    }, `${init.method ?? "GET"} CRM v6`);
    if (!response.ok) throw new Error(`Zoho CRM request failed (${response.status}): ${await response.text()}`);
    return response.json() as Promise<T>;
  }

  async findLeadByPhone(phone: string) {
    const data = await this.request<ZohoListResponse<Record<string, unknown>>>(`/Leads/search?phone=${encodeURIComponent(phone)}`);
    return data.data?.[0] ?? null;
  }

  async findDealByPhone(phone: string) {
    const query = { select_query: `select id, Deal_Name, Stage, Amount, Closing_Date from Deals where Contact_Name.Phone = '${phone.replace(/'/g, "\\'")}' limit 1` };
    const data = await this.request<ZohoListResponse<Record<string, unknown>>>("/coql", { method: "POST", body: JSON.stringify(query) });
    return data.data?.[0] ?? null;
  }

  async createLead(input: { name: string; phone: string; vehicle?: string; email?: string }) {
    const [firstName, ...last] = input.name.trim().split(/\s+/);
    const result = await this.request<{ data: Array<Record<string, unknown>> }>("/Leads", {
      method: "POST",
      body: JSON.stringify({ data: [{
        First_Name: firstName,
        Last_Name: last.join(" ") || firstName,
        Phone: input.phone,
        Email: input.email,
        Description: input.vehicle ? `Vehicle interest: ${input.vehicle}` : undefined,
        Lead_Source: "AI Chat Agent"
      }] })
    });
    return result.data[0];
  }

  async createEvent(input: { subject: string; start: string; end: string; description?: string }) {
    const result = await this.request<{ data: Array<Record<string, unknown>> }>("/Events", {
      method: "POST",
      body: JSON.stringify({ data: [{
        Event_Title: input.subject,
        Start_DateTime: input.start,
        End_DateTime: input.end,
        Description: input.description
      }] })
    });
    return result.data[0];
  }

  async createCase(input: { subject: string; description: string; phone?: string; priority?: string }) {
    const result = await this.request<{ data: Array<Record<string, unknown>> }>("/Cases", {
      method: "POST",
      body: JSON.stringify({ data: [{
        Subject: input.subject,
        Description: input.description,
        Phone: input.phone,
        Priority: input.priority ?? "Normal",
        Status: "New",
        Origin: "AI Chat Agent"
      }] })
    });
    return result.data[0];
  }
}

export const zohoClient = new ZohoClient();
