/** Prefix that marks a message as spoken, so Claude answers in short plain sentences. */
export const VOICE_MESSAGE_PREFIX = '[voice] ';

/**
 * Removes a leading `[voice]` tag from a transcript. The local speech server
 * already tags what it transcribes, and the bridge adds the tag itself, so
 * without this a spoken request would reach Claude as `[voice] [voice] ...`.
 * Used by Private live before sending a transcript.
 */
export function stripVoicePrefix(transcript: string): string {
  return transcript.replace(/^\s*\[voice\]\s*/i, '').trim();
}
