import { useCallback, useEffect, useRef, useState } from 'react';
import { AssistantRefusal, ask, confirm, type AssistantConfirm, type AssistantDone, type AssistantEvent, type AssistantScope } from '../services/dashboards/assistantApi';

export type AssistantProblem = 'failed' | 'scope' | 'busy' | 'expired' | 'invalid';

export interface AssistantTurn {
  readonly id: number;
  readonly question: string;
  /** The answer so far (plain text: never read as markup). */
  readonly answer: string;
  /** How the turn ended; null while it is being answered. */
  readonly stop: AssistantDone['stop'] | 'aborted' | null;
}

export interface AssistantState {
  readonly turns: readonly AssistantTurn[];
  readonly busy: boolean;
  /** The tool the assistant is looking at right now. */
  readonly tool: string | null;
  /** A write waiting for the owner's yes or no. */
  readonly pending: AssistantConfirm | null;
  readonly problem: AssistantProblem | null;
  readonly remaining: number | null;
  readonly lastQuestion: string | null;
}

export interface Assistant extends AssistantState {
  readonly ask: (question: string) => void;
  readonly decide: (decision: 'approve' | 'decline') => void;
  readonly stop: () => void;
  readonly reset: () => void;
}

/** What a refusal before the stream means for the page. */
function problemOf(error: unknown): AssistantProblem {
  if (!(error instanceof AssistantRefusal)) return 'failed';
  if (error.status === 403) return 'scope';
  if (error.status === 409) return 'busy';
  if (error.status === 410) return 'expired';
  if (error.status === 422) return 'invalid';
  return 'failed';
}

/**
 * One conversation with the assistant of a page, for as long as the page is open: the questions and their streamed answers, the tool it is looking at,
 * a write waiting for a yes or a no, and what is left of the day's requests. Stop aborts the request; leaving the page does too. Nothing the
 * server says is shown as it is: the page words every state.
 */
export function useAssistant(scope: AssistantScope): Assistant {
  const [state, setState] = useState<AssistantState>({ turns: [], busy: false, tool: null, pending: null, problem: null, remaining: null, lastQuestion: null });
  const conversation = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const counter = useRef(0);
  const busy = useRef(false);

  useEffect(() => () => controller.current?.abort(), []);

  const apply = useCallback((turnId: number, event: AssistantEvent) => {
    const turn = (change: (current: AssistantTurn) => AssistantTurn) => (previous: AssistantState): AssistantState => ({ ...previous, turns: previous.turns.map((entry) => (entry.id === turnId ? change(entry) : entry)) });
    switch (event.type) {
      case 'meta':
        conversation.current = event.conversationId;
        return;
      case 'delta':
        setState(turn((entry) => ({ ...entry, answer: entry.answer + event.text })));
        return;
      case 'tool':
        setState((previous) => ({ ...previous, tool: event.state === 'running' ? event.name : null }));
        return;
      case 'confirm':
        setState((previous) => ({ ...previous, pending: event.confirm }));
        return;
      case 'error':
        setState((previous) => ({ ...previous, problem: 'failed' }));
        return;
      case 'done':
        setState((previous) => ({ ...turn((entry) => ({ ...entry, stop: event.stop }))(previous), remaining: event.remaining?.requests ?? previous.remaining, problem: event.stop === 'error' ? 'failed' : previous.problem }));
        return;
    }
  }, []);

  const run = useCallback(
    async (turnId: number, open: (signal: AbortSignal) => Promise<AsyncGenerator<AssistantEvent>>) => {
      const own = new AbortController();
      controller.current = own;
      busy.current = true;
      setState((previous) => ({ ...previous, busy: true, problem: null, tool: null }));
      try {
        for await (const event of await open(own.signal)) apply(turnId, event);
      } catch (error) {
        if (own.signal.aborted) setState((previous) => ({ ...previous, turns: previous.turns.map((entry) => (entry.id === turnId && entry.stop === null ? { ...entry, stop: 'aborted' } : entry)) }));
        else setState((previous) => ({ ...previous, problem: problemOf(error), pending: problemOf(error) === 'expired' ? null : previous.pending }));
      } finally {
        busy.current = false;
        if (controller.current === own) controller.current = null;
        setState((previous) => ({ ...previous, busy: false, tool: null }));
      }
    },
    [apply],
  );

  const send = useCallback(
    (question: string) => {
      const text = question.trim();
      if (text.length === 0 || text.length > 2000 || busy.current) return;
      counter.current += 1;
      const id = counter.current;
      setState((previous) => (previous.pending ? previous : { ...previous, turns: [...previous.turns, { id, question: text, answer: '', stop: null }], lastQuestion: text }));
      void run(id, (signal) => ask(scope, text, conversation.current, signal));
    },
    [run, scope],
  );

  const decide = useCallback(
    (decision: 'approve' | 'decline') => {
      const token = state.pending?.token;
      if (!token || busy.current) return;
      const last = state.turns[state.turns.length - 1];
      setState((previous) => ({ ...previous, pending: null, turns: previous.turns.map((entry) => (entry.id === last?.id ? { ...entry, stop: null } : entry)) }));
      void run(last?.id ?? 0, (signal) => confirm(token, decision, signal));
    },
    [run, state.pending, state.turns],
  );

  const stop = useCallback(() => controller.current?.abort(), []);

  const reset = useCallback(() => {
    controller.current?.abort();
    conversation.current = null;
    setState((previous) => ({ turns: [], busy: false, tool: null, pending: null, problem: null, remaining: previous.remaining, lastQuestion: null }));
  }, []);

  return { ...state, ask: send, decide, stop, reset };
}
