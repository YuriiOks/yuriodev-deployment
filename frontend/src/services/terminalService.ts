/**
 * The Connect section's terminal: a registry of commands (name, description,
 * run) that the `help` command and the help panel both list, plus the pure
 * helpers the InteractiveTerminal component uses: tokenising and running a
 * line, Tab completion and colouring plain-text output by line.
 */
import {
    EMAILS,
    IDENTITY,
    PROJECT_LINKS,
    SECTIONS,
    SOCIALS,
    displayUrl,
    socialsFor,
    type SocialId,
} from '../data/site';
import type { Theme } from '../context/theme-context';
import { isHeaderEmojiLine } from '../utils/headerEmoji';
import { firstLine, truncate } from '../utils/postText';
import { getPosts, primaryVariant } from './postsApi';

/** The contact card's line for each profile: marker, then the name padded to the column. */
const CONTACT_MARKERS: Partial<Record<SocialId, string>> = {
    linkedin: '🔗',
    x: '𝕏 ',
    github: '💻',
};

function contactLine(marker: string, name: string, value: string): string {
    return `${marker} ${`${name}:`.padEnd(10)}${value}`;
}

const contactCard = (): string => [
    contactLine('📧', 'Email', EMAILS.personal),
    ...socialsFor('terminal').map(({ id, shortLabel, url }) =>
        contactLine(CONTACT_MARKERS[id] ?? '🔗', shortLabel, displayUrl(url)),
    ),
    contactLine('🌐', 'Website', displayUrl(IDENTITY.website)),
    contactLine('📍', 'Location', IDENTITY.location),
].join('\n');

