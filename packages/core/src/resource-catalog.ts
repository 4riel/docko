import {
  DEFAULT_CUSTOM_STALE_MS,
  DEFAULT_SHARED_ENV_STALE_MS,
  DEFAULT_SLOT_STALE_MS
} from './constants.js';
import type { EnsureResourceOptions, RegistryDocument, RegistryResource } from './types.js';
import { RegistryScribe } from './registry-scribe.js';
import { DockoError } from './errors.js';

export class ResourceCatalog {
  /**
   * Knows how resources enter the registry and what their default stale policy is.
   * Slot resources are discovered from the workspace layout; other resource types
   * are registered explicitly.
   */
  constructor(private readonly registryScribe: RegistryScribe) {}

  defaultStaleAfter(registry: RegistryDocument, resourceType: string): number {
    if (resourceType === 'slot') {
      const configured = registry.workspace.config?.janitor?.slot_stale_after_ms;
      return typeof configured === 'number' && Number.isInteger(configured) && configured > 0
        ? configured
        : DEFAULT_SLOT_STALE_MS;
    }

    if (resourceType === 'shared-env') {
      return DEFAULT_SHARED_ENV_STALE_MS;
    }

    return DEFAULT_CUSTOM_STALE_MS;
  }

  async ensure(
    registry: RegistryDocument,
    options: EnsureResourceOptions
  ): Promise<RegistryResource> {
    const existing = this.registryScribe.getResource(registry, options.resourceType, options.resourceId);
    if (existing) {
      if (options.path !== undefined && existing.status === 'claimed' && options.path !== existing.path) {
        throw new DockoError(
          'Cannot modify the path of a claimed resource.',
          'RESOURCE_MUTATION_DENIED',
          2,
          {
            resource_type: options.resourceType,
            resource_id: options.resourceId
          }
        );
      }

      if (options.path !== undefined && existing.resource_type !== 'slot') {
        existing.path = options.path;
      }
      return existing;
    }

    if (options.resourceType === 'slot') {
      await this.registryScribe.discoverSlotResources(registry);
      const discovered = this.registryScribe.getResource(registry, options.resourceType, options.resourceId);
      if (discovered) {
        return discovered;
      }

      throw new DockoError('Slot not found under slots/.', 'RESOURCE_NOT_FOUND', 1, {
        resource_type: options.resourceType,
        resource_id: options.resourceId
      });
    }

    return this.registryScribe.upsertResource(
      registry,
      options.resourceType,
      options.resourceId,
      options.path ?? null
    );
  }
}
