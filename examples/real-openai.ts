/**
 * REAL USAGE: contextkit with OpenAI
 *
 * Set OPENAI_API_KEY env var, then run:
 *   npx tsx examples/real-openai.ts
 */
import { createContextKit } from "../src/index.js";
import type { Message } from "../src/types/index.js";

// --- Plug in OpenAI ---

const ctx = createContextKit({
	contextWindowSize: 128_000, // GPT-4o context window

	summarize: async (messages, prompt) => {
		const apiKey = process.env.OPENAI_API_KEY;
		if (!apiKey) throw new Error("Set OPENAI_API_KEY env var");

		const response = await fetch("https://api.openai.com/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model: "gpt-4o-mini", // Use cheap model for summarization
				max_tokens: 20_000,
				messages: [
					...messages.map((m) => ({
						role: m.role as "user" | "assistant" | "system",
						content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
					})),
					{ role: "user", content: prompt },
				],
			}),
		});

		const data = (await response.json()) as {
			choices: Array<{ message: { content: string } }>;
		};
		return data.choices[0]?.message.content ?? "";
	},

	onAutoCompact: (result) => {
		console.log(`\n✅ Compacted: ${result.preCompactTokens} → ${result.postCompactTokens} tokens`);
		console.log(`   Freed ${result.tokensFreed} tokens (${Math.round((result.tokensFreed / result.preCompactTokens) * 100)}%)\n`);
	},

	onWarningStateChange: (state) => {
		if (state !== "ok") {
			console.log(`⚠️  Context warning: ${state}`);
		}
	},
});

// --- Chat loop ---

async function chat() {
	const messages: Message[] = [];

	console.log("contextkit + OpenAI Demo");
	console.log("Type messages. contextkit auto-compacts when the context fills up.\n");

	// Simulate a conversation
	const conversation = [
		"Explain how TCP/IP works in detail",
		"Now explain HTTP on top of TCP",
		"What about WebSockets? How do they differ?",
		"Write me a WebSocket server in Node.js with error handling",
		"Now add authentication to it with JWT",
	];

	for (const userMsg of conversation) {
		console.log(`You: ${userMsg}`);
		messages.push({ role: "user", content: userMsg });

		// Check context and auto-compact if needed
		const { messages: managed } = await ctx.autoCompact(messages);
		messages.length = 0;
		messages.push(...managed);

		// Get response from OpenAI
		const response = await fetch("https://api.openai.com/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
			},
			body: JSON.stringify({
				model: "gpt-4o-mini",
				messages: messages.map((m) => ({
					role: m.role,
					content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
				})),
			}),
		});

		const data = (await response.json()) as {
			choices: Array<{ message: { content: string } }>;
			usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
		};

		const reply = data.choices[0]?.message.content ?? "";
		messages.push({
			role: "assistant",
			content: reply,
			usage: {
				inputTokens: data.usage.prompt_tokens,
				outputTokens: data.usage.completion_tokens,
				totalTokens: data.usage.total_tokens,
			},
		});

		console.log(`Assistant: ${reply.slice(0, 200)}...`);
		console.log(`   [${ctx.estimateTokens(messages)} est. tokens, ${messages.length} messages]\n`);
	}
}

chat().catch(console.error);
