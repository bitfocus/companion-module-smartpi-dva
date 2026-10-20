import type ModuleInstance from './main.js'

/** None yet. */
export type FeedbackSchema = Record<string, never>

export function UpdateFeedbacks(self: ModuleInstance): void {
	self.setFeedbackDefinitions({})
}
