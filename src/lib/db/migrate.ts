import { getDb } from './client';

// ─── Versioned Migrations ──────────────────────────────────────────────────
// Each migration is applied exactly once. The `schema_migrations` table tracks
// which have been applied. Add new migrations at the end — never edit existing ones.

const MIGRATIONS: { id: number; description: string; sql: string }[] = [
  {
    id: 1,
    description: 'Initial schema with CHECK constraints',
    sql: `
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        devotional_theme TEXT NOT NULL,
        target_language TEXT NOT NULL DEFAULT 'English',
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','queued','running','waiting_for_approval','retrying','completed','failed','cancelled')),
        current_stage TEXT,
        total_stages INTEGER NOT NULL DEFAULT 13,
        completed_stages INTEGER NOT NULL DEFAULT 0,
        config TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS stage_runs (
        id TEXT PRIMARY KEY,
        workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
        stage_key TEXT NOT NULL,
        stage_index INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','success','failed','skipped','awaiting_input')),
        attempt INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        input TEXT,
        output TEXT,
        error_message TEXT,
        screenshot_path TEXT,
        html_dump_path TEXT,
        started_at INTEGER,
        completed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_stage_runs_workflow_run_id ON stage_runs(workflow_run_id);
      CREATE INDEX IF NOT EXISTS idx_stage_runs_status ON stage_runs(status);

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed')),
        priority INTEGER NOT NULL DEFAULT 0,
        attempt INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        run_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        error TEXT,
        worker_id TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_status_run_at ON jobs(status, run_at);

      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
        stage_run_id TEXT REFERENCES stage_runs(id) ON DELETE SET NULL,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        asset_type TEXT NOT NULL CHECK(asset_type IN ('lyrics','audio','video','image','document','thumbnail','package','screenshot','html_dump','scene_plan','evaluation')),
        service TEXT,
        file_path TEXT NOT NULL,
        file_size INTEGER,
        mime_type TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_assets_workflow_run_id ON assets(workflow_run_id);
      CREATE INDEX IF NOT EXISTS idx_assets_project_id ON assets(project_id);

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
        stage_run_id TEXT REFERENCES stage_runs(id) ON DELETE SET NULL,
        approval_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
        options TEXT,
        selected_option TEXT,
        notes TEXT,
        requested_at INTEGER NOT NULL,
        resolved_at INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_approvals_workflow_run_id ON approvals(workflow_run_id);
      CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);

      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        schedule_type TEXT NOT NULL CHECK(schedule_type IN ('once','recurring')),
        cron_expression TEXT,
        run_at INTEGER,
        workflow_config TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','completed','cancelled')),
        last_run_at INTEGER,
        next_run_at INTEGER,
        run_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS browser_profiles (
        id TEXT PRIMARY KEY,
        service TEXT NOT NULL UNIQUE CHECK(service IN ('gemini','chatgpt','suno','sora','canva','capcut','local')),
        profile_path TEXT NOT NULL,
        is_connected INTEGER NOT NULL DEFAULT 0,
        last_login_at INTEGER,
        last_used_at INTEGER,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS selectors (
        id TEXT PRIMARY KEY,
        service TEXT NOT NULL,
        selector_key TEXT NOT NULL,
        selector_value TEXT NOT NULL,
        selector_type TEXT NOT NULL DEFAULT 'css' CHECK(selector_type IN ('css','xpath','text')),
        description TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        fallback_value TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(service, selector_key)
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        description TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS logs (
        id TEXT PRIMARY KEY,
        workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE CASCADE,
        stage_run_id TEXT REFERENCES stage_runs(id) ON DELETE CASCADE,
        level TEXT NOT NULL CHECK(level IN ('debug','info','warn','error')),
        message TEXT NOT NULL,
        context TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_logs_workflow_run_id ON logs(workflow_run_id);
      CREATE INDEX IF NOT EXISTS idx_logs_stage_run_id ON logs(stage_run_id);
      CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at);
    `,
  },
  {
    id: 2,
    description: 'Add version and fallback_value to selectors (for existing DBs)',
    sql: `
      -- Safe no-ops if columns already exist (SQLite ignores ADD COLUMN errors via try/catch in runner)
      ALTER TABLE selectors ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE selectors ADD COLUMN fallback_value TEXT;
    `,
  },
  {
    id: 3,
    description: 'Add attempt and max_attempts to jobs (for existing DBs)',
    sql: `
      ALTER TABLE jobs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE jobs ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3;
    `,
  },
  {
    id: 4,
    description: 'Rebuild workflow_runs and stage_runs with updated status CHECK constraints',
    sql: `
      PRAGMA foreign_keys = OFF;
      PRAGMA legacy_alter_table = ON;

      ALTER TABLE workflow_runs RENAME TO workflow_runs_old;
      CREATE TABLE workflow_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','queued','running','waiting_for_approval','retrying','completed','failed','cancelled')),
        current_stage TEXT,
        total_stages INTEGER NOT NULL DEFAULT 13,
        completed_stages INTEGER NOT NULL DEFAULT 0,
        config TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER
      );
      INSERT INTO workflow_runs SELECT
        id, project_id, name,
        CASE status
          WHEN 'pending' THEN 'draft'
          WHEN 'paused'  THEN 'waiting_for_approval'
          ELSE status
        END,
        current_stage, total_stages, completed_stages, config,
        created_at, updated_at, started_at, completed_at
      FROM workflow_runs_old;
      DROP TABLE workflow_runs_old;

      ALTER TABLE stage_runs RENAME TO stage_runs_old;
      CREATE TABLE stage_runs (
        id TEXT PRIMARY KEY,
        workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
        stage_key TEXT NOT NULL,
        stage_index INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','success','failed','skipped','awaiting_input')),
        attempt INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        input TEXT,
        output TEXT,
        error_message TEXT,
        screenshot_path TEXT,
        html_dump_path TEXT,
        started_at INTEGER,
        completed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO stage_runs SELECT
        id, workflow_run_id, stage_key, stage_index,
        CASE status
          WHEN 'queued'            THEN 'pending'
          WHEN 'completed'         THEN 'success'
          WHEN 'awaiting_approval' THEN 'awaiting_input'
          ELSE status
        END,
        attempt, max_attempts, input, output, error_message,
        screenshot_path, html_dump_path, started_at, completed_at,
        created_at, updated_at
      FROM stage_runs_old;
      DROP TABLE stage_runs_old;

      CREATE INDEX IF NOT EXISTS idx_stage_runs_workflow_run_id ON stage_runs(workflow_run_id);
      CREATE INDEX IF NOT EXISTS idx_stage_runs_status ON stage_runs(status);

      PRAGMA legacy_alter_table = OFF;
      PRAGMA foreign_keys = ON;
    `,
  },
  {
    id: 5,
    description: 'Add missed_run_policy, timezone, max_run_count to schedules',
    sql: `
      ALTER TABLE schedules ADD COLUMN missed_run_policy TEXT NOT NULL DEFAULT 'skip';
      ALTER TABLE schedules ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';
      ALTER TABLE schedules ADD COLUMN max_run_count INTEGER;
    `,
  },
  {
    id: 6,
    description: 'Replace sora with grok in browser_profiles CHECK constraint and selectors',
    sql: `
      PRAGMA foreign_keys = OFF;
      PRAGMA legacy_alter_table = ON;

      ALTER TABLE browser_profiles RENAME TO browser_profiles_old;
      CREATE TABLE browser_profiles (
        id TEXT PRIMARY KEY,
        service TEXT NOT NULL UNIQUE CHECK(service IN ('gemini','chatgpt','suno','grok','canva','capcut','local')),
        profile_path TEXT NOT NULL,
        is_connected INTEGER NOT NULL DEFAULT 0,
        last_login_at INTEGER,
        last_used_at INTEGER,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO browser_profiles SELECT * FROM browser_profiles_old WHERE service != 'sora';
      DROP TABLE browser_profiles_old;

      UPDATE selectors SET service = 'grok', id = 'grok_' || selector_key, updated_at = ${Date.now()} WHERE service = 'sora';

      PRAGMA legacy_alter_table = OFF;
      PRAGMA foreign_keys = ON;
    `,
  },
  {
    id: 7,
    description: 'Rebuild logs, assets, approvals with correct FK references (fix migration-4 rename side-effect)',
    sql: `
      PRAGMA foreign_keys = OFF;

      CREATE TABLE logs_new (
        id TEXT PRIMARY KEY,
        workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE CASCADE,
        stage_run_id TEXT REFERENCES stage_runs(id) ON DELETE CASCADE,
        level TEXT NOT NULL CHECK(level IN ('debug','info','warn','error')),
        message TEXT NOT NULL,
        context TEXT,
        created_at INTEGER NOT NULL
      );
      INSERT INTO logs_new SELECT * FROM logs;
      DROP TABLE logs;
      ALTER TABLE logs_new RENAME TO logs;
      CREATE INDEX IF NOT EXISTS idx_logs_workflow_run_id ON logs(workflow_run_id);
      CREATE INDEX IF NOT EXISTS idx_logs_stage_run_id ON logs(stage_run_id);
      CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at);

      CREATE TABLE assets_new (
        id TEXT PRIMARY KEY,
        workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
        stage_run_id TEXT REFERENCES stage_runs(id) ON DELETE SET NULL,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        asset_type TEXT NOT NULL CHECK(asset_type IN ('lyrics','audio','video','image','document','thumbnail','package','screenshot','html_dump','scene_plan','evaluation')),
        service TEXT,
        file_path TEXT NOT NULL,
        file_size INTEGER,
        mime_type TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL
      );
      INSERT INTO assets_new SELECT * FROM assets;
      DROP TABLE assets;
      ALTER TABLE assets_new RENAME TO assets;
      CREATE INDEX IF NOT EXISTS idx_assets_workflow_run_id ON assets(workflow_run_id);
      CREATE INDEX IF NOT EXISTS idx_assets_project_id ON assets(project_id);

      CREATE TABLE approvals_new (
        id TEXT PRIMARY KEY,
        workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
        stage_run_id TEXT REFERENCES stage_runs(id) ON DELETE SET NULL,
        approval_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
        options TEXT,
        selected_option TEXT,
        notes TEXT,
        requested_at INTEGER NOT NULL,
        resolved_at INTEGER,
        created_at INTEGER NOT NULL
      );
      INSERT INTO approvals_new SELECT * FROM approvals;
      DROP TABLE approvals;
      ALTER TABLE approvals_new RENAME TO approvals;
      CREATE INDEX IF NOT EXISTS idx_approvals_workflow_run_id ON approvals(workflow_run_id);
      CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);

      PRAGMA foreign_keys = ON;
    `,
  },
];

