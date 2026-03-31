#!/usr/bin/env npx tsx
/**
 * LIVE DEMO: contextkit in action
 *
 * Shows a conversation growing until it hits the context window,
 * then contextkit compacts it seamlessly.
 *
 * Run: npx tsx examples/demo-live.ts
 *
 * No API key needed — uses a mock LLM for the demo.
 */

import { createContextKit } from "../src/index.js";
import type { Message, ContextWarningState } from "../src/types/index.js";

// --- Visual helpers ---

const COLORS = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	red: "\x1b[31m",
	cyan: "\x1b[36m",
	magenta: "\x1b[35m",
	bgGreen: "\x1b[42m",
	bgYellow: "\x1b[43m",
	bgRed: "\x1b[41m",
	white: "\x1b[37m",
};

function progressBar(current: number, max: number, width = 50): string {
	const pct = Math.min(current / max, 1);
	const filled = Math.round(pct * width);
	const empty = width - filled;

	let color = COLORS.green;
	if (pct > 0.85) color = COLORS.red;
	else if (pct > 0.7) color = COLORS.yellow;

	const bar = color + "█".repeat(filled) + COLORS.dim + "░".repeat(empty) + COLORS.reset;
	const pctStr = `${Math.round(pct * 100)}%`;
	return `${bar} ${pctStr}`;
}

function formatTokens(n: number): string {
	if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
	return String(n);
}

