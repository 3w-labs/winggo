export const combineAbortSignals = (
  ...signals: Array<AbortSignal | undefined>
): AbortSignal => {
  const present = signals.filter(
    (signal): signal is AbortSignal => signal !== undefined,
  );
  return present.length === 1 ? present[0] : AbortSignal.any(present);
};

export const throwIfSearchAborted = (signal?: AbortSignal) => {
  signal?.throwIfAborted();
};
