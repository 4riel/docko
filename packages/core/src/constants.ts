export const SCHEMA_VERSION = '0.1.0';
export const DOCKO_DIR = 'docko';
export const DEFAULT_SLOT_STALE_MS = 60 * 60 * 1000;
export const DEFAULT_SHARED_ENV_STALE_MS = 10 * 60 * 1000;
export const DEFAULT_CUSTOM_STALE_MS = 30 * 60 * 1000;
export const DEFAULT_SESSION_STALE_MS = 8 * 60 * 60 * 1000;
export const DEFAULT_ENDED_SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const LOG_RETENTION_DAYS = 3;
export const DEFAULT_LOG_LIMIT = 200;
export const MUTATION_LOCK_DIR = '.registry.lock';
export const ENDED_SESSIONS_DIR = 'ended';
// Bounds one automatic janitor pass so a long-idle workspace cannot hold the lock for minutes.
export const JANITOR_MAX_ENDED_SESSIONS_PER_PASS = 100;
export const JANITOR_MAX_DELETED_MANIFESTS_PER_PASS = 200;
// Refresh an owner claim heartbeat at most this often on the authorized-write path.
export const CLAIM_WRITE_HEARTBEAT_THROTTLE_MS = 30 * 1000;
export const TEMP_DIR_PREFIX = '.docko-tmp-';
export const TEMP_ARTIFACT_MAX_AGE_MS = 5 * 60 * 1000;
