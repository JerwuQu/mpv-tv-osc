# mpv-tv-osc

OSD Overlay to change media settings from a TV-like controller that only has arrows, select and back.

The following README is mostly for my own reference.

## Install

Run `update.sh` to install the latest release on linux. Alternatively [grab it yourself](https://github.com/JerwuQu/mpv-tv-osc/releases/latest), or compile with `make` (using the TypeScript compiler `tsc`), and put the js file into `<mpv config dir>/scripts`.

## Config

The menu is bound to alt+u by default but can be changed by adding `<key> script-binding tv-osc-toggle` to `<mpv config dir>/input.conf`.

You can add custom filter presets by adding a `<mpv config dir>/script-opts/tv-osc.conf.json` (or equivalent) file. There's an example [here](https://github.com/JerwuQu/mpv-tv-osc/blob/master/tv-osc.conf.json).
