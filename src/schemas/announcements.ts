import { z } from 'zod'

/** `components.schemas.AnnouncementDto`, a saved announcement (library item) on this Node. */
export const Announcement = z.object({
	id: z.int(),
	name: z.string(),
	description: z.string().nullable(),
	/** What it queues at, unless a queue request overrides it. */
	priority: z.int(),
	/** Queue timeout in seconds. */
	expiry: z.int().nullable(),
	/** Free text in the document, no enum. Observed: `'ModalChange'`. */
	type: z.string().nullable(),
})
export type Announcement = z.infer<typeof Announcement>

/** `GET /api/announcements` */
export const GetAnnouncementsResponse = z.compile(z.array(Announcement))
export type GetAnnouncementsResponse = z.infer<typeof GetAnnouncementsResponse>
