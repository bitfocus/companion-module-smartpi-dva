import {
	InstanceBase,
	InstanceStatus,
	type CompanionVariableDefinitions,
	type SomeCompanionConfigField,
} from '@companion-module/base'
import { GetConfigFields, type ModuleConfig, type ModuleSecrets } from './config.js'
import { getVariableDefinitions, getVariableValues, type VariablesSchema } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionSchema } from './actions.js'
import { UpdateFeedbacks, type FeedbackSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import PQueue from 'p-queue'
import { Agent, request } from 'undici'
import type { z } from 'zod'
import { buildPath, endpoints, ErrorResponse, type EndpointName } from './schemas/index.js'
import { isDeepStrictEqual } from 'node:util'
import { StatusManager } from './status.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: ModuleSecrets
	actions: ActionSchema
	feedbacks: FeedbackSchema
	variables: VariablesSchema
}

type EndpointMap = typeof endpoints

/**
 * `params` is required for endpoints whose path has placeholders and rejected for those that
 * don't; `body` likewise. Both shapes come from the schemas, so a typo in a path parameter is
 * a compile error rather than a 404.
 */
type MessageFor<K extends EndpointName> = { endpoint: K } & (EndpointMap[K]['params'] extends z.ZodType
	? { params: z.input<EndpointMap[K]['params']> }
	: { params?: never }) &
	(EndpointMap[K]['body'] extends z.ZodType ? { body: z.input<EndpointMap[K]['body']> } : { body?: never })

/** A request against any one of the endpoints in the registry. */
export type Message = { [K in EndpointName]: MessageFor<K> }[EndpointName]

/** Every GET in the registry. None takes params or a body, so the poll issues them all alike. */
export type PolledEndpoint = { [K in EndpointName]: EndpointMap[K]['method'] extends 'GET' ? K : never }[EndpointName]

const polledEndpoints = (Object.keys(endpoints) as EndpointName[]).filter(
	(endpoint): endpoint is PolledEndpoint => endpoints[endpoint].method === 'GET',
)

/** The last valid response from each polled endpoint. An endpoint is absent until it has sent one. */
export type DeviceState = { [K in PolledEndpoint]?: z.output<EndpointMap[K]['response']> }

/**
 * The registry, seen only through the polled endpoints' response schemas. Typed as a mapped
 * type so that indexing it with a generic endpoint keeps the schema tied to that endpoint.
 */
const responseSchemas: { [K in PolledEndpoint]: { response: z.ZodType<NonNullable<DeviceState[K]>> } } = endpoints

/** The lists the action, feedback and preset definitions are built from. */
const definitionSources: readonly PolledEndpoint[] = [
	'getAnnouncements',
	'getDestinations',
	'getGroups',
	'getRegions',
	'getAreas',
]

/** A response that arrived but did not match its endpoint's schema. */
class UnexpectedResponseError extends Error {}

/** Maps an HTTP response status to an instance status, for sendMsg to report via #statusManager. */
function statusForHttpCode(statusCode: number): { status: InstanceStatus; message: string | null } {
	if (statusCode >= 200 && statusCode < 300) return { status: InstanceStatus.Ok, message: null }
	if (statusCode >= 300 && statusCode < 400) {
		return {
			status: InstanceStatus.BadConfig,
			message: `Unexpected redirect (status ${statusCode}) — check the Protocol setting`,
		}
	}
	if (statusCode === 401 || statusCode === 403) {
		return { status: InstanceStatus.AuthenticationFailure, message: `Authentication failed (status ${statusCode})` }
	}
	if (statusCode >= 500) {
		return { status: InstanceStatus.ConnectionFailure, message: `Device error (status ${statusCode})` }
	}
	return { status: InstanceStatus.UnknownError, message: `Unexpected status ${statusCode}` }
}

