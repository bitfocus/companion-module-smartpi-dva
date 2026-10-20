import { z } from 'zod'

/**
 * `components.schemas.NodeDto`.
 *
 * The document defines this but no operation references it: `/api/status` and
 * `/api/status/all` are declared with a bare `200 OK`. A capture shows it is what
 * `/api/status/all` returns.
 */
export const NodeStatus = z.object({
	id: z.int(),
	nodeName: z.string(),
	nodeDesc: z.string(),
	/** Free text in the document, no enum. Observed: `'Online'`. */
	onlineStatus: z.string(),
	loggedOnUser: z.string(),
	/** Unix epoch seconds. The document gives no unit; a capture does. */
	lastUpdateTs: z.int(),
	/** CPU load percentage, e.g. `24.73`. Declared `float`. */
	cpuLoad: z.number(),
})
export type NodeStatus = z.infer<typeof NodeStatus>

/**
 * `GET /api/status`, the Node serving the request. Undocumented. Taken from a capture, and
 * narrower than {@link NodeStatus}.
 */
export const GetStatusResponse = z.compile(
	z.object({
		/** The Node's id, as in {@link NodeStatus}. */
		id: z.int(),
		/** Observed: `'Ok'`. Left open, as no other value has been seen. */
		status: z.string(),
	}),
)
export type GetStatusResponse = z.infer<typeof GetStatusResponse>

/** `GET /api/status/all`, every Node. Can answer `500`. */
export const GetStatusAllResponse = z.compile(z.array(NodeStatus))
export type GetStatusAllResponse = z.infer<typeof GetStatusAllResponse>
