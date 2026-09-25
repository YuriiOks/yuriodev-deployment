import { afterEach, describe, expect, it, vi } from 'vitest';
import { SECTIONS, SOCIALS, displayUrl } from '../data/site';
import {
  HEALTH_URL,
  TERMINAL_COMMANDS,
  classifyLine,
  complete,
  execute,
  findCommand,
  tokenize,
  type Execution,
  type TerminalContext,
} from './terminalService';

const context = (theme: 'dark' | 'light' = 'dark'): TerminalContext & { setTheme: ReturnType<typeof vi.fn> } => ({
  theme,
  setTheme: vi.fn(),
});

function run(input: string, ctx: TerminalContext = context()): Execution {
  const result = execute(input, ctx);
  if (result instanceof Promise) throw new Error(`${input} answered asynchronously`);
  return result;
}

/** A synchronous command's output as plain text. */
function text(input: string, ctx?: TerminalContext): string {
  const result = run(input, ctx);
  if (result.kind !== 'lines') throw new Error(`${input} cleared the screen`);
  return result.lines.map(({ text: t }) => t).join('\n');
}

const SYNC_TEXT_COMMANDS = TERMINAL_COMMANDS.map(({ name }) => name).filter((name) => !['clear', 'status'].includes(name));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('terminal command registry', () => {
  it('every command has a unique lower-case name and a description', () => {
    const names = TERMINAL_COMMANDS.map(({ name }) => name);
    expect(new Set(names).size).toBe(names.length);
    for (const { name, description } of TERMINAL_COMMANDS) {
      expect(name).toMatch(/^[a-z]+$/);
      expect(description.length, name).toBeGreaterThan(5);
    }
  });

  it('includes the new socials, status and theme commands', () => {
    for (const name of ['socials', 'status', 'theme']) expect(findCommand(name), name).toBeDefined();
  });

  it('help is generated from the registry and lists every command with its description', () => {
    const help = text('help');
    expect(help.split('\n')[0]).toBe('Available commands:');
    for (const { name, description } of TERMINAL_COMMANDS) {
      expect(help).toContain(`${name.padEnd(10)} - ${description}`);
    }
  });

  it('every text command prints something', () => {
    for (const name of SYNC_TEXT_COMMANDS) {
      expect(text(name).trim().length, name).toBeGreaterThan(0);
    }
  });

  it('clear asks the terminal to clear the screen', () => {
    expect(run('clear')).toEqual({ kind: 'clear' });
  });

  it('ls lists the sections of the page', () => {
    const ls = text('ls');
    for (const { label, navLabel } of SECTIONS) {
      expect(ls).toContain(label);
      expect(ls).toContain(navLabel);
    }
  });

  it('socials lists every profile from site.ts', () => {
    const socials = text('socials');
    for (const { shortLabel, url } of SOCIALS) {
      expect(socials).toContain(shortLabel);
      expect(socials).toContain(displayUrl(url));
    }
  });

  it('socials colours every profile line as a link', () => {
    const result = run('socials');
    const lines = result.kind === 'lines' ? result.lines : [];
    expect(lines.slice(2).map(({ type }) => type)).toEqual(SOCIALS.map(() => 'success'));
  });

  it('contact lists the LinkedIn and X profiles and no phone number', () => {
    const contact = text('contact');
    expect(contact).toContain('linkedin.com/in/y-oks');
    expect(contact).toContain('x.com/YuriODev');
    expect(contact).not.toMatch(/phone|\+44|\d{4} ?\d{6}/i);
  });

  it('states experience as 10+ years', () => {
    expect(text('about')).toContain('10+ years building production AI systems');
    for (const name of SYNC_TEXT_COMMANDS) {
      expect(text(name), name).not.toMatch(/\b8\+ years/);
    }
  });

  it('no output contains a replacement character or the retired --details hint', () => {
    for (const name of SYNC_TEXT_COMMANDS) {
      const output = text(name);
      expect(output, name).not.toContain('�');
      expect(output, name).not.toContain('--details');
    }
  });
});

describe('running a command line', () => {
  it('tokenises: the name in lower case, arguments as typed, extra spaces ignored', () => {
    expect(tokenize('  Theme   Light  ')).toEqual(['theme', 'Light']);
    expect(tokenize('   ')).toEqual([]);
  });

  it('runs a command typed in any case and with surrounding spaces', () => {
    expect(text('  SKILLS ')).toBe(text('skills'));
  });

  it('reports an unknown command as an error line', () => {
    const result = run('not-a-real-command');
    expect(result).toEqual({
      kind: 'lines',
      lines: [{ text: 'Command not found: not-a-real-command. Type "help" for available commands.', type: 'error' }],
    });
  });

  it.each(['constructor', '__proto__', 'hasOwnProperty', 'toString', 'valueOf'])(
    'treats the inherited name %s as unknown',
    (name) => {
      expect(findCommand(name)).toBeUndefined();
      expect(text(name)).toBe(`Command not found: ${name.toLowerCase()}. Type "help" for available commands.`);
    },
  );

  it('an empty line prints nothing', () => {
    expect(run('   ')).toEqual({ kind: 'lines', lines: [] });
  });
});

