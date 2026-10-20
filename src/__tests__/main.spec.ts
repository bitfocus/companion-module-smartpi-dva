import { InstanceStatus, type CompanionActionDefinitions } from '@companion-module/base'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActionId, type ActionSchema } from '../actions.js'
import type { ModuleConfig, ModuleSecrets } from '../config.js'
import ModuleInstance from '../main.js'
import { endpoints } from '../schemas/index.js'
import { captures } from './captures.js'
import { FakeDva } from './fakeDva.js'

/** What InstanceBase needs from the host, with everything it forwards to Companion mocked */
function createContext() {
	return {
		id: 'test-instance',
		_isInstanceContext: true as const,
		label: 'test',
		upgradeScripts: [],
		saveConfig: vi.fn(),
		updateStatus: vi.fn(),
		oscSend: vi.fn(),
		recordAction: vi.fn(),
		setActionDefinitions: vi.fn(),
		subscribeActions: vi.fn(),
		unsubscribeActions: vi.fn(),
		setFeedbackDefinitions: vi.fn(),
		unsubscribeFeedbacks: vi.fn(),
		checkFeedbacks: vi.fn(),
		checkAllFeedbacks: vi.fn(),
		checkFeedbacksById: vi.fn(),
		setPresetDefinitions: vi.fn(),
		setCompositeElementDefinitions: vi.fn(),
		setVariableDefinitions: vi.fn(),
		setVariableValues: vi.fn(),
		getVariableValue: vi.fn(),
		sharedUdpSocketHandlers: new Map(),
		sharedUdpSocketJoin: vi.fn(),
		sharedUdpSocketLeave: vi.fn(),
		sharedUdpSocketSend: vi.fn(),
	}
}

/** What the poll should hold once every endpoint has answered with its capture. */
const captured = Object.fromEntries(Object.entries(captures).map(([name, body]) => [name, JSON.parse(body) as unknown]))

/** Each polled endpoint's request, as the fake records it. */
const polledRequests = Object.keys(captures).map((name) => {
	const { method, path } = endpoints[name as keyof typeof captures]
	return `${method} ${path}`
})

const secrets: ModuleSecrets = { xapikey: '' }

let fake: FakeDva
const instances: ModuleInstance[] = []

beforeEach(async () => {
	fake = new FakeDva()
	await fake.listen()
})

afterEach(async () => {
	for (const instance of instances.splice(0)) await instance.destroy()
	await fake.close()
})

function createInstance() {
	const context = createContext()
	const instance = new ModuleInstance(context)
	const log = vi.spyOn(instance, 'log').mockImplementation(() => {})
	instances.push(instance)
	return { instance, context, log }
}

/** An interval long enough that only the poll on connecting runs, unless a test says otherwise. */
function config(overrides: Partial<ModuleConfig> = {}): ModuleConfig {
	return { host: fake.host, protocol: 'http', apikey: false, allowInsecure: false, interval: 3600, ...overrides }
}

/** The status manager sends at most one status per 2 s, so this waits up to 3. */
async function expectStatus(
	context: ReturnType<typeof createContext>,
	status: InstanceStatus,
	message: string | null = null,
): Promise<void> {
	await vi.waitFor(() => expect(context.updateStatus).toHaveBeenLastCalledWith(status, message), { timeout: 3000 })
}

