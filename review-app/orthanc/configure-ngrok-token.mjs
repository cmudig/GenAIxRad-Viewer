import { spawnSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

if (!process.stdin.isTTY) throw new Error('Run in an interactive terminal; never provide the token through chat.');
process.umask(0o077);
let token = '';
process.stdout.write('Paste your ngrok authtoken (hidden), then press Enter. Ctrl+C cancels: ');
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.resume();
function finish() {
  process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdout.write('\n');
}
process.stdin.on('data', chunk => {
  for (const character of chunk) {
    if (character === '\u0003' || character === '\u0004') {
      token = '';
      finish();
      process.exit(1);
    }
    if (character === '\r' || character === '\n') {
      finish();
      if (!token.trim()) { console.error('No token saved.'); process.exit(1); }
      // Capture CLI output so even an error cannot echo the token to logs.
      const result = spawnSync('ngrok', ['config', 'add-authtoken', token.trim()], { encoding: 'utf8' });
      token = '';
      if (result.status !== 0) { console.error('Token setup failed; inspect your ngrok account directly.'); process.exit(1); }
      chmodSync(join(homedir(), 'Library/Application Support/ngrok/ngrok.yml'), 0o600);
      console.log('Authtoken saved privately outside the repository. No tunnel started.');
      process.exit(0);
    }
    if (character === '\u007f' || character === '\b') token = token.slice(0, -1);
    else if (character >= ' ') token += character;
  }
});
