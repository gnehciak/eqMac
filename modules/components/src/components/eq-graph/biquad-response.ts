/**
 * RBJ Audio-EQ-Cookbook biquad magnitude-response math.
 *
 * The coefficient formulas below are the standard cookbook ones — the same
 * math the native DSP side uses to build its per-band biquad cascades — so
 * the curves rendered by eqm-eq-graph match what the audio engine actually
 * applies.
 *
 * Pure functions only, no Angular dependencies.
 */

export type EqGraphBandType =
  | 'peak'
  | 'lowPass'
  | 'highPass'
  | 'lowShelf'
  | 'highShelf'
  | 'bandPass'
  | 'notch'
  | 'allPass'

export type EqGraphBandChannel = 'left' | 'right' | 'both'

export interface EqGraphBand {
  id: string
  type: EqGraphBandType
  frequency: number
  gain: number
  q: number
  channel: EqGraphBandChannel
  enabled: boolean
}

/** Biquad coefficients normalized so that a0 === 1 */
export interface BiquadCoefficients {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

const MIN_Q = 0.001
const SILENCE_DB = -240

export function computeBiquadCoefficients (
  band: Pick<EqGraphBand, 'type' | 'frequency' | 'gain' | 'q'>,
  sampleRate: number
): BiquadCoefficients {
  const Fs = sampleRate > 0 ? sampleRate : 44100
  // Clamp the center frequency into the representable range for this Fs
  const f0 = Math.min(Math.max(band.frequency, 1), Fs / 2 * 0.999)
  const Q = Math.max(band.q, MIN_Q)
  const A = Math.pow(10, band.gain / 40)
  const w0 = 2 * Math.PI * (f0 / Fs)
  const cosW0 = Math.cos(w0)
  const sinW0 = Math.sin(w0)
  const alpha = sinW0 / (2 * Q)
  const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha

  let b0: number, b1: number, b2: number
  let a0: number, a1: number, a2: number

  switch (band.type) {
    case 'peak': {
      b0 = 1 + alpha * A
      b1 = -2 * cosW0
      b2 = 1 - alpha * A
      a0 = 1 + alpha / A
      a1 = -2 * cosW0
      a2 = 1 - alpha / A
      break
    }
    case 'lowPass': {
      b0 = (1 - cosW0) / 2
      b1 = 1 - cosW0
      b2 = (1 - cosW0) / 2
      a0 = 1 + alpha
      a1 = -2 * cosW0
      a2 = 1 - alpha
      break
    }
    case 'highPass': {
      b0 = (1 + cosW0) / 2
      b1 = -(1 + cosW0)
      b2 = (1 + cosW0) / 2
      a0 = 1 + alpha
      a1 = -2 * cosW0
      a2 = 1 - alpha
      break
    }
    case 'lowShelf': {
      b0 = A * ((A + 1) - (A - 1) * cosW0 + twoSqrtAAlpha)
      b1 = 2 * A * ((A - 1) - (A + 1) * cosW0)
      b2 = A * ((A + 1) - (A - 1) * cosW0 - twoSqrtAAlpha)
      a0 = (A + 1) + (A - 1) * cosW0 + twoSqrtAAlpha
      a1 = -2 * ((A - 1) + (A + 1) * cosW0)
      a2 = (A + 1) + (A - 1) * cosW0 - twoSqrtAAlpha
      break
    }
    case 'highShelf': {
      b0 = A * ((A + 1) + (A - 1) * cosW0 + twoSqrtAAlpha)
      b1 = -2 * A * ((A - 1) + (A + 1) * cosW0)
      b2 = A * ((A + 1) + (A - 1) * cosW0 - twoSqrtAAlpha)
      a0 = (A + 1) - (A - 1) * cosW0 + twoSqrtAAlpha
      a1 = 2 * ((A - 1) - (A + 1) * cosW0)
      a2 = (A + 1) - (A - 1) * cosW0 - twoSqrtAAlpha
      break
    }
    case 'bandPass': {
      // Constant 0 dB peak gain variant
      b0 = alpha
      b1 = 0
      b2 = -alpha
      a0 = 1 + alpha
      a1 = -2 * cosW0
      a2 = 1 - alpha
      break
    }
    case 'notch': {
      b0 = 1
      b1 = -2 * cosW0
      b2 = 1
      a0 = 1 + alpha
      a1 = -2 * cosW0
      a2 = 1 - alpha
      break
    }
    case 'allPass': {
      b0 = 1 - alpha
      b1 = -2 * cosW0
      b2 = 1 + alpha
      a0 = 1 + alpha
      a1 = -2 * cosW0
      a2 = 1 - alpha
      break
    }
    default: {
      // Unknown type -> pass-through
      b0 = 1; b1 = 0; b2 = 0
      a0 = 1; a1 = 0; a2 = 0
      break
    }
  }

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0
  }
}

