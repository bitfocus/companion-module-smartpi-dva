import type { CompanionActionDefinitions } from '@companion-module/base'
import { describe, expect, it, vi } from 'vitest'
import { ActionId, UpdateActions, type ActionSchema } from '../actions.js'
import type ModuleInstance from '../main.js'
import type { DeviceState } from '../main.js'
import { GetAnnouncementsResponse, GetGroupsResponse } from '../schemas/index.js'
import { captures } from './captures.js'

/** The state the poll saves from the captured announcements and groups. */
const captured: DeviceState = {
	getAnnouncements: GetAnnouncementsResponse.parse(JSON.parse(captures.getAnnouncements)),
	getGroups: GetGroupsResponse.parse(JSON.parse(captures.getGroups)),
}

/**
 * The document's example reply to `POST /api/queue`. No queue request has been sent to the
 * rack, as it would play the announcement.
 */
const exampleReply = {
	status: 'Queued',
	announcementId: 12,
	announcementName: 'Platform change',
	priority: 50,
	expiry: 300,
	items: [
		{ destinationId: 1, destinationName: 'Platform 1', outputChannel: 1, queuedTime: '2026-10-20T16:50:00+11:00' },
		{ destinationId: 3, destinationName: 'Concourse', outputChannel: 3, queuedTime: '2026-10-20T16:50:00+11:00' },
	],
	skipped: [
		{
			destinationId: 4,
			destinationName: 'Platform 4',
			outputChannel: 4,
			reason: 'Not active or not on a configured output channel (from group 2).',
		},
	],
}

/** A stand-in for the instance, with just what the actions use. */
function createSelf(state: DeviceState, reply: unknown = exampleReply) {
	const self = {
		state,
		setActionDefinitions: vi.fn(),
		sendMsg: vi.fn().mockResolvedValue(reply),
		log: vi.fn(),
	}
	UpdateActions(self as unknown as ModuleInstance)

	const definitions = self.setActionDefinitions.mock.calls[0]?.[0] as CompanionActionDefinitions<ActionSchema>
	const action = definitions[ActionId.AddToQueue]
	if (!action) throw new Error('Add to Queue is not defined')

	return { self, action }
}

type Callback = Exclude<CompanionActionDefinitions<ActionSchema>[ActionId.AddToQueue], false | undefined>['callback']

/** Runs the action as Companion would, once it has checked the options against their choices. */
async function run(action: { callback: Callback }, options: ActionSchema[ActionId.AddToQueue]['options']) {
	const signal = new AbortController().signal
	await action.callback({ options } as Parameters<Callback>[0], { signal } as Parameters<Callback>[1])
	return signal
}

describe('Add to Queue', () => {
	it('offers the announcements, labelled with their description', () => {
		const { action } = createSelf(captured)
		const [announcement] = action.options

		expect(announcement).toMatchObject({
			id: 'announcement',
			type: 'dropdown',
			choices: [{ id: 1, label: '232: WAITING OUTSIDE' }],
			default: 1,
		})
	})

	it('offers the groups in their dashboard order, and requires one', () => {
		const groups = [...(captured.getGroups ?? [])].reverse()
		const { action } = createSelf({ ...captured, getGroups: groups })
		const [, group] = action.options

		expect(group).toMatchObject({
			id: 'groups',
			type: 'multidropdown',
			choices: [
				{ id: 1, label: 'All Audio' },
				{ id: 2, label: 'Audio' },
				{ id: 3, label: 'AFILS / Auracast' },
			],
			default: [],
			minSelection: 1,
		})
	})

	it('says nothing has been read yet before the first poll', () => {
		const { action } = createSelf({})
		const [announcement, group] = action.options

		expect(announcement).toMatchObject({
			choices: [],
			default: 0,
			expressionDescription: 'No announcements have been read from the device yet',
		})
		expect(group).toMatchObject({ choices: [] })
	})

	it('posts the announcement and groups, passing the action signal on', async () => {
		const { self, action } = createSelf(captured)

		const signal = await run(action, { announcement: 1, groups: [1, 3] })

		expect(self.sendMsg).toHaveBeenCalledWith(
			{ endpoint: 'queueAnnouncement', body: { announcementId: 1, groupIds: [1, 3] } },
			signal,
		)
	})

	it('logs where it was queued, and each destination skipped', async () => {
		const { self, action } = createSelf(captured)

		await run(action, { announcement: 12, groups: [2] })

		expect(self.log.mock.calls).toEqual([
			['info', 'Queued "Platform change" on Platform 1, Concourse'],
			['warn', 'Add to Queue: skipped Platform 4: Not active or not on a configured output channel (from group 2).'],
		])
	})

	it('warns rather than failing when the announcement was queued but the reply does not parse', async () => {
		const { self, action } = createSelf(captured, { status: 'Queued' })

		await run(action, { announcement: 1, groups: [1] })

		expect(self.log).toHaveBeenCalledWith('warn', expect.stringContaining('queued, but the response was unexpected'))
	})

	it('fails when the request does', async () => {
		const { self, action } = createSelf(captured)
		self.sendMsg.mockRejectedValue(new Error('Unexpected status 404 for POST /api/queue - Announcement not found'))

		await expect(run(action, { announcement: 99, groups: [1] })).rejects.toThrow('Announcement not found')
	})
})
