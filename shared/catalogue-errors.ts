export interface CatalogueIssue {
  row?: number;
  field?: string;
  message: string;
}
export type CatalogueCheckStage = 'structure' | 'file' | 'catalogue';

/** A failed check never contains a usable import plan. Safe to return to the uploader. */
export class CatalogueValidationError extends Error {
  readonly code = 'CATALOGUE_VALIDATION';
  readonly issues: CatalogueIssue[];
  readonly stage: CatalogueCheckStage;
  constructor(issues: CatalogueIssue[], stage: CatalogueCheckStage = 'catalogue') {
    const unique = [...new Map(issues.map(issue => [`${issue.row ?? ''}:${issue.message}`, issue])).values()]
      .sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
    super(`${unique.length} file issue${unique.length === 1 ? '' : 's'} found. Nothing has been saved.\n${unique.map(i => i.message).join('\n')}`);
    this.name = 'CatalogueValidationError';
    this.issues = unique;
    this.stage = stage;
  }
}

export function catalogueIssue(error: unknown): CatalogueIssue {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/^(?:CSV )?Row (\d+):?/) || message.match(/^Rows \d+ and (\d+):/);
  return {...(match ? {row: Number(match[1])} : {}), message};
}

export function catalogueErrorPayload(error: unknown) {
  return error instanceof CatalogueValidationError
    ? {code: error.code, issues: error.issues, stage: error.stage}
    : {};
}

export function catalogueErrorFromResponse(data: any): CatalogueValidationError | undefined {
  if (data?.code !== 'CATALOGUE_VALIDATION' || !Array.isArray(data.issues) || !data.issues.length ||
      !['structure', 'file', 'catalogue'].includes(data.stage)) return;
  if (!data.issues.every((i: any) => i && typeof i.message === 'string' &&
      (i.row === undefined || Number.isInteger(i.row) && i.row > 0) &&
      (i.field === undefined || typeof i.field === 'string'))) return;
  return new CatalogueValidationError(data.issues, data.stage);
}
