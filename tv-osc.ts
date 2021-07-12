declare const mp: any;

// TODO:
// - More flexible settings save/load menu
// - Show progress on pause: mp.observe_property('pause', 'bool', ...);

enum Keys { Up, Down, Left, Right, Enter }

interface Config {
	filters?: {
		audio?: {[name: string]: string}
		shaders?: {[name: string]: string}
		// TODO: video?: {[name: string]: string}
	}
}

let config: Config = {};
const loadConfig = () => {
	const CONF_FILE = '~~/script-opts/tv-osc.conf.json';
	try {
		config = JSON.parse(mp.utils.read_file(CONF_FILE));
	} catch {
		mp.msg.info(`No config at '${CONF_FILE}'`);
	}
};

namespace mpv {
	export interface OsdOverlay {
		data: string
		update(): void
		remove(): void
	}

	export interface Track {
		// NOTE: incomplete
		id: string
		type: string
	}

	export interface Chapter {
		title: string
		time: number
	}

	export const createASS = (): OsdOverlay => mp.create_osd_overlay('ass-events');
}

const util = {
	clamp: (n: number, min: number, max: number) => n < min ? min : (n > max ? max : n),
	padTwoZero: (s: string) => s.length === 1 ? ('0' + s) : s,
	hhmmss(s: number, forceH?: boolean) {
		const h = Math.floor(s / 3600);
		s %= 3600;
		const m = Math.floor(s / 60);
		s = Math.floor(s % 60);
		return (h > 0 || forceH ? util.padTwoZero(h + '') + ':' : '')
				+ util.padTwoZero(m + '') + ':' + util.padTwoZero(s + '');
	},
	repeat(s: string, n: number): string {
		let str = '';
		while (n--) {
			str += s;
		}
		return str;
	},
	objectValues: (obj: {}): any[] => Object.keys(obj).map(k => obj[k]),
};

namespace Settings {
	const PROPS_FILE = '~~/tv-osc.settings.json';

	export let autoload = false;

	const SAVED_PROPS = [
		'fullscreen',
		'audio', 'sub',
		'audio-delay', 'sub-delay',
		'sub-scale', 'sub-pos',
		'af', 'glsl-shaders',
	];

	export const save = () => {
		const props = {autoload};
		for (let prop of SAVED_PROPS) {
			props[prop] = mp.get_property_native(prop);
		}
		mp.utils.write_file('file://' + PROPS_FILE, JSON.stringify(props));
		mp.osd_message('tv-osc settings saved');
	};

	export const load = (autoloaded: boolean) => {
		try {
			const props = JSON.parse(mp.utils.read_file(PROPS_FILE));
			autoload = props['autoload'] || false;
			if (autoloaded && !autoload) {
				return;
			}
			for (let prop of SAVED_PROPS) {
				if (props[prop]) {
					mp.set_property_native(prop, props[prop]);
				}
			}
			mp.osd_message('tv-osc settings loaded');
		} catch {
			if (!autoloaded) {
				mp.osd_message('File load failed');
			}
		}
	};
}

interface MenuItem {
	title: string
	value?: string | number | ((it: MenuItem) => string | number)
	pressHandler?(it: MenuItem): void
	lrHandler?(dir: -1 | 1, it: MenuItem): void
}

type MenuItemish = MenuItem | 'separator';

class SimpleAssMenu {
	items: [number, MenuItem][]
	osd = mpv.createASS()
	selectedI = 0

	constructor(items: MenuItemish[]) {
		this.items = [];
		let seps = 0;
		for (let it of items) {
			if (it === 'separator') {
				seps++;
			} else {
				this.items.push([seps, it]);
				seps = 0;
			}
		}
		this.update();
	}
	destroy = () => this.osd.remove();
	update() {
		this.osd.data = '\\N\\N\\N' + this.items.map(([seps, it], i) => {
			let str = it.title;
			if (it.value !== undefined) {
				if (typeof it.value === 'function') {
					str += ' (' + it.value(it) + ')';
				} else {
					str += ' (' + it.value + ')';
				}
			}
			if (it.pressHandler) {
				str = '[ ' + str + ' ]';
			}
			if (it.lrHandler) {
				str = '[<] ' + str + ' [>]';
			}
			return util.repeat('{\\an7}{\\fs16}\\N', seps) + '{\\an7}{\\fs22}{\\bord1}'
					+ (this.selectedI === i ? '{\\b1}' : '') + str;
		}).join('\n');
		this.osd.update();
	}
	key(key: Keys) {
		if (this.items.length > 0) {
			const it = this.items[this.selectedI][1];
			switch (key) {
			case Keys.Up:
				this.selectedI = (this.selectedI + this.items.length - 1) % this.items.length;
				break;
			case Keys.Down:
				this.selectedI = (this.selectedI + 1) % this.items.length;
				break;
			case Keys.Left:
				if (it.lrHandler) {
					it.lrHandler(-1, it);
				}
				break;
			case Keys.Right:
				if (it.lrHandler) {
					it.lrHandler(1, it);
				}
				break;
			case Keys.Enter:
				if (it.pressHandler) {
					it.pressHandler(it);
				}
				break;
			}
		}
		this.update();
	}
}

