import type { CompanionVariableDefinitions } from '@companion-module/base'
import type { DeviceState } from './main.js'
import type { NodeStatus } from './schemas/index.js'

/** What each Node in `/api/status/all` gets a variable for, as `node_<id>_<field>`. */
const nodeFields = {
	name: { label: 'name', value: (node) => node.nodeName },
	description: { label: 'description', value: (node) => node.nodeDesc },
	online_status: { label: 'online status', value: (node) => node.onlineStatus },
	logged_on_user: { label: 'logged on user', value: (node) => node.loggedOnUser },
	last_update: { label: 'last update (Unix seconds)', value: (node) => node.lastUpdateTs },
	cpu_load: { label: 'CPU load (%)', value: (node) => node.cpuLoad },
} as const satisfies Record<string, { label: string; value: (node: NodeStatus) => string | number }>

type NodeField = keyof typeof nodeFields

type NodeVariables = {
	[F in NodeField as `node_${number}_${F}`]: ReturnType<(typeof nodeFields)[F]['value']>
}

export type VariablesSchema = NodeVariables & {
	/** From `/api/status`: the Node serving the connection. */
	node_id: number
	status: string
}

/**
 * {@link nodeFields}, typed as a mapped type so that indexing it with a generic field keeps
 * the value's type tied to that field.
 */
const fieldTable: {
	[F in NodeField]: { label: string; value: (node: NodeStatus) => NodeVariables[`node_${number}_${F}`] }
} = nodeFields

const fields = Object.keys(nodeFields) as NodeField[]

function nodeVariableId<F extends NodeField>(id: number, field: F): `node_${number}_${F}` {
	return `node_${id}_${field}`
}

/** One set of `node_<id>_` variables for each Node the last `/api/status/all` listed. */
export function getVariableDefinitions(state: DeviceState): CompanionVariableDefinitions<VariablesSchema> {
	const definitions: CompanionVariableDefinitions<VariablesSchema> = {
		node_id: { name: 'Node ID' },
		status: { name: 'Node status' },
	}

	for (const node of state.getStatusAll ?? []) {
		const prefix = node.nodeName ? `Node ${node.id} (${node.nodeName})` : `Node ${node.id}`
		for (const field of fields) {
			definitions[nodeVariableId(node.id, field)] = { name: `${prefix} ${fieldTable[field].label}` }
		}
	}

	return definitions
}

/** Every variable's value. `node_id` and `status` are `undefined` until `/api/status` has answered. */
export function getVariableValues(state: DeviceState): Partial<VariablesSchema> {
	const values: Partial<VariablesSchema> = {
		node_id: state.getStatus?.id,
		status: state.getStatus?.status,
	}

	for (const node of state.getStatusAll ?? []) {
		for (const field of fields) setNodeValue(values, node, field)
	}

	return values
}

/** Generic so the variable's id and its value stay tied to the one field. */
function setNodeValue<F extends NodeField>(values: Partial<VariablesSchema>, node: NodeStatus, field: F): void {
	values[nodeVariableId(node.id, field)] = fieldTable[field].value(node)
}
