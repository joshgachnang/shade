/**
 * Local mirror of `@terreno/api`'s `ScriptRunner` contract. The backend pins
 * `@terreno/api@0.3.1` which predates the export, while admin-backend ships
 * with the newer api@0.9.2 internally and expects the same shape. Keeping a
 * local copy lets us type our scripts without upgrading the whole app.
 */

export interface ScriptResult {
  success: boolean;
  results: string[];
}

export interface ScriptContext {
  checkCancellation?: () => Promise<void>;
  addLog?: (level: "info" | "warn" | "error", message: string) => Promise<void>;
  updateProgress?: (percentage: number, stage?: string, message?: string) => Promise<void>;
}

export type ScriptRunner = (wetRun: boolean, ctx?: ScriptContext) => Promise<ScriptResult>;
