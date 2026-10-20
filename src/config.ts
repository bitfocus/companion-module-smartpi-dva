import { Regex, type SomeCompanionConfigField } from '@companion-module/base'

export type ModuleConfig = {
	host: string
	apikey: boolean
	protocol: 'http' | 'https'
	allowInsecure: boolean
	interval: number
}

export type ModuleSecrets = {
	xapikey: string
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'textinput',
			id: 'host',
			label: 'Host',
			width: 8,
			regex: Regex.HOSTNAME,
		},
		{
			type: 'dropdown',
			id: 'protocol',
			label: 'Protocol',
			default: 'http',
			choices: [
				{ id: 'http', label: 'HTTP' },
				{ id: 'https', label: 'HTTPS' },
			],
			width: 4,
			disableAutoExpression: true,
		},
		{
			type: 'checkbox',
			id: 'allowInsecure',
			label: 'Allow Insecure Connections',
			default: false,
			width: 4,
			description: 'Accept self-signed or otherwise untrusted TLS certificates when using HTTPS.',
			isVisibleExpression: '$(options:protocol) == "https"',
		},
		{
			type: 'checkbox',
			id: 'apikey',
			label: 'Use X-API-Key',
			width: 4,
			default: false,
		},
		{
			type: 'secret-text',
			id: 'xapikey',
			label: 'X-API-Key',
			width: 8,
			default: '',
			isVisibleExpression: '$(options:apikey)',
		},
		{
			type: 'number',
			id: 'interval',
			label: 'Update Interval (S)',
			width: 4,
			default: 60,
			min: 1,
			max: 3600,
		},
	]
}
