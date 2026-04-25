import type { ArtifactTemplateId } from '../types';

export interface ArtifactTemplate {
  id: ArtifactTemplateId;
  label: string;
  description: string;
  /** Token budget — long-form artifacts need more headroom than chat replies. */
  maxTokens: number;
  /**
   * The user-message instruction sent to Claude. Connected sources are
   * available as XML-tagged context in the system prompt; this template
   * tells Claude what to *do* with them.
   */
  userInstructions: string;
}

/**
 * v1 templates. Tuned for content-marketing workflows: research → artifact.
 * Each one expects connected sources as context (Claude reads them from the
 * system prompt). Add new ones here — the rest of the artifact pipeline
 * picks them up automatically.
 */
export const TEMPLATES: ArtifactTemplate[] = [
  {
    id: 'youtube-script',
    label: 'YouTube script',
    description: 'Long-form YouTube video script with hook, sections, CTA',
    maxTokens: 6000,
    userInstructions: `Write a YouTube video script using the connected sources as research material.

Structure:
- HOOK (first 5-10 seconds): an attention-grabbing opener that makes viewers want to keep watching. Pattern interrupt, bold claim, or curiosity gap.
- INTRO (10-20 seconds): establish what the video is about and what the viewer will learn.
- MAIN CONTENT (3-5 sections): each section should have a clear subheading, deliver one key point, and use specific examples or data from the sources. Include rough timestamps.
- CALL TO ACTION (last 10-20 seconds): tell viewers what to do next (subscribe, comment, watch another video, click a link).

Tone: conversational, energetic, written for spoken delivery. Use short sentences. Avoid corporate language. Pull specific quotes, claims, and examples from the connected sources.`,
  },
  {
    id: 'video-script',
    label: 'Short-form video script',
    description: 'Reels/TikTok/Shorts script: 30-60 seconds, punchy',
    maxTokens: 1500,
    userInstructions: `Write a script for a short-form video (30-60 seconds, suitable for Reels/TikTok/YouTube Shorts).

Structure:
- HOOK (0-3 seconds): one sentence that stops the scroll. Bold, surprising, or contrarian.
- PAYOFF (3-50 seconds): deliver on the hook with 2-4 quick beats. Use specifics from the connected sources.
- CTA (last 5-10 seconds): one clear ask (follow, comment, save).

Format: write it as on-screen text + voiceover, with timing markers. Punchy sentences. Cut everything that isn't essential. Aim for 130-180 spoken words total.`,
  },
  {
    id: 'lead-magnet',
    label: 'Lead magnet (guide)',
    description: 'Multi-section downloadable guide: cover, TOC, chapters, CTA',
    maxTokens: 8000,
    userInstructions: `Write a complete lead magnet — a downloadable guide that someone would trade their email for. Use the connected sources as your research base.

Structure:
1. COVER PAGE: title (specific, benefit-driven), subtitle, byline.
2. INTRODUCTION (200-300 words): the problem this guide solves and who it's for.
3. TABLE OF CONTENTS: 5-8 chapter titles.
4. CHAPTERS: each chapter should be 300-500 words with:
   - clear H2 heading
   - opening that frames the chapter's promise
   - 3-5 actionable points (use bullet lists, numbered steps, or short examples)
   - "key takeaway" box at the end
5. CONCLUSION (150-200 words): synthesize what the reader learned.
6. NEXT STEPS / CTA: one clear next action (book a call, buy a product, sign up for a course).

Tone: authoritative but warm. Use specific examples from the connected sources. Format with markdown headings, bullets, and bold text. Aim for ~2000-3000 words total.`,
  },
  {
    id: 'ad-copy',
    label: 'Ad copy variants',
    description: '3 angles × 3 lengths = 9 ad variations to test',
    maxTokens: 2500,
    userInstructions: `Generate ad copy variations using the connected sources for context (product details, customer pain points, competitive angles).

Produce 3 distinct angles. For each angle, write 3 length variations:
- SHORT (under 100 chars, suitable for headlines or display ads)
- MEDIUM (100-250 chars, suitable for social ads)
- LONG (250-500 chars, suitable for long-form social or email subject + preview)

Format the output as:
## Angle 1: [angle name — 2-4 words]
**Why this works:** [one sentence]
- Short: [copy]
- Medium: [copy]
- Long: [copy]

## Angle 2: [angle name]
[same format]

## Angle 3: [angle name]
[same format]

Make the angles meaningfully different — pain-led, aspiration-led, social-proof-led, contrarian, etc. Pull specific phrasing from the connected sources where possible.`,
  },
  {
    id: 'tweet-thread',
    label: 'Tweet/X thread',
    description: '8-12 tweet thread with hook tweet and CTA',
    maxTokens: 2000,
    userInstructions: `Write a Twitter/X thread of 8-12 tweets using the connected sources as research.

Rules:
- Tweet 1 must be a HOOK that compels readers to expand. Bold claim, story open, or unexpected question. Under 270 characters.
- Each subsequent tweet must add one specific idea or example. Don't pad. Each tweet must be able to stand alone.
- Use line breaks within tweets for readability.
- Tweet 8-12 should be the CTA: tell readers what to do next (follow, RT, click a link).
- Each tweet must be under 270 characters (leave room for a "/N" counter).

Format the output as:
1/ [tweet text]

2/ [tweet text]

...etc.`,
  },
  {
    id: 'blog-post',
    label: 'Blog post',
    description: 'SEO-friendly blog post: 1500-2500 words with H2 sections',
    maxTokens: 6000,
    userInstructions: `Write a comprehensive blog post (1500-2500 words) using the connected sources as research material.

Structure:
- TITLE: specific, benefit-driven, includes a keyword phrase someone would search for.
- META DESCRIPTION: 150-160 chars summarizing the article.
- INTRO (150-200 words): hook the reader, name the problem, promise the resolution.
- 4-6 BODY SECTIONS with H2 headings. Each section: 250-400 words. Use H3 subheadings, bullet lists, and short paragraphs.
- CONCLUSION (150-200 words): synthesize, restate the value, end with a CTA.

Write in a conversational but expert voice. Cite specific examples, quotes, or data from the connected sources. Format in markdown.`,
  },
  {
    id: 'email-sequence',
    label: 'Email sequence (3-email nurture)',
    description: 'Welcome → Value → Pitch sequence',
    maxTokens: 4000,
    userInstructions: `Write a 3-email nurture sequence using the connected sources for context.

Structure:
- EMAIL 1 — WELCOME (sent immediately): warmly greet, set expectations for what's coming, deliver one quick win.
- EMAIL 2 — VALUE (sent day 2): teach one specific lesson or insight from the connected sources. No pitch yet.
- EMAIL 3 — PITCH (sent day 4): make a specific offer. Reference the value from email 2. One clear CTA.

For each email, provide:
**Subject line:** [short, curiosity-driven, under 50 chars]
**Preview text:** [continuation of the subject, under 90 chars]
**Body:** [200-400 words, conversational, single CTA at the end]

Tone: written like a real person, not a marketing department. Short paragraphs. Use the connected sources as your evidence base for claims.`,
  },
  {
    id: 'linkedin-post',
    label: 'LinkedIn post',
    description: 'Single LinkedIn post: hook + insight + CTA',
    maxTokens: 1500,
    userInstructions: `Write a LinkedIn post (200-400 words) using the connected sources as your raw material.

Structure:
- LINE 1: a hook that makes someone stop scrolling. Bold claim, contrarian take, story open, or surprising data point.
- LINES 2-3: one-line per line, build curiosity, lead to the meat.
- BODY: deliver the insight in short paragraphs (1-3 lines each). Use specifics from the sources. Format with line breaks for scannability.
- CLOSER: one takeaway sentence, then a CTA (a question to invite comments works well).

Tone: confident, specific, no jargon, no humblebrag. Avoid words like "synergy", "leverage", "ecosystem". Write like you're DMing a smart friend.`,
  },
  {
    id: 'custom',
    label: 'Custom prompt',
    description: 'Write your own instructions',
    maxTokens: 4000,
    userInstructions: '', // populated from ArtifactNodeData.customInstructions
  },
];

export function getTemplate(id: ArtifactTemplateId): ArtifactTemplate {
  const t = TEMPLATES.find((t) => t.id === id);
  if (!t) throw new Error(`Unknown artifact template: ${id}`);
  return t;
}
