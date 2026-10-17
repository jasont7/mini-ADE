import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  ASK_CLAUDE_TOOL,
  buildAudioMessage,
  buildContextMessage,
  buildLiveSocketUrl,
  buildSetupMessage,
  buildToolResponse,
  createResumptionTracker,
  GEMINI_VOICE_PROMPT,
  parseServerMessage,
} from '@/modules/chat/utils/geminiLiveProtocol';

type Setup = {
  setup: {
    model: string;
    generationConfig: { speechConfig?: unknown };
    tools: Array<{ functionDeclarations: Array<Record<string, unknown>> }>;
    sessionResumption: { handle?: string };
  };
};

test('setup declares ask_claude as the only tool, with the voice and the persona', () => {
  const { setup } = buildSetupMessage({ model: 'gemini-3.8-live', voice: 'Kore', resumptionHandle: null, nonBlockingTools: false }) as Setup;
  assert.equal(setup.model, 'models/gemini-3.8-live');
  assert.deepEqual(setup.generationConfig.speechConfig, { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } });
  const declarations = setup.tools[0].functionDeclarations;
  assert.deepEqual(declarations.map((declaration) => declaration.name), [ASK_CLAUDE_TOOL]);
  assert.equal(declarations[0].behavior, undefined);
  assert.match(GEMINI_VOICE_PROMPT, /voice for one of Jason's mini-ADE sessions/);
  assert.match(GEMINI_VOICE_PROMPT, /short plain sentences/);
  assert.match(GEMINI_VOICE_PROMPT, /Never say something is done before a tool result/);
  assert.match(GEMINI_VOICE_PROMPT, /busy/);
});

test('the removed sidekick tools are gone from the setup and the prompt', () => {
  const { setup } = buildSetupMessage({ model: 'm', voice: null, resumptionHandle: null, nonBlockingTools: true }) as Setup;
  const text = JSON.stringify(setup) ;
  for (const name of ['list_sessions', 'read_session', 'ask_session', 'open_session']) assert.equal(text.includes(name), false, name);
});

test('ask_claude needs a request and takes no session', () => {
  const { setup } = buildSetupMessage({ model: 'm', voice: null, resumptionHandle: null, nonBlockingTools: false }) as Setup;
  const ask = setup.tools[0].functionDeclarations[0] as { parameters: { required: string[]; properties: Record<string, unknown> } };
  assert.deepEqual(ask.parameters.required, ['request']);
  assert.deepEqual(Object.keys(ask.parameters.properties), ['request']);
});

test('setup marks the tool non-blocking only when asked, and resumes with a handle', () => {
  const { setup } = buildSetupMessage({ model: 'models/x', voice: null, resumptionHandle: 'h1', nonBlockingTools: true }) as Setup;
  assert.equal(setup.model, 'models/x');
  assert.equal(setup.tools[0].functionDeclarations[0].behavior, 'NON_BLOCKING');
  assert.deepEqual(setup.sessionResumption, { handle: 'h1' });
  assert.equal(setup.generationConfig.speechConfig, undefined);
});

test('socket url carries only the ephemeral token', () => {
  assert.equal(
    buildLiveSocketUrl('auth_tokens/a b'),
    'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=auth_tokens%2Fa%20b',
  );
});

test('audio and tool response messages have the documented shape', () => {
  assert.deepEqual(buildAudioMessage('AAAA'), { realtimeInput: { audio: { data: 'AAAA', mimeType: 'audio/pcm;rate=16000' } } });
  assert.deepEqual(buildToolResponse({ id: 'c1', name: 'ask_claude' }, 'done', 'WHEN_IDLE'), {
    toolResponse: { functionResponses: [{ id: 'c1', name: 'ask_claude', response: { output: 'done' }, scheduling: 'WHEN_IDLE' }] },
  });
  const blocking = buildToolResponse({ id: 'c1', name: 'ask_claude' }, 'done', null) as { toolResponse: { functionResponses: Array<Record<string, unknown>> } };
  assert.equal('scheduling' in blocking.toolResponse.functionResponses[0], false);
});

test('parses audio, interruption, completion and transcripts from one message', () => {
  const events = parseServerMessage({
    serverContent: {
      modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'QQ==' } }] },
      outputTranscription: { text: 'hi' },
      interrupted: true,
      turnComplete: true,
    },
  });
  assert.deepEqual(events.map((event) => event.kind), ['interrupted', 'audio', 'outputTranscript', 'turnComplete']);
});

test('parses tool calls, cancellations, goAway and setupComplete', () => {
  assert.deepEqual(parseServerMessage({ setupComplete: {} }), [{ kind: 'setupComplete' }]);
  assert.deepEqual(
    parseServerMessage({ toolCall: { functionCalls: [{ id: 'c1', name: 'ask_claude', args: { request: 'list files' } }, { nope: 1 }] } }),
    [{ kind: 'toolCall', calls: [{ id: 'c1', name: 'ask_claude', args: { request: 'list files' } }] }],
  );
  assert.deepEqual(parseServerMessage({ toolCallCancellation: { ids: ['c1', 3] } }), [{ kind: 'toolCancel', ids: ['c1'] }]);
  assert.deepEqual(parseServerMessage({ goAway: { timeLeft: '50s' } }), [{ kind: 'goAway', timeLeftMs: 50_000 }]);
  assert.deepEqual(parseServerMessage('junk'), []);
  assert.deepEqual(parseServerMessage({ something: 'else' }), []);
});

test('resumption tracker keeps the newest handle and clears it when not resumable', () => {
  const tracker = createResumptionTracker();
  assert.equal(tracker.handle(), null);
  for (const event of parseServerMessage({ sessionResumptionUpdate: { newHandle: 'h1', resumable: true } })) tracker.apply(event);
  assert.equal(tracker.handle(), 'h1');
  for (const event of parseServerMessage({ sessionResumptionUpdate: { newHandle: 'h2', resumable: true } })) tracker.apply(event);
  assert.equal(tracker.handle(), 'h2');
  for (const event of parseServerMessage({ sessionResumptionUpdate: { resumable: false } })) tracker.apply(event);
  assert.equal(tracker.handle(), null);
});

test('a context message is a quiet text turn, and a spoken turn asks for a reply', () => {
  assert.deepEqual(buildContextMessage('Jason moved.', false), {
    clientContent: { turns: [{ role: 'user', parts: [{ text: 'Jason moved.' }] }], turnComplete: false },
  });
  assert.equal((buildContextMessage('Update: done.', true) as { clientContent: { turnComplete: boolean } }).clientContent.turnComplete, true);
});