function stateIcon(state: ContextWarningState): string {
	switch (state) {
		case "ok": return `${COLORS.green}✓${COLORS.reset}`;
		case "warning": return `${COLORS.yellow}⚠${COLORS.reset}`;
		case "error": return `${COLORS.red}⚠${COLORS.reset}`;
		case "critical": return `${COLORS.red}🔥${COLORS.reset}`;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Simulated conversation data ---

const CODING_CONVERSATION: Array<{ role: "user" | "assistant"; content: string }> = [
	{ role: "user", content: "I'm building a REST API with Express and TypeScript. Can you help me set up the project structure?" },
	{ role: "assistant", content: `Sure! Here's a solid project structure for an Express + TypeScript API:

\`\`\`
src/
  routes/
    users.ts
    products.ts
    auth.ts
  middleware/
    auth.ts
    errorHandler.ts
    validation.ts
  services/
    userService.ts
    productService.ts
  models/
    user.ts
    product.ts
  utils/
    logger.ts
    config.ts
  app.ts
  server.ts
\`\`\`

Let me create the base files. First, \`package.json\`:
\`\`\`json
{
  "name": "my-api",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js"
  },
  "dependencies": {
    "express": "^4.18.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "@types/express": "^4.17.0",
    "tsx": "^4.0.0"
  }
}
\`\`\`` },
	{ role: "user", content: "Now create the user model with Zod validation and the user service with CRUD operations" },
	{ role: "assistant", content: `Here's the user model with full Zod validation:

\`\`\`typescript
// src/models/user.ts
import { z } from 'zod';

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(2).max(100),
  role: z.enum(['admin', 'user', 'moderator']),
  createdAt: z.date(),
  updatedAt: z.date(),
  preferences: z.object({
    theme: z.enum(['light', 'dark']).default('light'),
    notifications: z.boolean().default(true),
    language: z.string().default('en'),
  }).optional(),
});

export const CreateUserSchema = UserSchema.omit({ id: true, createdAt: true, updatedAt: true });
export const UpdateUserSchema = CreateUserSchema.partial();

export type User = z.infer<typeof UserSchema>;
export type CreateUser = z.infer<typeof CreateUserSchema>;
export type UpdateUser = z.infer<typeof UpdateUserSchema>;
\`\`\`

And the user service:

\`\`\`typescript
// src/services/userService.ts
import { randomUUID } from 'crypto';
import type { User, CreateUser, UpdateUser } from '../models/user';

const users = new Map<string, User>();

export class UserService {
  async create(data: CreateUser): Promise<User> {
    const user: User = {
      ...data,
      id: randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    users.set(user.id, user);
    return user;
  }

  async findById(id: string): Promise<User | null> {
    return users.get(id) ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    for (const user of users.values()) {
      if (user.email === email) return user;
    }
    return null;
  }

  async update(id: string, data: UpdateUser): Promise<User | null> {
    const existing = users.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...data, updatedAt: new Date() };
    users.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return users.delete(id);
  }

  async list(page = 1, limit = 20): Promise<{ users: User[]; total: number }> {
    const all = Array.from(users.values());
    const start = (page - 1) * limit;
    return {
      users: all.slice(start, start + limit),
      total: all.length,
    };
  }
}
\`\`\`` },
	{ role: "user", content: "Add JWT authentication middleware with refresh tokens" },
	{ role: "assistant", content: `Here's a complete JWT auth implementation with access + refresh tokens:

\`\`\`typescript
// src/middleware/auth.ts
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

const ACCESS_TOKEN_SECRET = process.env.JWT_SECRET || 'your-secret';
const REFRESH_TOKEN_SECRET = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret';
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';

interface TokenPayload {
  userId: string;
  email: string;
  role: string;
}

export function generateTokens(payload: TokenPayload) {
  const accessToken = jwt.sign(payload, ACCESS_TOKEN_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
  const refreshToken = jwt.sign(payload, REFRESH_TOKEN_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });
  return { accessToken, refreshToken };
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, ACCESS_TOKEN_SECRET) as TokenPayload;
}

export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, REFRESH_TOKEN_SECRET) as TokenPayload;
}

// Refresh token store (use Redis in production)
const refreshTokens = new Set<string>();

export function storeRefreshToken(token: string): void {
  refreshTokens.add(token);
}

export function revokeRefreshToken(token: string): void {
  refreshTokens.delete(token);
}

export function isRefreshTokenValid(token: string): boolean {
  return refreshTokens.has(token);
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const token = authHeader.substring(7);
  try {
    const payload = verifyAccessToken(token);
    (req as any).user = payload;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as TokenPayload;
    if (!user || !roles.includes(user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}
\`\`\`` },
	{ role: "user", content: "Now add error handling middleware, request validation with Zod, and rate limiting" },
	{ role: "assistant", content: `Here's comprehensive error handling, Zod validation middleware, and rate limiting:

\`\`\`typescript
// src/middleware/errorHandler.ts
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  console.error(\`[ERROR] \${req.method} \${req.path}:\`, err.message);

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      details: err.details,
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: err.errors.map(e => ({
        field: e.path.join('.'),
        message: e.message,
        code: e.code,
      })),
    });
  }

  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN' });
  }

  // Unexpected error
  return res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
  });
}

// src/middleware/validation.ts
import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';

export function validate(schema: ZodSchema, source: 'body' | 'params' | 'query' = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(result.error);
    }
    req[source] = result.data;
    next();
  };
}

// src/middleware/rateLimit.ts
const requestCounts = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(options: {
  windowMs?: number;
  maxRequests?: number;
  keyFn?: (req: Request) => string;
} = {}) {
  const windowMs = options.windowMs ?? 60_000;
  const maxRequests = options.maxRequests ?? 100;
  const keyFn = options.keyFn ?? ((req: Request) => req.ip ?? 'unknown');

  // Cleanup interval
  setInterval(() => {
    const now = Date.now();
    for (const [key, value] of requestCounts) {
      if (value.resetAt <= now) requestCounts.delete(key);
    }
  }, windowMs);

  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyFn(req);
    const now = Date.now();
    const record = requestCounts.get(key);

    if (!record || record.resetAt <= now) {
      requestCounts.set(key, { count: 1, resetAt: now + windowMs });
      res.setHeader('X-RateLimit-Remaining', maxRequests - 1);
      return next();
    }

    record.count++;
    const remaining = Math.max(0, maxRequests - record.count);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetAt / 1000));

    if (record.count > maxRequests) {
      return res.status(429).json({
        error: 'Too many requests',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil((record.resetAt - now) / 1000),
      });
    }

    next();
  };
}
\`\`\`` },
	{ role: "user", content: "Add database integration with Prisma — user and product models with relations" },
	{ role: "assistant", content: `Here's the Prisma setup with User and Product models including relations:

\`\`\`prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id          String    @id @default(uuid())
  email       String    @unique
  name        String
  password    String
  role        Role      @default(USER)
  products    Product[]
  reviews     Review[]
  orders      Order[]
  preferences Json?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([email])
  @@index([role])
}

model Product {
  id          String      @id @default(uuid())
  name        String
  description String?
  price       Decimal     @db.Decimal(10, 2)
  stock       Int         @default(0)
  category    Category    @relation(fields: [categoryId], references: [id])
  categoryId  String
  seller      User        @relation(fields: [sellerId], references: [id])
  sellerId    String
  reviews     Review[]
  orderItems  OrderItem[]
  images      String[]
  tags        String[]
  active      Boolean     @default(true)
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  @@index([categoryId])
  @@index([sellerId])
  @@index([price])
  @@index([active])
}

model Category {
  id          String    @id @default(uuid())
  name        String    @unique
  slug        String    @unique
  description String?
  products    Product[]
  parent      Category? @relation("CategoryTree", fields: [parentId], references: [id])
  parentId    String?
  children    Category[] @relation("CategoryTree")
  createdAt   DateTime  @default(now())
}

model Review {
  id        String   @id @default(uuid())
  rating    Int      @db.SmallInt
  comment   String?
  user      User     @relation(fields: [userId], references: [id])
  userId    String
  product   Product  @relation(fields: [productId], references: [id])
  productId String
  createdAt DateTime @default(now())

  @@unique([userId, productId])
  @@index([productId])
}

model Order {
  id        String      @id @default(uuid())
  user      User        @relation(fields: [userId], references: [id])
  userId    String
  items     OrderItem[]
  total     Decimal     @db.Decimal(10, 2)
  status    OrderStatus @default(PENDING)
  createdAt DateTime    @default(now())
  updatedAt DateTime    @updatedAt

  @@index([userId])
  @@index([status])
}

model OrderItem {
  id        String  @id @default(uuid())
  order     Order   @relation(fields: [orderId], references: [id])
  orderId   String
  product   Product @relation(fields: [productId], references: [id])
  productId String
  quantity  Int
  price     Decimal @db.Decimal(10, 2)
}

enum Role {
  ADMIN
  USER
  MODERATOR
}

enum OrderStatus {
  PENDING
  CONFIRMED
  SHIPPED
  DELIVERED
  CANCELLED
}
\`\`\`

And the updated service using Prisma:

\`\`\`typescript
// src/services/userService.ts
import { PrismaClient } from '@prisma/client';
import type { CreateUser, UpdateUser } from '../models/user';

const prisma = new PrismaClient();

export class UserService {
  async create(data: CreateUser) {
    return prisma.user.create({
      data,
      include: { products: true },
    });
  }

  async findById(id: string) {
    return prisma.user.findUnique({
      where: { id },
      include: {
        products: { take: 10, orderBy: { createdAt: 'desc' } },
        orders: { take: 5, orderBy: { createdAt: 'desc' }, include: { items: true } },
      },
    });
  }

  async findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  }

  async update(id: string, data: UpdateUser) {
    return prisma.user.update({
      where: { id },
      data: { ...data, updatedAt: new Date() },
    });
  }

  async delete(id: string) {
    await prisma.user.delete({ where: { id } });
    return true;
  }

  async list(page = 1, limit = 20) {
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { products: true, orders: true } } },
      }),
      prisma.user.count(),
    ]);
    return { users, total, page, limit, pages: Math.ceil(total / limit) };
  }
}
\`\`\`` },
	{ role: "user", content: "Now add WebSocket support for real-time notifications and write integration tests" },
	{ role: "assistant", content: `Here's WebSocket real-time notifications and integration tests:

\`\`\`typescript
// src/services/websocket.ts
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { verifyAccessToken } from '../middleware/auth';

type Client = {
  ws: WebSocket;
  userId: string;
  rooms: Set<string>;
};

class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, Client>();

  init(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', async (ws, req) => {
      const url = new URL(req.url ?? '', 'http://localhost');
      const token = url.searchParams.get('token');

      if (!token) {
        ws.close(4001, 'Missing authentication token');
        return;
      }

      try {
        const payload = verifyAccessToken(token);
        const client: Client = { ws, userId: payload.userId, rooms: new Set() };
        this.clients.set(payload.userId, client);

        // Auto-join user's personal room
        client.rooms.add(\`user:\${payload.userId}\`);

        ws.on('message', (data) => this.handleMessage(client, data.toString()));
        ws.on('close', () => this.clients.delete(payload.userId));

        this.send(client, { type: 'connected', userId: payload.userId });
      } catch {
        ws.close(4002, 'Invalid token');
      }
    });
  }

  private handleMessage(client: Client, raw: string) {
    try {
      const msg = JSON.parse(raw);
      switch (msg.type) {
        case 'subscribe':
          client.rooms.add(msg.room);
          break;
        case 'unsubscribe':
          client.rooms.delete(msg.room);
          break;
        case 'ping':
          this.send(client, { type: 'pong' });
          break;
      }
    } catch { /* ignore malformed messages */ }
  }

  broadcast(room: string, data: unknown) {
    for (const client of this.clients.values()) {
      if (client.rooms.has(room) && client.ws.readyState === WebSocket.OPEN) {
        this.send(client, data);
      }
    }
  }

  notifyUser(userId: string, data: unknown) {
    const client = this.clients.get(userId);
    if (client?.ws.readyState === WebSocket.OPEN) {
      this.send(client, data);
    }
  }

  private send(client: Client, data: unknown) {
    client.ws.send(JSON.stringify(data));
  }

  get connectedCount() { return this.clients.size; }
}

export const wsManager = new WebSocketManager();
\`\`\`

And integration tests:

\`\`\`typescript
// tests/integration/users.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
let authToken: string;
let userId: string;

beforeAll(async () => {
  await prisma.$executeRaw\`TRUNCATE TABLE "User" CASCADE\`;

  const res = await request(app)
    .post('/api/auth/register')
    .send({ email: 'test@example.com', name: 'Test User', password: 'Password123!' });

  authToken = res.body.accessToken;
  userId = res.body.user.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /api/users', () => {
  it('returns paginated users', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', \`Bearer \${authToken}\`);

    expect(res.status).toBe(200);
    expect(res.body.users).toBeInstanceOf(Array);
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.page).toBe(1);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/users/:id', () => {
  it('returns user by ID', async () => {
    const res = await request(app)
      .get(\`/api/users/\${userId}\`)
      .set('Authorization', \`Bearer \${authToken}\`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('test@example.com');
  });

  it('returns 404 for unknown ID', async () => {
    const res = await request(app)
      .get('/api/users/00000000-0000-0000-0000-000000000000')
      .set('Authorization', \`Bearer \${authToken}\`);

    expect(res.status).toBe(404);
  });
});

describe('PUT /api/users/:id', () => {
  it('updates user fields', async () => {
    const res = await request(app)
      .put(\`/api/users/\${userId}\`)
      .set('Authorization', \`Bearer \${authToken}\`)
      .send({ name: 'Updated Name' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Name');
  });

  it('validates input with Zod', async () => {
    const res = await request(app)
      .put(\`/api/users/\${userId}\`)
      .set('Authorization', \`Bearer \${authToken}\`)
      .send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('Rate limiting', () => {
  it('blocks after too many requests', async () => {
    const promises = Array.from({ length: 105 }, () =>
      request(app).get('/api/users').set('Authorization', \`Bearer \${authToken}\`)
    );
    const results = await Promise.all(promises);
    const blocked = results.filter(r => r.status === 429);
    expect(blocked.length).toBeGreaterThan(0);
  });
});
\`\`\`` },
];

// --- Main demo ---

async function main() {
	console.clear();
	console.log(`${COLORS.bold}${COLORS.cyan}`);
	console.log("  ┌─────────────────────────────────────────────────┐");
	console.log("  │         contextkit — Live Demo                  │");
	console.log("  │   Never hit context window limits again.        │");
	console.log("  └─────────────────────────────────────────────────┘");
	console.log(COLORS.reset);

	// Small window to show compaction quickly
	const CONTEXT_WINDOW = 6_000;

	const ctx = createContextKit({
		contextWindowSize: CONTEXT_WINDOW,
		maxOutputTokens: 1_000,
		autoCompactBuffer: 500,
		warningBuffer: 1_000,
		summaryMaxTokens: 2_000,
		microCompactKeepRecent: 2,

		// Mock LLM summarizer (in production, this calls your LLM)
		summarize: async (messages, _prompt) => {
			await sleep(800); // Simulate API latency
			const msgCount = messages.length;
			return `## Session Summary

### Primary Request
User is building a REST API with Express and TypeScript, including authentication, database integration, and real-time features.

### Key Technical Stack
- Express + TypeScript + Zod validation
- JWT auth with access + refresh tokens
- Prisma ORM with PostgreSQL
- WebSocket (ws) for real-time notifications
- Rate limiting and error handling middleware

### Files Created/Modified
- \`src/models/user.ts\` — Zod schemas for User (create, update, full)
- \`src/services/userService.ts\` — CRUD with Prisma, pagination, includes
- \`src/middleware/auth.ts\` — JWT generation, verification, role middleware
- \`src/middleware/errorHandler.ts\` — Centralized error handling (Zod, JWT, AppError)
- \`src/middleware/validation.ts\` — Zod validation middleware factory
- \`src/middleware/rateLimit.ts\` — IP-based rate limiter with headers
- \`prisma/schema.prisma\` — User, Product, Category, Review, Order models
- \`src/services/websocket.ts\` — WebSocket manager with rooms and auth
- \`tests/integration/users.test.ts\` — API tests with supertest

### Current Work
Just completed WebSocket real-time notifications and integration tests.
All ${msgCount} conversation turns have been summarized.

### Next Step
User may want to add deployment configuration (Docker, CI/CD) or API documentation (Swagger/OpenAPI).`;
		},

		onWarningStateChange: (state) => {
			if (state === "warning") {
				console.log(`\n  ${COLORS.yellow}⚠  Context window getting full...${COLORS.reset}`);
			} else if (state === "error") {
				console.log(`\n  ${COLORS.red}⚠  Context window nearly full — compaction imminent!${COLORS.reset}`);
			}
		},
	});

	const messages: Message[] = [];
	const stats = ctx.getStats();

	console.log(`  Context window: ${formatTokens(CONTEXT_WINDOW)} tokens`);
	console.log(`  Auto-compact at: ${formatTokens(stats.autoCompactThreshold)} tokens`);
	console.log(`  Effective window: ${formatTokens(stats.effectiveWindow)} tokens\n`);

	// Simulate the conversation growing
	for (let i = 0; i < CODING_CONVERSATION.length; i++) {
		const msg = CODING_CONVERSATION[i]!;
		messages.push({ role: msg.role, content: msg.content });

		const tokens = ctx.estimateTokens(messages);
		const state = ctx.getWarningState(messages);
		const icon = msg.role === "user" ? `${COLORS.cyan}👤 User` : `${COLORS.magenta}🤖 Assistant`;
		const preview = typeof msg.content === "string" ? msg.content.slice(0, 60) : "[complex]";

		console.log(`  ${icon}${COLORS.reset}: ${COLORS.dim}${preview}...${COLORS.reset}`);
		console.log(`  ${stateIcon(state)} ${progressBar(tokens, stats.effectiveWindow)} ${formatTokens(tokens)} tokens (${messages.length} msgs)\n`);

		await sleep(400);

		// Check for auto-compact
		if (ctx.shouldCompact(messages)) {
			console.log(`  ${COLORS.bold}${COLORS.yellow}⚡ AUTO-COMPACT TRIGGERED${COLORS.reset}`);
			console.log(`  ${COLORS.dim}Summarizing ${messages.length} messages...${COLORS.reset}\n`);

			const result = await ctx.autoCompact(messages);

			if (result.compacted && result.result && "summary" in result.result) {
				const cr = result.result;
				messages.length = 0;
				messages.push(...result.messages);

				const newTokens = ctx.estimateTokens(messages);

				console.log(`  ${COLORS.bold}${COLORS.green}✅ COMPACTION COMPLETE${COLORS.reset}`);
				console.log(`  ${COLORS.green}   Before: ${formatTokens(cr.preCompactTokens)} tokens (${cr.preCompactTokens} messages)${COLORS.reset}`);
				console.log(`  ${COLORS.green}   After:  ${formatTokens(cr.postCompactTokens)} tokens (${messages.length} messages)${COLORS.reset}`);
				console.log(`  ${COLORS.green}   Freed:  ${formatTokens(cr.tokensFreed)} tokens (${Math.round((cr.tokensFreed / cr.preCompactTokens) * 100)}%)${COLORS.reset}`);
				console.log(`  ${progressBar(newTokens, stats.effectiveWindow)} ${formatTokens(newTokens)} tokens\n`);

				console.log(`  ${COLORS.dim}── Summary Preview ──${COLORS.reset}`);
				const summaryLines = cr.summary.split("\n").slice(0, 8);
				for (const line of summaryLines) {
					console.log(`  ${COLORS.dim}${line}${COLORS.reset}`);
				}
				console.log(`  ${COLORS.dim}...${COLORS.reset}\n`);

				await sleep(1000);
			}
		}
	}

	// Final state
	const finalTokens = ctx.estimateTokens(messages);
	console.log(`  ${COLORS.bold}── Final State ──${COLORS.reset}`);
	console.log(`  Messages: ${messages.length}`);
	console.log(`  Tokens:   ${formatTokens(finalTokens)}`);
	console.log(`  ${progressBar(finalTokens, stats.effectiveWindow)}`);
	console.log(`\n  ${COLORS.bold}${COLORS.green}The conversation continues seamlessly. No data lost. No crashes.${COLORS.reset}\n`);
}

main().catch(console.error);
