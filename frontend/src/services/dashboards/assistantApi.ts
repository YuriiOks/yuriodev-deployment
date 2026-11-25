import { isObject } from './financeApi';
import { API_BASE } from './liveApi';

/** The pages the assistant may be asked on (Work 2 never: its data is not sent anywhere). */
export type AssistantScope = 'personal' | 'work-1' | 'money';

export interface AssistantSubject {
  readonly type: string;
  readonly id: string | null;
  readonly name: string | null;
}

/** A write the assistant wants to make; nothing is written until the owner approves it. */
export interface AssistantConfirm {
  readonly token: string;
  /** A code (add_task, update_task, complete_task, reopen_task, add_event, set_category, attention_snooze, mark_paid, ...): the page words it. */
  readonly action: string;
  readonly subject: AssistantSubject;
  readonly changes: Readonly<Record<string, unknown>>;
  readonly expiresIn: number;
}

export interface AssistantDone {
  readonly stop: 'end_turn' | 'length' | 'refused' | 'confirm' | 'cap' | 'error';
  readonly remaining: { readonly requests: number | null; readonly tokens: number | null } | null;
}

/** What a stream says, in order: the conversation, text, a tool at work, a write to confirm, a failure, and the end. */
export type AssistantEvent =
  | { readonly type: 'meta'; readonly conversationId: string }
  | { readonly type: 'delta'; readonly text: string }
  | { readonly type: 'tool'; readonly name: string; readonly state: 'running' | 'done' }
  | { readonly type: 'confirm'; readonly confirm: AssistantConfirm }
  | { readonly type: 'error'; readonly code: string }
  | ({ readonly type: 'done' } & AssistantDone);

/** The server refused before any stream (JSON): 403 assistant_scope_refused, 409 assistant_busy, 410 assistant_confirmation_gone, 422, or another failure. */
export class AssistantRefusal extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.name = 'AssistantRefusal';
    this.status = status;
    this.code = code;
  }
}

const STOPS = ['end_turn', 'length', 'refused', 'confirm', 'cap', 'error'] as const;
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/** One event of the stream, from its name and its JSON data; one this page does not know is dropped. */
export function parseAssistantEvent(name: string, data: unknown): AssistantEvent | null {
  if (!isObject(data)) return null;
  switch (name) {
    case 'meta': {
      const id = str(data.conversation_id);
      return id ? { type: 'meta', conversationId: id } : null;
    }
    case 'delta':
      return typeof data.text === 'string' ? { type: 'delta', text: data.text } : null;
    case 'tool': {
      const tool = str(data.name);
      return tool && (data.state === 'running' || data.state === 'done') ? { type: 'tool', name: tool, state: data.state } : null;
    }
    case 'confirm': {
      const token = str(data.token);
      const action = str(data.action);
      if (!token || !action) return null;
      const subject = isObject(data.subject) ? data.subject : {};
      return { type: 'confirm', confirm: { token, action, subject: { type: str(subject.type) ?? '', id: str(subject.id), name: str(subject.name) }, changes: isObject(data.changes) ? data.changes : {}, expiresIn: num(data.expires_in) ?? 300 } };
    }
    case 'error':
      return { type: 'error', code: str(data.code) ?? 'error' };
    case 'done': {
      const stop = STOPS.find((candidate) => candidate === data.stop) ?? 'error';
      const remaining = isObject(data.remaining) ? { requests: num(data.remaining.requests), tokens: num(data.remaining.tokens) } : null;
      return { type: 'done', stop, remaining };
    }
    default:
      return null;
  }
}

/** Reads a `text/event-stream` body as it arrives: events are separated by a blank line, each with `event:` and `data:` lines. */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<AssistantEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const take = (block: string): AssistantEvent | null => {
    let name = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) name = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (data.length === 0) return null;
    try {
      return parseAssistantEvent(name, JSON.parse(data.join('\n')));
    } catch {
      return null;
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let cut = buffer.indexOf('\n\n');
      while (cut >= 0) {
        const event = take(buffer.slice(0, cut));
        buffer = buffer.slice(cut + 2);
        if (event) yield event;
        cut = buffer.indexOf('\n\n');
      }
    }
    const last = take(buffer);
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}

async function open(path: string, body: unknown, signal: AbortSignal): Promise<AsyncGenerator<AssistantEvent>> {
  const response = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, credentials: 'same-origin', body: JSON.stringify(body), signal });
  if (!response.ok || !response.body) {
    let code = 'failed';
    try {
      const json: unknown = await response.json();
      if (isObject(json) && typeof json.error === 'string') code = json.error;
    } catch {
      // not JSON: keep the generic code
    }
    throw new AssistantRefusal(response.status, code);
  }
  return readEvents(response.body);
}

/** Asks a question on a page: the answer streams back; `conversationId` continues a conversation. Rejects with an AssistantRefusal when refused before the stream. */
export function ask(scope: AssistantScope, question: string, conversationId: string | null, signal: AbortSignal): Promise<AsyncGenerator<AssistantEvent>> {
  return open('/assistant/ask', { scope, question, ...(conversationId ? { conversation_id: conversationId } : {}) }, signal);
}

/** The owner's decision on a write the assistant asked to make: the rest of the turn streams back. */
export function confirm(token: string, decision: 'approve' | 'decline', signal: AbortSignal): Promise<AsyncGenerator<AssistantEvent>> {
  return open('/assistant/confirm', { token, decision }, signal);
}
