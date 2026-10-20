import { z } from 'zod'

/** `components.schemas.DestinationDto`, a destination that can be queued to. */
export const Destination = z.object({
	id: z.int(),
	name: z.string(),
	outputChannel: z.int(),
})
export type Destination = z.infer<typeof Destination>

/** `components.schemas.DestinationMemberDto`, a destination as listed in a group, region or area. */
export const DestinationMember = Destination.extend({
	/**
	 * Active and on a configured output channel. A member that is not is skipped when its
	 * group, region or area is queued.
	 */
	queueable: z.boolean(),
})
export type DestinationMember = z.infer<typeof DestinationMember>

/** `GET /api/destinations`: only those that are active and on a configured output channel. */
export const GetDestinationsResponse = z.compile(z.array(Destination))
export type GetDestinationsResponse = z.infer<typeof GetDestinationsResponse>