describe('poll', () => {
	it('saves the response from every GET endpoint, requesting each once', async () => {
		const { instance, context } = createInstance()
		await instance.init(config(), true, secrets)

		await vi.waitFor(() => expect(instance.state).toEqual(captured))
		expect([...fake.requests].sort()).toEqual([...polledRequests].sort())
		await expectStatus(context, InstanceStatus.Ok)
	})

	// The document says /api/status/all can answer 500
	it('saves the other responses, and warns, when an endpoint fails', async () => {
		fake.replies.set('GET /api/status/all', { status: 500 })
		const { instance, context, log } = createInstance()
		await instance.init(config(), true, secrets)

		await vi.waitFor(() =>
			expect(log).toHaveBeenCalledWith(
				'error',
				expect.stringContaining('Unexpected status 500 for GET /api/status/all'),
			),
		)

		const { getStatusAll: _failed, ...others } = captured
		expect(instance.state).toEqual(others)
		await expectStatus(context, InstanceStatus.UnknownWarning, '1 of 8 requests failed, see log')
	})

	it('saves the other responses, and warns, when one does not parse', async () => {
		fake.replies.set('GET /api/announcements', { body: '[{"id":"one"}]' })
		const { instance, context, log } = createInstance()
		await instance.init(config(), true, secrets)

		await vi.waitFor(() =>
			expect(log).toHaveBeenCalledWith('error', expect.stringContaining('Unexpected response from /api/announcements')),
		)

		const { getAnnouncements: _invalid, ...others } = captured
		expect(instance.state).toEqual(others)
		await expectStatus(context, InstanceStatus.UnknownWarning, '1 of 8 requests failed, see log')
	})

	// As another web server on the configured address might, which sendMsg would report as Ok
	it('warns when every request is answered but no response parses', async () => {
		for (const request of polledRequests) fake.replies.set(request, { body: '{"unexpected":true}' })
		const { instance, context, log } = createInstance()
		await instance.init(config(), true, secrets)

		await vi.waitFor(() => expect(log).toHaveBeenCalledWith('error', expect.stringContaining('/api/areas')))

		expect(instance.state).toEqual({})
		await expectStatus(context, InstanceStatus.UnknownWarning, '8 of 8 requests failed, see log')
	})

	it('leaves the status the requests reported when every one of them fails', async () => {
		for (const request of polledRequests) fake.replies.set(request, { status: 401 })
		const { instance, context, log } = createInstance()
		await instance.init(config(), true, secrets)

		await vi.waitFor(() => expect(log).toHaveBeenCalledWith('error', expect.stringContaining('/api/areas')))

		expect(instance.state).toEqual({})
		await expectStatus(context, InstanceStatus.AuthenticationFailure, 'Authentication failed (status 401)')
	})

	it('keeps the last valid response when a later one does not parse', async () => {
		const { instance, log } = createInstance()
		await instance.init(config({ interval: 1 }), true, secrets)
		await vi.waitFor(() => expect(instance.state).toEqual(captured))

		fake.replies.set('GET /api/announcements', { body: '{}' })
		await vi.waitFor(() => expect(log).toHaveBeenCalledWith('error', expect.stringContaining('/api/announcements')), {
			timeout: 2500,
		})

		expect(instance.state.getAnnouncements).toEqual(captured.getAnnouncements)
	})

	it('rebuilds the definitions once for a poll that changes several lists', async () => {
		const { instance, context } = createInstance()
		await instance.init(config(), true, secrets)
		await vi.waitFor(() => expect(instance.state).toEqual(captured))

		// Once for the config, then once for the first poll's five new lists
		expect(context.setActionDefinitions).toHaveBeenCalledTimes(2)
	})

	it('does not rebuild the definitions when none of their lists changed', async () => {
		for (const path of ['announcements', 'destinations', 'groups', 'regions', 'areas']) {
			fake.replies.set(`GET /api/${path}`, { status: 500 })
		}
		const { instance, context, log } = createInstance()
		await instance.init(config(), true, secrets)

		await vi.waitFor(() => expect(log).toHaveBeenCalledWith('error', expect.stringContaining('/api/areas')))
		expect(Object.keys(instance.state).sort()).toEqual(['getQueue', 'getStatus', 'getStatusAll'])
		expect(context.setActionDefinitions).toHaveBeenCalledTimes(1)
	})
})

describe('a config change', () => {
	it('clears the saved responses', async () => {
		const { instance } = createInstance()
		await instance.init(config(), true, secrets)
		await vi.waitFor(() => expect(instance.state).toEqual(captured))

		void instance.configUpdated(config(), secrets)

		expect(instance.state).toEqual({})
	})

	it('polls at once, even while the old config still has a poll in flight', async () => {
		let release = (): void => {}
		const held = new Promise<void>((resolve) => (release = resolve))
		let first = true
		fake.replies.set('GET /api/status', async () => {
			if (first) {
				first = false
				await held
			}
			return { body: captures.getStatus }
		})

		const { instance } = createInstance()
		await instance.init(config(), true, secrets)
		await vi.waitFor(() => expect(fake.requests).toEqual(['GET /api/status']))

		void instance.configUpdated(config(), secrets)

		// The interval is an hour, so only the poll on the config change can fill this in time
		await vi.waitFor(() => expect(instance.state).toEqual(captured))
		release()
	})
})

