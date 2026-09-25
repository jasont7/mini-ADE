import { execFile, spawn } from 'node:child_process';

import express from 'express';

const LAUNCHD_LABEL = 'com.jason.ade';

const router = express.Router();

// Running chats are `claude` child processes of this server.
router.get('/status', (_req, res) => {
  execFile('pgrep', ['-P', String(process.pid), 'claude'], (_error, stdout) => {
    const runningSessions = stdout.split('\n').filter(Boolean).length;
    res.json({ runningSessions });
  });
});

// `launchctl kickstart -k` kills this server and its process group, so run it
// detached (own session) or it dies before the restart request lands.
router.post('/restart', (_req, res) => {
  res.json({ success: true });
  res.on('finish', () => {
    setTimeout(() => {
      spawn('launchctl', ['kickstart', '-k', `gui/${process.getuid?.()}/${LAUNCHD_LABEL}`], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    }, 300);
  });
});

export default router;
