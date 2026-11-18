#!/usr/bin/env node
// Stands in for `occ remote --print-env` in unit tests: prints bindings in occ's format and holds until SIGINT.
const args = process.argv.slice(2);
if (process.env.FAKE_OCC_FAIL) {
  process.stderr.write('Error: resolve dependencies: forbidden\n');
  process.exit(1);
}
process.stdout.write('Resolving dependencies for development...\n');
setTimeout(() => {
  process.stdout.write('\nEnvironment bindings:\n');
  process.stdout.write('  export DB_HOST=127.0.0.1\n  export DB_PORT=54321\n');
  process.stdout.write(args.includes('--show-secrets') ? '  export DB_PASSWORD=s3cret\n' : '  export DB_PASSWORD=<hidden; pass --show-secrets to print it>\n');
  process.stdout.write(`  export ARGS=${JSON.stringify(args.join(' '))}\n`);
  process.stdout.write('\nTunnels open. The session renews automatically; press Ctrl-C to disconnect.\n');
}, 100);
process.on('SIGINT', () => process.exit(0));
setInterval(() => {}, 1000);
