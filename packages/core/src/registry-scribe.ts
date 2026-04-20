import crypto from 'node:crypto';
import path from 'node:path';
import { DockoError } from './errors.js';
import { atomicWriteJson, atomicWriteText, ensureDir, isEnoent, listDirectories, readJsonFile } from './fs-utils.js';
import { MirrorSmith } from './mirror-smith.js';
import { getPaths, type DockoPaths } from './paths.js';
import { SCHEMA_VERSION } from './constants.js';
import type {
  RegistryDocument,
  RegistryResource,
  ResourceType,
  StatusResult,
  WorkspaceApplication
} from './types.js';

function qualifySlotResourceId(applicationId: string | null | undefined, slotName: string): string {
  return applicationId ? `${applicationId}.${slotName}` : slotName;
}

export class RegistryScribe {
  /**
   * Owns the canonical registry on disk.
   * It validates the machine-readable source of truth and keeps the human mirror in sync.
   */
  private readonly paths: DockoPaths;
  private readonly mirrorSmith = new MirrorSmith();

  constructor(workspaceRoot: string) {
    this.paths = getPaths(workspaceRoot);
  }

  getPaths(): DockoPaths {
    return this.paths;
  }

  async init(): Promise<RegistryDocument> {
    await ensureDir(this.paths.dockoDir);
    await ensureDir(this.paths.sessionsDir);
    await ensureDir(this.paths.logsDir);
    const registry = await this.ensureRegistry();
    await this.writeRegistry(registry);
    return registry;
  }

  async ensureRegistry(): Promise<RegistryDocument> {
    await ensureDir(this.paths.dockoDir);

    let registry: RegistryDocument;
    try {
      registry = await readJsonFile<RegistryDocument>(this.paths.registryPath);
    } catch (error: unknown) {
      if (isEnoent(error)) {
        const fresh = this.createDefaultRegistry();
        await this.writeRegistry(fresh);
        return fresh;
      }
      throw new DockoError(
        'Registry file is corrupted or invalid.',
        'CORRUPTED_REGISTRY',
        5,
        { registry_path: this.paths.registryPath }
      );
    }
    this.validateRegistry(registry);
    return this.cloneRegistry(registry);
  }

  async writeRegistry(registry: RegistryDocument): Promise<void> {
    const next = this.cloneRegistry(registry);
    next.generated_at = new Date().toISOString();
    await atomicWriteJson(this.paths.registryPath, next);
    await atomicWriteText(this.paths.mirrorPath, this.mirrorSmith.render(next));
  }

  buildStatus(
    registry: RegistryDocument,
    resourceType?: string,
    resourceId?: string
  ): Omit<StatusResult, 'janitor'> {
    return {
      schema_version: registry.schema_version,
      workspace: registry.workspace,
      applications: registry.applications,
      resources: this.filterResources(registry, resourceType, resourceId)
    };
  }

  private filterResources(registry: RegistryDocument, resourceType?: string, resourceId?: string): RegistryResource[] {
    return registry.resources.filter((resource) => {
      if (resourceType && resource.resource_type !== resourceType) {
        return false;
      }

      if (resourceId && resource.resource_id !== resourceId) {
        return false;
      }

      return true;
    });
  }

  getResource(registry: RegistryDocument, resourceType: string, resourceId: string): RegistryResource | undefined {
    return registry.resources.find(
      (resource) => resource.resource_type === resourceType && resource.resource_id === resourceId
    );
  }

  getApplication(registry: RegistryDocument, applicationId: string): WorkspaceApplication | undefined {
    return registry.applications.find((application) => application.application_id === applicationId);
  }

  upsertResource(
    registry: RegistryDocument,
    resourceType: ResourceType | (string & {}),
    resourceId: string,
    resourcePath?: string | null,
    metadata: Pick<RegistryResource, 'application_id' | 'slot_name'> = {
      application_id: null,
      slot_name: null
    }
  ): RegistryResource {
    const existing = this.getResource(registry, resourceType, resourceId);
    if (existing) {
      if (resourcePath !== undefined) {
        existing.path = resourcePath;
      }
      existing.application_id = metadata.application_id ?? null;
      existing.slot_name = metadata.slot_name ?? null;
      return existing;
    }

    const resource: RegistryResource = {
      resource_type: resourceType,
      resource_id: resourceId,
      path: resourcePath ?? null,
      application_id: metadata.application_id ?? null,
      slot_name: metadata.slot_name ?? null,
      status: 'free',
      claim: null,
      delegations: []
    };
    registry.resources.push(resource);
    registry.resources.sort((left, right) => left.resource_id.localeCompare(right.resource_id));
    return resource;
  }

