// Material Design Icons (the set Home Assistant uses), referenced by key from home.json.
import {
	mdiCoachLamp,
	mdiCoachLampVariant,
	mdiGarageAlert,
	mdiGarageOpenVariant,
	mdiGarageVariant,
	mdiHomeLightbulb,
	mdiHomeLightbulbOutline,
	mdiLightbulbOn,
	mdiLightbulbOutline,
} from '@mdi/js';

/** Icon per state; `default` is used for states without their own icon. */
const TILE_ICONS: Record<string, Record<string, string>> = {
	garage: { default: mdiGarageVariant, open: mdiGarageOpenVariant, opening: mdiGarageOpenVariant, closing: mdiGarageOpenVariant, unavailable: mdiGarageAlert },
	light: { default: mdiLightbulbOutline, on: mdiLightbulbOn },
	'outdoor-lamp': { default: mdiCoachLamp, on: mdiCoachLampVariant },
	'house-light': { default: mdiHomeLightbulbOutline, on: mdiHomeLightbulb },
};

export function iconSvg(path: string, className: string): SVGSVGElement {
	const ns = 'http://www.w3.org/2000/svg';
	const icon = document.createElementNS(ns, 'svg');
	icon.setAttribute('viewBox', '0 0 24 24');
	icon.setAttribute('class', className);
	icon.setAttribute('aria-hidden', 'true');
	const shape = document.createElementNS(ns, 'path');
	shape.setAttribute('d', path);
	shape.setAttribute('fill', 'currentColor');
	icon.append(shape);
	return icon;
}

export function tileIcon(key: string, state: string): SVGSVGElement | null {
	const set = TILE_ICONS[key];
	return set ? iconSvg(set[state] ?? set.default, 'home-tile-icon') : null;
}
