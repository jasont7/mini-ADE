/** A running microphone capture; `stop` releases the mic and the audio graph. */
export type MicCapture = { stop(): void; sampleRate: number };

/**
 * Opens the microphone and calls `onFrame` with mono float frames (about 20 ms
 * each at 48 kHz). Echo cancellation is requested so the reply playing through
 * the speakers does not read as the user speaking. Used by the Private and
 * Gemini live hooks. A ScriptProcessor is used because it works on every
 * browser the app targets, including iOS Safari, without a separate worklet file.
 */
export async function startMicCapture(onFrame: (samples: Float32Array) => void): Promise<MicCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const context = new AudioContext();
  if (context.state === 'suspended') await context.resume();

  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(1024, 1, 1);
  const silent = context.createGain();
  silent.gain.value = 0;

  processor.onaudioprocess = (event) => {
    // Copy: the browser reuses the input buffer after the callback returns.
    onFrame(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  // The processor only runs while connected to the destination; the zero gain keeps it silent.
  processor.connect(silent);
  silent.connect(context.destination);

  return {
    sampleRate: context.sampleRate,
    stop() {
      processor.onaudioprocess = null;
      source.disconnect();
      processor.disconnect();
      silent.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
    },
  };
}
