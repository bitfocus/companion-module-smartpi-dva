import { readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
	Announcement,
	Area,
	Destination,
	DestinationMember,
	endpoints,
	ErrorResponse,
	Group,
	IsoDateTime,
	NodeStatus,
	QueuedItem,
	QueueEntry,
	QueueRequest,
	QueueResponse,
	Region,
	SkippedDestination,
} from '../schemas/index.js'

/**
 * These tests hold the schemas to `docs/swagger.json` rather than restating it, so replacing
 * the document with a newer one reports exactly what has drifted.
 */

/** The JSON Schema keywords both the document and `z.toJSONSchema` output are read for. */
type SchemaNode = {
	$ref?: string | undefined
	type?: string | undefined
	properties?: Record<string, SchemaNode> | undefined
	items?: SchemaNode | undefined
	required?: string[] | undefined
	nullable?: boolean | undefined
	enum?: unknown[] | undefined
	format?: string | undefined
	minimum?: number | undefined
	maximum?: number | undefined
	example?: unknown
}

const SchemaNode: z.ZodType<SchemaNode> = z.lazy(() =>
	z.looseObject({
		$ref: z.string().optional(),
		type: z.string().optional(),
		properties: z.record(z.string(), SchemaNode).optional(),
		items: SchemaNode.optional(),
		required: z.array(z.string()).optional(),
		nullable: z.boolean().optional(),
		enum: z.array(z.unknown()).optional(),
		format: z.string().optional(),
		minimum: z.number().optional(),
		maximum: z.number().optional(),
		example: z.unknown().optional(),
	}),
)

const JsonContent = z.object({
	'application/json': z.object({
		schema: SchemaNode,
		example: z.unknown().optional(),
		examples: z.record(z.string(), z.object({ value: z.unknown() })).optional(),
	}),
})

const Operation = z.object({
	requestBody: z.object({ content: JsonContent }).optional(),
	responses: z.record(z.string(), z.object({ content: JsonContent.optional() })),
})

const OpenApiDocument = z.object({
	paths: z.record(z.string(), z.record(z.string(), Operation)),
	components: z.object({ schemas: z.record(z.string(), SchemaNode) }),
})

const doc = OpenApiDocument.parse(JSON.parse(readFileSync(new URL('../../docs/swagger.json', import.meta.url), 'utf8')))

/** Every keyword {@link compare} understands, plus the annotations it can safely ignore. */
const KNOWN_KEYWORDS = new Set([
	'$ref',
	'type',
	'properties',
	'items',
	'required',
	'nullable',
	'enum',
	'format',
	'minimum',
	'maximum',
	'description',
	'default',
	'example',
])

/** Width hints with no zod equivalent. `z.int()` against `z.number()` already covers them. */
const NUMBER_FORMATS = new Set(['int32', 'int64', 'float', 'double'])

function resolve(node: SchemaNode): SchemaNode {
	if (node.$ref === undefined) return node

	const name = node.$ref.replace('#/components/schemas/', '')
	const target = doc.components.schemas[name]
	if (target === undefined) throw new Error(`Unresolvable $ref ${node.$ref}`)
	return resolve(target)
}

/** `z.int()` emits the safe integer range as its bounds. Anything else was set on purpose. */
function bound(value: number | undefined): number | undefined {
	return value === undefined || Math.abs(value) === Number.MAX_SAFE_INTEGER ? undefined : value
}

