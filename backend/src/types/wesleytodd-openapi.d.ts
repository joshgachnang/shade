declare module "@wesleytodd/openapi" {
  import type {RequestHandler} from "express";

  export interface OpenApiDocument {
    info?: {title?: string; description?: string; version?: string};
    openapi?: string;
    [k: string]: unknown;
  }

  export interface OpenApiMiddleware extends RequestHandler {
    document: OpenApiDocument;
    routePrefix: string;
    options: Record<string, unknown>;
    path: (schema?: Record<string, unknown>) => RequestHandler;
    validPath: (
      schema?: Record<string, unknown>,
      pathOpts?: Record<string, unknown>
    ) => RequestHandler;
    component: (type: string, name: string, schema: Record<string, unknown>) => void;
    schema: (name: string, schema: Record<string, unknown>) => void;
    parameters: (name: string, schema: Record<string, unknown>) => void;
    response: (name: string, schema: Record<string, unknown>) => void;
    swaggerui: () => RequestHandler;
    redoc: () => RequestHandler;
    generateDocument: (
      doc: OpenApiDocument,
      router?: unknown,
      basePath?: string
    ) => OpenApiDocument;
  }

  function ExpressOpenApi(
    routePrefix?: string | OpenApiDocument,
    doc?: OpenApiDocument | Record<string, unknown>,
    opts?: Record<string, unknown>
  ): OpenApiMiddleware;

  export default ExpressOpenApi;
}
