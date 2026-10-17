const MAX_SENTENCES = 4;

/**
 * Turns a Claude reply into what is read aloud: no code blocks, URLs or
 * markdown symbols, and at most four sentences. Used by Private live before
 * text to speech, and by Gemini live for the tool result it hands the front.
 */
export function toSpeakableText(markdown: string, maxChars = 600): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/[*_~>|]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?])/g, '$1')
    .trim();

  const sentences = plain.split(/(?<=[.!?])\s+/);
  let spoken = sentences.slice(0, MAX_SENTENCES).join(' ').trim();
  if (spoken.length > maxChars) {
    const cut = spoken.slice(0, maxChars);
    const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    spoken = (lastStop > maxChars / 2 ? cut.slice(0, lastStop + 1) : cut).trim();
  }
  return spoken;
}
