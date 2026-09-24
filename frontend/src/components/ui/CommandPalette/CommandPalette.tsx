import React, { useState, useEffect, useMemo } from 'react';
import { useTheme } from '../../../context/useTheme';
import styles from './CommandPalette.module.css';

function scrollToSection(selector:string) {
    const element = document.querySelector(selector);
    if (element) {
        const header = document.querySelector('.terminal-header') as HTMLElement;
        const headerOffset = header ? header.offsetHeight : 70;
        const elementPosition = (element as HTMLElement).offsetTop - headerOffset;
        window.scrollTo({ top: elementPosition, behavior: 'smooth' });
    }
}

const CommandPalette: React.FC = () => {
    const { toggleTheme } = useTheme();

    const commands = useMemo(() => [
        { title: 'Go to Hero', action: () => scrollToSection('#hero'), shortcut: 'hero' },
        { title: 'Go to About', action: () => scrollToSection('#about'), shortcut: 'about' },
        { title: 'Go to Platform', action: () => scrollToSection('#platform'), shortcut: 'platform' },
        { title: 'Go to Projects', action: () => scrollToSection('#projects'), shortcut: 'projects' },
        { title: 'Go to Timeline', action: () => scrollToSection('#timeline'), shortcut: 'timeline' },
        { title: 'Go to Skills', action: () => scrollToSection('#skills'), shortcut: 'skills' },
        { title: 'Go to Connect', action: () => scrollToSection('#connect'), shortcut: 'connect' },
        { title: 'Go to Terminal', action: () => scrollToSection('#terminal'), shortcut: 'terminal' },
        { title: 'Toggle Theme', action: () => toggleTheme(), shortcut: 'theme' },
        { title: 'Show Help', action: () => {/**/}, shortcut: 'help' },
        { title: 'Send Email', action: () => window.location.href = 'mailto:yurii.oksamytnyi@yuriodev.co.uk', shortcut: 'email' },
        { title: 'View LinkedIn', action: () => window.open('https://www.linkedin.com/in/yurii-oksamytnyi/', '_blank'), shortcut: 'linkedin' },
        { title: 'View GitHub', action: () => window.open('https://github.com/YuriiOks', '_blank'), shortcut: 'github' }
    ], [toggleTheme]);
    const [isOpen, setIsOpen] = useState(false);
    const [inputValue, setInputValue] = useState('');
    const [filteredCommands, setFilteredCommands] = useState(commands);
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                setIsOpen(!isOpen);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen]);

    useEffect(() => {
        if (isOpen) {
            setFilteredCommands(
                commands.filter(cmd =>
                    cmd.title.toLowerCase().includes(inputValue.toLowerCase()) ||
                    cmd.shortcut.toLowerCase().includes(inputValue.toLowerCase())
                )
            );
            setSelectedIndex(0);
        }
    }, [inputValue, isOpen, commands]);


    const handleCommandClick = (command: { title: string; action: () => void; shortcut: string; }) => {
        command.action();
        setIsOpen(false);
        setInputValue('');
    };

    if (!isOpen) return null;

    return (
        <div className={styles.commandPalette} onClick={() => setIsOpen(false)}>
            <div className={styles.commandPaletteContent} onClick={(e) => e.stopPropagation()}>
                <input
                    type="text"
                    className={styles.commandInput}
                    placeholder="Type a command or search..."
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    autoFocus
                />
                <div className={styles.commandResults}>
                    {filteredCommands.map((cmd, index) => (
                        <div
                            key={cmd.title}
                            className={`${styles.commandItem} ${index === selectedIndex ? styles.selected : ''}`}
                            onClick={() => handleCommandClick(cmd)}
                        >
                            <span className={styles.commandTitle}>{cmd.title}</span>
                            <span className={styles.commandShortcut}>{cmd.shortcut}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default CommandPalette;
