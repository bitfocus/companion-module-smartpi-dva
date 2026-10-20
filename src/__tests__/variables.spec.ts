import { describe, expect, it } from 'vitest'
import type { DeviceState } from '../main.js'
import { GetStatusAllResponse, GetStatusResponse } from '../schemas/index.js'
import { getVariableDefinitions, getVariableValues } from '../variables.js'
import { captures } from './captures.js'

/** The state the poll saves from the captured `/api/status` and `/api/status/all`. */
const captured: DeviceState = {
	getStatus: GetStatusResponse.parse(JSON.parse(captures.getStatus)),
	getStatusAll: GetStatusAllResponse.parse(JSON.parse(captures.getStatusAll)),
}

describe('getVariableDefinitions', () => {
	it('defines node_id and status, and a set for each node', () => {
		expect(getVariableDefinitions(captured)).toEqual({
			node_id: { name: 'Node ID' },
			status: { name: 'Node status' },
			node_1_name: { name: 'Node 1 (DVA3) name' },
			node_1_description: { name: 'Node 1 (DVA3) description' },
			node_1_online_status: { name: 'Node 1 (DVA3) online status' },
			node_1_logged_on_user: { name: 'Node 1 (DVA3) logged on user' },
			node_1_last_update: { name: 'Node 1 (DVA3) last update (Unix seconds)' },
			node_1_cpu_load: { name: 'Node 1 (DVA3) CPU load (%)' },
		})
	})

	it('leaves the name out of the label of a node that has none', () => {
		const [node] = captured.getStatusAll ?? []
		const definitions = getVariableDefinitions({ getStatusAll: [{ ...node, nodeName: '' }] })

		expect(definitions.node_1_cpu_load).toEqual({ name: 'Node 1 CPU load (%)' })
	})

	it('defines only node_id and status before anything has been polled', () => {
		expect(getVariableDefinitions({})).toEqual({ node_id: { name: 'Node ID' }, status: { name: 'Node status' } })
	})
})

describe('getVariableValues', () => {
	it('takes each value from the last responses', () => {
		expect(getVariableValues(captured)).toEqual({
			node_id: 1,
			status: 'Ok',
			node_1_name: 'DVA3',
			node_1_description: 'DEMO RACK, DVA node',
			node_1_online_status: 'Online',
			node_1_logged_on_user: 'DVA3',
			node_1_last_update: 1792490448,
			node_1_cpu_load: 4.1,
		})
	})

	it('leaves node_id and status undefined before /api/status has answered', () => {
		expect(getVariableValues({})).toStrictEqual({ node_id: undefined, status: undefined })
	})

	// The demo rack has one node, so the second is the first with its id and name changed
	it('keeps the nodes apart, and defines every value it gives', () => {
		const [node] = captured.getStatusAll ?? []
		const state: DeviceState = {
			...captured,
			getStatusAll: [node, { ...node, id: 2, nodeName: 'DVA4', cpuLoad: 51 }],
		}

		const values = getVariableValues(state)

		expect(values).toMatchObject({
			node_1_name: 'DVA3',
			node_1_cpu_load: 4.1,
			node_2_name: 'DVA4',
			node_2_cpu_load: 51,
		})
		expect(Object.keys(getVariableDefinitions(state)).sort()).toEqual(Object.keys(values).sort())
	})
})
