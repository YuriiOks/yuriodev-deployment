import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTheme } from '../../../context/useTheme';
import { useSectionNav } from '../../../context/useSectionNav';
import { EMAILS, SECTIONS, TERMINAL_ANCHOR, shortcutFor, socialsFor } from '../../../data/site';
import styles from './CommandPalette.module.css';

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
    const { goTo } = useSectionNav();

    const commands = useMemo(() => [
        // Sections in page order; from any other page, goTo opens the home page there.
        ...SECTIONS.map(({ id, label }) => ({ title: `Go to ${label}`, action: () => goTo(id), shortcut: id })),
        { title: 'Go to Terminal', action: () => goTo(TERMINAL_ANCHOR), shortcut: TERMINAL_ANCHOR },
        { title: 'Toggle Theme', action: () => toggleTheme(), shortcut: 'theme' },
        { title: 'Show Help', action: () => onShowHelp?.(), shortcut: 'help' },
        { title: 'Send Email', action: () => { window.location.href = `mailto:${EMAILS.personal}`; }, shortcut: 'email' },
        ...socialsFor('palette').map(({ id, shortLabel, url }) => ({
            title: `View ${shortLabel}`,
            action: () => openExternal(url),
            shortcut: id,
        })),
    ], [toggleTheme, goTo, onShowHelp]);
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
            if (shortcutFor(e) === 'palette') {
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
