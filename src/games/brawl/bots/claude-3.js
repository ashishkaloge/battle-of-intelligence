// Claude, bout 3. New rule: every 25 ticks the outer ring turns to wall.
// Treat the ring that is about to close as already gone, so I never get
// caught on it. Also keep one boost back to dodge GPT's boost attacks.
const STEP = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] }

function ringOf(s, x, y) {
  return Math.min(x, y, s.width - 1 - x, s.height - 1 - y)
}

// The closing ring counts as wall once it is this close to shutting.
function doomed(s, x, y) {
  return s.closing !== null && s.closing.in <= 6 && ringOf(s, x, y) <= s.closing.ring
}

function open(s, x, y) {
  if (y < 0 || y >= s.height || x < 0 || x >= s.width) return false
  return s.grid[y][x] === 0 && !doomed(s, x, y)
}

function distances(s, x, y, blocked) {
  const dist = new Array(s.width * s.height).fill(-1)
  dist[y * s.width + x] = 0
  const queue = [[x, y]]
  for (let i = 0; i < queue.length; i++) {
    const [cx, cy] = queue[i]
    for (const [dx, dy] of Object.values(STEP)) {
      const nx = cx + dx
      const ny = cy + dy
      const key = ny * s.width + nx
      if (open(s, nx, ny) && dist[key] < 0 && key !== blocked) {
        dist[key] = dist[cy * s.width + cx] + 1
        queue.push([nx, ny])
      }
    }
  }
  return dist
}

function lead(s, x, y) {
  const mine = distances(s, x, y, -1)
  const theirs = distances(s, s.them.x, s.them.y, y * s.width + x)
  let score = 0
  for (let i = 0; i < mine.length; i++) {
    const me = mine[i]
    const them = theirs[i]
    if (me >= 0 && (them < 0 || me < them)) score++
    else if (them >= 0 && (me < 0 || them < me)) score--
  }
  return score
}

function move(s) {
  let best = { dir: s.you.dir, boost: false, score: -Infinity }
  for (const [dir, [dx, dy]] of Object.entries(STEP)) {
    const x = s.you.x + dx
    const y = s.you.y + dy
    if (y < 0 || y >= s.height || x < 0 || x >= s.width || s.grid[y][x] !== 0) continue
    const nearThem = Math.abs(x - s.them.x) + Math.abs(y - s.them.y) === 1
    let penalty = s.them.alive && nearThem ? 1000 : 0
    if (doomed(s, x, y)) penalty += 400
    const single = lead(s, x, y) - penalty
    if (single > best.score) best = { dir, boost: false, score: single }
    if (s.you.boosts > 1 && open(s, x + dx, y + dy)) {
      const double = lead(s, x + dx, y + dy) - penalty
      if (double > single + 6 && double > best.score) best = { dir, boost: true, score: double }
    }
  }
  return { dir: best.dir, boost: best.boost, say: best.boost ? 'Mine.' : '' }
}
