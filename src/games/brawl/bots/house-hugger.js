// House bot: keeps a wall on its right hand and follows it.
const TURN_RIGHT = { up: 'right', right: 'down', down: 'left', left: 'up' }
const TURN_LEFT = { up: 'left', left: 'down', down: 'right', right: 'up' }
const STEP = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] }

function open(s, dir) {
  const x = s.you.x + STEP[dir][0]
  const y = s.you.y + STEP[dir][1]
  return y >= 0 && y < s.height && x >= 0 && x < s.width && s.grid[y][x] === 0
}

function move(s) {
  const right = TURN_RIGHT[s.you.dir]
  const left = TURN_LEFT[s.you.dir]
  for (const dir of [right, s.you.dir, left]) if (open(s, dir)) return dir
  return s.you.dir
}
