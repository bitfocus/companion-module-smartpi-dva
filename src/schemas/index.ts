import type { z } from 'zod'

import * as AnnouncementsApi from './announcements.js'
import * as DestinationsApi from './destinations.js'
import * as NodeStatusApi from './node-status.js'
import * as QueueApi from './queue.js'
import * as TargetsApi from './targets.js'

export * from './announcements.js'
export * from './common.js'
export * from './destinations.js'
export * from './node-status.js'
export * from './queue.js'
export * from './targets.js'

export type HttpMethod = 'GET' | 'POST'

export type EndpointDefinition = {
	method: HttpMethod
	/** Path template, with `{param}` placeholders matching the `params` schema keys. */
	path: string
	/** Path parameters, or `null` when the endpoint takes none. */
	params: z.ZodType | null
	/** Request body, or `null` when the endpoint takes none. */
	body: z.ZodType | null
	response: z.ZodType
}

/**
 * Every operation in the DVA OpenAPI document (`docs/swagger.json`), keyed by operation name.
 *
 * All of them are covered by the `ApiKey` security scheme: an `x-api-key` header, checked
 * only when the Remote API key is enabled on the Node.
 *
 * Response schemas are compiled where they are declared. Request schemas are not.
 */
export const endpoints = {
	getStatus: {
		method: 'GET',
		path: '/api/status',
		params: null,
		body: null,
		response: NodeStatusApi.GetStatusResponse,
	},
	getStatusAll: {
		method: 'GET',
		path: '/api/status/all',
		params: null,
		body: null,
		response: NodeStatusApi.GetStatusAllResponse,
	},
	getAnnouncements: {
		method: 'GET',
		path: '/api/announcements',
		params: null,
		body: null,
		response: AnnouncementsApi.GetAnnouncementsResponse,
	},
	getDestinations: {
		method: 'GET',
		path: '/api/destinations',
		params: null,
		body: null,
		response: DestinationsApi.GetDestinationsResponse,
	},
	getQueue: {
		method: 'GET',
		path: '/api/queue',
		params: null,
		body: null,
		response: QueueApi.GetQueueResponse,
	},
	queueAnnouncement: {
		method: 'POST',
		path: '/api/queue',
		params: null,
		body: QueueApi.QueueRequest,
		response: QueueApi.QueueResponse,
	},
	getGroups: {
		method: 'GET',
		path: '/api/groups',
		params: null,
		body: null,
		response: TargetsApi.GetGroupsResponse,
	},
	getRegions: {
		method: 'GET',
		path: '/api/regions',
		params: null,
		body: null,
		response: TargetsApi.GetRegionsResponse,
	},
	getAreas: {
		method: 'GET',
		path: '/api/areas',
		params: null,
		body: null,
		response: TargetsApi.GetAreasResponse,
	},
} as const satisfies Record<string, EndpointDefinition>

export type EndpointName = keyof typeof endpoints

/** Substitutes `{param}` placeholders in an endpoint path template, URI-encoding each value. */
export function buildPath(template: string, params: Record<string, string | number> = {}): string {
	return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
		const value = params[key]
		if (value === undefined) throw new Error(`Missing path parameter '${key}' for '${template}'`)
		return encodeURIComponent(value)
	})
}
