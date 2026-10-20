import { z } from 'zod'
import { DestinationMember } from './destinations.js'

/**
 * The named sets of destinations a queue request can target, besides individual destinations.
 * Each lists every member, queueable or not.
 */
const DestinationSet = z.object({
	id: z.int(),
	name: z.string(),
	destinations: z.array(DestinationMember),
})

/** `components.schemas.GroupDto`, a dashboard "My Groups" zone button. */
export const Group = DestinationSet.extend({
	/** A colour name, not a hex value. The document gives no format. Observed: `'blue'`, `'yellow'`. */
	color: z.string().nullable(),
	/** Position among the zone buttons. */
	pos: z.int(),
})
export type Group = z.infer<typeof Group>

/**
 * `components.schemas.RegionDto`, a Dynamic popup region. `destinations` holds its direct
 * destinations plus those of its areas.
 */
export const Region = DestinationSet.extend({
	areaIds: z.array(z.int()),
})
export type Region = z.infer<typeof Region>

/** `components.schemas.AreaDto`, a Dynamic popup area. */
export const Area = DestinationSet
export type Area = z.infer<typeof Area>

/** `GET /api/groups` */
export const GetGroupsResponse = z.compile(z.array(Group))
export type GetGroupsResponse = z.infer<typeof GetGroupsResponse>

/** `GET /api/regions` */
export const GetRegionsResponse = z.compile(z.array(Region))
export type GetRegionsResponse = z.infer<typeof GetRegionsResponse>

/** `GET /api/areas` */
export const GetAreasResponse = z.compile(z.array(Area))
export type GetAreasResponse = z.infer<typeof GetAreasResponse>
