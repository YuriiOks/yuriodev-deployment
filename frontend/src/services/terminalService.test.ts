import { describe, expect, it } from 'vitest';
import { runTerminalCommand, terminalCommands } from './terminalService';

describe('terminalCommands', () => {
  it('returns non-empty output for every known command', () => {
    const names = Object.keys(terminalCommands);
    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      const output = terminalCommands[name]();
      expect(typeof output).toBe('string');
      expect(output.length).toBeGreaterThan(0);
    }
  });

  it('help lists the other available commands', () => {
    const helpText = terminalCommands.help();
    expect(helpText).toContain('skills');
    expect(helpText).toContain('contact');
    expect(helpText).toContain('projects');
  });

  it('clear returns the sentinel used by the UI to wipe the terminal', () => {
    expect(terminalCommands.clear()).toBe('CLEAR_TERMINAL');
  });

  it('ls aliases help', () => {
    expect(terminalCommands.ls()).toBe(terminalCommands.help());
  });

  it('looking up an unknown command name yields no handler', () => {
    expect(terminalCommands['not-a-real-command']).toBeUndefined();
  });

  it('contact lists the LinkedIn and X profiles', () => {
    const contact = terminalCommands.contact();
    expect(contact).toContain('linkedin.com/in/y-oks');
    expect(contact).toContain('x.com/YuriODev');
  });

  it('runTerminalCommand runs known commands', () => {
    expect(runTerminalCommand('help')).toBe(terminalCommands.help());
  });

  it.each(['constructor', '__proto__', 'hasOwnProperty', 'toString', 'valueOf'])(
    'runTerminalCommand treats the inherited name %s as unknown',
    (name) => {
      expect(runTerminalCommand(name)).toBeUndefined();
    },
  );

  it('no output contains a replacement character or the retired --details hint', () => {
    for (const name of Object.keys(terminalCommands)) {
      const output = terminalCommands[name]();
      expect(output, name).not.toContain('\uFFFD');
      expect(output, name).not.toContain('--details');
    }
  });
});
