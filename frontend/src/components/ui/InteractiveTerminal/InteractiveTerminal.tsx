import React, { useState, useRef, useEffect } from 'react';
import { terminalCommands } from '../../../services/terminalService';
import { isHeaderEmojiLine } from '../../../utils/headerEmoji';
import styles from './InteractiveTerminal.module.css';

interface TerminalLine {
  content: string;
  type: 'command' | 'output' | 'success' | 'error' | 'warning' | 'info' | 'comment';
}

const InteractiveTerminal: React.FC = () => {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState<TerminalLine[]>([]);
  const terminalOutputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (terminalOutputRef.current) {
      terminalOutputRef.current.scrollTop = terminalOutputRef.current.scrollHeight;
    }
  }, [output]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
  };

    const parseOutputWithColors = (text: string): TerminalLine[] => {
    const lines: TerminalLine[] = [];
    
    if (!text) return lines;
    
    const textLines = text.split('\n');
    
    textLines.forEach(line => {
      if (!line.trim()) {
        lines.push({ content: '\u00A0', type: 'output' });
        return;
      }
      
      // Success indicators
      if (line.startsWith('✓') || line.toLowerCase().includes('successfully') || line.toLowerCase().includes('complete')) {
        lines.push({ content: line, type: 'success' });
      }
      // Error indicators
      else if (line.startsWith('✗') || line.toLowerCase().includes('error') || line.toLowerCase().includes('not found') || line.toLowerCase().includes('failed')) {
        lines.push({ content: line, type: 'error' });
      }
      // Warning indicators
      else if (line.startsWith('⚠') || line.toLowerCase().includes('warning') || line.toLowerCase().includes('note:')) {
        lines.push({ content: line, type: 'warning' });
      }
      // Comments
      else if (line.trim().startsWith('#') || line.trim().startsWith('//')) {
        lines.push({ content: line, type: 'comment' });
      }
      // Headers (lines with emojis or section titles)
      else if (line.includes('━') || isHeaderEmojiLine(line)) {
        lines.push({ content: line, type: 'info' });
      }
      // Email, links, contact info
      else if (line.includes('@') || line.includes('http') || line.includes('.com') || line.includes('.uk') || line.includes('github') || line.includes('linkedin')) {
        lines.push({ content: line, type: 'success' });
      }
      // Section headers (Available commands, Technical Skills, etc.)
      else if (line.includes(':') && !line.includes('~$') && (line.match(/^[A-Z]/))) {
        lines.push({ content: line, type: 'warning' });
      }
      // Progress bars and percentages
      else if (line.includes('█') || line.includes('[') && line.includes(']') || line.includes('%')) {
        lines.push({ content: line, type: 'success' });
      }
      // Box drawing characters (for surprise command)
      else if (line.includes('╔') || line.includes('╠') || line.includes('╚') || line.includes('║')) {
        lines.push({ content: line, type: 'warning' });
      }
      // Info lines (bullets, dashes, arrows)
      else if (line.includes('→') || line.includes('•') || line.includes('ℹ') || line.trim().startsWith('-') || line.trim().startsWith('◦')) {
        lines.push({ content: line, type: 'info' });
      }
      // Default: Matrix green
      else {
        lines.push({ content: line, type: 'output' });
      }
    });
    
    return lines;
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const command = input.trim().toLowerCase();
      if (command) {
        // Add command to output
        const newOutput: TerminalLine[] = [
          ...output,
          { content: `visitor@yuriodev:~$ ${input}`, type: 'command' }
        ];
        
        // Execute command
        const commandOutput = terminalCommands[command]?.();
        
        if (commandOutput === 'CLEAR_TERMINAL') {
          setOutput([]);
        } else {
          const parsedOutput = parseOutputWithColors(
            commandOutput || `Command not found: ${command}. Type "help" for available commands.`
          );
          
          setOutput([
            ...newOutput,
            ...parsedOutput,
            { content: '\u00A0', type: 'output' }
          ]);
        }
        setInput('');
      }
    }
  };

  // Focus input when clicking on terminal
  const handleTerminalClick = () => {
    inputRef.current?.focus();
  };

  return (
    <div className={styles.terminalWrapper}>
      {/* Mac-style window header */}
      <div className={styles.terminalHeader}>
        <div className={styles.trafficLights}>
          <span className={`${styles.trafficLight} ${styles.red}`}></span>
          <span className={`${styles.trafficLight} ${styles.yellow}`}></span>
          <span className={`${styles.trafficLight} ${styles.green}`}></span>
        </div>
        <div className={styles.terminalTitle}>visitor@yuriodev: ~</div>
        <div className={styles.terminalActions}></div>
      </div>
      
      {/* Terminal content */}
      <div className={styles.interactiveTerminal} onClick={handleTerminalClick}>
        <div className={styles.terminalOutput} ref={terminalOutputRef}>
          <div className={`${styles.terminalLine} ${styles.success}`}>
            Welcome to YuriODev Terminal v2.0.1
          </div>
          <div className={`${styles.terminalLine} ${styles.info}`}>
            Type 'help' for available commands, or try: skills, contact, projects, surprise
          </div>
          <div className={styles.terminalLine}>&nbsp;</div>
          {output.map((line, index) => (
            <div 
              key={index} 
              className={`${styles.terminalLine} ${styles[line.type]}`}
            >
              {line.content}
            </div>
          ))}
        </div>
        <div className={styles.terminalInputLine}>
          <span className={styles.terminalPromptInteractive}>visitor@yuriodev:~$</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            className={styles.terminalInput}
            placeholder="Type a command..."
            aria-label="Terminal command input"
            autoComplete="off"
          />
        </div>
      </div>
    </div>
  );
};

export default InteractiveTerminal;