export { UpgradeScripts }

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config!: ModuleConfig // Setup in init()
	#secrets: ModuleSecrets | undefined
	#controller: AbortController = new AbortController()
	#queue = new PQueue({ concurrency: 1, autoStart: true, interval: 10, intervalCap: 1, strict: true })
	#statusManager = new StatusManager(this, { status: InstanceStatus.Connecting, message: 'Initialising' }, 2000)
	#dispatcher: Agent | undefined
	#pollTimer: NodeJS.Timeout | undefined
	/** The controller signal of the poll in flight, if there is one. */
	#pollSignal: AbortSignal | undefined
	#state: DeviceState = {}
	/** What Companion was last sent, so only what has changed is sent again. */
	#variableDefinitions: CompanionVariableDefinitions<VariablesSchema> | undefined
	#variableValues: Partial<VariablesSchema> = {}

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig, _isFirstInit: boolean, secrets: ModuleSecrets): Promise<void> {
		this.config = config
		this.#secrets = secrets
		this.#updateDispatcher()

		this.#statusManager.updateStatus(InstanceStatus.Connecting)

		void this.configUpdated(config, secrets)
	}
	// When module gets deleted
	async destroy(): Promise<void> {
		this.log('debug', `destroy ${this.id}:${this.label}`)
		this.#stopPolling()
		this.#controller.abort('Module destroyed')
		this.#queue.clear()
		await this.#dispatcher?.close()
		this.#dispatcher = undefined
		this.#statusManager.destroy()
	}

	async configUpdated(config: ModuleConfig, secrets: ModuleSecrets): Promise<void> {
		this.config = config
		this.#secrets = secrets
		this.#controller.abort('Config Updated')

		this.#controller = new AbortController()

		process.env.NODE_TLS_REJECT_UNAUTHORIZED = config.allowInsecure ? '0' : '1'

		this.#statusManager.updateStatus(InstanceStatus.Connecting, `Config updated — reinitialising`)

		// The config may point at another device, so nothing saved from the old one still holds
		this.#state = {}

		this.#updateDispatcher()
		this.#updateCompanionBits()
		this.#startPolling()
	}

	/**
	 * Rebuilds the undici dispatcher for the current config. Only needed to opt out of TLS
	 * verification — otherwise `undefined` leaves undici on its global dispatcher.
	 */
	#updateDispatcher(): void {
		const previous = this.#dispatcher
		this.#dispatcher =
			this.config.protocol === 'https' && this.config.allowInsecure
				? new Agent({ connect: { rejectUnauthorized: false } })
				: undefined
		void previous?.close()
	}

	/**
	 * (Re)starts the poll loop on the configured interval, which is in *seconds*.
	 * Always stops an existing loop first, so calling this repeatedly is safe.
	 */
	#startPolling(): void {
		this.#stopPolling()

		this.#pollTimer = setInterval(() => void this.#poll(), this.config.interval * 1000)
		void this.#poll() // don't make the user wait a whole interval for the first result
	}

	/** Cancels the poll loop if one is running. Safe to call when it isn't. */
	#stopPolling(): void {
		if (this.#pollTimer === undefined) return

		clearInterval(this.#pollTimer)
		this.#pollTimer = undefined
	}

	/** The responses saved by the poll, see {@link DeviceState}. */
	public get state(): Readonly<DeviceState> {
		return this.#state
	}

	/**
	 * Fetches one endpoint and saves its response if that has changed. Resolves to whether it
	 * did. Rejects if the request failed, or with an {@link UnexpectedResponseError} if the
	 * response did not match its schema, leaving the last valid one in place.
	 */
	async #pollEndpoint<K extends PolledEndpoint>(endpoint: K, signal: AbortSignal): Promise<boolean> {
		const name: PolledEndpoint = endpoint
		const body = await this.sendMsg({ endpoint: name })

		// The config changed while this was in flight, so it describes a connection that is gone
		if (signal.aborted) return false

		const result = responseSchemas[endpoint].response.safeParse(body)
		if (!result.success) {
			throw new UnexpectedResponseError(`Unexpected response from ${endpoints[endpoint].path}: ${result.error.message}`)
		}

		// Absent until the first valid response, so that one always counts as a change
		if (isDeepStrictEqual(this.#state[endpoint], result.data)) return false

		this.#state[endpoint] = result.data
		return true
	}

	/**
	 * One poll cycle: fetch every GET endpoint and save each valid response, then rebuild the
	 * definitions once if any of the lists they are built from changed.
	 */
	async #poll(): Promise<void> {
		const signal = this.#controller.signal

		// A slow response must not let cycles stack up behind each other. A poll from before a
		// config change doesn't count: it is being aborted, and must not hold the new config's
		// first poll back by a whole interval
		if (this.#pollSignal === signal) return
		this.#pollSignal = signal

		try {
			// Settled rather than all, so one failing endpoint doesn't discard the others
			const results = await Promise.allSettled(
				polledEndpoints.map(async (endpoint) => this.#pollEndpoint(endpoint, signal)),
			)

			// An abort means the config changed or the module went away, not a failure
			if (signal.aborted) return

			const changed = polledEndpoints.filter((_endpoint, index) => {
				const result = results[index]
				return result.status === 'fulfilled' && result.value
			})
			// Once per poll, however many of the lists moved
			if (changed.some((endpoint) => definitionSources.includes(endpoint))) this.#updateCompanionBits()
			if (changed.length > 0) this.#updateVariables()

			const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []))
			// Deduplicated: an unreachable device fails every request with the same error
			for (const message of new Set(failures.map(errorMessage))) this.log('error', `Poll failed: ${message}`)

			if (failures.length === 0) {
				this.#statusManager.updateStatus(InstanceStatus.Ok)
			} else if (failures.length < results.length || failures.some((err) => err instanceof UnexpectedResponseError)) {
				// sendMsg reported Ok for each response that arrived, which would hide these
				this.#statusManager.updateStatus(
					InstanceStatus.UnknownWarning,
					`${failures.length} of ${results.length} requests failed, see log`,
				)
			}
			// Otherwise every request failed before there was a body to check, and sendMsg has
			// already reported why: the connection, authentication or a device error
		} finally {
			if (this.#pollSignal === signal) this.#pollSignal = undefined
		}
	}

	#updateCompanionBits(): void {
		this.#updateActions()
		this.#updateFeedbacks()
		this.#updatePresets()
		this.#updateVariables()
	}

	/**
	 * Issues a single API request and returns its decoded body.
	 *
	 * Deliberately does no schema validation — the caller owns that, so it can pick the
	 * matching schema from `./schemas` and decide how to handle a mismatch:
	 *
	 * ```ts
	 * const modes = GetModesResponse.parse(await this.sendMsg({ endpoint: 'getModes' }))
	 * ```
	 *
	 * Resolves to the parsed JSON for a JSON body, the raw text for anything else, and
	 * `undefined` for an empty body (which the mutating endpoints return).
	 */
	public async sendMsg(msg: Message, signal?: AbortSignal): Promise<unknown> {
		const combinedSignal = signal ? AbortSignal.any([signal, this.#controller.signal]) : this.#controller.signal

		const response = await this.#queue.add(
			async ({ signal: taskSignal }) => {
				const endpoint = endpoints[msg.endpoint]
				const path = buildPath(endpoint.path, msg.params ?? {})
				const url = `${this.config.protocol}://${this.config.host}${path}`

				const headers: Record<string, string> = {
					Accept: 'application/json, text/plain, */*',
				}

				if (this.config.apikey) {
					const apiKey = this.#secrets?.xapikey
					if (!apiKey) throw new Error(`X-API-Key is enabled but no key is configured`)
					headers['X-Api-Key'] = apiKey
				}

				const sendBody = endpoint.body !== null && msg.body !== undefined
				if (sendBody) headers['Content-Type'] = 'application/json'

				this.log('debug', `Sending: ${endpoint.method} ${url}`)
				let requestResult: Awaited<ReturnType<typeof request>>
				try {
					requestResult = await request(url, {
						method: endpoint.method,
						signal: taskSignal,
						dispatcher: this.#dispatcher,
						headers,
						body: sendBody ? JSON.stringify(msg.body) : undefined,
					})
				} catch (err) {
					if (!taskSignal?.aborted) {
						this.#statusManager.updateStatus(
							InstanceStatus.ConnectionFailure,
							err instanceof Error ? err.message : String(err),
						)
					}
					throw err
				}

				const { statusCode, headers: responseHeaders, body } = requestResult
				const { status, message } = statusForHttpCode(statusCode)
				this.#statusManager.updateStatus(status, message)

				const contentType = String(responseHeaders['content-type'] ?? '')
				const text = await body.text()

				if (statusCode < 200 || statusCode >= 300) {
					throw new Error(
						`Unexpected status ${statusCode} for ${endpoint.method} ${path}${describeErrorBody(text, contentType)}`,
					)
				}

				// The mutating endpoints answer 200 with no body
				if (text.length === 0) return undefined

				if (!contentType.includes('json')) {
					this.log('debug', `Unexpected non-JSON response from ${path}: ${text}`)
					return text
				}

				try {
					return JSON.parse(text)
				} catch (err) {
					throw new Error(`Failed to parse JSON from ${path}: ${(err as Error).message}. Body: ${text}`, {
						cause: err,
					})
				}
			},
			{ signal: combinedSignal },
		)

		return response
	}

	// Return config fields for web config
	public getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	#updateActions(): void {
		UpdateActions(this)
	}

	#updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}

	#updatePresets(): void {
		UpdatePresets(this)
	}

	/**
	 * Sends the variable definitions and values the state now gives. Each is sent only if it
	 * has changed: CPU load moves on almost every poll, the rest rarely do.
	 */
	#updateVariables(): void {
		const definitions = getVariableDefinitions(this.#state)
		if (!isDeepStrictEqual(definitions, this.#variableDefinitions)) {
			this.setVariableDefinitions(definitions)
			this.#variableDefinitions = definitions
		}

		const values = getVariableValues(this.#state)
		const changed = changedValues(values, this.#variableValues)
		if (Object.keys(changed).length > 0) this.setVariableValues(changed)
		this.#variableValues = values
	}
}

/**
 * The entries of `next` that differ from `previous`. One missing from `next` is left out,
 * not cleared: it is a variable whose definition has gone with it.
 */
function changedValues<T extends object>(next: Partial<T>, previous: Partial<T>): Partial<T> {
	const changed: Partial<T> = {}
	for (const id in next) {
		if (!isDeepStrictEqual(next[id], previous[id])) changed[id] = next[id]
	}
	return changed
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err)
}

/**
 * Renders a failed response for an error message. The API documents an `{ error }` body for
 * its 400s and 404s, so prefer that over dumping the whole body. An unknown route answers
 * 404 with no body at all.
 */
function describeErrorBody(text: string, contentType: string): string {
	if (text.length === 0) return ''

	if (contentType.includes('json')) {
		let body: unknown
		try {
			body = JSON.parse(text)
		} catch {
			// not valid JSON after all, fall through to the raw body
		}

		const parsed = ErrorResponse.safeParse(body)
		if (parsed.success) return ` - ${parsed.data.error}`
	}

	return ` - ${text.slice(0, 200)}`
}
