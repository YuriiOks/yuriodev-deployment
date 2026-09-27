import React from 'react';
import {
  ArrowUpRight,
  Bookmark,
  BookOpen,
  Bot,
  Brain,
  Briefcase,
  CircleCheck,
  ClipboardList,
  Code2,
  Coffee,
  Construction,
  Dna,
  Dumbbell,
  Flag,
  FlaskConical,
  GraduationCap,
  Globe,
  Hand,
  Laptop,
  Lightbulb,
  Mail,
  MapPin,
  Moon,
  RefreshCw,
  Rocket,
  Scroll,
  Smartphone,
  Sparkles,
  Sun,
  Target,
  Trophy,
  Video,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/** Every glyph used across the site, keyed by a stable semantic name (not the
 * Lucide component name), so a rename upstream never touches call sites. */
const ICONS = {
  'arrow-up-right': ArrowUpRight,
  bookmark: Bookmark,
  'book-open': BookOpen,
  bot: Bot,
  brain: Brain,
  briefcase: Briefcase,
  'circle-check': CircleCheck,
  'clipboard-list': ClipboardList,
  'code': Code2,
  coffee: Coffee,
  construction: Construction,
  dna: Dna,
  dumbbell: Dumbbell,
  flag: Flag,
  flask: FlaskConical,
  globe: Globe,
  'graduation-cap': GraduationCap,
  hand: Hand,
  laptop: Laptop,
  lightbulb: Lightbulb,
  mail: Mail,
  'map-pin': MapPin,
  moon: Moon,
  'refresh-cw': RefreshCw,
  rocket: Rocket,
  scroll: Scroll,
  smartphone: Smartphone,
  sparkles: Sparkles,
  sun: Sun,
  target: Target,
  trophy: Trophy,
  video: Video,
  x: X,
  zap: Zap,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export interface IconProps extends Omit<React.SVGProps<SVGSVGElement>, 'name'> {
  /** Which glyph to draw. */
  name: IconName;
  /** An accessible name: makes the icon a labelled image instead of decoration (the default). */
  label?: string;
  /** The icon's own size, in any CSS length; default 1em (matches the surrounding text). */
  size?: string;
}

/**
 * One glyph from the Lucide set, sized in em so it scales with its
 * surrounding text and the page's fluid type (never px), nudged to sit on
 * the text baseline. Decorative by default (aria-hidden); pass `label` when
 * the icon is the only content naming a control (nothing else in the DOM
 * already says what it does).
 */
const Icon: React.FC<IconProps> = ({ name, label, size = '1em', style, ...rest }) => {
  const Glyph = ICONS[name];
  return (
    <Glyph
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
      strokeWidth={1.75}
      style={{ width: size, height: size, verticalAlign: '-0.15em', flexShrink: 0, ...style }}
      {...rest}
    />
  );
};

export default Icon;
