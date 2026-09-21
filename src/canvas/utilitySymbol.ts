import type { Graphics } from 'pixi.js'
import type { Point } from '../core/types'

// Draw one continuous stem on the terminal's centerline. The raster artwork's
// off-center lead overlapped the generic port extension, producing a visible step.
export function drawUtilitySource(graphics: Graphics, color: number, terminal: Point) {
  const triangle = [
    { x: -29, y: -22.5 },
    { x: 29, y: -22.5 },
    { x: terminal.x, y: 16 },
  ]
  for (const slope of [-1, 1]) {
    for (let offset = -60; offset <= 60; offset += 12) {
      const intersections: Point[] = []
      for (let i = 0; i < triangle.length; i++) {
        const a = triangle[i],
          b = triangle[(i + 1) % triangle.length]
        const t = (slope * a.x + offset - a.y) / (b.y - a.y - slope * (b.x - a.x))
        if (t >= 0 && t <= 1)
          intersections.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      }
      if (intersections.length >= 2)
        graphics
          .moveTo(intersections[0].x, intersections[0].y)
          .lineTo(intersections[1].x, intersections[1].y)
    }
  }
  graphics.stroke({ width: 0.75, color })
  graphics
    .moveTo(triangle[0].x, triangle[0].y)
    .lineTo(triangle[1].x, triangle[1].y)
    .lineTo(triangle[2].x, triangle[2].y)
    .closePath()
    .stroke({ width: 1.2, color })
  graphics
    .moveTo(triangle[2].x, triangle[2].y)
    .lineTo(terminal.x, terminal.y)
    .stroke({ width: 1.2, color })
}