describe('variables', () => {
	/** Every value sent so far, later calls overriding earlier ones, as Companion would hold them. */
	const sentValues = (context: ReturnType<typeof createContext>): Record<string, unknown> =>
		Object.assign({}, ...context.setVariableValues.mock.calls.map(([values]) => values as object)) as Record<
			string,
			unknown
		>

	it('are defined and set from the first poll', async () => {
		const { instance, context } = createInstance()
		await instance.init(config(), true, secrets)
		await vi.waitFor(() => expect(instance.state).toEqual(captured))

		expect(Object.keys(context.setVariableDefinitions.mock.calls.at(-1)?.[0] ?? {}).sort()).toEqual(
			[
				'node_id',
				'status',
				'node_1_name',
				'node_1_description',
				'node_1_online_status',
				'node_1_logged_on_user',
				'node_1_last_update',
				'node_1_cpu_load',
			].sort(),
		)
		expect(sentValues(context)).toEqual({
			node_id: 1,
			status: 'Ok',
			node_1_name: 'DVA3',
			node_1_description: 'DEMO RACK, DVA node',
			node_1_online_status: 'Online',
			node_1_logged_on_user: 'DVA3',
			node_1_last_update: 1792490448,
			node_1_cpu_load: 4.1,
		})
	})

	it('send only what changed on a later poll', async () => {
		const { instance, context } = createInstance()
		await instance.init(config({ interval: 1 }), true, secrets)
		await vi.waitFor(() => expect(instance.state).toEqual(captured))
		context.setVariableDefinitions.mockClear()
		context.setVariableValues.mockClear()

		fake.replies.set('GET /api/status/all', { body: captures.getStatusAll.replace('"cpuLoad":4.1', '"cpuLoad":9.5') })

		await vi.waitFor(() => expect(context.setVariableValues).toHaveBeenCalled(), { timeout: 2500 })
		expect(context.setVariableValues.mock.calls).toEqual([[{ node_1_cpu_load: 9.5 }]])
		expect(context.setVariableDefinitions).not.toHaveBeenCalled()
	})

	it('drop the nodes, and clear node_id and status, when the config changes', async () => {
		const { instance, context } = createInstance()
		await instance.init(config(), true, secrets)
		await vi.waitFor(() => expect(instance.state).toEqual(captured))
		context.setVariableDefinitions.mockClear()
		context.setVariableValues.mockClear()

		void instance.configUpdated(config(), secrets)

		expect(context.setVariableDefinitions.mock.calls).toEqual([
			[{ node_id: { name: 'Node ID' }, status: { name: 'Node status' } }],
		])
		// Strict, as an id sent with undefined is what clears it
		expect(context.setVariableValues.mock.calls).toStrictEqual([[{ node_id: undefined, status: undefined }]])
	})
})

describe('Add to Queue', () => {
	it('posts the chosen announcement and groups to the device', async () => {
		const { instance, context, log } = createInstance()
		await instance.init(config(), true, secrets)
		await vi.waitFor(() => expect(instance.state).toEqual(captured))
		// The document's reply, cut down to the rack's groups: no queue request has been sent to it
		fake.replies.set('POST /api/queue', {
			body: JSON.stringify({
				status: 'Queued',
				announcementId: 1,
				announcementName: '232',
				priority: 60,
				expiry: 1000,
				items: [
					{ destinationId: 1, destinationName: 'Audio', outputChannel: 1, queuedTime: '2026-10-20T16:50:00+11:00' },
				],
				skipped: [],
			}),
		})

		const definitions = context.setActionDefinitions.mock.calls.at(-1)?.[0] as CompanionActionDefinitions<ActionSchema>
		const action = definitions[ActionId.AddToQueue]
		if (!action) throw new Error('Add to Queue is not defined')
		type Callback = typeof action.callback
		await action.callback(
			{ options: { announcement: 1, groups: [2] } } as Parameters<Callback>[0],
			{ signal: new AbortController().signal } as Parameters<Callback>[1],
		)

		expect(fake.bodies).toEqual([{ request: 'POST /api/queue', body: { announcementId: 1, groupIds: [2] } }])
		expect(log).toHaveBeenCalledWith('info', 'Queued "232" on Audio')
	})
})

describe('sendMsg', () => {
	it("puts the API's error in the message of a failed request", async () => {
		fake.replies.set('POST /api/queue', {
			status: 400,
			body: '{"error":"Selection resolves to no active destinations"}',
		})
		const { instance } = createInstance()
		await instance.init(config(), true, secrets)

		await expect(
			instance.sendMsg({ endpoint: 'queueAnnouncement', body: { announcementId: 1, areaIds: [9] } }),
		).rejects.toThrow('Unexpected status 400 for POST /api/queue - Selection resolves to no active destinations')
	})
})
