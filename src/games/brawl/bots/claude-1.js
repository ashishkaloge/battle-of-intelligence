// Claude, bout 1. Plan: go wherever there is the most room, and never step
// next to GPT's head, so a head-on is impossible.
const STEP = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] }

function open(s, x, y) {
  return y >= 0 && y < s.height && x >= 0 && x < s.width && s.grid[y][x] === 0
}

// Open cells reachable from (x, y), counted with a flood fill.
function room(s, x, y) {
  const seen = new Set([y * s.width + x])
  const stack = [[x, y]]
  while (stack.length) {
    const [cx, cy] = stack.pop()
    for (const [dx, dy] of Object.values(STEP)) {
      const nx = cx + dx
      const ny = cy + dy
      const key = ny * s.width + nx
      if (open(s, nx, ny) && !seen.has(key)) {
        seen.add(key)
        stack.push([nx, ny])
      }
    }
  }
  return seen.size
}

function nextToThem(s, x, y) {
  return Math.abs(x - s.them.x) + Math.abs(y - s.them.y) === 1
}

function move(s) {
  let best = s.you.dir
  let bestScore = -Infinity
  for (const [dir, [dx, dy]] of Object.entries(STEP)) {
    const x = s.you.x + dx
    const y = s.you.y + dy
    if (!open(s, x, y)) continue
    let score = room(s, x, y)
    if (s.them.alive && nextToThem(s, x, y)) score -= 1000
    if (dir === s.you.dir) score += 0.5
    if (score > bestScore) {
      bestScore = score
      best = dir
    }
  }
  return best
}
