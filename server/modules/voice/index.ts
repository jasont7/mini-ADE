// voiceRoutes: used by the server entrypoint to mount authenticated STT/TTS endpoints.
export { voiceRoutes } from './voice.module.js';
// handleLiveDictationConnection: used by the websocket module's gateway to relay live dictation audio.
export { handleLiveDictationConnection } from './voice.module.js';
