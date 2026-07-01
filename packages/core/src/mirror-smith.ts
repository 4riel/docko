import { DEFAULT_SHARED_ENV_STALE_MS, DEFAULT_SLOT_STALE_MS } from './constants.js';
import type { RegistryDocument } from './types.js';

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toISOString().replace('T', ' ').slice(0, 16);
}

export class MirrorSmith {
  render(registry: RegistryDocument): string {
    const applications = registry.applications ?? [];
    const lines: string[] = [
      '# docko Registry',
      '',
      'Machine-readable source of truth: `docko/registry.json`.',
      '`docko/registry.md` is a generated mirror and should not be hand-edited.',
      '',
      '## Applications',
      '',
      '| Application | Name | Keywords | Description | Source |',
      '|---|---|---|---|---|'
    ];

    for (const application of applications) {
      lines.push(
        `| ${application.application_id} | ${application.name} | ${(application.keywords ?? []).join(', ')} | ${application.description ?? ''} | ${application.source_path ?? ''} |`
      );
    }

    if (applications.length === 0) {
      lines.push('|  |  |  |  |  |');
    }

    lines.push(
      '',
      '## Slots',
      '',
      '| Application | Slot | Status | Branch | Task | Updated | Owner | Delegations |',
      '|---|---|---|---|---|---|---|---|'
    );

    for (const resource of registry.resources.filter((entry) => entry.resource_type === 'slot')) {
      lines.push(
        `| ${resource.application_id ?? ''} | ${resource.slot_name ?? resource.resource_id} | ${resource.status.toUpperCase()} | ${resource.claim?.branch ?? ''} | ${resource.claim?.task ?? ''} | ${formatDate(resource.claim?.updated_at)} | ${resource.claim?.owner_session_id ?? ''} | ${(resource.delegations ?? []).length} |`
      );
    }

    const sharedResources = registry.resources.filter((entry) => entry.resource_type !== 'slot');
    if (sharedResources.length > 0) {
      lines.push(
        '',
        '## Other Resources',
        '',
        '| Resource | Type | Status | Updated | Owner | Heartbeat |',
        '|---|---|---|---|---|---|'
      );

      for (const resource of sharedResources) {
        lines.push(
          `| ${resource.resource_id} | ${resource.resource_type} | ${resource.status.toUpperCase()} | ${formatDate(resource.claim?.updated_at)} | ${resource.claim?.owner_session_id ?? ''} | ${formatDate(resource.claim?.heartbeat_at)} |`
        );
      }
    }

    const slotStaleMs = registry.workspace?.config?.janitor?.slot_stale_after_ms ?? DEFAULT_SLOT_STALE_MS;
    const slotStaleNote =
      slotStaleMs >= 3600000
        ? `${slotStaleMs / 3600000} hour`
        : slotStaleMs >= 60000
          ? `${slotStaleMs / 60000} minute`
          : `${slotStaleMs / 1000} second`;

    lines.push(
      '',
      '## Notes',
      '',
      `- Slot claims default to ${slotStaleNote} stale recovery.`,
      `- Shared env claims default to ${DEFAULT_SHARED_ENV_STALE_MS / 60000} minute stale recovery.`,
      '- Application-aware slot acquire can use `--application` or infer the application from configured keywords in the task or branch text.',
      '- Delegated child authority is valid only while the parent claim remains active.'
    );

    return `${lines.join('\n')}\n`;
  }
}
