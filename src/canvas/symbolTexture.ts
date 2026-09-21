import { Texture } from 'pixi.js'

const masks = new WeakMap<Texture, Texture>()

// A white alpha mask lets Pixi tint the actual ink, including black source pixels.
// Each shared symbol is converted once, never during a pointer gesture.
export function tintableSymbol(original: Texture): Texture {
  const cached = masks.get(original)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = original.source.pixelWidth
  canvas.height = original.source.pixelHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Could not prepare symbol artwork')
  context.drawImage(
    original.source.resource as CanvasImageSource,
    0,
    0,
    canvas.width,
    canvas.height,
  )
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
  for (let i = 0; i < pixels.data.length; i += 4) {
    const ink = 1 - (pixels.data[i] + pixels.data[i + 1] + pixels.data[i + 2]) / (3 * 255)
    pixels.data[i + 3] = Math.round(pixels.data[i + 3] * ink)
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255
  }
  context.putImageData(pixels, 0, 0)
  const texture = Texture.from(canvas)
  masks.set(original, texture)
  return texture
}
