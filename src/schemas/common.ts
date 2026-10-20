import { z } from 'zod'

/**
 * Shared primitives for the DVA remote API, as described by `docs/swagger.json` (DVA API 3.0.11).
 *
 * The OpenAPI document marks no property `required` on any response DTO. Every declared
 * property is treated as always present, with `null` allowed only where the document says
 * `nullable`. That is how a DTO serialiser normally writes them, but it has not yet been
 * checked against a live Node.
 */

/**
 * An RFC 3339 `date-time`, which carries an offset: `2026-10-20T16:50:00+11:00` in the
 * document's examples. A timestamp without one is rejected.
 */
export const IsoDateTime = z.iso.datetime({ offset: true })
export type IsoDateTime = z.infer<typeof IsoDateTime>

/** `components.schemas.ErrorResponse`, the body of a 400 or 404 from `POST /api/queue`. */
export const ErrorResponse = z.object({
	error: z.string(),
})
export type ErrorResponse = z.infer<typeof ErrorResponse>
