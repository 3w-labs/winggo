export const resolveInConfiguredOrder = <T>(
  loaders: Array<() => Promise<T>>,
): Promise<T[]> => Promise.all(loaders.map((load) => load()));
