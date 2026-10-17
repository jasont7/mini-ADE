import { pcm16ToFloat } from '@/modules/chat/utils/pcmAudio';

/** Gapless player for the 24 kHz PCM chunks Gemini streams back. */
export type GeminiAudioPlayer = {
  enqueue(pcm: Int16Array): void;
  /** Cuts all queued and playing audio at once. Used for barge-in. */
  stop(): void;
  /** Calls back once when everything queued has finished playing. */
  onDrained(callback: () => void): void;
  close(): void;
};

/**
 * Creates the player used by the Gemini live hook. Chunks are scheduled back
 * to back on one AudioContext, and every source is tracked so `stop` can cut
 * them all within a frame.
 */
export function createGeminiAudioPlayer(sampleRate: number): GeminiAudioPlayer {
  const context = new AudioContext({ sampleRate });
  const active = new Set<AudioBufferSourceNode>();
  let nextStart = 0;
  let drained: (() => void) | null = null;

  const settle = () => {
    if (active.size === 0 && drained) {
      const callback = drained;
      drained = null;
      callback();
    }
  };

  return {
    enqueue(pcm) {
      if (context.state === 'suspended') void context.resume();
      const floats = pcm16ToFloat(pcm);
      const buffer = context.createBuffer(1, floats.length, sampleRate);
      buffer.copyToChannel(floats, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      nextStart = Math.max(nextStart, context.currentTime + 0.02);
      source.start(nextStart);
      nextStart += buffer.duration;
      active.add(source);
      source.onended = () => {
        active.delete(source);
        settle();
      };
    },

    stop() {
      for (const source of active) {
        source.onended = null;
        try {
          source.stop();
        } catch {
          /* already stopped */
        }
      }
      active.clear();
      nextStart = 0;
      settle();
    },

    onDrained(callback) {
      drained = callback;
      settle();
    },

    close() {
      drained = null;
      for (const source of active) source.onended = null;
      active.clear();
      void context.close();
    },
  };
}
