export type ActorMode = 'interactive' | 'delegated' | 'automation';
export type ResourceStatus = 'free' | 'claimed';
export type DelegationScope = 'read' | 'write';
export type ResourceType = 'slot' | 'shared-env' | 'custom';

export interface WorkspaceJanitorConfig {
  slot_stale_after_ms?: number;
}

export interface WorkspaceSchedulerConfig {
  // Last slot id claimed per application key, used to rotate slot acquire round-robin.
  // Keyed by application_id (or a default key for flat, application-less slots).
  last_slot_id?: Record<string, string>;
}

export interface WorkspaceConfig {
  janitor?: WorkspaceJanitorConfig;
  scheduler?: WorkspaceSchedulerConfig;
}

export interface WorkspaceDescriptor {
  workspace_id: string;
  workspace_root: string;
  name: string;
  config?: WorkspaceConfig;
}

export interface WorkspaceApplication {
  application_id: string;
  name: string;
  description?: string | null;
  keywords?: string[];
  source_path?: string | null;
}

export interface SessionManifest {
  schema_version: string;
  session_id: string;
  runtime: string;
  actor_mode: ActorMode;
  parent_session_id: string | null;
  delegated_from_session_id: string | null;
  started_at: string;
  updated_at: string;
  ended_at: string | null;
  workspace_root: string;
  metadata?: Record<string, unknown>;
}

export interface ResourceDelegation {
  child_session_id: string;
  granted_by_session_id: string;
  granted_at: string;
  scope: DelegationScope;
}

export interface ResourceClaim {
  owner_session_id: string;
  runtime: string | null;
  branch: string | null;
  task: string | null;
  claimed_at: string;
  updated_at: string;
  heartbeat_at: string | null;
  stale_after_ms: number;
  release_reason: string | null;
}

export interface RegistryResource {
  resource_type: ResourceType | (string & {});
  resource_id: string;
  path?: string | null;
  application_id?: string | null;
  slot_name?: string | null;
  status: ResourceStatus;
  claim?: ResourceClaim | null;
  delegations?: ResourceDelegation[];
}

export interface RegistryDocument {
  schema_version: string;
  generated_at: string;
  workspace: WorkspaceDescriptor;
  applications: WorkspaceApplication[];
  resources: RegistryResource[];
}

export interface StatusJanitorResult {
  released_claims: RegistryResource[];
}

export interface StatusResult {
  schema_version: string;
  workspace: WorkspaceDescriptor;
  applications: WorkspaceApplication[];
  resources: RegistryResource[];
  janitor: StatusJanitorResult;
}

export interface InitOptions {
  slotStaleAfterMs?: number;
}

export interface SessionStartOptions {
  sessionId?: string;
  runtime: string;
  actorMode?: ActorMode;
  parentSessionId?: string | null;
  delegatedFromSessionId?: string | null;
  workspaceRoot: string;
  metadata?: Record<string, unknown>;
}

export interface ClaimOptions {
  sessionId: string;
  resourceType: string;
  resourceId: string;
  branch?: string | null;
  task?: string | null;
  runtime?: string | null;
  staleAfterMs?: number;
  // When set, advance the round-robin scheduler cursor for this application key as part of
  // the same claim transaction. Only the `slot acquire` path sets this; manual claims leave it
  // unset so an explicit `/dock-claim <slot>` never perturbs rotation.
  advanceSchedulerKey?: string | null;
}

export interface EnsureResourceOptions {
  resourceType: string;
  resourceId: string;
  path?: string | null;
}

export interface EnsureApplicationOptions {
  applicationId: string;
  name?: string | null;
  description?: string | null;
  keywords?: string[];
  sourcePath?: string | null;
}

export interface ReleaseOptions {
  sessionId: string;
  resourceType: string;
  resourceId: string;
  reason?: string;
  force?: boolean;
}

export interface DelegateOptions {
  sessionId: string;
  childSessionId: string;
  resourceType: string;
  resourceId: string;
  scope?: DelegationScope;
}

export interface HeartbeatOptions {
  sessionId: string;
  resourceType: string;
  resourceId: string;
}

export interface AuthorizationResult {
  allowed: boolean;
  reason: string;
  session_id: string;
  resource_id: string | null;
  owner_session_id: string | null;
}

export type LogOutcome = 'ok' | 'error';

export interface DockoLogEntry {
  timestamp: string;
  operation: string;
  outcome: LogOutcome;
  session_id: string | null;
  resource_type: string | null;
  resource_id: string | null;
  details?: Record<string, unknown>;
}

export interface DockoLogQuery {
  days?: number;
  limit?: number;
}

export interface DockoLogResult {
  retention_days: number;
  days: number;
  entries: DockoLogEntry[];
}
