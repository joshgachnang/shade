export const captureException = (error: unknown): void => {
  console.error("Captured exception:", error);
};

export const captureMessage = (message: string): void => {
  console.warn("Captured message:", message);
};

export const createSentryReduxEnhancer = (): unknown => {
  return undefined;
};
