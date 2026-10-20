import type { PolledEndpoint } from '../main.js'

/**
 * Responses captured from a live DVA on 2026-10-20 (DVA API 3.0.11, served by Kestrel), kept
 * as the raw body text. The demo rack's single Node, `DVA3`, had one saved announcement,
 * eight destinations and three groups. Nothing was queued and no regions or areas were set
 * up, so `/api/queue`, `/api/regions` and `/api/areas` each answered `[]`: their item shapes
 * are still unconfirmed. The Remote API key was disabled.
 */
export const captures = {
	getStatus: '{"id":1,"status":"Ok"}',
	getStatusAll:
		'[{"id":1,"nodeName":"DVA3","nodeDesc":"DEMO RACK, DVA node","onlineStatus":"Online","loggedOnUser":"DVA3","lastUpdateTs":1792490448,"cpuLoad":4.1}]',
	getAnnouncements:
		'[{"id":1,"name":"232","description":"WAITING OUTSIDE","priority":60,"expiry":1000,"type":"ModalChange"}]',
	getDestinations:
		'[{"id":1,"name":"Audio","outputChannel":1},{"id":2,"name":"Auracast / AFILS","outputChannel":2},{"id":3,"name":"Destination 3","outputChannel":3},{"id":4,"name":"Destination 4","outputChannel":4},{"id":5,"name":"Destination 5","outputChannel":5},{"id":6,"name":"Destination 6","outputChannel":6},{"id":7,"name":"Destination 7","outputChannel":7},{"id":8,"name":"Destination 8","outputChannel":8}]',
	getQueue: '[]',
	getGroups:
		'[{"id":1,"name":"All Audio","color":"blue","pos":1,"destinations":[{"id":1,"name":"Audio","outputChannel":1,"queueable":true},{"id":2,"name":"Auracast / AFILS","outputChannel":2,"queueable":true}]},{"id":2,"name":"Audio","color":"yellow","pos":2,"destinations":[{"id":1,"name":"Audio","outputChannel":1,"queueable":true}]},{"id":3,"name":"AFILS / Auracast","color":"yellow","pos":3,"destinations":[{"id":2,"name":"Auracast / AFILS","outputChannel":2,"queueable":true}]}]',
	getRegions: '[]',
	getAreas: '[]',
} as const satisfies Record<PolledEndpoint, string>
