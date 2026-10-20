import { z } from 'zod'
import { IsoDateTime } from './common.js'

/**
 * The states a queue entry can be in. `as const` so that `z.enum()` infers a union of
 * literals; a state outside the document's list fails the parse.
 */
export const QueueEntryStatus = ['Waiting', 'Played', 'Playing', 'Paused', 'Expired'] as const
export type QueueEntryStatus = (typeof QueueEntryStatus)[number]

/**
 * `components.schemas.QueueEntryDto`, one item in the play queue of an output channel.
 * Carries the destination's name but not its id.
 */
export const QueueEntry = z.object({
	outputChannel: z.int(),
	destinationName: z.string(),
	announcementId: z.int(),
	announcementName: z.string(),
	priority: z.int(),
	status: z.enum(QueueEntryStatus),
	queuedTime: IsoDateTime,
})
export type QueueEntry = z.infer<typeof QueueEntry>

/**
 * `GET /api/queue`. Summarised as the waiting and playing items, but {@link QueueEntryStatus}
 * also allows played, paused and expired ones.
 */
export const GetQueueResponse = z.compile(z.array(QueueEntry))
export type GetQueueResponse = z.infer<typeof GetQueueResponse>

/** The range a queue request's `priority` override must fall in. */
export const QUEUE_PRIORITY_MIN = 1
export const QUEUE_PRIORITY_MAX = 100

const TargetIds = z.array(z.int())

/**
 * `components.schemas.QueueRequest`, the body of `POST /api/queue`.
 *
 * The targets are combined and de-duplicated by destination id. The document requires at
 * least one, so a request with none, or with only empty lists, is rejected here rather than
 * with a `400`.
 */
export const QueueRequest = z
	.object({
		announcementId: z.int(),
		/** An unknown id is a `404`; an inactive one, or one on an unconfigured channel, a `400`. */
		destinationIds: TargetIds.optional(),
		/** Members that are not queueable are skipped, and listed in the response's `skipped`. */
		groupIds: TargetIds.optional(),
		/** Members that are not queueable are skipped. */
		regionIds: TargetIds.optional(),
		/** Members that are not queueable are skipped. */
		areaIds: TargetIds.optional(),
		/** Every active destination on a configured output channel. The server defaults it to `false`. */
		allDestinations: z.boolean().optional(),
		/** Overrides the announcement's own priority, for this request only. */
		priority: z.int().min(QUEUE_PRIORITY_MIN).max(QUEUE_PRIORITY_MAX).nullish(),
	})
	.refine(
		(request) =>
			request.allDestinations === true ||
			[request.destinationIds, request.groupIds, request.regionIds, request.areaIds].some(
				(ids) => ids !== undefined && ids.length > 0,
			),
		{ error: 'Give at least one target: destinationIds, groupIds, regionIds, areaIds or allDestinations' },
	)
export type QueueRequest = z.infer<typeof QueueRequest>

/** Fields shared by {@link QueuedItem} and {@link SkippedDestination}. */
const QueueTarget = z.object({
	destinationId: z.int(),
	destinationName: z.string(),
	outputChannel: z.int(),
})

/** `components.schemas.QueuedItemDto`, a destination the announcement was queued on. */
export const QueuedItem = QueueTarget.extend({
	queuedTime: IsoDateTime,
})
export type QueuedItem = z.infer<typeof QueuedItem>

/** `components.schemas.SkippedDestinationDto`, a group, region or area member left out. */
export const SkippedDestination = QueueTarget.extend({
	/** Free text, e.g. `Not active or not on a configured output channel (from group 2).` */
	reason: z.string(),
})
export type SkippedDestination = z.infer<typeof SkippedDestination>

/** `components.schemas.QueueResponse`, the `200` reply to `POST /api/queue`. */
export const QueueResponse = z.compile(
	z.object({
		/** `'Queued'` in the document's example. No enum is declared. */
		status: z.string(),
		announcementId: z.int(),
		announcementName: z.string(),
		priority: z.int(),
		/** Queue timeout in seconds. */
		expiry: z.int().nullable(),
		items: z.array(QueuedItem),
		skipped: z.array(SkippedDestination),
	}),
)
export type QueueResponse = z.infer<typeof QueueResponse>
