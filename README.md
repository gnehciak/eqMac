<p align="center">
  <img width="400" src="https://github.com/bitgapp/eqMac/raw/master/assets/logos/promo-dark.png"/>
</p>

<p align="center">
  <img width="1024" src="https://github.com/bitgapp/eqMac/raw/master/assets/screenshots/autoeq-promo.png"/>
</p>

# eqMac Reborn

A community fork of [bitgapp/eqMac](https://github.com/bitgapp/eqMac) (open-source v1.3.2) that implements, in open source, the feature set of eqMac Pro ([eqmac.app/#features](https://eqmac.app/#features)) plus the feature set of [Peace Equalizer](https://sourceforge.net/projects/peace-equalizer-apo-extension/) (the Windows Equalizer APO front end), translated to macOS.

Everything here is free and open source. No subscriptions, no license keys.

## Features

### Equalizers
* **Basic EQ** — Bass / Mids / Treble with peak-limiter auto-gain *(upstream)*
* **Advanced EQ** — 10 fixed bands, 22 genre presets *(upstream)*
* **Expert EQ** *(new)* — parametric EQ with unlimited bands (soft cap 64), 8 filter types (peak, low/high pass, low/high shelf, band-pass, notch, all-pass), per-band frequency / gain / Q, graphical SVG curve editor with drag + scroll-to-Q interactions
* **Separate L/R equalization** *(new)* — every Expert EQ band can target left, right, or both channels
* **Graphic 31-band EQ** *(new)* — ISO third-octave bands, Peace-style, with genre presets interpolated from the Advanced tables
* **Spectrum analyzer** *(new)* — live 30 fps FFT display underlaying the Expert EQ curve
* **AutoEQ headphone presets** *(new)* — bundled database of 8,850 headphone profiles from [AutoEq](https://github.com/jaakkopasanen/AutoEq), searchable browser, one-click audition or save-as-preset
* **Hearing test** *(new)* — staircase audiometry wizard (9 frequencies × 2 ears) that generates a personalized compensation preset (per-ear Expert preset + Advanced approximation)

### Effects (Peace-style suite, all new)
* **Crossfeed** — bs2b-style headphone crossfeed (cutoff + level)
* **Channel delay** — independent left/right delay 0–30 ms
* **Channel routing** — stereo / mono downmix / swap L-R / left-to-both / right-to-both
* **Preamp** — ±24 dB with auto-gain compensation
* **Spatial audio** — 13 reverb environments (rooms, halls, plate, cathedral…) with wet/dry control
* **Audio Unit hosting** — chain your third-party AU effect plugins into the system audio pipeline, with native plugin editor windows and state persistence

### Mixing & control (new)
* **App Mixer** — per-application volume and mute, implemented at the driver level
* **Super Presets** — auto-switch EQ type + preset when the output device or the frontmost app changes
* **Global hotkeys** — volume, mute, boost, preset cycling, enable/disable, show/hide (Carbon hotkeys, no accessibility permission needed)
* **MIDI controller support** — map CC/notes to volume, balance, preamp, preset switching, with MIDI-learn
* **Recorder** — record the processed system audio to AAC/M4A
* **HTTP + WebSocket API** — control every eqMac route from any language; token-authenticated
* **Remote control** — serve the UI over LAN to phones/other machines via the built-in server

### UI (new)
* **Themes** — CSS custom-property theme engine, built-in themes + custom accent color
* **Section arrangement** — reorder and show/hide the main sections
* **Localization** — English, German, French, Simplified Chinese (machine-draft; PRs welcome)
* **Import/export** — presets for every EQ type + whole-config backup/restore (`.eqmacbackup`)

### Upstream features retained
* System audio processing via the userspace HAL driver
* Volume booster, balance for all devices (including HDMI/DisplayPort)
* Works with Built-in, Bluetooth, AirPlay, USB, HDMI, DisplayPort, Thunderbolt, Aggregate devices

## Building

```bash
# UI (Node; use --openssl-legacy-provider on Node 17+)
npm install --legacy-peer-deps
cd ui && NODE_OPTIONS=--openssl-legacy-provider npm run build

# Native app + self-installing bundle (requires full Xcode + CocoaPods)
cd native && pod install
./package-app.sh            # builds app + driver, bundles the driver, ad-hoc signs
```

`package-app.sh` produces `build/eqMac.app` — a **self-contained, self-installing** bundle. Copy it to a fresh Mac, double-click, and on first launch it prompts once for your admin password and installs its audio driver itself (no separate installer, no download). To iterate in Xcode instead, `open eqMac.xcworkspace` and build the `eqMac` scheme.

Notes:
* `pod install` is required once — the fork adds the [Telegraph](https://github.com/Building42/Telegraph) pod for the HTTP/WebSocket server.
* The audio driver ships **inside** the app (`Contents/Resources/eqMac.driver`) and is installed on demand via `install-driver.sh`; you no longer copy it to `/Library/Audio/Plug-Ins/HAL` by hand.
* **No phone-home.** This fork removes Sparkle auto-updates, Google Analytics telemetry, Sentry crash reporting, and the over-the-air remote-UI fetch — the UI is always loaded from the copy embedded in the app. It contacts no vendor server; the only network listeners are the local/LAN control API (ports 37624/37628/37629).
* The AutoEQ database (`native/app/Assets/Embedded/autoeq-db.json.gz`) is generated from AutoEq's parametric EQ results and ships with the app.

## Technology
* [App](native/app) — native Swift backend: audio engine (AVAudioEngine two-engine passthrough + lock-free raw DSP chain), state, API server, lifecycle.
* [UI](ui) — Angular web UI, embedded in the app and also served over LAN for remote control.
* [Driver](native/driver) — userspace CoreAudio Audio Server Plug-in (Swift) that captures system audio, now with per-client volume for the App Mixer.

## Credits

* [@nodeful](https://github.com/nodeful) — creator and developer of eqMac
* [@titanicbobo](https://github.com/titanicbobo) — Big Sur icon design
* [Max Heim](https://github.com/0bmxa) — first Swift Audio Server Plug-in driver, [Pancake](https://github.com/0bmxa/Pancake)
* [Jaakko Pasanen](https://github.com/jaakkopasanen) — [AutoEq](https://github.com/jaakkopasanen/AutoEq), source of the headphone preset database
* [Peter Verbeek](https://sourceforge.net/projects/peace-equalizer-apo-extension/) — Peace Equalizer, the inspiration for the effects suite
* Upstream project: [bitgapp/eqMac](https://github.com/bitgapp/eqMac) (GPLv3)