// ─── Default seed data ─────────────────────────────────────────────────────

const DEFAULT_SETTINGS = [
  { key: 'projects_dir', value: '/data/projects', description: 'Root directory for project files' },
  { key: 'downloads_dir', value: '/data/downloads', description: 'Directory for downloaded assets' },
  { key: 'logs_dir', value: '/data/logs', description: 'Directory for log files' },
  { key: 'browser_profiles_dir', value: '/data/browser-profiles', description: 'Directory for browser profiles' },
  { key: 'worker_poll_interval_ms', value: '2000', description: 'Worker polling interval in ms' },
  { key: 'playwright_headless', value: 'true', description: 'Run browsers in headless mode' },
  { key: 'playwright_slow_mo', value: '100', description: 'Slow motion delay in ms' },
  { key: 'playwright_timeout_ms', value: '60000', description: 'Default action timeout in ms' },
  { key: 'playwright_nav_timeout_ms', value: '30000', description: 'Navigation timeout in ms' },
];

const DEFAULT_SELECTORS: Array<{
  service: string;
  selector_key: string;
  selector_value: string;
  selector_type: string;
  description: string;
}> = [
  // Gemini
  { service: 'gemini', selector_key: 'input_box', selector_value: 'div[contenteditable="true"].ql-editor, rich-textarea .ql-editor, [data-test-id="chat-input"], textarea.mat-input-element', selector_type: 'css', description: 'Gemini prompt input' },
  { service: 'gemini', selector_key: 'send_button', selector_value: 'button[aria-label="Send message"], button.send-button, mat-icon[fonticon="send"]', selector_type: 'css', description: 'Gemini send button' },
  { service: 'gemini', selector_key: 'response_container', selector_value: 'model-response .markdown, .model-response-text', selector_type: 'css', description: 'Gemini response content' },
  { service: 'gemini', selector_key: 'login_check', selector_value: 'a[href*="accounts.google.com"]', selector_type: 'css', description: 'Gemini login redirect indicator' },

  // ChatGPT
  { service: 'chatgpt', selector_key: 'input_box', selector_value: '#prompt-textarea', selector_type: 'css', description: 'ChatGPT message input' },
  { service: 'chatgpt', selector_key: 'send_button', selector_value: 'button[data-testid="send-button"], button[aria-label="Send prompt"]', selector_type: 'css', description: 'ChatGPT send button' },
  { service: 'chatgpt', selector_key: 'response_container', selector_value: '[data-message-author-role="assistant"] .markdown', selector_type: 'css', description: 'ChatGPT response' },
  { service: 'chatgpt', selector_key: 'response_done', selector_value: 'button[aria-label="Stop streaming"]', selector_type: 'css', description: 'Stop streaming button (indicates response in progress)' },
  { service: 'chatgpt', selector_key: 'login_check', selector_value: 'button[data-testid="login-button"], a[href="/auth/login"]', selector_type: 'css', description: 'ChatGPT login indicator' },

  // Suno
  { service: 'suno', selector_key: 'create_nav', selector_value: 'a[href="/create"], button:has-text("Create")', selector_type: 'css', description: 'Suno create navigation' },
  { service: 'suno', selector_key: 'custom_mode_toggle', selector_value: 'button:has-text("Custom"), [data-testid="custom-mode"]', selector_type: 'css', description: 'Suno custom mode toggle' },
  { service: 'suno', selector_key: 'lyrics_input', selector_value: 'textarea[placeholder*="lyrics"], textarea[placeholder*="Lyrics"]', selector_type: 'css', description: 'Suno lyrics textarea' },
  { service: 'suno', selector_key: 'style_input', selector_value: 'textarea[placeholder*="style"], input[placeholder*="style"]', selector_type: 'css', description: 'Suno style input' },
  { service: 'suno', selector_key: 'title_input', selector_value: 'input[placeholder*="title"], input[placeholder*="Title"]', selector_type: 'css', description: 'Suno title input' },
  { service: 'suno', selector_key: 'create_button', selector_value: 'button:has-text("Create"), button[type="submit"]:has-text("Create")', selector_type: 'css', description: 'Suno create/generate button' },
  { service: 'suno', selector_key: 'song_card', selector_value: '[data-testid="song-card"], .song-card, [class*="song-item"]', selector_type: 'css', description: 'Suno generated song card' },
  { service: 'suno', selector_key: 'download_button', selector_value: 'button[aria-label*="Download"], button:has-text("Download")', selector_type: 'css', description: 'Suno download button' },
  { service: 'suno', selector_key: 'login_check', selector_value: 'button:has-text("Sign in"), a[href*="/login"]', selector_type: 'css', description: 'Suno login indicator' },

  // Grok
  { service: 'grok', selector_key: 'prompt_input', selector_value: 'textarea[placeholder*="Describe"], div[contenteditable="true"]', selector_type: 'css', description: 'Grok video prompt input' },
  { service: 'grok', selector_key: 'generate_button', selector_value: 'button:has-text("Generate"), button[type="submit"]', selector_type: 'css', description: 'Grok generate button' },
  { service: 'grok', selector_key: 'video_result', selector_value: 'video, [data-testid="video-result"]', selector_type: 'css', description: 'Grok video result' },
  { service: 'grok', selector_key: 'download_button', selector_value: 'button[aria-label*="download"], a[download]', selector_type: 'css', description: 'Grok download button' },
  { service: 'grok', selector_key: 'login_check', selector_value: 'button:has-text("Log in"), a[href*="/login"]', selector_type: 'css', description: 'Grok login indicator' },

  // Canva
  { service: 'canva', selector_key: 'create_design', selector_value: 'button:has-text("Create a design"), [data-testid="create-design-button"]', selector_type: 'css', description: 'Canva create design button' },
  { service: 'canva', selector_key: 'custom_size', selector_value: 'button:has-text("Custom size")', selector_type: 'css', description: 'Canva custom size option' },
  { service: 'canva', selector_key: 'width_input', selector_value: 'input[aria-label*="width"], input[placeholder*="width"]', selector_type: 'css', description: 'Canva width input' },
  { service: 'canva', selector_key: 'height_input', selector_value: 'input[aria-label*="height"], input[placeholder*="height"]', selector_type: 'css', description: 'Canva height input' },
  { service: 'canva', selector_key: 'share_button', selector_value: 'button:has-text("Share"), [data-testid="share-menu-button"]', selector_type: 'css', description: 'Canva share button' },
  { service: 'canva', selector_key: 'download_option', selector_value: 'button:has-text("Download"), [data-testid="download-button"]', selector_type: 'css', description: 'Canva download option' },
  { service: 'canva', selector_key: 'login_check', selector_value: 'a[href*="/login"], button:has-text("Log in")', selector_type: 'css', description: 'Canva login indicator' },
];