describe('theme command', () => {
  it('without an argument shows the current theme', () => {
    const ctx = context('light');
    expect(text('theme', ctx)).toContain('Current theme: light');
    expect(ctx.setTheme).not.toHaveBeenCalled();
  });

  it('switches to the named theme', () => {
    const ctx = context('dark');
    expect(text('theme LIGHT', ctx)).toContain('Theme switched to light.');
    expect(ctx.setTheme).toHaveBeenCalledWith('light');
  });

  it('leaves the theme alone when it is already the one asked for', () => {
    const ctx = context('dark');
    expect(text('theme dark', ctx)).toContain('already dark');
    expect(ctx.setTheme).not.toHaveBeenCalled();
  });

  it('rejects an unknown theme', () => {
    const ctx = context();
    const result = run('theme blue', ctx);
    expect(result.kind === 'lines' && result.lines[0].type).toBe('error');
    expect(ctx.setTheme).not.toHaveBeenCalled();
  });
});

describe('status command', () => {
  async function status(): Promise<Execution> {
    const result = execute('status', context());
    expect(result).toBeInstanceOf(Promise);
    return result;
  }

  const lines = (result: Execution) => (result.kind === 'lines' ? result.lines : []);

  it('reports the environment and the short revision from /api/health', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ status: 'healthy', service: 'backend', environment: 'prod', revision: '0123456789abcdef0123' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = lines(await status());

    expect(fetchMock).toHaveBeenCalledWith(HEALTH_URL, expect.objectContaining({ cache: 'no-store' }));
    expect(result.map(({ text: t }) => t)).toEqual(['API:         healthy', 'Environment: prod', 'Revision:    0123456']);
    expect(result[0].type).toBe('success');
  });

  it('says so, without throwing, when the API answers with an error status', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('bad gateway', { status: 502 }))));
    const result = lines(await status());
    expect(result[0]).toEqual({ text: 'Could not reach the API (HTTP 502).', type: 'error' });
  });

  it('says so when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    const result = lines(await status());
    expect(result[0]).toEqual({ text: 'Could not reach the API (network error).', type: 'error' });
  });

  it('says so when the answer is not the health JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<html></html>', { status: 200 }))));
    const result = lines(await status());
    expect(result[0].type).toBe('error');
  });

  it('gives up after 5 seconds without an answer', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      ),
    );
    const pending = status();
    await vi.advanceTimersByTimeAsync(5000);
    const result = lines(await pending);
    expect(result[0]).toEqual({ text: 'Could not reach the API (no answer in 5 s).', type: 'error' });
  });
});

describe('Tab completion', () => {
  it('completes a unique command name and adds a space', () => {
    expect(complete('sk')).toEqual({ value: 'skills ', candidates: [] });
  });

  it('extends to the common prefix and lists the candidates', () => {
    expect(complete('e')).toEqual({ value: 'e', candidates: ['experience', 'education'] });
    expect(complete('ex')).toEqual({ value: 'experience ', candidates: [] });
    expect(complete('s')).toEqual({ value: 's', candidates: ['skills', 'socials', 'status', 'surprise'] });
    expect(complete('so')).toEqual({ value: 'socials ', candidates: [] });
  });

  it('completes the theme argument', () => {
    expect(complete('theme l')).toEqual({ value: 'theme light ', candidates: [] });
    expect(complete('theme ')).toEqual({ value: 'theme ', candidates: ['dark', 'light'] });
  });

  it('has nothing to offer for an empty line, an unknown prefix or a command without arguments', () => {
    expect(complete('')).toBeNull();
    expect(complete('zz')).toBeNull();
    expect(complete('skills x')).toBeNull();
  });
});

describe('line colouring', () => {
  it.each([
    ['Technical Skills Matrix:', 'warning'],
    ['🤖 AI & Agentic Engineering:', 'info'],
    ['━━━━━━━━', 'info'],
    ['   • Python (Advanced)            [████████████] Expert', 'success'],
    ['plain words', 'output'],
  ])('%s is %s', (line, type) => {
    expect(classifyLine(line)).toBe(type);
  });
});
