import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardLangProvider } from '../../../context/DashboardLangProvider';
import { LANG_STORAGE_KEY } from '../../../services/dashboards/strings';
import { resetStorageFallback } from '../../../utils/safeStorage';
import AskCard from './AskCard';

// A faked assistant: the server's stream, in exactly the shapes it writes (invented questions and answers).

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const encoder = new TextEncoder();

/** A response whose stream the test feeds event by event (and can leave open, so an abort has something to cut). */
function controlled(signal?: AbortSignal | null) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
    },
  });
  return {
    response: new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    push: (event: string, data: unknown) => controller.enqueue(encoder.encode(sse(event, data))),
    close: () => controller.close(),
  };
}

const finished = (...events: [string, unknown][]) => {
  const stream = controlled();
  for (const [event, data] of events) stream.push(event, data);
  stream.close();
  return stream.response;
};

const refusal = (status: number, error: string) => new Response(JSON.stringify({ error, message: 'x', request_id: 'test' }), { status, headers: { 'Content-Type': 'application/json' } });
const done = (stop = 'end_turn', requests = 29) => ['done', { stop, usage: { input_tokens: 1, output_tokens: 1 }, remaining: { requests, tokens: 1000 } }] as [string, unknown];

interface Sent {
  path: string;
  body: Record<string, unknown>;
}

/** Answers the fetches of the card, in order, and records what was sent. */
function fakeServer(answers: ((signal?: AbortSignal | null) => Response)[]) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ path: String(url).replace('/api/dashboards/v1', ''), body: JSON.parse(String(init.body)) });
      const next = answers.shift();
      if (!next) throw new Error('unexpected request');
      return next(init.signal);
    }),
  );
  return sent;
}