  upsertApplication(
    registry: RegistryDocument,
    application: Pick<WorkspaceApplication, 'application_id'> & Partial<WorkspaceApplication>
  ): WorkspaceApplication {
    const existing = this.getApplication(registry, application.application_id);
    const normalized: WorkspaceApplication = {
      application_id: application.application_id,
      name: application.name ?? application.application_id,
      description: application.description ?? null,
      keywords: [...new Set((application.keywords ?? []).filter(Boolean))],
      source_path: application.source_path ?? null
    };

    if (existing) {
      existing.name = normalized.name;
      existing.description = normalized.description;
      existing.keywords = normalized.keywords;
      existing.source_path = normalized.source_path;
      registry.applications.sort((left, right) => left.application_id.localeCompare(right.application_id));
      return existing;
    }

    registry.applications.push(normalized);
    registry.applications.sort((left, right) => left.application_id.localeCompare(right.application_id));
    return normalized;
  }

  private createDefaultRegistry(): RegistryDocument {
    return {
      schema_version: SCHEMA_VERSION,
      generated_at: new Date().toISOString(),
      workspace: {
        workspace_id: `wk_${crypto.randomUUID().replaceAll('-', '')}`,
        workspace_root: this.paths.workspaceRoot,
        name: 'workspace'
      },
      applications: [],
      resources: []
    };
  }

  private cloneRegistry(registry: RegistryDocument): RegistryDocument {
    // Normalize shape without mutating the caller's object graph.
    const next: RegistryDocument = {
      ...registry,
      workspace: {
        ...registry.workspace,
        workspace_root: this.paths.workspaceRoot,
        config: registry.workspace.config
          ? {
              ...registry.workspace.config,
              janitor: registry.workspace.config.janitor
                ? { ...registry.workspace.config.janitor }
                : undefined
            }
          : undefined
      },
      applications: (registry.applications ?? []).map((application) => ({
        ...application,
        description: application.description ?? null,
        keywords: [...(application.keywords ?? [])],
        source_path: application.source_path ?? null
      })),
      resources: registry.resources.map((resource) => ({
        ...resource,
        application_id: resource.application_id ?? null,
        slot_name: resource.slot_name ?? null,
        delegations: [...(resource.delegations ?? [])]
      }))
    };

    return next;
  }

  async discoverSlotResources(registry: RegistryDocument): Promise<RegistryDocument> {
    const slotDirs = await listDirectories(this.paths.slotsDir);
    const applicationIds = new Set((registry.applications ?? []).map((application) => application.application_id));
    const discoveredSlotIds = new Set<string>();

    registry.resources = registry.resources.filter((resource) => {
      if (resource.resource_type !== 'slot') {
        return true;
      }

      if (discoveredSlotIds.has(resource.resource_id)) {
        return true;
      }

      return resource.status === 'claimed';
    });

    for (const slotId of slotDirs) {
      if (applicationIds.has(slotId)) {
        const applicationSlots = await listDirectories(path.join(this.paths.slotsDir, slotId));
        for (const slotName of applicationSlots) {
          const resourceId = qualifySlotResourceId(slotId, slotName);
          discoveredSlotIds.add(resourceId);
          this.upsertResource(registry, 'slot', resourceId, `slots/${slotId}/${slotName}`, {
            application_id: slotId,
            slot_name: slotName
          });
        }
        continue;
      }

      discoveredSlotIds.add(slotId);
      this.upsertResource(registry, 'slot', slotId, `slots/${slotId}`, {
        application_id: null,
        slot_name: slotId
      });
    }
    return registry;
  }

  private validateRegistry(registry: RegistryDocument): void {
    if (
      !registry ||
      typeof registry !== 'object' ||
      !Array.isArray(registry.resources) ||
      ('applications' in registry && !Array.isArray(registry.applications))
    ) {
      throw new DockoError(
        'Registry file is corrupted or invalid.',
        'CORRUPTED_REGISTRY',
        5,
        { registry_path: this.paths.registryPath }
      );
    }
  }
}
