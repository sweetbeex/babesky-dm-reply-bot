/**
 * Bluesky chat/DM client for listing conversations and sending messages.
 * Uses chat.bsky.convo APIs via PDS proxy.
 */

const CHAT_PROXY_HEADER = 'did:web:api.bsky.chat';
const DM_MAX_GRAPHEMES = 1000;

function truncateMessage(text: string): string {
  const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
  const segments = [...seg.segment(text)];
  if (segments.length <= DM_MAX_GRAPHEMES) return text;
  return segments.slice(0, DM_MAX_GRAPHEMES).map((s) => s.segment).join('');
}

export interface ConvoParticipant {
  did: string;
  handle?: string;
}

export interface ConvoLastMessage {
  id: string;
  text: string;
  sentAt: string;
  sender: { did: string };
}

export interface Convo {
  id: string;
  members?: ConvoParticipant[];
  lastMessage?: ConvoLastMessage | null;
}

export class BlueskyDmClient {
  private accessJwt: string | null = null;
  private ourDid: string | null = null;
  private handle: string;
  private serviceUrl: string;

  constructor(handle: string, appPassword: string, serviceUrl: string = 'https://bsky.social') {
    this.handle = handle;
    this.serviceUrl = serviceUrl.replace(/\/$/, '');
  }

  async login(appPassword: string): Promise<void> {
    const res = await fetch(`${this.serviceUrl}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: this.handle,
        password: appPassword,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Bluesky login failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as { accessJwt?: string; did?: string };
    this.accessJwt = data.accessJwt || null;
    this.ourDid = data.did || null;
  }

  private getHeaders(): Record<string, string> {
    if (!this.accessJwt) throw new Error('Not logged in');
    return {
      Authorization: `Bearer ${this.accessJwt}`,
      'Content-Type': 'application/json',
      'AT-Protocol-Proxy': CHAT_PROXY_HEADER,
    };
  }

  /**
   * List conversations. Returns convos where lastMessage exists.
   */
  async listConvos(limit = 50, cursor?: string): Promise<{ convos: Convo[]; cursor?: string }> {
    const params = new URLSearchParams();
    params.append('limit', String(limit));
    if (cursor) params.append('cursor', cursor);
    const url = `${this.serviceUrl}/xrpc/chat.bsky.convo.listConvos?${params}`;
    const res = await fetch(url, { method: 'GET', headers: this.getHeaders() });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`listConvos failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as { convos?: Convo[]; cursor?: string };
    return {
      convos: data.convos || [],
      cursor: data.cursor,
    };
  }

  /**
   * Get the other participant's DID from a convo (excluding ourselves).
   */
  getOtherParticipantDid(convo: Convo): string | null {
    const ourDid = this.ourDid;
    if (!ourDid || !convo.members) return null;
    const other = convo.members.find((m) => m.did !== ourDid);
    return other?.did || null;
  }

  /**
   * Check if the last message in the convo was sent by the other user (not us).
   */
  isLastMessageFromOther(convo: Convo): boolean {
    const last = convo.lastMessage;
    if (!last || !this.ourDid) return false;
    return last.sender?.did !== this.ourDid;
  }

  /**
   * Send a DM in an existing conversation.
   */
  async sendMessage(convoId: string, text: string): Promise<boolean> {
    const safeText = truncateMessage(text.trim());
    const url = `${this.serviceUrl}/xrpc/chat.bsky.convo.sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ convoId, message: { text: safeText } }),
    });
    if (!res.ok) {
      console.error('sendMessage failed:', res.status, await res.text());
      return false;
    }
    return true;
  }

  /**
   * Get or create a conversation with a user and send a message.
   * Uses getConvoAvailability and getConvoForMembers like bluesky-client.
   */
  async sendDmToUser(userDid: string, text: string): Promise<boolean> {
    const ourDid = this.ourDid;
    if (!ourDid) {
      console.error('Cannot send DM: not logged in');
      return false;
    }

    const headers = this.getHeaders();
    const safeText = truncateMessage(text.trim());

    // 1. Check if we can chat
    const availParams = new URLSearchParams();
    availParams.append('members', ourDid);
    availParams.append('members', userDid);
    const availUrl = `${this.serviceUrl}/xrpc/chat.bsky.convo.getConvoAvailability?${availParams}`;
    const availRes = await fetch(availUrl, { method: 'GET', headers });
    if (!availRes.ok) {
      console.error('getConvoAvailability failed:', availRes.status, await availRes.text());
      return false;
    }
    const availData = (await availRes.json()) as { canChat?: boolean; convo?: { id?: string } };
    if (!availData.canChat) {
      console.log(`User ${userDid} has DMs restricted, skipping`);
      return false;
    }

    let convoId: string;
    if (availData.convo?.id) {
      convoId = availData.convo.id;
    } else {
      const convoParams = new URLSearchParams();
      convoParams.append('members', ourDid);
      convoParams.append('members', userDid);
      const convoUrl = `${this.serviceUrl}/xrpc/chat.bsky.convo.getConvoForMembers?${convoParams}`;
      const convoRes = await fetch(convoUrl, { method: 'GET', headers });
      if (!convoRes.ok) {
        console.error('getConvoForMembers failed:', convoRes.status, await convoRes.text());
        return false;
      }
      const convoData = (await convoRes.json()) as { convo?: { id?: string } };
      convoId = convoData.convo?.id || '';
      if (!convoId) {
        console.error('No convo ID');
        return false;
      }
    }

    return this.sendMessage(convoId, safeText);
  }
}
