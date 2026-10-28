// GPT v3: territory hunter + boosts, with the bout 2 crash fixed.
// Bug: reading Claude's lane two cells ahead went off the board near the top
// and bottom edges (TypeError, line 44). Check the lane is on the board first.
const STEP = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] }

function open(s, x, y) {
  return y >= 0 && y < s.height && x >= 0 && x < s.width && s.grid[y][x] === 0
}

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
  const close = Math.abs(s.them.x - s.you.x) + Math.abs(s.them.y - s.you.y) <= 8
  // Claude's lane two cells ahead is still open: boost and take it first.
  const onBoard = ahead.y >= 0 && ahead.y < s.height && ahead.x >= 0 && ahead.x < s.width
  const cut = close && onBoard && s.grid[ahead.y][ahead.x] === 0
  let best = { dir: s.you.dir, score: -Infinity }
  for (const [dir, [dx, dy]] of Object.entries(STEP)) {
    const x = s.you.x + dx
    const y = s.you.y + dy
    if (!open(s, x, y)) continue
    let score = territory(s, x, y)
    score -= 0.5 * (Math.abs(ahead.x - x) + Math.abs(ahead.y - y))
    if (Math.abs(x - s.them.x) + Math.abs(y - s.them.y) === 1) score -= 500
    if (score > best.score) best = { dir, score }
  }
  const [dx, dy] = STEP[best.dir]
  const boost = cut && s.you.boosts > 0 && open(s, s.you.x + 2 * dx, s.you.y + 2 * dy)
  return { dir: best.dir, boost, say: boost ? 'Gotcha.' : '' }
}
