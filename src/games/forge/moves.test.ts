import { describe, expect, it } from 'vitest'
import { formatGrid, parseGrid } from './grid.ts'
import { applyMove, type Move, moveSpace, objectsIn, runProgram } from './moves.ts'

const apply = (move: Move, text: string) => {
  const out = applyMove(move, parseGrid(text))
  return out ? formatGrid(out) : null
}

describe('geometry', () => {
  it('rotates clockwise', () => {
    expect(apply({ op: 'rotate', turns: 1 }, '12/34')).toBe('31/42')
    expect(apply({ op: 'rotate', turns: 1 }, '123/456')).toBe('41/52/63')
  })

  it('returns to the start after four quarter turns', () => {
    const grid = parseGrid('120/034/500')
    const back = runProgram(Array(4).fill({ op: 'rotate', turns: 1 }), grid)
    expect(back).toEqual(grid)
  })

  it('mirrors on every axis and refuses a diagonal on a non-square grid', () => {
    expect(apply({ op: 'mirror', axis: 'left-right' }, '120/003')).toBe('021/300')
    expect(apply({ op: 'mirror', axis: 'top-bottom' }, '12/34')).toBe('34/12')
    expect(apply({ op: 'mirror', axis: 'diagonal' }, '12/34')).toBe('13/24')
    expect(apply({ op: 'mirror', axis: 'diagonal' }, '123/456')).toBeNull()
  })

  it('shifts with wraparound', () => {
    expect(apply({ op: 'shift', dir: 'right' }, '120/000')).toBe('012/000')
    expect(apply({ op: 'shift', dir: 'up' }, '100/002')).toBe('002/100')
  })

  it('crops to the colored cells and scales by two', () => {
    expect(apply({ op: 'crop' }, '000/010/020')).toBe('1/2')
    expect(apply({ op: 'scale' }, '10/02')).toBe('1100/1100/0022/0022')
  })

  it('copies a mirrored half for symmetry', () => {
    expect(apply({ op: 'symmetry', from: 'left' }, '1200/3400')).toBe('1221/3443')
    expect(apply({ op: 'symmetry', from: 'top' }, '12/00/00')).toBe('12/00/12')
  })
})

describe('physics', () => {
  it('drops cells with gravity, keeping their order', () => {
    expect(apply({ op: 'gravity', dir: 'down' }, '10/20/00/03')).toBe('00/00/10/23')
    expect(apply({ op: 'gravity', dir: 'left' }, '0102/0300')).toBe('1200/3000')
  })

  it('extends rays until they hit a colored cell or the edge', () => {
    expect(apply({ op: 'extend', dir: 'right' }, '1000/0020')).toBe('1111/0022')
    expect(apply({ op: 'extend', dir: 'down' }, '10/00/20/00')).toBe('10/10/20/20')
  })
})

describe('color and objects', () => {
  it('recolors, erases and swaps colors', () => {
    expect(apply({ op: 'recolor', from: 1, to: 5 }, '12/10')).toBe('52/50')
    expect(apply({ op: 'recolor', from: 1, to: 0 }, '12/10')).toBe('02/00')
    expect(apply({ op: 'swap', a: 1, b: 2 }, '12/10')).toBe('21/20')
  })

  it('finds objects as same-colored cells joined edge to edge', () => {
    expect(objectsIn(parseGrid('110/001/220')).map((o) => o.length)).toEqual([2, 1, 2])
  })

  it('paints and keeps the largest or smallest object, ties included', () => {
    expect(apply({ op: 'paint', target: 'largest', color: 7 }, '110/000/020')).toBe('770/000/020')
    expect(apply({ op: 'keep', target: 'smallest' }, '110/000/202')).toBe('000/000/202')
  })

  it('outlines objects and fills sealed holes', () => {
    expect(apply({ op: 'outline', color: 4 }, '000/010/000')).toBe('040/414/040')
    expect(apply({ op: 'fill', color: 3 }, '1110/1010/1110/0000')).toBe('1110/1310/1110/0000')
  })
})

describe('move space', () => {
  it('grows with the colors in play and never repeats a move', () => {
    const space = moveSpace([1, 2, 3])
    const keys = space.map((move) => JSON.stringify(move))
    expect(new Set(keys).size).toBe(keys.length)
    expect(space.length).toBe(26 + 3 * 5 + 6 + 3)
  })
})