/** The fixed text some commands print. */
const TEXT = {
    skills: () => `Technical Skills Matrix:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🤖 AI & Agentic Engineering:
   • LangGraph, LangChain, MCP    [████████████] Expert
   • RAG Pipelines & Retrieval    [████████████] Expert
   • PyTorch & Deep Learning      [████████████] Expert
   • Gemini, GPT-4, LLM APIs      [████████████] Expert
   • Multi-Agent Systems          [████████████] Expert
   • Agentic Patterns (ReAct)     [███████████░] Expert

🏗️  System Architecture:
   • Microservices & Event-Driven [████████████] Expert
   • FastAPI & Backend Systems    [████████████] Expert
   • PostgreSQL, MongoDB, Redis   [████████████] Expert
   • Cloud-Native Architecture    [████████████] Expert

☁️  DevOps & Cloud:
   • Docker/Kubernetes            [████████████] Expert
   • GCP, AWS                     [███████████░] Expert
   • CI/CD (GitHub Actions)       [████████████] Expert
   • BigQuery & Data Engineering  [████████████] Expert

💻 Full-Stack Development:
   • Python (Advanced)            [████████████] Expert
   • React, TypeScript, Next.js   [██████████░░] Advanced
   • ETL Pipelines                [████████████] Expert

👨‍🏫 Leadership & Education:
   • Technical Mentoring          [████████████] Expert
   • Course Design                [████████████] Expert
   • Team Leadership              [████████████] Expert
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,

    contact: () => `Contact Information:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${contactCard()}

Available for:
• AI/ML systems architecture & consulting
• Agentic workflow design & implementation
• Production RAG pipeline development
• Technical leadership & mentoring
• Speaking engagements & workshops`,

    projects: () => `Featured Projects:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🤖 Proactive AI Agent (RAG Prototype)
   95% retrieval precision (from 30%)
   <1.2s latency • 100 concurrent users
   ChromaDB • Gemini 2.0 • MCP Servers

🚀 SaleSphereAI (Multi-Agent Platform)
   200% sales conversion increase
   5-agent system • LangGraph orchestration
   FastAPI • PostgreSQL • Redis

📄 Resume Parsing Platform (HR Tech)
   93% F1 score • 75% time-to-hire reduction
   PyTorch • Gemini API • LlamaIndex
   10K+ resumes processed monthly

🏠 Property Valuation (PropTech)
   94% accuracy • 100M+ records • GCP
   BigQuery • ×50 faster data loading
   500K+ properties valued

📚 Agentic Research Assistant
   200+ papers analyzed in <30 min
   LangGraph • ChromaDB • PyMuPDF
   88% extraction accuracy

🐍 Automated Python Course
   ${displayUrl(PROJECT_LINKS.pythonCourse)}
   1000+ students • 25+ modules
   CI/CD grading • Open source`,

    about: () => `About ${IDENTITY.name}:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👨‍💻 AI/ML Systems Engineer | Agentic Architect
🎓 MLX Applied Machine Learning Graduate
📊 10+ years building production AI systems
📍 Based in ${IDENTITY.location}

Mission: Democratizing AI/ML education through
hands-on platforms and production-grade systems.

Current Focus: Architecting agentic workflows,
RAG pipelines, and YuriODev educational platform.

Track Record:
• 95% retrieval precision (from 30% baseline)
• ×50 data latency reduction (PropTech)
• >90% F1 on production models
• 200% sales conversion (SaleSphereAI)
• 1000+ students reached globally

Specialization: Agentic systems (LangGraph, MCP),
production RAG pipelines, multi-agent orchestration,
cloud-native ML platforms.`,

    experience: () => `Career Highlights:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💼 Lead AI Engineer & Systems Designer
   Apr 2022 - Present | Independent (Consultant)
   • Built RAG systems with 95% precision
   • Architected multi-agent platforms
   • Deployed HR Tech & PropTech ML systems
   • Consulted for JPMorgan, Bloomberg

💼 Lead Data Scientist
   Mar 2022 - Oct 2022 | Ministry of Health Ukraine
   • Healthcare analytics (>90% F1 score)
   • GDPR-compliant ML pipelines
   • Millions of patient records processed

💼 Senior ML Engineer
   Jan 2021 - Feb 2022 | Forecys (FinTech)
   • Financial forecasting models
   • Real-time fraud detection
   • 60% latency reduction

💼 Technical Lead & Mentor
   Sep 2014 - Present | YuriODev Initiative
   • Created 25+ module Python course
   • 1000+ students across 20+ countries
   • Automated CI/CD grading system

Type 'education' for academic background`,

    education: () => `Education & Certifications:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎓 MLX Applied Machine Learning Certificate
   Apr 2025 - May 2025 | MLX Program
   Advanced ML systems, RAG, multi-agent workflows

🎓 MSc Artificial Intelligence
   2016 - 2018 | Queen Mary, University of London
   Deep Learning, NLP, Computer Vision
   Distinction with published research

🎓 BSc Computer Science
   2012 - 2016 | MIPT (Moscow Institute)
   Honors (GPA: 4.8/5.0)
   ACM ICPC regional medals

📚 Teaching Experience:
   • MIPT Instructor (2014-2016)
   • YuriODev Course Creator (2023-Present)
   • 1000+ students mentored

Type 'about' to see current focus areas`,

    surprise: () => `
    ╔══════════════════════════════════════╗
    ║        🎉 EASTER EGG UNLOCKED! 🎉     ║
    ╠══════════════════════════════════════╣
    ║                                      ║
    ║  You've discovered the secret menu!  ║
    ║                                      ║
    ║  🤖 AI Fact: RAG systems combine     ║
    ║     retrieval with generation for    ║
    ║     knowledge-grounded responses     ║
    ║                                      ║
    ║  🧠 Fun Fact: I improved retrieval   ║
    ║     precision from 30% to 95% using  ║
    ║     hybrid search strategies         ║
    ║                                      ║
    ║  🚀 Secret: Building agentic AI      ║
    ║     systems with LangGraph & MCP     ║
    ║     for production deployments       ║
    ║                                      ║
    ║  💡 Tip: Multi-agent systems can     ║
    ║     achieve 200%+ conversion gains   ║
    ║     with proper orchestration        ║
    ║                                      ║
    ╚══════════════════════════════════════╝

    Type 'help' to return to normal commands.`,

    whoami: () => `visitor@yuriodev
Current session: Guest user exploring YuriODev
Access level: Public portfolio viewer
Interested in: Production AI/ML systems & education
Type 'contact' to discuss collaboration! 🚀`,
} satisfies Record<string, () => string>;


// ---------------------------------------------------------------------------
// Output lines
// ---------------------------------------------------------------------------

export type LineType = 'command' | 'output' | 'success' | 'error' | 'warning' | 'info' | 'comment';

export interface TerminalLine {
    readonly text: string;
    readonly type: LineType;
}

const line = (text: string, type: LineType): TerminalLine => ({ text, type });

/** A blank line keeps its height in the output. */
const BLANK = ' ';

/** The colour of one line of plain-text output, from what it looks like. */
export function classifyLine(text: string): LineType {
    const lower = text.toLowerCase();
    const trimmed = text.trim();
    if (!trimmed) return 'output';
    if (text.startsWith('✓') || lower.includes('successfully') || lower.includes('complete')) return 'success';
    if (text.startsWith('✗') || lower.includes('error') || lower.includes('not found') || lower.includes('failed')) return 'error';
    if (text.startsWith('⚠') || lower.includes('warning') || lower.includes('note:')) return 'warning';
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) return 'comment';
    // Headers: rules and emoji-led section titles.
    if (text.includes('━') || isHeaderEmojiLine(text)) return 'info';
    // Addresses and links.
    if (text.includes('@') || text.includes('http') || text.includes('.com') || text.includes('.uk')
        || text.includes('github') || text.includes('linkedin')) return 'success';
    // Plain section titles ("Available commands:", "Technical Skills Matrix:").
    if (text.includes(':') && !text.includes('~$') && /^[A-Z]/.test(text)) return 'warning';
    // Progress bars and percentages.
    if (text.includes('█') || (text.includes('[') && text.includes(']')) || text.includes('%')) return 'success';
    // Box drawing (the surprise command).
    if (text.includes('╔') || text.includes('╠') || text.includes('╚') || text.includes('║')) return 'warning';
    // Bullets, dashes and arrows.
    if (text.includes('→') || text.includes('•') || text.includes('ℹ') || trimmed.startsWith('-') || trimmed.startsWith('◦')) return 'info';
    return 'output';
}

/** Plain-text output as typed lines. */
export function toLines(text: string): TerminalLine[] {
    if (!text) return [];
    return text.split('\n').map((t) => (t.trim() ? line(t, classifyLine(t)) : line(BLANK, 'output')));
}

// ---------------------------------------------------------------------------
// The command registry
// ---------------------------------------------------------------------------

/** What a command may use from the page around the terminal. */
export interface TerminalContext {
    readonly theme: Theme;
    readonly setTheme: (theme: Theme) => void;
}

/** Plain text (coloured line by line), typed lines, or the request to clear the screen. */
export type CommandOutput = string | readonly TerminalLine[] | { readonly clear: true };

export interface TerminalCommand {
    readonly name: string;
    readonly description: string;
    /** Values of the first argument, offered by Tab completion. */
    readonly argValues?: readonly string[];
    readonly run: (args: readonly string[], context: TerminalContext) => CommandOutput | Promise<CommandOutput>;
}

const THEMES: readonly Theme[] = ['dark', 'light'];

function themeCommand(args: readonly string[], { theme, setTheme }: TerminalContext): TerminalLine[] {
    const wanted = args[0]?.toLowerCase();
    if (!wanted) {
        return [line(`Current theme: ${theme}`, 'info'), line('Usage: theme dark | theme light', 'output')];
    }
    if (!THEMES.includes(wanted as Theme)) {
        return [line(`Unknown theme "${args[0]}". Usage: theme dark | theme light`, 'error')];
    }
    if (wanted === theme) return [line(`The theme is already ${theme}.`, 'info')];
    setTheme(wanted as Theme);
    return [line(`Theme switched to ${wanted}.`, 'success')];
}

function socialsLines(): TerminalLine[] {
    const width = Math.max(...SOCIALS.map(({ shortLabel }) => shortLabel.length)) + 2;
    return [
        line('Profiles:', 'warning'),
        line('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info'),
        ...SOCIALS.map(({ shortLabel, url }) => line(`${`${shortLabel}:`.padEnd(width)}${displayUrl(url)}`, 'success')),
    ];
}

function sectionsText(): string {
    return [
        'Sections of this page (the header menu and the palette jump to them):',
        ...SECTIONS.map(({ navLabel, label, optional }) => `  ${navLabel.padEnd(18)}${label}${optional ? '*' : ''}`),
        ...(SECTIONS.some(({ optional }) => optional) ? ['* Only while there is something to show.'] : []),
    ].join('\n');
}

/** Same origin: the proxy routes /api/ to the backend in every environment. */
export const HEALTH_URL = '/api/health';
const STATUS_TIMEOUT_MS = 5000;

/** A git SHA shortened to 7 characters; anything else is shown as it is, capped. */
function shortRevision(revision: string): string {
    return /^[0-9a-f]{8,40}$/i.test(revision) ? revision.slice(0, 7) : revision.slice(0, 24);
}

function field(body: unknown, key: string): string | null {
    if (typeof body !== 'object' || body === null) return null;
    const value = (body as Record<string, unknown>)[key];
    return typeof value === 'string' && value ? value.slice(0, 64) : null;
}

async function statusCommand(): Promise<TerminalLine[]> {
    const unreachable = (why: string): TerminalLine[] => [
        line(`Could not reach the API (${why}).`, 'error'),
        line('The pages themselves are static and keep working; try again later.', 'comment'),
    ];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
    try {
        const response = await fetch(HEALTH_URL, {
            headers: { Accept: 'application/json' },
            cache: 'no-store',
            signal: controller.signal,
        });
        if (!response.ok) return unreachable(`HTTP ${response.status}`);
        let body: unknown;
        try {
            body = await response.json();
        } catch {
            // The 5 s limit can also run out while the body is still arriving.
            return unreachable(controller.signal.aborted ? 'no answer in 5 s' : 'the answer was not JSON');
        }
        const health = field(body, 'status');
        if (!health) return unreachable('the answer had no status');
        const environment = field(body, 'environment') ?? 'unknown';
        const revision = field(body, 'revision');
        // The verdict on its own line: its type adds a mark (✓ or ⚠) in front,
        // which would push it out of line with the padded columns below.
        return [
            health === 'healthy' ? line('The API is healthy.', 'success') : line(`The API reports: ${health}`, 'warning'),
            line(`Environment: ${environment}`, 'info'),
            line(`Revision:    ${revision ? shortRevision(revision) : 'unknown'}`, 'info'),
        ];
    } catch {
        return unreachable(controller.signal.aborted ? 'no answer in 5 s' : 'network error');
    } finally {
        clearTimeout(timer);
    }
}

/** How many posts `posts` lists. */
export const TERMINAL_POSTS = 5;

/** The latest posts: each one's first line, then its link. */
async function postsCommand(): Promise<TerminalLine[]> {
    const feed = (await getPosts())?.feed;
    if (!feed?.enabled || feed.items.length === 0) {
        return [line('No posts yet.', 'info')];
    }
    return [
        line('Latest posts:', 'warning'),
        line('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info'),
        ...feed.items.slice(0, TERMINAL_POSTS).flatMap((item, i) => {
            const { variant } = primaryVariant(item);
            return [
                line(`${i + 1}. ${truncate(firstLine(variant.parts[0]), 60)}`, 'output'),
                line(`   ${displayUrl(variant.url)}`, 'success'),
            ];
        }),
    ];
}

type CommandDef = Omit<TerminalCommand, 'name'>;

/** Keyed by command name, in the order `help` and the help panel list them. */
const REGISTRY = {
    help: { description: 'Show this help message', run: () => helpText() },
    skills: { description: 'Display technical skills and expertise', run: TEXT.skills },
    contact: { description: 'Show contact information', run: TEXT.contact },
    socials: { description: 'List every profile, with its link', run: socialsLines },
    projects: { description: 'List recent projects and research', run: TEXT.projects },
    about: { description: 'Display information about me', run: TEXT.about },
    experience: { description: 'Show career highlights', run: TEXT.experience },
    education: { description: 'Display education and certifications', run: TEXT.education },
    status: { description: 'Check the live API: environment and revision', run: statusCommand },
    posts: { description: 'List the latest posts from LinkedIn and X', run: postsCommand },
    theme: { description: 'Show or switch the theme: theme [dark|light]', argValues: THEMES, run: themeCommand },
    ls: { description: 'List the sections of this page', run: sectionsText },
    whoami: { description: 'Display current user info', run: TEXT.whoami },
    surprise: { description: 'Easter egg command', run: TEXT.surprise },
    clear: { description: 'Clear terminal output', run: () => ({ clear: true }) as const },
} satisfies Record<string, CommandDef>;

export const TERMINAL_COMMANDS: readonly TerminalCommand[] = Object.entries(REGISTRY).map(
    ([name, command]: [string, CommandDef]) => ({ name, ...command }),
);

// A Map, not an object: typed names such as 'constructor' or '__proto__'
// must be unknown commands, never Object internals.
const BY_NAME: ReadonlyMap<string, TerminalCommand> = new Map(TERMINAL_COMMANDS.map((c) => [c.name, c]));

export function findCommand(name: string): TerminalCommand | undefined {
    return BY_NAME.get(name);
}

function helpText(): string {
    return [
        'Available commands:',
        ...TERMINAL_COMMANDS.map(({ name, description }) => `${name.padEnd(10)} - ${description}`),
    ].join('\n');
}

// ---------------------------------------------------------------------------
// Running a line
// ---------------------------------------------------------------------------

export type Execution = { readonly kind: 'lines'; readonly lines: readonly TerminalLine[] } | { readonly kind: 'clear' };

/** The words of a command line: the command name (lower case), then its arguments. */
export function tokenize(input: string): string[] {
    const words = input.trim().split(/\s+/).filter(Boolean);
    if (words.length > 0) words[0] = words[0].toLowerCase();
    return words;
}

function toExecution(output: CommandOutput): Execution {
    if (typeof output === 'string') return { kind: 'lines', lines: toLines(output) };
    if ('clear' in output) return { kind: 'clear' };
    return { kind: 'lines', lines: output };
}

/**
 * Runs one command line. Synchronous commands answer synchronously (the
 * output appears in the same render as the typed line); `status` returns a
 * promise.
 */
export function execute(input: string, context: TerminalContext): Execution | Promise<Execution> {
    const [name, ...args] = tokenize(input);
    if (!name) return { kind: 'lines', lines: [] };
    const command = findCommand(name);
    if (!command) {
        return { kind: 'lines', lines: [line(`Command not found: ${name}. Type "help" for available commands.`, 'error')] };
    }
    const output = command.run(args, context);
    return output instanceof Promise ? output.then(toExecution) : toExecution(output);
}

// ---------------------------------------------------------------------------
// Tab completion
// ---------------------------------------------------------------------------

export interface Completion {
    /** The input after completion (unchanged when only the candidates can be shown). */
    readonly value: string;
    /** Every match, when more than one fits. */
    readonly candidates: readonly string[];
}

function commonPrefix(words: readonly string[]): string {
    let prefix = words[0] ?? '';
    for (const word of words) {
        while (!word.startsWith(prefix)) prefix = prefix.slice(0, -1);
    }
    return prefix;
}

function completeWord(typed: string, options: readonly string[], rebuild: (word: string) => string): Completion | null {
    const matches = options.filter((option) => option.startsWith(typed.toLowerCase()));
    if (matches.length === 0) return null;
    if (matches.length === 1) return { value: rebuild(matches[0]) + ' ', candidates: [] };
    const prefix = commonPrefix(matches);
    return { value: rebuild(prefix.length > typed.length ? prefix : typed), candidates: matches };
}

/**
 * Tab completion for the command name, or for the first argument of a
 * command that lists its values. Null when there is nothing to complete, so
 * Tab can move focus on as usual.
 */
export function complete(input: string): Completion | null {
    const leading = input.match(/^\s*/)?.[0] ?? '';
    const rest = input.slice(leading.length);
    if (!rest) return null;
    const words = rest.split(/\s+/);
    if (words.length === 1) {
        return completeWord(words[0], TERMINAL_COMMANDS.map(({ name }) => name), (word) => leading + word);
    }
    if (words.length === 2) {
        const command = findCommand(words[0].toLowerCase());
        if (!command?.argValues) return null;
        const head = rest.slice(0, rest.length - words[1].length);
        return completeWord(words[1], command.argValues, (word) => leading + head + word);
    }
    return null;
}
