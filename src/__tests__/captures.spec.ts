import { describe, expect, it } from 'vitest'
import { endpoints } from '../schemas/index.js'
import { captures } from './captures.js'

// An empty list parses whatever its items' schema, so it confirms nothing about them
const nonEmpty = Object.entries(captures).filter(([, body]) => body !== '[]')

describe('captured responses', () => {
	it.each(nonEmpty)('%s parses unchanged', (name, body) => {
		const value: unknown = JSON.parse(body)
		expect(endpoints[name as keyof typeof captures].response.parse(value)).toEqual(value)
	})
})
