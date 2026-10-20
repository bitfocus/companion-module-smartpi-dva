import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { endpoints } from '../schemas/index.js'
import { captures } from './captures.js'

export type Reply = { status?: number; body?: string }

/**
 * A DVA's HTTP API on a local port. Every polled endpoint answers with its capture unless a
 * test sets another reply. A request it has no reply for answers 404 with no body, as an
 * unknown route on the DVA does.
 */
export class FakeDva {
	/** Replies keyed by `METHOD /path`. A function is called per request, and may hold it. */
	readonly replies = new Map<string, Reply | (() => Reply | Promise<Reply>)>()
	/** Every request received, as `METHOD /path`, in order. */
	readonly requests: string[] = []
	/** The JSON body of every request that had one, in order. */
	readonly bodies: { request: string; body: unknown }[] = []

	readonly #server = createServer((request, response) => void this.#handle(request, response))

	constructor() {
		for (const [name, body] of Object.entries(captures)) {
			const { method, path } = endpoints[name as keyof typeof captures]
			this.replies.set(`${method} ${path}`, { body })
		}
	}

	/** `host:port`, as the module's Host field takes it. */
	get host(): string {
		return `127.0.0.1:${(this.#server.address() as AddressInfo).port}`
	}

	async listen(): Promise<void> {
		await new Promise<void>((resolve) => this.#server.listen(0, '127.0.0.1', resolve))
	}

	async close(): Promise<void> {
		// A held request would otherwise keep the server open
		this.#server.closeAllConnections()
		await new Promise<void>((resolve, reject) => this.#server.close((err) => (err ? reject(err) : resolve())))
	}

	async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const key = `${request.method} ${request.url}`
		this.requests.push(key)

		const chunks: Buffer[] = []
		for await (const chunk of request) chunks.push(chunk as Buffer)
		const text = Buffer.concat(chunks).toString()
		if (text.length > 0) this.bodies.push({ request: key, body: JSON.parse(text) as unknown })

		const reply = this.replies.get(key)
		const { status = 200, body } = (typeof reply === 'function' ? await reply() : reply) ?? { status: 404 }

		if (response.destroyed) return
		if (body === undefined) {
			response.writeHead(status).end()
			return
		}
		response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(body)
	}
}