/**
 * Magnitude of the biquad transfer function at `frequency`, in dB.
 * |H(e^jw)|^2 = ((b0 + b1 cos w + b2 cos 2w)^2 + (b1 sin w + b2 sin 2w)^2) /
 *              ((1  + a1 cos w + a2 cos 2w)^2 + (a1 sin w + a2 sin 2w)^2)
 */
export function biquadMagnitudeDb (
  coefficients: BiquadCoefficients,
  frequency: number,
  sampleRate: number
): number {
  const Fs = sampleRate > 0 ? sampleRate : 44100
  const w = 2 * Math.PI * (Math.min(frequency, Fs / 2) / Fs)
  const cos1 = Math.cos(w)
  const sin1 = Math.sin(w)
  const cos2 = Math.cos(2 * w)
  const sin2 = Math.sin(2 * w)
  const { b0, b1, b2, a1, a2 } = coefficients
  const numeratorReal = b0 + b1 * cos1 + b2 * cos2
  const numeratorImaginary = b1 * sin1 + b2 * sin2
  const denominatorReal = 1 + a1 * cos1 + a2 * cos2
  const denominatorImaginary = a1 * sin1 + a2 * sin2
  const numerator = numeratorReal * numeratorReal + numeratorImaginary * numeratorImaginary
  const denominator = denominatorReal * denominatorReal + denominatorImaginary * denominatorImaginary
  if (denominator <= 0) return SILENCE_DB
  const magnitude = Math.sqrt(numerator / denominator)
  if (magnitude <= 1e-12) return SILENCE_DB
  return 20 * Math.log10(magnitude)
}

/** Per-band magnitude response in dB for each of the given frequencies */
export function bandResponseDb (
  band: Pick<EqGraphBand, 'type' | 'frequency' | 'gain' | 'q'>,
  frequencies: number[],
  sampleRate: number
): number[] {
  const coefficients = computeBiquadCoefficients(band, sampleRate)
  return frequencies.map(frequency => biquadMagnitudeDb(coefficients, frequency, sampleRate))
}

/**
 * Summed (composite) response in dB of all enabled bands that affect the
 * given channel. A band affects 'left' when its channel is 'left' or 'both',
 * and 'right' when its channel is 'right' or 'both'.
 */
export function compositeResponseDb (
  bands: EqGraphBand[],
  frequencies: number[],
  sampleRate: number,
  channel: 'left' | 'right' = 'left'
): number[] {
  const sum = frequencies.map(() => 0)
  for (const band of bands) {
    if (!band.enabled) continue
    if (band.channel !== 'both' && band.channel !== channel) continue
    const coefficients = computeBiquadCoefficients(band, sampleRate)
    for (let i = 0; i < frequencies.length; i++) {
      sum[i] += biquadMagnitudeDb(coefficients, frequencies[i], sampleRate)
    }
  }
  return sum
}

// MARK: - Band colors (Pro-style rainbow ramp)

/**
 * Fixed rainbow ramp assigned to bands by index (orange, amber, yellow,
 * lime, green, teal, cyan, blue, indigo, violet — repeating), matching the
 * eqMac Pro reference design. These are the fallback values; a theme can
 * override any entry by stamping an `--eqm-eq-band-color-<index>` CSS custom
 * property (0-9) on :root, the same token-first pattern ColorsService uses.
 */
export const EQ_BAND_COLOR_RAMP: readonly string[] = [
  '#ff7a2f', // orange
  '#ffb02e', // amber
  '#ffe14d', // yellow
  '#a8e04a', // lime
  '#4cd964', // green
  '#2fd8b4', // teal
  '#35c8e8', // cyan
  '#4a90ff', // blue
  '#7a6bff', // indigo
  '#b05cff' // violet
]

/**
 * Color for the band at `index` (wraps around the ramp). Reads the optional
 * `--eqm-eq-band-color-<i>` theme token first, falling back to the fixed
 * ramp — safe to call outside the browser (tests / SSR).
 */
export function eqBandColor (index: number): string {
  const length = EQ_BAND_COLOR_RAMP.length
  const i = ((Math.round(index) % length) + length) % length
  const fallback = EQ_BAND_COLOR_RAMP[i]
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return fallback
  }
  try {
    const value = window.getComputedStyle(document.documentElement)
      .getPropertyValue(`--eqm-eq-band-color-${i}`)
    const trimmed = typeof value === 'string' ? value.trim() : ''
    return trimmed.length > 0 ? trimmed : fallback
  } catch (err) {
    return fallback
  }
}

/** `count` logarithmically spaced frequencies from `min` to `max` Hz (inclusive) */
export function logSpacedFrequencies (count: number, min = 20, max = 20000): number[] {
  const n = Math.max(count, 2)
  const logMin = Math.log(min)
  const logMax = Math.log(max)
  const frequencies: number[] = []
  for (let i = 0; i < n; i++) {
    frequencies.push(Math.exp(logMin + (i / (n - 1)) * (logMax - logMin)))
  }
  return frequencies
}
