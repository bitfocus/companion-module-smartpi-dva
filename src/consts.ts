import { combineRgb, type CompanionButtonStyleProps } from '@companion-module/base'

export const colours = {
	white: combineRgb(255, 255, 255),
	black: combineRgb(0, 0, 0),
	red: combineRgb(240, 0, 0),
	green: combineRgb(102, 255, 102),
	orange: combineRgb(255, 191, 128),
} as const satisfies Record<string, number>

export const presetDefaults = {
	style: {
		size: '18',
		alignment: 'center:center',
		color: colours.white,
		bgcolor: colours.black,
	},
} as const satisfies { style: Partial<CompanionButtonStyleProps> }
