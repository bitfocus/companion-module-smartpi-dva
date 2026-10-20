import type { DropdownChoice } from '@companion-module/base'
import type { DeviceState } from './main.js'

/**
 * Option helpers shared by actions and feedbacks, so an id dropdown is presented the same
 * way wherever it appears.
 */

/**
 * The saved announcements, labelled with their description where they have one: the
 * captured one is named `232` and described `WAITING OUTSIDE`. Empty until the first poll.
 */
export function getAnnouncementChoices(state: DeviceState): DropdownChoice<number>[] {
	return (state.getAnnouncements ?? []).map(({ id, name, description }) => {
		const label = name || `Announcement ${id}`
		return { id, label: description ? `${label}: ${description}` : label }
	})
}

/** The dashboard's "My Groups" zone buttons, in their dashboard order. Empty until the first poll. */
export function getGroupChoices(state: DeviceState): DropdownChoice<number>[] {
	return [...(state.getGroups ?? [])]
		.sort((a, b) => a.pos - b.pos)
		.map(({ id, name }) => ({ id, label: name || `Group ${id}` }))
}

/** The values an id dropdown will accept once it is in expression mode. */
export function describeIdChoices(choices: DropdownChoice<number>[], noun: string): string {
	if (choices.length === 0) return `No ${noun} have been read from the device yet`

	return `Accepted values: ${formatIdRanges(choices.map((choice) => choice.id))}`
}

/**
 * Collapses a set of ids into the shortest readable form: runs of consecutive ids become
 * `min-max`, isolated ids are listed on their own — `1-5, 7, 11-14`.
 */
function formatIdRanges(ids: number[]): string {
	const sorted = [...new Set(ids)].sort((a, b) => a - b)
	if (sorted.length === 0) return ''

	const parts: string[] = []
	let start = sorted[0]
	let end = start

	for (const id of sorted.slice(1)) {
		if (id === end + 1) {
			end = id
			continue
		}

		parts.push(start === end ? `${start}` : `${start}-${end}`)
		start = id
		end = id
	}
	parts.push(start === end ? `${start}` : `${start}-${end}`)

	return parts.join(', ')
}