class TitleProgress {
	osd = mpv.createASS()

	constructor() {
		this.update();
	}
	destroy = () => this.osd.remove();
	update() {
		const title = mp.get_property('media-title');
		const pos = mp.get_property_number('time-pos');
		const duration = mp.get_property_number('duration');
		const posStr = util.hhmmss(pos, duration >= 3600);
		const durationStr = util.hhmmss(duration);
		const posPercent = Math.round(mp.get_property_number('percent-pos') * 100) / 100;
		this.osd.data = `{\\an8}{\\fs32}${title}\n{\\an8}{\\fs24}${posStr}/${durationStr} - ${posPercent}%`;
		this.osd.update();
	}
}

namespace MainMenu {
	const trackStr = (type: string) => {
		const tracks: mpv.Track[] = JSON.parse(mp.get_property('track-list'));
		const title = mp.get_property(`current-tracks/${type}/title`);
		const lang = mp.get_property(`current-tracks/${type}/lang`);
		const id = mp.get_property(type);
		const count = tracks.filter(t => t.type === type).length;
		if (count) {
			return `${title ? title + ' ' : ''}${lang ? lang + ' ' : ''}${id}/${count}`;
		} else {
			return 'N/A';
		}
	};
	const cycleTrack = (type: string, dir: number) => {
		const tracks: mpv.Track[] = JSON.parse(mp.get_property('track-list'));
		const count = tracks.filter(t => t.type === type).length;
		const currentStr = mp.get_property(type);
		const current = currentStr === 'no' ? 0 : parseInt(currentStr);
		const next = (current + count + 1 + dir) % (count + 1);
		mp.set_property(type, next === 0 ? 'no' : next);
	};

	// NOTE: This state-management is a bit flimsy and won't detect external changes.
	//       The reason this is used is because the value set with mp.set_property
	//       won't always result in getting the same value back with mp.get_property
	//       when dealing with filters. mp.get_property_native could be used, but
	//       then it'd also require a cache for the actual values to match against,
	//       or for the user to put the native values in config, which is undesired.
	// TODO: Figure out how to detect external changes, or even just loading settings.
	type FilterState = {index: number, setValue?: any};
	const filterStates: {[k: string]: FilterState} = {
		'af': {index: 0, setValue: null},
		'glsl-shaders': {index: 0, setValue: null}
	};
	const FILTER_KEYS = {
		'af': 'audio',
		'glsl-shaders': 'shaders',
	};
	const filterPresetKeys = (type: string) => {
		const presetKeys = Object.keys(config.filters?.[FILTER_KEYS[type]] || {});
		presetKeys.splice(0, 0, presetKeys.length === 0 ? 'None (N/A)' : 'None')
		return presetKeys;
	};
	const filterStr = (type: string) => {
		const presets = config.filters?.[FILTER_KEYS[type]] || {};
		const presetName = filterPresetKeys(type)[filterStates[type].index];
		const isSet = filterStates[type].setValue === presets[presetName];
		return `${presetName} (${isSet ? 'Set' : 'Not Set'})`;
	};
	const cycleFilter = (type: string, dir: number) => {
		const count = filterPresetKeys(type).length;
		filterStates[type].index = (filterStates[type].index + count + dir) % count;
	};
	const applyFilter = (type: string) => {
		const presets = config.filters?.[FILTER_KEYS[type]] || {};
		const presetName = filterPresetKeys(type)[filterStates[type].index];
		mp.set_property(type, presets[presetName] || '');
		filterStates[type].setValue = presets[presetName];
	};

