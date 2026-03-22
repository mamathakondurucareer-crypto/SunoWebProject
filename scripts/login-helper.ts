/**
 * Interactive login helper — opens a browser for each service
 * so you can log in and save the session to the persistent profile.
 *
 * Usage (outside Docker, headful):
 *   PLAYWRIGHT_HEADLESS=false tsx scripts/login-helper.ts
 *
 * Usage (Docker with X11 forwarding):
 *   DISPLAY=:0 PLAYWRIGHT_HEADLESS=false docker compose run --rm login-helper
 */

import { chromium } from 'playwright';
import * as readline from 'readline';
import path from 'path';
import fs from 'fs';
import { runMigrations } from '@/lib/db/migrate';
import { browserProfilesRepo } from '@/lib/db/repositories/browser-profiles';
import type { ServiceName } from '@/types';

const SERVICES: Array<{ name: ServiceName; url: string; instructions: string }> = [
  {
    name: 'gemini',
    url: 'https://gemini.google.com/app',
    instructions: 'Sign in with your Google account',
  },
  {
    name: 'chatgpt',
    url: 'https://chat.openai.com',
    instructions: 'Sign in with your OpenAI account',
  },
  {
    name: 'suno',
    url: 'https://suno.com',
    instructions: 'Sign in with your Suno account',
  },
  {
    name: 'grok',
    url: 'https://grok.com',
    instructions: 'Sign in with your xAI account (Grok access required)',
  },
  {
    name: 'canva',
    url: 'https://www.canva.com',
    instructions: 'Sign in with your Canva account',
  },
];

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

async function loginToService(name: ServiceName, url: string, instructions: string, profilePath: string): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Service: ${name.toUpperCase()}`);
  console.log(`Instructions: ${instructions}`);
  console.log(`Profile: ${profilePath}`);
  console.log('='.repeat(60));

  fs.mkdirSync(profilePath, { recursive: true });

  // Use real Chrome if available — Google/OpenAI block Playwright's Chromium
  // as an automated browser during OAuth flows.
  const systemChrome =
    process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : process.platform === 'linux'
        ? '/usr/bin/google-chrome'
        : undefined;
  const executablePath = systemChrome && fs.existsSync(systemChrome) ? systemChrome : undefined;

  const context = await chromium.launchPersistentContext(profilePath, {
    headless: false,
    slowMo: 100,
    viewport: { width: 1280, height: 900 },
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const page = await context.newPage();
  await page.goto(url);

  console.log(`\nBrowser opened at ${url}`);
  console.log('Please log in manually, then press Enter when done...');

  await prompt('Press Enter when logged in > ');

  await context.close();

  // Mark as connected in DB
  const profile = browserProfilesRepo.upsert(name);
  browserProfilesRepo.markConnected(profile.id, true);

  console.log(`✓ ${name} profile saved and marked as connected`);
}

async function main(): Promise<void> {
  runMigrations();

  console.log('Devotional Workflow — Browser Login Helper');
  console.log('==========================================');
  console.log('This tool opens a browser for each service so you can log in.');
  console.log('Sessions are saved to persistent profiles for the worker to use.\n');

  const services = await prompt(`Which services to log in? (all / gemini,chatgpt,suno,grok,canva): `);
  const serviceList = services.trim().toLowerCase() === 'all'
    ? SERVICES
    : SERVICES.filter(s => services.includes(s.name));

  if (serviceList.length === 0) {
    console.log('No services selected.');
    process.exit(0);
  }

  const profilesDir = process.env.BROWSER_PROFILES_DIR ?? path.join(process.cwd(), 'data', 'browser-profiles');

  for (const service of serviceList) {
    const profilePath = path.join(profilesDir, service.name);
    await loginToService(service.name, service.url, service.instructions, profilePath);
  }

  console.log('\n✓ All selected services logged in successfully!');
  console.log('You can now start the worker and it will use these sessions.');
  process.exit(0);
}

main().catch(err => {
  console.error('Login helper error:', err);
  process.exit(1);
});
