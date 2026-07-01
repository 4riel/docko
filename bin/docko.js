#!/usr/bin/env node

try {
  const { main } = await import('../packages/cli/dist/index.js');
  await main();
} catch (error) {
  if (
    error instanceof Error &&
    'code' in error &&
    error.code === 'ERR_MODULE_NOT_FOUND' &&
    error.message.includes('../packages/cli/dist/index.js')
  ) {
    process.stderr.write('docko CLI is not built yet. Run `pnpm build` first.\n');
    process.exit(1);
  }

  throw error;
}