	export const MENU: MenuItemish[] = [
		{
			title: 'Chapter',
			value: () => {
				const chapters: mpv.Chapter[] = JSON.parse(mp.get_property('chapter-list'));
				if (chapters.length > 0) {
					const chapterI = mp.get_property_number('chapter');
					return `${chapterI + 1}/${chapters.length}`;
				} else {
					return 'N/A';
				}
			},
			lrHandler: dir => {
				const chapters: mpv.Chapter[] = JSON.parse(mp.get_property('chapter-list'));
				if (chapters.length > 0) {
					const chapterI = mp.get_property_number('chapter');
					const newChapter = util.clamp(chapterI + dir, 0, chapters.length - 1);
					mp.set_property('chapter', newChapter);
				}
			},
		},
		{
			title: 'Fullscreen',
			value: () => mp.get_property('fullscreen'),
			pressHandler: () => mp.set_property('fullscreen',
					mp.get_property('fullscreen') === 'yes' ? 'no' : 'yes'),
			lrHandler: (_dir, it) => {
				it.pressHandler(it);
			},
		},
		'separator',
		{
			title: 'Audio Track',
			value: () => trackStr('audio'),
			// pressHandler: () => {}, // TODO: show selection menu
			lrHandler: dir => cycleTrack('audio', dir),
		},
		{
			title: 'Subtitle Track',
			value: () => trackStr('sub'),
			// pressHandler: () => {}, // TODO: show selection menu
			lrHandler: dir => cycleTrack('sub', dir),
		},
		'separator',
		{
			title: 'Audio Delay',
			value: () => Math.round(mp.get_property('audio-delay') * 1000) + 'ms',
			pressHandler: () => mp.set_property('audio-delay', 0),
			lrHandler: dir => mp.set_property('audio-delay',
					mp.get_property_number('audio-delay') + dir * 0.025),
		},
		{
			title: 'Subtitle Delay',
			value: () => Math.round(mp.get_property('sub-delay') * 1000) + 'ms',
			pressHandler: () => mp.set_property('sub-delay', 0),
			lrHandler: dir => mp.set_property('sub-delay',
					mp.get_property_number('sub-delay') + dir * 0.025),
		},
		'separator',
		{
			title: 'Shader',
			value: () => filterStr('glsl-shaders'),
			pressHandler: () => applyFilter('glsl-shaders'),
			lrHandler: dir => cycleFilter('glsl-shaders', dir),
		},
		{
			title: 'Audio Filter',
			value: () => filterStr('af'),
			pressHandler: () => applyFilter('af'),
			lrHandler: dir => cycleFilter('af', dir),
		},
		'separator',
		{
			title: 'Subtitle Scale',
			value: () => Math.round(mp.get_property('sub-scale') * 100) / 100,
			pressHandler: () => mp.set_property('sub-scale', 1),
			lrHandler: dir => {
				const newVal = mp.get_property_number('sub-scale') + dir * 0.05;
				mp.set_property('sub-scale', util.clamp(newVal, 0.05, 5));
			},
		},
		{
			title: 'Subtitle Position',
			value: () => mp.get_property('sub-pos'),
			pressHandler: () => mp.set_property('sub-pos', 100),
			lrHandler: dir => {
				const newVal = mp.get_property_number('sub-pos') + dir * 5;
				mp.set_property('sub-pos', util.clamp(newVal, 0, 150));
			},
		},
		'separator',
		{
			title: 'Autoload Settings',
			value: () => Settings.autoload ? 'yes' : 'no',
			lrHandler: () => Settings.autoload = !Settings.autoload,
		},
		{
			title: 'Save Settings',
			pressHandler: Settings.save,
		},
		{
			title: 'Load Settings',
			pressHandler: () => Settings.load(false),
		},
		'separator',
		{
			title: 'Save Position & Quit',
			pressHandler: () => mp.command('quit-watch-later'),
		},
		{
			title: 'Quit',
			pressHandler: () => mp.command('quit'),
		},
	];
}

class Overlay {
	titleProgress = new TitleProgress()
	menu = new SimpleAssMenu(MainMenu.MENU)

	destroy() {
		this.titleProgress.destroy();
		this.menu.destroy();
	}
	key(key: Keys) {
		this.menu.key(key);
	}
}

let overlay: Overlay = null;

const openOverlay = () => {
	overlay = new Overlay();
	mp.add_forced_key_binding('enter', 'tv-osc-enter', () => overlay.key(Keys.Enter));
	const flags = {repeatable: true};
	mp.add_forced_key_binding('up', 'tv-osc-up', () => overlay.key(Keys.Up), flags);
	mp.add_forced_key_binding('down', 'tv-osc-down', () => overlay.key(Keys.Down), flags);
	mp.add_forced_key_binding('left', 'tv-osc-left', () => overlay.key(Keys.Left), flags);
	mp.add_forced_key_binding('right', 'tv-osc-right', () => overlay.key(Keys.Right), flags);
};

const closeOverlay = () => {
	mp.remove_key_binding('tv-osc-enter');
	mp.remove_key_binding('tv-osc-up');
	mp.remove_key_binding('tv-osc-down');
	mp.remove_key_binding('tv-osc-left');
	mp.remove_key_binding('tv-osc-right');
	overlay.destroy();
	overlay = null;
};

const init = () => {
	mp.unregister_event(init);
	loadConfig();
	Settings.load(true);
};
mp.register_event('file-loaded', init);

mp.add_key_binding('alt+u', 'tv-osc-toggle', () => {
	if (overlay) {
		closeOverlay();
	} else {
		openOverlay();
	}
});

mp.add_key_binding('q', 'tv-osc-back', () => {
	if (overlay) {
		closeOverlay();
	} else {
		mp.command('quit');
	}
});

mp.observe_property('media-title', 'string', () => overlay?.titleProgress.update());
mp.observe_property('time-pos', 'number', () => overlay?.titleProgress.update());
mp.observe_property('chapter', 'number', () => overlay?.menu.update());
