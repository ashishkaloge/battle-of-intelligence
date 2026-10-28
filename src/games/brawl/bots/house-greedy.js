// House bot: steps wherever it has the most open neighbours next.
const STEP = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] }

function open(s, x, y) {
  return y >= 0 && y < s.height && x >= 0 && x < s.width && s.grid[y][x] === 0
}

function move(s) {
  let best = s.you.dir
  let most = -1
  for (const [dir, [dx, dy]] of Object.entries(STEP)) {
    const x = s.you.x + dx
    const y = s.you.y + dy
    if (!open(s, x, y)) continue
    let around = 0
    for (const [ex, ey] of Object.values(STEP)) if (open(s, x + ex, y + ey)) around++
    if (around > most) {
      most = around
      best = dir
    }
  }
  return best
}
