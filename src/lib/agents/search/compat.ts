export type OptimizationMode = 'speed' | 'balanced' | 'quality';

export type CompatSearchOptions = {
  categories?: string[];
  engines?: string[];
  language?: string;
  pageno?: number;
  time_range?: 'day' | 'month' | 'year';
};

export type CompatSearchRequest = {
  query: string;
  optimizationMode: OptimizationMode;
  searchOptions: CompatSearchOptions;
};

type CompatSource = {
  content: string;
  metadata: Record<string, unknown>;
};

type FormatCompatSearchResponseInput = {
  query: string;
  optimizationMode: OptimizationMode;
  message: string;
  sources: CompatSource[];
  requestId: string;
  elapsedMs: number;
};

export class CompatRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    status: number,
    code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CompatRequestError';
    this.status = status;
    this.code = code;
  }
}

const splitList = (value: string | null): string[] | undefined => {
  const items = value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return items && items.length > 0 ? items : undefined;
};

export const parseCompatSearchRequest = (
  requestUrl: string,
): CompatSearchRequest => {
  const params = new URL(requestUrl).searchParams;
  const query = params.get('q')?.trim();

  if (!query) {
    throw new CompatRequestError(400, 'missing_query', 'Query is required.');
  }

  const format = params.get('format') ?? 'json';
  if (format !== 'json') {
    throw new CompatRequestError(
      400,
      'invalid_format',
      'Only JSON format is supported.',
    );
  }

  const optimizationMode = params.get('optimizationMode');
  if (!['speed', 'balanced', 'quality'].includes(optimizationMode ?? '')) {
    throw new CompatRequestError(
      400,
      'invalid_optimization_mode',
      'Optimization mode must be speed, balanced, or quality.',
    );
  }

  const searchOptions: CompatSearchOptions = {};
  const categories = splitList(params.get('categories'));
  const engines = splitList(params.get('engines'));
  const language = params.get('language')?.trim();
  const pageValue = params.get('pageno');
  const timeRange = params.get('time_range');

  if (categories) searchOptions.categories = categories;
  if (engines) searchOptions.engines = engines;
  if (language) searchOptions.language = language;

  if (pageValue !== null) {
    const page = Number(pageValue);
    if (!Number.isInteger(page) || page < 1) {
      throw new CompatRequestError(
        400,
        'invalid_pageno',
        'Page number must be a positive integer.',
      );
    }
    searchOptions.pageno = page;
  }

  if (timeRange !== null && timeRange !== '') {
    if (!['day', 'month', 'year'].includes(timeRange)) {
      throw new CompatRequestError(
        400,
        'invalid_time_range',
        'Time range must be day, month, or year.',
      );
    }
    searchOptions.time_range = timeRange as 'day' | 'month' | 'year';
  }

  return {
    query,
    optimizationMode: optimizationMode as OptimizationMode,
    searchOptions,
  };
};

export const formatCompatSearchResponse = (
  input: FormatCompatSearchResponseInput,
) => ({
  query: input.query,
  optimizationMode: input.optimizationMode,
  answer: input.message,
  results: input.sources.map((source) => ({
    title:
      typeof source.metadata.title === 'string' ? source.metadata.title : '',
    url: typeof source.metadata.url === 'string' ? source.metadata.url : '',
    content: source.content,
  })),
  meta: {
    requestId: input.requestId,
    elapsedMs: input.elapsedMs,
  },
});

export const getModeTimeout = (mode: OptimizationMode): number => {
  if (mode === 'speed') return 45_000;
  if (mode === 'balanced') return 90_000;
  return 180_000;
};

export const buildCompatSystemInstructions = (
  language?: string,
  existing = '',
): string => {
  const instructions = existing.trim();
  if (language?.toLowerCase() !== 'ko') return instructions;
  return [instructions, 'Respond in Korean.'].filter(Boolean).join('\n');
};
