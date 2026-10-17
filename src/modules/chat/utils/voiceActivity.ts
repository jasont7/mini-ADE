/** Tuning for the energy based voice activity detector. */
export type VoiceActivityConfig = {
  /** Speech must exceed this RMS no matter how quiet the room is. */
  minRms: number;
  /** Speech must exceed the tracked noise floor times this ratio. */
  floorRatio: number;
  /** Consecutive loud audio needed to report speech start. Keeps barge-in well under 300 ms. */
  startMs: number;
  /** Consecutive quiet audio needed to end an utterance. */
  endMs: number;
  /** Audio at the start that only calibrates the noise floor, so a noisy room is not taken for speech. */
  calibrationMs: number;
};

/** Defaults tuned for a laptop or phone mic with echo cancellation. */
export const DEFAULT_VOICE_ACTIVITY_CONFIG: VoiceActivityConfig = {
  minRms: 0.015,
  floorRatio: 3,
  startMs: 60,
  endMs: 900,
  calibrationMs: 400,
};

/** Transition reported by the detector for one audio frame. */
export type VoiceActivityEvent =
  | { type: 'start' }
  | { type: 'end'; speechMs: number };

/** Stateful detector fed with one RMS value per audio frame. */
export type VoiceActivityDetector = {
  push(rms: number, frameMs: number): VoiceActivityEvent | null;
  reset(): void;
};

const FLOOR_SMOOTHING = 0.05;

/**
 * Creates the voice activity detector used by Private live to cut utterances
 * and to detect barge-in, and by Gemini live to feed the idle timeout. It
 * tracks a slowly adapting noise floor while nobody speaks so a noisy room
 * does not read as speech. Pure apart from its own state, so it is unit tested
 * with synthetic frames.
 */
export function createVoiceActivityDetector(
  config: VoiceActivityConfig = DEFAULT_VOICE_ACTIVITY_CONFIG,
): VoiceActivityDetector {
  let floor = 0;
  let speaking = false;
  let loudMs = 0;
  let quietMs = 0;
  let speechMs = 0;
  let heardMs = 0;

  return {
    push(rms, frameMs) {
      heardMs += frameMs;
      const calibrating = heardMs <= config.calibrationMs;
      const threshold = Math.max(config.minRms, floor * config.floorRatio);
      const loud = !calibrating && rms > threshold;

      if (!speaking) {
        // Only quiet frames teach the floor after calibration, so speech cannot raise it.
        if (calibrating) {
          // The minimum, not the mean, so speech in the first moments cannot teach the floor.
          floor = floor === 0 ? rms : Math.min(floor, rms);
        } else if (!loud) {
          floor += (rms - floor) * FLOOR_SMOOTHING;
        }
        loudMs = loud ? loudMs + frameMs : 0;
        if (loudMs >= config.startMs) {
          speaking = true;
          speechMs = loudMs;
          quietMs = 0;
          return { type: 'start' };
        }
        return null;
      }

      speechMs += frameMs;
      quietMs = loud ? 0 : quietMs + frameMs;
      if (quietMs >= config.endMs) {
        const spoken = speechMs - quietMs;
        speaking = false;
        loudMs = 0;
        quietMs = 0;
        speechMs = 0;
        return { type: 'end', speechMs: spoken };
      }
      return null;
    },

    reset() {
      floor = 0;
      speaking = false;
      loudMs = 0;
      quietMs = 0;
      speechMs = 0;
      heardMs = 0;
    },
  };
}