function toJsonSchema(schema: z.ZodType): SchemaNode {
	return SchemaNode.parse(z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input' }))
}

/** Every way `actual`, from a zod schema, differs from `documented`. Empty when they agree. */
function compare(actual: SchemaNode | undefined, documented: SchemaNode, at: string): string[] {
	const want = resolve(documented)
	const problems = Object.keys(want)
		.filter((key) => !KNOWN_KEYWORDS.has(key))
		.map((key) => `${at}: the document uses '${key}', which this comparison does not check`)

	if (actual === undefined) return [...problems, `${at}: in the document but not the schema`]

	if (actual.type !== want.type) problems.push(`${at}: type is ${actual.type}, document says ${want.type}`)
	if (Boolean(actual.nullable) !== Boolean(want.nullable)) {
		problems.push(`${at}: nullable is ${Boolean(actual.nullable)}, document says ${Boolean(want.nullable)}`)
	}
	if (!isDeepStrictEqual(actual.enum, want.enum)) {
		problems.push(`${at}: enum is ${JSON.stringify(actual.enum)}, document says ${JSON.stringify(want.enum)}`)
	}

	const format = want.format !== undefined && NUMBER_FORMATS.has(want.format) ? undefined : want.format
	if (actual.format !== format) problems.push(`${at}: format is ${actual.format}, document says ${format}`)

	for (const key of ['minimum', 'maximum'] as const) {
		if (bound(actual[key]) !== want[key]) {
			problems.push(`${at}: ${key} is ${bound(actual[key])}, document says ${want[key]}`)
		}
	}

	if (want.items !== undefined) problems.push(...compare(actual.items, want.items, `${at}[]`))

	if (want.properties !== undefined || actual.properties !== undefined) {
		const documentedProperties = want.properties ?? {}
		const keys = new Set([...Object.keys(documentedProperties), ...Object.keys(actual.properties ?? {})])
		for (const key of keys) {
			const property = documentedProperties[key]
			if (property === undefined) {
				problems.push(`${at}.${key}: in the schema but not the document`)
				continue
			}
			problems.push(...compare(actual.properties?.[key], property, `${at}.${key}`))
		}
	}

	// The document marks nothing required on its responses, so only its own list is checked
	for (const key of want.required ?? []) {
		if (!actual.required?.includes(key)) problems.push(`${at}.${key}: required by the document, optional here`)
	}

	return problems
}

/** The schema standing for each entry in `components.schemas`. */
const components: Record<string, z.ZodType> = {
	NodeDto: NodeStatus,
	AnnouncementDto: Announcement,
	DestinationDto: Destination,
	QueueRequest: QueueRequest,
	QueuedItemDto: QueuedItem,
	QueueResponse: QueueResponse,
	QueueEntryDto: QueueEntry,
	ErrorResponse: ErrorResponse,
	DestinationMemberDto: DestinationMember,
	GroupDto: Group,
	RegionDto: Region,
	AreaDto: Area,
	SkippedDestinationDto: SkippedDestination,
}

function operationFor(endpoint: { method: string; path: string }): z.infer<typeof Operation> {
	const operation = doc.paths[endpoint.path]?.[endpoint.method.toLowerCase()]
	if (operation === undefined) throw new Error(`${endpoint.method} ${endpoint.path} is not in the document`)
	return operation
}

describe('component schemas match the document', () => {
	it('has a schema for every component', () => {
		expect(Object.keys(components).sort()).toEqual(Object.keys(doc.components.schemas).sort())
	})

	it.each(Object.entries(components))('%s', (name, schema) => {
		expect(compare(toJsonSchema(schema), doc.components.schemas[name] ?? {}, name)).toEqual([])
	})

	it.each(Object.entries(components).filter(([name]) => doc.components.schemas[name]?.example !== undefined))(
		'%s parses its example unchanged',
		(name, schema) => {
			const { example } = doc.components.schemas[name] ?? {}
			expect(schema.parse(example)).toEqual(example)
		},
	)
})

describe('the endpoint registry matches the document', () => {
	it('has an endpoint for every operation, and none it lacks', () => {
		const documented = Object.entries(doc.paths).flatMap(([path, methods]) =>
			Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
		)
		const registered = Object.values(endpoints).map(({ method, path }) => `${method} ${path}`)

		expect(registered.sort()).toEqual(documented.sort())
	})

	it.each(Object.entries(endpoints))('%s', (name, endpoint) => {
		const operation = operationFor(endpoint)
		const response = operation.responses['200']?.content?.['application/json']
		const body = operation.requestBody?.content['application/json']

		// `/api/status` and `/api/status/all` declare no response schema. captures.spec.ts covers them
		if (response !== undefined) {
			expect(compare(toJsonSchema(endpoint.response), response.schema, `${name} response`)).toEqual([])
		}

		expect(endpoint.body === null).toBe(body === undefined)
		if (endpoint.body !== null && body !== undefined) {
			expect(compare(toJsonSchema(endpoint.body), body.schema, `${name} body`)).toEqual([])
		}
	})

	// Built while collecting, so an endpoint missing from the document is skipped here rather
	// than failing the whole file. The registry test above reports it.
	const examples = Object.entries(endpoints).flatMap(([name, endpoint]) => {
		const operation = doc.paths[endpoint.path]?.[endpoint.method.toLowerCase()]
		if (operation === undefined) return []

		const response = operation.responses['200']?.content?.['application/json']?.example
		const bodies = Object.entries(operation.requestBody?.content['application/json'].examples ?? {})

		return [
			...bodies.map(([example, { value }]) => ({ label: `${name} body '${example}'`, schema: endpoint.body, value })),
			...(response === undefined ? [] : [{ label: `${name} response`, schema: endpoint.response, value: response }]),
		]
	})

	it.each(examples)('$label parses unchanged', ({ schema, value }) => {
		expect(schema?.parse(value)).toEqual(value)
	})
})

describe('QueueRequest', () => {
	it('rejects a request with no target', () => {
		expect(QueueRequest.safeParse({ announcementId: 12 }).success).toBe(false)
	})

	it('rejects a request whose only targets are empty lists', () => {
		const request = { announcementId: 12, destinationIds: [], groupIds: [], regionIds: [], areaIds: [] }
		expect(QueueRequest.safeParse(request).success).toBe(false)
	})

	it('rejects allDestinations: false as the only target', () => {
		expect(QueueRequest.safeParse({ announcementId: 12, allDestinations: false }).success).toBe(false)
	})

	it('accepts any one non-empty target', () => {
		for (const key of ['destinationIds', 'groupIds', 'regionIds', 'areaIds']) {
			expect(QueueRequest.safeParse({ announcementId: 12, [key]: [1] }).success, key).toBe(true)
		}
	})
})

describe('IsoDateTime', () => {
	it('accepts the offset the document uses, and Z', () => {
		expect(IsoDateTime.safeParse('2026-10-20T16:50:00+11:00').success).toBe(true)
		expect(IsoDateTime.safeParse('2026-10-20T05:50:00.123Z').success).toBe(true)
	})

	// A `date-time` carries an offset in RFC 3339. Relax this only once a capture shows otherwise.
	it('rejects a timestamp with no offset', () => {
		expect(IsoDateTime.safeParse('2026-10-20T16:50:00').success).toBe(false)
	})
})
