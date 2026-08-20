import type {FastifyInstance, FastifyReply, FastifyRequest} from "fastify";

import type {AppConfig} from "../config.js";
import type {IdentityRepository, UserRole} from "../db/repositories/identityRepository.js";
import {ApiError} from "../http/errors.js";
import {FixedWindowRateLimiter} from "../security/rateLimiter.js";
import {AuthService, type AuthenticatedSession, type IssuedSession} from "./authService.js";

export const sessionCookieName = "storyvideogen_session";
export const csrfCookieName = "storyvideogen_csrf";

export interface AuthRoutesDependencies {
  config: AppConfig;
  auth: AuthService;
  identities: IdentityRepository;
}

export async function registerAuthRoutes(app: FastifyInstance, dependencies: AuthRoutesDependencies): Promise<void> {
  const limiter = new FixedWindowRateLimiter(dependencies.config.authAttemptLimit, 60_000);

  app.post("/api/v1/auth/register", async (request, reply) => {
    enforceRateLimit(limiter, request);
    const body = objectBody(request.body);
    const issued = dependencies.auth.register(body.username, body.password);
    setSessionCookies(reply, issued, dependencies.config);
    return reply.code(201).send({user: issued.user});
  });

  app.post("/api/v1/auth/login", async (request, reply) => {
    enforceRateLimit(limiter, request);
    const body = objectBody(request.body);
    const issued = dependencies.auth.login(body.username, body.password);
    setSessionCookies(reply, issued, dependencies.config);
    return {user: issued.user};
  });

  app.get("/api/v1/auth/me", async (request) => ({user: requireSession(request, dependencies.auth).user}));

  app.post("/api/v1/auth/logout", async (request, reply) => {
    const session = requireMutationSession(request, dependencies.auth);
    dependencies.auth.logout(session);
    clearSessionCookies(reply, dependencies.config);
    return reply.code(204).send();
  });

  app.post("/api/v1/auth/password", async (request, reply) => {
    const session = requireMutationSession(request, dependencies.auth);
    const body = objectBody(request.body);
    dependencies.auth.changePassword(session, body.currentPassword, body.newPassword);
    clearSessionCookies(reply, dependencies.config);
    return reply.code(204).send();
  });

  app.get("/api/v1/admin/users", async (request) => {
    requireRole(request, dependencies.auth, "admin");
    return {users: dependencies.identities.listUsers()};
  });
}

export function requireSession(request: FastifyRequest, auth: AuthService): AuthenticatedSession {
  return auth.authenticate(request.cookies[sessionCookieName]);
}

export function requireMutationSession(request: FastifyRequest, auth: AuthService): AuthenticatedSession {
  const session = requireSession(request, auth);
  auth.verifyCsrf(session, headerValue(request.headers["x-csrf-token"]));
  return session;
}

export function requireRole(request: FastifyRequest, auth: AuthService, role: UserRole): AuthenticatedSession {
  const session = requireSession(request, auth);
  if (session.user.role !== role) throw new ApiError(403, "FORBIDDEN", "You do not have access to this resource.");
  return session;
}

function setSessionCookies(reply: FastifyReply, issued: IssuedSession, config: AppConfig): void {
  const common = {path: "/", sameSite: "strict" as const, secure: config.secureCookies, expires: new Date(issued.expiresAt)};
  reply.setCookie(sessionCookieName, issued.sessionToken, {...common, httpOnly: true});
  reply.setCookie(csrfCookieName, issued.csrfToken, {...common, httpOnly: false});
}

function clearSessionCookies(reply: FastifyReply, config: AppConfig): void {
  const options = {path: "/", sameSite: "strict" as const, secure: config.secureCookies};
  reply.clearCookie(sessionCookieName, {...options, httpOnly: true});
  reply.clearCookie(csrfCookieName, {...options, httpOnly: false});
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "BODY_INVALID", "A JSON object is required.");
  return value as Record<string, unknown>;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function enforceRateLimit(limiter: FixedWindowRateLimiter, request: FastifyRequest): void {
  if (!limiter.consume(request.ip)) throw new ApiError(429, "RATE_LIMITED", "Too many authentication attempts. Try again later.");
}