// ─── Migration runner ──────────────────────────────────────────────────────

export function runMigrations(): void {
  const db = getDb();

  // Ensure migration tracking table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const getApplied = db.prepare('SELECT id FROM schema_migrations');
  const applied = new Set((getApplied.all() as { id: number }[]).map(r => r.id));

  const insertMigration = db.prepare(
    'INSERT INTO schema_migrations (id, description, applied_at) VALUES (?, ?, ?)'
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;

    // Run each statement individually so ALTER TABLE failures (column already exists)
    // can be caught per-statement without rolling back the whole migration.
    const statements = migration.sql
      .split(';')
      .map(s => s.trim())
      .filter(Boolean);

    for (const stmt of statements) {
      try {
        db.exec(stmt + ';');
      } catch (err: unknown) {
        // SQLite throws on duplicate column adds — safe to ignore for idempotency
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('duplicate column name')) {
          continue;
        }
        throw err;
      }
    }

    insertMigration.run(migration.id, migration.description, Date.now());
    console.log(`[migrate] Applied migration ${migration.id}: ${migration.description}`);
  }

  // Seed default data (INSERT OR IGNORE — safe to run on every startup)
  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO app_settings (key, value, description, updated_at)
    VALUES (?, ?, ?, ?)
  `);
  const now = Date.now();
  for (const setting of DEFAULT_SETTINGS) {
    insertSetting.run(setting.key, setting.value, setting.description, now);
  }

  const insertSelector = db.prepare(`
    INSERT OR IGNORE INTO selectors (id, service, selector_key, selector_value, selector_type, description, version, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
  `);
  for (const sel of DEFAULT_SELECTORS) {
    const id = `${sel.service}_${sel.selector_key}`;
    insertSelector.run(id, sel.service, sel.selector_key, sel.selector_value, sel.selector_type, sel.description, now, now);
  }

  console.log('[migrate] Database migrations complete');
}

// Run directly: npx ts-node src/lib/db/migrate.ts
if (require.main === module) {
  runMigrations();
  process.exit(0);
}
