import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from '../../../context/useTheme';
import styles from './CommandPalette.module.css';
import { scrollBehavior } from '../../../utils/motion';

// html's scroll-padding-top keeps the target clear of the fixed header.
function scrollToSection(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
}

// External links open in a new tab with no opener and no referrer.
function openExternal(url: string) {
    window.open(url, '_blank', 'noopener,noreferrer');
}

interface CommandPaletteProps {
    /** Open state owned by the parent (PageLayout keeps one overlay open at a time). Omit to let the palette own it. */
    isOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    onShowHelp?: () => void;
}

const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen: openProp, onOpenChange, onShowHelp }) => {
    const { toggleTheme } = useTheme();
    const { pathname } = useLocation();
    const navigate = useNavigate();

    const commands = useMemo(() => {
        // Sections live on the home page; from any other page, go there first.
        const goTo = (id: string) => () => {
            if (pathname === '/') scrollToSection(id);
            else navigate(`/#${id}`);
        };
        return [
            { title: 'Go to Hero', action: goTo('hero'), shortcut: 'hero' },
            { title: 'Go to About', action: goTo('about'), shortcut: 'about' },
            { title: 'Go to Platform', action: goTo('platform'), shortcut: 'platform' },
            { title: 'Go to Projects', action: goTo('projects'), shortcut: 'projects' },
            { title: 'Go to Timeline', action: goTo('timeline'), shortcut: 'timeline' },
            { title: 'Go to Skills', action: goTo('skills'), shortcut: 'skills' },
            { title: 'Go to Connect', action: goTo('connect'), shortcut: 'connect' },
            { title: 'Go to Terminal', action: goTo('terminal'), shortcut: 'terminal' },
            { title: 'Toggle Theme', action: () => toggleTheme(), shortcut: 'theme' },
            { title: 'Show Help', action: () => onShowHelp?.(), shortcut: 'help' },
            { title: 'Send Email', action: () => { window.location.href = 'mailto:yurii.oksamytnyi@yuriodev.co.uk'; }, shortcut: 'email' },
            { title: 'View LinkedIn', action: () => openExternal('https://www.linkedin.com/in/y-oks'), shortcut: 'linkedin' },
            { title: 'View X', action: () => openExternal('https://x.com/YuriODev'), shortcut: 'x' },
            { title: 'View GitHub', action: () => openExternal('https://github.com/YuriiOks'), shortcut: 'github' }
        ];
    }, [toggleTheme, pathname, navigate, onShowHelp]);
    const [ownOpen, setOwnOpen] = useState(false);
    const isOpen = openProp ?? ownOpen;
    const setIsOpen = useCallback((open: boolean) => {
        if (openProp === undefined) setOwnOpen(open);
        onOpenChange?.(open);
    }, [openProp, onOpenChange]);
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
    }, [isOpen, setIsOpen]);

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
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                            e.preventDefault();
                            setIsOpen(false);
                            setInputValue('');
                        }
                    }}
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
