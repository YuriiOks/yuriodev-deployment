import { describe, expect, it } from 'vitest';
import { terminalCommands } from './terminalService';

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
});
