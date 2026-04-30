import type { ReactNode } from 'react';
import type { ArtifactTemplateId } from '@/lib/types';

/**
 * Brand-colored visual identity for each artifact template. Used by the
 * collapsed artifact card so the canvas reads as a recognizable row of
 * output destinations (YouTube red, LinkedIn blue, etc.) rather than a
 * grid of identical glass panels.
 */
export interface TemplateVisual {
  label: string;
  /** Brand-ish hex used for the icon chip background. */
  color: string;
  /** Foreground for the icon glyph (usually white, but a few brands invert). */
  iconColor: string;
  icon: ReactNode;
}

const ICON_PROPS = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'currentColor',
} as const;

export const TEMPLATE_VISUALS: Record<ArtifactTemplateId, TemplateVisual> = {
  'youtube-script': {
    label: 'YouTube Script',
    color: '#FF0033',
    iconColor: '#ffffff',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M23 7.5a3 3 0 0 0-2.1-2.1C19 5 12 5 12 5s-7 0-8.9.4A3 3 0 0 0 1 7.5C.6 9.4.6 12 .6 12s0 2.6.4 4.5a3 3 0 0 0 2.1 2.1C5 19 12 19 12 19s7 0 8.9-.4a3 3 0 0 0 2.1-2.1c.4-1.9.4-4.5.4-4.5s0-2.6-.4-4.5zM10 15.5v-7l6 3.5-6 3.5z" />
      </svg>
    ),
  },
  'video-script': {
    label: 'Short Video',
    color: '#FF2BD6',
    iconColor: '#ffffff',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM7 6h2v2H7V6zm0 4h2v2H7v-2zm0 4h2v2H7v-2zm10 2h-6v-2h6v2zm0-4h-6v-2h6v2zm0-4h-6V6h6v2zm-2-1.5L17 8l-2 1.5v-3z" />
      </svg>
    ),
  },
  'lead-magnet': {
    label: 'Lead Magnet',
    color: '#F59E0B',
    iconColor: '#ffffff',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M19 2H8a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h11a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1zM8 4h10v12H8a2 2 0 0 0-1 .3V4zm0 16a1 1 0 1 1 0-2h10v2H8z" />
      </svg>
    ),
  },
  'ad-copy': {
    label: 'Ad Copy',
    color: '#A78BFA',
    iconColor: '#ffffff',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M3 10v4a1 1 0 0 0 1 1h2l4 4V5L6 9H4a1 1 0 0 0-1 1zm13.5 2c0-1.5-.8-2.8-2-3.5v7c1.2-.7 2-2 2-3.5zM14.5 4v2.1c2.9.9 5 3.6 5 6.9s-2.1 6-5 6.9V22c4-1 7-4.6 7-9s-3-8-7-9z" />
      </svg>
    ),
  },
  'tweet-thread': {
    label: 'Twitter Post',
    color: '#0F1419',
    iconColor: '#ffffff',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
  'blog-post': {
    label: 'Blog Article',
    color: '#10B981',
    iconColor: '#ffffff',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM7 7h10v2H7V7zm0 4h10v2H7v-2zm0 4h7v2H7v-2z" />
      </svg>
    ),
  },
  'email-sequence': {
    label: 'Email Sequence',
    color: '#3B82F6',
    iconColor: '#ffffff',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z" />
      </svg>
    ),
  },
  'linkedin-post': {
    label: 'LinkedIn Post',
    color: '#0A66C2',
    iconColor: '#ffffff',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM8.34 17.34H5.67V9.67h2.67v7.67zM7 8.5a1.55 1.55 0 1 1 0-3.1 1.55 1.55 0 0 1 0 3.1zm11.34 8.84h-2.67v-3.73c0-.89-.02-2.04-1.24-2.04-1.24 0-1.43.97-1.43 1.97v3.8H10.34V9.67h2.56v1.05h.04c.36-.68 1.23-1.39 2.53-1.39 2.71 0 3.21 1.78 3.21 4.1v3.91z" />
      </svg>
    ),
  },
  custom: {
    label: 'Custom',
    color: '#00E5FF',
    iconColor: '#050310',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M12 2 9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z" />
      </svg>
    ),
  },
};

export function getTemplateVisual(id: ArtifactTemplateId | undefined): TemplateVisual {
  return TEMPLATE_VISUALS[id ?? 'custom'] ?? TEMPLATE_VISUALS.custom;
}

/**
 * Small colored chip used in the collapsed card and (optionally) the
 * expanded header. Shown as a rounded square with the brand color as
 * background and the icon glyph centered.
 */
export function TemplateIconChip({
  templateId,
  size = 32,
}: {
  templateId: ArtifactTemplateId | undefined;
  size?: number;
}) {
  const v = getTemplateVisual(templateId);
  return (
    <span
      className="flex items-center justify-center rounded-lg flex-shrink-0"
      style={{
        width: size,
        height: size,
        background: v.color,
        color: v.iconColor,
        boxShadow: `0 0 12px -3px ${v.color}aa`,
      }}
      aria-hidden
    >
      {v.icon}
    </span>
  );
}
