import type {FastifyError, FastifyInstance, FastifyReply, FastifyRequest} from "fastify";

interface ErrorPayload {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const candidateStatus = error.statusCode ?? 500;
    const statusCode = candidateStatus >= 400 && candidateStatus <= 599 ? candidateStatus : 500;
    const isServerError = statusCode >= 500;
    if (isServerError) {
      request.log.error({err: error}, "request failed");
    }
    const code = isServerError ? "INTERNAL_ERROR" : error instanceof ApiError ? error.code : error.code || "REQUEST_ERROR";
    const message = isServerError ? "The request could not be completed." : error.message;
    return reply.code(statusCode).send(errorPayload(code, message, request.id));
  });
}

export function errorPayload(code: string, message: string, requestId: string): ErrorPayload {
  return {
    error: {
      code,
      message,
      requestId
    }
  };
}
