import { execFileSync } from 'node:child_process';
const { queryClaudeSDK } = await import(new URL('../../dist-server/', import.meta.url).href + 'server/modules/providers/list/claude/claude-runtime.provider.js');

const cwd = '/tmp/one-proc-test';
const appId = 'one-proc-test-' + Date.now();
let providerId = null;
const ctx = {
  resolveProviderSessionId: () => providerId,
  resolveResumeModel: async (_s, m) => m,
  getProviderModels: async () => { throw new Error('skip'); },
  normalizeMessage: (msg) => [{ kind: msg.type, raw: msg }],
  isProviderInstalled: async () => true,
};
function writer(name) {
  const w = { name, events: [], completes: 0, texts: [], userId: null,
    send(m) {
      this.events.push(m);
      if (m?.kind === 'complete' || m?.type === 'complete') this.completes++;
      const raw = m?.raw;
      if (raw?.type === 'assistant') for (const c of raw.message?.content || []) if (c.type === 'text') this.texts.push(c.text);
    },
    setSessionId(id) { providerId = id; } };
  return w;
}
const cliChildren = () => {
  try { return execFileSync('pgrep', ['-P', String(process.pid)], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).length; }
  catch { return 0; }
};
const waitFor = async (pred, ms, label) => {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout: ' + label); await new Promise(r => setTimeout(r, 250)); }
};
const opts = (extra) => ({ sessionId: appId, cwd, permissionMode: 'bypassPermissions',
  toolsSettings: { allowedTools: [], disallowedTools: [], skipPermissions: true }, ...extra });

const w1 = writer('turn1');
const run1 = queryClaudeSDK(
  'Use the Bash tool with run_in_background set to true to run exactly: sleep 40. Do not wait for it. Then reply with exactly the word: started',
  opts({}), w1, ctx);
await waitFor(() => w1.completes > 0, 180000, 'turn 1 complete');
const procsAfterTurn1 = cliChildren();

const w2 = writer('turn2');
const t2 = Date.now();
let maxProcsDuringTurn2 = 0;
const sampler = setInterval(() => { maxProcsDuringTurn2 = Math.max(maxProcsDuringTurn2, cliChildren()); }, 200);
await queryClaudeSDK('Reply with exactly the word: second', opts({}), w2, ctx);
clearInterval(sampler);

console.log(JSON.stringify({
  turn1Text: w1.texts.join(' ').slice(0, 80),
  cliProcessesHeldAfterTurn1: procsAfterTurn1,
  maxCliProcessesDuringTurn2: maxProcsDuringTurn2,
  turn2Completed: w2.completes > 0,
  turn2Text: w2.texts.join(' ').slice(0, 80),
  turn2Seconds: +((Date.now() - t2) / 1000).toFixed(1),
  turn1WriterGotTurn2Events: w1.texts.join(' ').includes('second'),
}, null, 2));
try { execFileSync('pkill', ['-P', String(process.pid)]); } catch {}
process.exit(0);
