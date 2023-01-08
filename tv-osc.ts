/// <reference path="./mpv-jutil/jutil.ts" />

const enum Keys { Up, Down, Left, Right, Enter }

namespace Settings {
	const PROPS_FILE = '~~/tv-osc.settings.json';

	export let autoload = false;

	const SAVED_PROPS = [
		'fullscreen',
		'audio', 'sub',
		'audio-delay', 'sub-delay',
		'sub-scale', 'sub-pos',
	];

	export const save = () => {
		const props: any = {autoload};
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

namespace Config {
	const FILE = '~~/script-opts/tv-osc.conf.json';

	interface Command {
		name: string
		cmd: string
	}

	export let commands: Command[] = [];

	export const load = () => {
		let config: any = {};
		try {
			config = JSON.parse(mp.utils.read_file(FILE));
		} catch {
			mp.msg.verbose(`No config at '${FILE}'`);
		}
		const cmdObj = (config?.commands || {});
		commands = Object.keys(cmdObj).map(k => ({name: k, cmd: cmdObj[k]}));
	}
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
	osd = new AssDraw()
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
	destroy() {
		this.osd.destroy();
	}
	update() {
		this.osd.start();
		this.osd.setOptions({
			an: AssAlignment.TopLeft,
			fs: 22,
			bord: 1,
		});
		this.osd.text(util.repeat('\n', 6));
		for (let i = 0; i < this.items.length; i++) {
			const [seps, it] = this.items[i];
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
			this.osd.text(util.repeat('\n', seps));
			if (this.selectedI === i) {
				this.osd.setOptions({b: true, bord: 2});
			}
			this.osd.text(str + '\n');
			if (this.selectedI === i) {
				this.osd.setOptions({b: false, bord: 1});
			}
		}
		this.osd.end();
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
	osd = new AssDraw()

	constructor() {
		this.update();
	}
	destroy() {
		this.osd.destroy();
	}
	update() {
		const width = 720 * mp.get_osd_size().aspect;

		this.osd.start();

		const posPercent = mp.get_property_number('percent-pos') / 100;
		this.osd.setOptions({color: [255, 255, 255, 200]});
		this.osd.rect(width * posPercent, 0, width * (1 - posPercent), 5);
		this.osd.setOptions({color: [255, 0, 0, 200]});
		this.osd.rect(0, 0, width * posPercent, 5);

		const title = mp.get_property('media-title') || '<unknown>';
		const pos = mp.get_property_number('time-pos');
		const duration = mp.get_property_number('duration');
		const posStr = util.hhmmss(pos, duration >= 3600);
		const durationStr = util.hhmmss(duration);
		this.osd.setOptions({
			an: AssAlignment.TopCenter,
			fs: 32,
			b: true,
			bord: 2,
		});
		this.osd.text(title);
		this.osd.setOptions({
			fs: 24,
			bord: 1,
		});
		this.osd.text(`\n${posStr}/${durationStr}`);

		this.osd.end();
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

	let selectedCommand = 0;

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
			pressHandler: () => mp.set_property('fullscreen', mp.get_property('fullscreen') === 'yes' ? 'no' : 'yes'),
			lrHandler: (_dir, it) => {
				it.pressHandler!!(it);
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
			lrHandler: dir => mp.set_property('audio-delay', mp.get_property_number('audio-delay') + dir * 0.025),
		},
		{
			title: 'Subtitle Delay',
			value: () => Math.round(mp.get_property('sub-delay') * 1000) + 'ms',
			pressHandler: () => mp.set_property('sub-delay', 0),
			lrHandler: dir => mp.set_property('sub-delay', mp.get_property_number('sub-delay') + dir * 0.025),
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
			title: 'Command',
			value: () => {
				if (Config.commands.length > 0) {
					return `${Config.commands[selectedCommand].name} (${selectedCommand + 1}/${Config.commands.length})`;
				} else {
					return 'N/A';
				}
			},
			pressHandler: () => {
				if (Config.commands.length > 0) {
					const cmd = Config.commands[selectedCommand].cmd;
					mp.msg.info(`Running command: '${cmd}'`);
					mp.command(cmd);
				}
			},
			lrHandler: dir => {
				if (Config.commands.length > 0) {
					selectedCommand = (selectedCommand + dir + Config.commands.length) % Config.commands.length;
				}
			},
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
	menu = new SimpleAssMenu(MainMenu.MENU)

	constructor() {
		mp.add_forced_key_binding('enter', 'tv-osc-enter', () => this.menu.key(Keys.Enter));
		const flags = {repeatable: true};
		mp.add_forced_key_binding('up', 'tv-osc-up', () => this.menu.key(Keys.Up), flags);
		mp.add_forced_key_binding('down', 'tv-osc-down', () => this.menu.key(Keys.Down), flags);
		mp.add_forced_key_binding('left', 'tv-osc-left', () => this.menu.key(Keys.Left), flags);
		mp.add_forced_key_binding('right', 'tv-osc-right', () => this.menu.key(Keys.Right), flags);
	}
	destroy() {
		mp.remove_key_binding('tv-osc-enter');
		mp.remove_key_binding('tv-osc-up');
		mp.remove_key_binding('tv-osc-down');
		mp.remove_key_binding('tv-osc-left');
		mp.remove_key_binding('tv-osc-right');
		this.menu.destroy();
	}
}

const init = () => {
	mp.unregister_event(init);
	Settings.load(true);
	Config.load();
};
mp.register_event('file-loaded', init);

let overlay: Overlay | null = null;
mp.add_key_binding('alt+u', 'tv-osc-toggle', () => {
	if (overlay) {
		overlay.destroy();
		overlay = null;
	} else {
		overlay = new Overlay();
	}
	showHideTitleProgress();
});

let titleProgress: TitleProgress | null = null;
const showHideTitleProgress = () => {
	const paused = mp.get_property_bool('pause');
	const overlayOn = !!overlay;
	if (paused || overlayOn) {
		if (titleProgress) {
			titleProgress.update()
		} else {
			titleProgress = new TitleProgress();

			// TODO: hack because weirdness when updating OSDs on pause
			setTimeout(() => titleProgress?.osd.overlay.update(), 100);
		}
	} else if (titleProgress) {
		titleProgress.destroy()
		titleProgress = null;
	}
}

mp.observe_property('media-title', 'string', () => titleProgress?.update());
mp.observe_property('time-pos', 'number', () => titleProgress?.update());
mp.observe_property('chapter', 'number', () => overlay?.menu.update());
mp.observe_property('pause', 'bool', showHideTitleProgress);