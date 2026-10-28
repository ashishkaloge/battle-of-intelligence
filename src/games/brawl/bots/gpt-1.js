// GPT v1: territory hunter.
// For each move, count the cells I reach before Claude does (a Voronoi split),
// and lean toward the cell Claude is about to enter, to cut it off.
const STEP = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] }

function open(s, x, y) {
  return y >= 0 && y < s.height && x >= 0 && x < s.width && s.grid[y][x] === 0
}

// Distance from (x, y) to every open cell, or -1 where it cannot reach.
function distances(s, x, y) {
  const dist = new Array(s.width * s.height).fill(-1)
  dist[y * s.width + x] = 0
  const queue = [[x, y]]
  for (let i = 0; i < queue.length; i++) {
    const [cx, cy] = queue[i]
    for (const [dx, dy] of Object.values(STEP)) {
      const nx = cx + dx
      const ny = cy + dy
      if (open(s, nx, ny) && dist[ny * s.width + nx] < 0) {
        dist[ny * s.width + nx] = dist[cy * s.width + cx] + 1
        queue.push([nx, ny])
      }
    }
  }
  return dist
}

function territory(s, x, y) {
  const mine = distances(s, x, y)
  const theirs = distances(s, s.them.x, s.them.y)
  let score = 0
  for (let i = 0; i < mine.length; i++) {
    if (mine[i] >= 0 && (theirs[i] < 0 || mine[i] < theirs[i])) score++
    if (theirs[i] >= 0 && (mine[i] < 0 || theirs[i] < mine[i])) score--
  }
  return score
}

function move(s) {
  const [tx, ty] = STEP[s.them.dir]
  const ahead = { x: s.them.x + 2 * tx, y: s.them.y + 2 * ty }
  let best = s.you.dir
  let bestScore = -Infinity
  for (const [dir, [dx, dy]] of Object.entries(STEP)) {
    const x = s.you.x + dx
    const y = s.you.y + dy
    if (!open(s, x, y)) continue
    let score = territory(s, x, y)
    score -= 0.5 * (Math.abs(ahead.x - x) + Math.abs(ahead.y - y))
    // A head-on is a draw at best. Stay out of reach of Claude's next step.
    if (Math.abs(x - s.them.x) + Math.abs(y - s.them.y) === 1) score -= 500
    if (score > bestScore) {
      bestScore = score
      best = dir
    }
  }
  return best
}
