/**
 * Server middleware utilities
 */

import logger from "../utils/logger.ts";

export type Handler = (request: Request) => Response | Promise<Response>;

/** Log requests */
export function requestLogger(handler: Handler): Handler {
  return async (request: Request) => {
    const start = Date.now();
    const url = new URL(request.url);

    try {
      const response = await handler(request);
      const duration = Date.now() - start;

      logger.info(`${request.method} ${url.pathname} ${response.status} ${duration}ms`);

      return response;
    } catch (err) {
      const duration = Date.now() - start;
      logger.error(`${request.method} ${url.pathname} 500 ${duration}ms - ${err}`);
      throw err;
    }
  };
}

/** Add CORS headers */
export function cors(handler: Handler): Handler {
  return async (request: Request) => {
    // Handle preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const response = await handler(request);

    // Add CORS headers to response
    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", "*");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

/** Error handling wrapper */
export function errorHandler(handler: Handler): Handler {
  return async (request: Request) => {
    try {
      return await handler(request);
    } catch (err) {
      logger.error(`Unhandled error: ${err}`);
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };
}

/** Compose multiple middleware */
export function compose(...middlewares: ((h: Handler) => Handler)[]): (h: Handler) => Handler {
  return (handler: Handler) => {
    return middlewares.reduceRight((h, middleware) => middleware(h), handler);
  };
}

export default { requestLogger, cors, errorHandler, compose };