const renderCard = (scope: 'personal' | 'work-1' | 'money' = 'personal') =>
  render(
    <DashboardLangProvider>
      <AskCard scope={scope} />
    </DashboardLangProvider>,
  );

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(LANG_STORAGE_KEY, 'en');
  resetStorageFallback();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Ask Claude', () => {
  it('sends a suggested question, shows a tool at work, streams the answer as plain text with its line breaks, shows what is left, and keeps the conversation for the next question', async () => {
    const stream = controlled();
    const sent = fakeServer([() => stream.response, () => finished(['meta', { conversation_id: 'c-1', model: 'm' }], ['delta', { text: 'Second.' }], done())]);
    const user = userEvent.setup();
    renderCard();
    const card = within(screen.getByRole('region', { name: 'Ask Claude' }));
    await user.click(card.getByRole('button', { name: 'What is overdue?' }));
    expect(sent[0]).toEqual({ path: '/assistant/ask', body: { scope: 'personal', question: 'What is overdue?' } });
    await act(async () => {
      stream.push('meta', { conversation_id: 'c-1', model: 'm' });
      stream.push('tool', { name: 'list_tasks', state: 'running' });
    });
    expect(await card.findByText('Looking at the tasks…')).toBeInTheDocument();
    await act(async () => {
      stream.push('tool', { name: 'list_tasks', state: 'done' });
      stream.push('delta', { text: 'Two tasks:\n- <b>File the form</b>\n' });
      stream.push('delta', { text: '- Book the dentist' });
      stream.push(...done());
      stream.close();
    });
    await waitFor(() => expect(card.queryByText('Looking at the tasks…')).toBeNull());
    const answer = card.getByText(/Two tasks:/);
    // Text, with its line breaks; markup in it is shown as typed, never drawn.
    expect(answer.textContent).toBe('Two tasks:\n- <b>File the form</b>\n- Book the dentist');
    expect(answer.querySelector('b')).toBeNull();
    expect(card.getByText('Requests left today: 29')).toBeInTheDocument();
    await waitFor(() => expect(card.getByLabelText('Question')).toHaveFocus());
    // Enter sends and goes on in the same conversation; Shift+Enter is a new line.
    await user.type(card.getByLabelText('Question'), 'And tomorrow?{Shift>}{Enter}{/Shift}more');
    expect(sent).toHaveLength(1);
    expect(card.getByLabelText('Question')).toHaveValue('And tomorrow?\nmore');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].body).toEqual({ scope: 'personal', question: 'And tomorrow?\nmore', conversation_id: 'c-1' });
    expect(await card.findByText('Second.')).toBeInTheDocument();
    // "New conversation" forgets it.
    await user.click(card.getByRole('button', { name: 'New conversation' }));
    expect(card.queryByText('Second.')).toBeNull();
  });

  it('shows a write to confirm in words (an event with its local date, start and end and a warning when it is in the past), writes nothing until Approve, and goes on with the answer', async () => {
    const confirmEvent = { token: 'tok-1', action: 'add_event', subject: { type: 'event', id: null, name: 'Dentist' }, changes: { title: 'Dentist', starts_at: '2026-11-20T10:00:00+00:00', ends_at: '2026-11-20T11:00:00+00:00', local_date: '2026-11-20', local_start: '10:00', local_end: '11:00', local_end_date: '2026-11-20', in_the_past: true }, scope: 'personal', expires_in: 300 };
    const sent = fakeServer([() => finished(['meta', { conversation_id: 'c-2', model: 'm' }], ['delta', { text: 'I can add it.' }], ['confirm', confirmEvent], done('confirm')), () => finished(['meta', { conversation_id: 'c-2', model: 'm' }], ['delta', { text: 'Added.' }], done())]);
    const user = userEvent.setup();
    renderCard();
    const card = within(screen.getByRole('region', { name: 'Ask Claude' }));
    await user.type(card.getByLabelText('Question'), 'Add a dentist visit on the 20th{Enter}');
    const box = within(await card.findByRole('group', { name: 'Confirm the change' }));
    expect(box.getByText('Add an event')).toBeInTheDocument();
    expect(box.getByText('About: Dentist')).toBeInTheDocument();
    expect(box.getByText('20 November 2026')).toBeInTheDocument();
    expect(box.getByText('10:00')).toBeInTheDocument();
    expect(box.getByText('11:00')).toBeInTheDocument();
    expect(box.getByRole('alert')).toHaveTextContent('This event is in the past.');
    // Nothing was sent but the question, and the box is closed to new questions.
    expect(sent).toHaveLength(1);
    expect(card.getByLabelText('Question')).toBeDisabled();
    await user.click(box.getByRole('button', { name: 'Yes, do it' }));
    expect(sent[1]).toEqual({ path: '/assistant/confirm', body: { token: 'tok-1', decision: 'approve' } });
    expect(await card.findByText(/Added\./)).toBeInTheDocument();
    expect(card.queryByRole('group', { name: 'Confirm the change' })).toBeNull();
  });

  it('declines a write on request, and says a confirmation that ran out changed nothing', async () => {
    const confirmTask = { token: 'tok-2', action: 'complete_task', subject: { type: 'task', id: 't-1', name: 'File the form' }, changes: { status: 'done' }, scope: 'personal', expires_in: 300 };
    const sent = fakeServer([() => finished(['confirm', confirmTask], done('confirm')), () => finished(['delta', { text: 'Left as it was.' }], done()), () => finished(['confirm', confirmTask], done('confirm')), () => refusal(410, 'assistant_confirmation_gone')]);
    const user = userEvent.setup();
    renderCard();
    const card = within(screen.getByRole('region', { name: 'Ask Claude' }));
    await user.type(card.getByLabelText('Question'), 'Mark the form done{Enter}');
    let box = within(await card.findByRole('group', { name: 'Confirm the change' }));
    expect(box.getByText('Mark a task done')).toBeInTheDocument();
    expect(box.getByText('Status')).toBeInTheDocument();
    await user.click(box.getByRole('button', { name: 'No' }));
    expect(sent[1].body).toEqual({ token: 'tok-2', decision: 'decline' });
    expect(await card.findByText(/Left as it was\./)).toBeInTheDocument();
    await waitFor(() => expect(card.getByLabelText('Question')).toBeEnabled());
    await user.type(card.getByLabelText('Question'), 'Again{Enter}');
    box = within(await card.findByRole('group', { name: 'Confirm the change' }));
    await user.click(box.getByRole('button', { name: 'Yes, do it' }));
    expect(await card.findByRole('alert')).toHaveTextContent('The confirmation ran out: nothing was changed.');
    expect(card.queryByRole('group', { name: 'Confirm the change' })).toBeNull();
  });

  it('stops on Stop: the request is aborted, what had come stays, and the box is free again', async () => {
    let aborted = false;
    let held!: ReturnType<typeof controlled>;
    fakeServer([
      (signal) => {
        signal?.addEventListener('abort', () => {
          aborted = true;
        });
        held = controlled(signal);
        return held.response;
      },
    ]);
    const user = userEvent.setup();
    renderCard();
    const card = within(screen.getByRole('region', { name: 'Ask Claude' }));
    await user.type(card.getByLabelText('Question'), 'A long one{Enter}');
    await act(async () => {
      held.push('delta', { text: 'Partial' });
    });
    expect(await card.findByText('Partial')).toBeInTheDocument();
    await user.click(card.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(aborted).toBe(true));
    expect(await card.findByText('Stopped.')).toBeInTheDocument();
    expect(card.getByText('Partial')).toBeInTheDocument();
    expect(card.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('says every refusal and failure in the page\'s own words, never what the server said, and offers a retry for a failure', async () => {
    const sent = fakeServer([() => refusal(403, 'assistant_scope_refused'), () => refusal(409, 'assistant_busy'), () => finished(['error', { code: 'rate_limited' }], done('error')), () => finished(['delta', { text: 'Fine now.' }], done()), () => finished(['delta', { text: 'Partly.' }], done('cap', 0))]);
    const user = userEvent.setup();
    renderCard('money');
    const card = within(screen.getByRole('region', { name: 'Ask Claude' }));
    const askAgain = async (question: string) => {
      await waitFor(() => expect(card.getByLabelText('Question')).toBeEnabled());
      await user.type(card.getByLabelText('Question'), `${question}{Enter}`);
    };
    await askAgain('one');
    expect(await card.findByRole('alert')).toHaveTextContent('The assistant is not available on this page.');
    await askAgain('two');
    await waitFor(() => expect(card.getByRole('alert')).toHaveTextContent('The previous question is still being answered.'));
    await askAgain('three');
    await waitFor(() => expect(card.getByRole('alert')).toHaveTextContent('Could not get an answer.'));
    expect(screen.queryByText(/rate_limited|assistant_/)).toBeNull();
    await user.click(card.getByRole('button', { name: 'Try again' }));
    expect(await card.findByText('Fine now.')).toBeInTheDocument();
    expect(sent[3].body.question).toBe('three');
    await askAgain('four');
    expect(await card.findByText('Today\'s limit is reached. Try again tomorrow.')).toBeInTheDocument();
    expect(card.getByText('Requests left today: 0')).toBeInTheDocument();
  });

  it('shows the 2000-character limit only near its end, and sends nothing empty', async () => {
    const sent = fakeServer([]);
    const user = userEvent.setup();
    renderCard();
    const card = within(screen.getByRole('region', { name: 'Ask Claude' }));
    expect(card.queryByText(/\/ 2000/)).toBeNull();
    expect(card.getByRole('button', { name: 'Send' })).toBeDisabled();
    await user.click(card.getByLabelText('Question'));
    await user.paste('x'.repeat(1900));
    expect(card.getByText('1900 / 2000')).toBeInTheDocument();
    expect(card.getByLabelText('Question')).toHaveAttribute('maxlength', '2000');
    expect(sent).toHaveLength(0);
  });
});
