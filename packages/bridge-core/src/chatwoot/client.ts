export class ChatwootError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    route: string,
  ) {
    super(`Chatwoot ${status} ${route}: ${body.slice(0, 300)}`);
  }
}

export type MessageStatus = "sent" | "delivered" | "read" | "failed";

type ContactInbox = { source_id: string; inbox: { id: number } };
type Contact = { id: number; identifier: string | null; contact_inboxes?: ContactInbox[] };

// Chỉ bọc những endpoint bridge dùng. Shape response lấy từ source Chatwoot v4.18 (app/views/api/v1/...).
export class ChatwootClient {
  constructor(
    private readonly baseUrl: string,
    private readonly accountId: number,
    private readonly token: string,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const route = `${method} ${path}`;
    const res = await fetch(`${this.baseUrl}/api/v1/accounts/${this.accountId}${path}`, {
      method,
      headers: {
        api_access_token: this.token,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) throw new ChatwootError(res.status, text, route);
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** Tạo API channel inbox. `secret` chỉ trả về khi token thuộc user Administrator. */
  async createApiInbox(name: string, webhookUrl: string): Promise<{ id: number; secret: string | null }> {
    const inbox = await this.request<{ id: number; secret?: string | null }>("POST", "/inboxes", {
      name,
      channel: { type: "api", webhook_url: webhookUrl },
    });
    return { id: inbox.id, secret: inbox.secret ?? null };
  }

  async listInboxIds(): Promise<number[]> {
    const res = await this.request<{ payload: { id: number }[] }>("GET", "/inboxes");
    return res.payload.map((inbox) => inbox.id);
  }

  async createContact(input: { inboxId: number; name: string; identifier: string }) {
    const res = await this.request<{ payload: { contact: Contact; contact_inbox: { source_id: string } } }>(
      "POST",
      "/contacts",
      { inbox_id: input.inboxId, name: input.name, identifier: input.identifier },
    );
    return { contactId: res.payload.contact.id, sourceId: res.payload.contact_inbox.source_id };
  }

  async findContactByIdentifier(identifier: string): Promise<Contact | undefined> {
    const res = await this.request<{ payload: Contact[] }>(
      "GET",
      `/contacts/search?q=${encodeURIComponent(identifier)}&include_contact_inboxes=true`,
    );
    return res.payload.find((c) => c.identifier === identifier);
  }

  async createContactInbox(contactId: number, inboxId: number): Promise<string> {
    const res = await this.request<{ source_id: string }>("POST", `/contacts/${contactId}/contact_inboxes`, {
      inbox_id: inboxId,
    });
    return res.source_id;
  }

  async createConversation(input: { inboxId: number; contactId: number; sourceId: string }): Promise<number> {
    const res = await this.request<{ id: number }>("POST", "/conversations", {
      inbox_id: input.inboxId,
      contact_id: input.contactId,
      source_id: input.sourceId,
    });
    return res.id;
  }

  async createIncomingMessage(conversationId: number, input: { content: string; sourceId: string }): Promise<number> {
    const res = await this.request<{ id: number }>("POST", `/conversations/${conversationId}/messages`, {
      content: input.content,
      message_type: "incoming",
      source_id: input.sourceId,
    });
    return res.id;
  }

  /** Chỉ dùng được với conversation của API inbox. */
  async updateMessageStatus(conversationId: number, messageId: number, status: MessageStatus, externalError?: string) {
    await this.request("PATCH", `/conversations/${conversationId}/messages/${messageId}`, {
      status,
      ...(externalError ? { external_error: externalError } : {}),
    });
  }
}
