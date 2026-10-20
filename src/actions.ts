import type { CompanionActionDefinitions } from '@companion-module/base'
import type ModuleInstance from './main.js'
import { describeIdChoices, getAnnouncementChoices, getGroupChoices } from './options.js'
import { QueueResponse } from './schemas/index.js'

export enum ActionId {
	AddToQueue = 'add_to_queue',
}

export type ActionSchema = {
	[ActionId.AddToQueue]: {
		options: {
			announcement: number
			groups: number[]
		}
	}
}

export function UpdateActions(self: ModuleInstance): void {
	const announcementChoices = getAnnouncementChoices(self.state)
	const groupChoices = getGroupChoices(self.state)

	const actions: CompanionActionDefinitions<ActionSchema> = {
		[ActionId.AddToQueue]: {
			name: 'Add to Queue',
			description: "Queues a saved announcement on one or more groups, as the dashboard's Add to Queue does",
			options: [
				{
					id: 'announcement',
					type: 'dropdown',
					label: 'Announcement',
					choices: announcementChoices,
					// The first announcement, or 0 before any have been read
					default: announcementChoices[0]?.id ?? 0,
					expressionDescription: describeIdChoices(announcementChoices, 'announcements'),
				},
				{
					id: 'groups',
					type: 'multidropdown',
					label: 'Groups',
					choices: groupChoices,
					default: [],
					minSelection: 1,
					sortSelection: true,
					description: 'Members that are inactive or not on a configured output channel are skipped',
					expressionDescription: `An array of group ids, e.g. [1, 2]. ${describeIdChoices(groupChoices, 'groups')}`,
				},
			],
			// Companion has checked both options against their choices, and that a group is selected
			callback: async ({ options }, context) => {
				const reply = await self.sendMsg(
					{ endpoint: 'queueAnnouncement', body: { announcementId: options.announcement, groupIds: options.groups } },
					context.signal,
				)

				// The announcement is queued by now, so a reply that doesn't parse is not a failure
				const response = QueueResponse.safeParse(reply)
				if (!response.success) {
					self.log('warn', `Add to Queue: queued, but the response was unexpected: ${response.error.message}`)
					return
				}

				const { announcementName, items, skipped } = response.data
				self.log('info', `Queued "${announcementName}" on ${items.map((item) => item.destinationName).join(', ')}`)
				for (const { destinationName, reason } of skipped) {
					self.log('warn', `Add to Queue: skipped ${destinationName}: ${reason}`)
				}
			},
		},
	}

	self.setActionDefinitions(actions)
}
