# Product

## Register

product

## Users

Mac audiophiles and power users who run a system-wide equalizer all day: headphone owners correcting frequency response (AutoEQ), people balancing per-app volume (music vs calls vs games), and tinkerers chaining Audio Unit effects. They open the window briefly but frequently — tweak a fader, switch a preset, close. The window is a *console*, not a document: glanceable state, direct manipulation, zero navigation depth.

## Product Purpose

eqMac Reborn is the open-source continuation of eqMac with every Pro feature implemented free: parametric/graphic EQ, per-app mixer, spatial audio, AU hosting, AutoEQ headphone profiles, hearing test, hotkeys, MIDI, recording, and a full HTTP/WebSocket API. Success = a first-time user finds and understands every audio control without opening a single menu, and a returning user reads the whole audio state in one glance.

## Brand Personality

Precise, tactile, alive. A hardware mixing console feel in software: controls look grabbable, meters move with the music, nothing is decoration. Confidence through density done right — professional, not intimidating.

## Anti-references

- The legacy eqMac v1.3 popover: narrow single column, features hidden behind gear menus and dialogs, tiny sliders, static graph.
- Generic settings-app layouts (rows of labeled dropdowns) — this is an instrument, not a preferences pane.
- Consumer "wellness audio" apps with oversized cards, gradients, and one control per screen.

## Design Principles

1. **Everything on the surface.** Every audio parameter is directly visible and manipulable on the main window. Dialogs are for management tasks (rules, bindings), never for audio controls.
2. **The signal is the interface.** Live spectrum, moving meters, curves that reshape as you drag — the UI always shows what the audio is doing right now.
3. **Physics of a console.** Full-travel faders, real knobs, log-spaced frequency axis like every hardware EQ ever made. Muscle memory from real gear must transfer.
4. **Glanceable state.** Enabled/bypassed, active preset, per-app levels readable across the room. Color = signal identity (band colors, channel L/R), never decoration.
5. **Fast path first.** The most common actions (volume, preset switch, band drag) take one gesture from window-open.

## Accessibility & Inclusion

- Keyboard: every fader/knob adjustable via arrow keys when focused; global hotkeys for the top actions.
- Respect reduced motion (spectrum decay stays, entrance animations go).
- Contrast ≥ 4.5:1 for text in both light and dark themes; band colors are distinguishable by position + label, never color alone.
- All controls carry tooltips/labels; i18n across en/de/fr/zh-Hans.
