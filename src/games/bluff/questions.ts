import { between, pick, type Rand, random, shuffled } from '../../lib/random.ts'
import type { Question } from './table.ts'

/**
 * Questions for live Bluff fights. Every answer comes from a fixed reference table or is computed,
 * so the truth card is checkable by code, and a fight's draw comes from a seed, so nobody can
 * learn the questions in advance. Each record saves the questions it was played with, so a later
 * change here never changes a fight that was already played.
 */

/** The periodic table in order: symbol and IUPAC name. Index + 1 is the atomic number. */
export const ELEMENTS: readonly (readonly [string, string])[] = [
  ['H', 'Hydrogen'],
  ['He', 'Helium'],
  ['Li', 'Lithium'],
  ['Be', 'Beryllium'],
  ['B', 'Boron'],
  ['C', 'Carbon'],
  ['N', 'Nitrogen'],
  ['O', 'Oxygen'],
  ['F', 'Fluorine'],
  ['Ne', 'Neon'],
  ['Na', 'Sodium'],
  ['Mg', 'Magnesium'],
  ['Al', 'Aluminium'],
  ['Si', 'Silicon'],
  ['P', 'Phosphorus'],
  ['S', 'Sulfur'],
  ['Cl', 'Chlorine'],
  ['Ar', 'Argon'],
  ['K', 'Potassium'],
  ['Ca', 'Calcium'],
  ['Sc', 'Scandium'],
  ['Ti', 'Titanium'],
  ['V', 'Vanadium'],
  ['Cr', 'Chromium'],
  ['Mn', 'Manganese'],
  ['Fe', 'Iron'],
  ['Co', 'Cobalt'],
  ['Ni', 'Nickel'],
  ['Cu', 'Copper'],
  ['Zn', 'Zinc'],
  ['Ga', 'Gallium'],
  ['Ge', 'Germanium'],
  ['As', 'Arsenic'],
  ['Se', 'Selenium'],
  ['Br', 'Bromine'],
  ['Kr', 'Krypton'],
  ['Rb', 'Rubidium'],
  ['Sr', 'Strontium'],
  ['Y', 'Yttrium'],
  ['Zr', 'Zirconium'],
  ['Nb', 'Niobium'],
  ['Mo', 'Molybdenum'],
  ['Tc', 'Technetium'],
  ['Ru', 'Ruthenium'],
  ['Rh', 'Rhodium'],
  ['Pd', 'Palladium'],
  ['Ag', 'Silver'],
  ['Cd', 'Cadmium'],
  ['In', 'Indium'],
  ['Sn', 'Tin'],
  ['Sb', 'Antimony'],
  ['Te', 'Tellurium'],
  ['I', 'Iodine'],
  ['Xe', 'Xenon'],
  ['Cs', 'Caesium'],
  ['Ba', 'Barium'],
  ['La', 'Lanthanum'],
  ['Ce', 'Cerium'],
  ['Pr', 'Praseodymium'],
  ['Nd', 'Neodymium'],
  ['Pm', 'Promethium'],
  ['Sm', 'Samarium'],
  ['Eu', 'Europium'],
  ['Gd', 'Gadolinium'],
  ['Tb', 'Terbium'],
  ['Dy', 'Dysprosium'],
  ['Ho', 'Holmium'],
  ['Er', 'Erbium'],
  ['Tm', 'Thulium'],
  ['Yb', 'Ytterbium'],
  ['Lu', 'Lutetium'],
  ['Hf', 'Hafnium'],
  ['Ta', 'Tantalum'],
  ['W', 'Tungsten'],
  ['Re', 'Rhenium'],
  ['Os', 'Osmium'],
  ['Ir', 'Iridium'],
  ['Pt', 'Platinum'],
  ['Au', 'Gold'],
  ['Hg', 'Mercury'],
  ['Tl', 'Thallium'],
  ['Pb', 'Lead'],
  ['Bi', 'Bismuth'],
  ['Po', 'Polonium'],
  ['At', 'Astatine'],
  ['Rn', 'Radon'],
  ['Fr', 'Francium'],
  ['Ra', 'Radium'],
  ['Ac', 'Actinium'],
  ['Th', 'Thorium'],
  ['Pa', 'Protactinium'],
  ['U', 'Uranium'],
  ['Np', 'Neptunium'],
  ['Pu', 'Plutonium'],
  ['Am', 'Americium'],
  ['Cm', 'Curium'],
  ['Bk', 'Berkelium'],
  ['Cf', 'Californium'],
  ['Es', 'Einsteinium'],
  ['Fm', 'Fermium'],
  ['Md', 'Mendelevium'],
  ['No', 'Nobelium'],
  ['Lr', 'Lawrencium'],
  ['Rf', 'Rutherfordium'],
  ['Db', 'Dubnium'],
  ['Sg', 'Seaborgium'],
  ['Bh', 'Bohrium'],
  ['Hs', 'Hassium'],
  ['Mt', 'Meitnerium'],
  ['Ds', 'Darmstadtium'],
  ['Rg', 'Roentgenium'],
  ['Cn', 'Copernicium'],
  ['Nh', 'Nihonium'],
  ['Fl', 'Flerovium'],
  ['Mc', 'Moscovium'],
  ['Lv', 'Livermorium'],
  ['Ts', 'Tennessine'],
  ['Og', 'Oganesson'],
]

/** Elements too famous to ask about: every model knows them cold. */
const FAMOUS = new Set(['H', 'He', 'C', 'N', 'O', 'Na', 'Fe', 'Cu', 'Ag', 'Au', 'Hg', 'Pb', 'U'])

/** Capitals that are settled: no rival seat of government, no recent move, no dispute. */
export const CAPITALS: readonly (readonly [string, string, ...string[]])[] = [
  ['Australia', 'Canberra'],
  ['Canada', 'Ottawa'],
  ['Turkey', 'Ankara'],
  ['Brazil', 'Brasília'],
  ['Nigeria', 'Abuja'],
  ['Pakistan', 'Islamabad'],
  ['New Zealand', 'Wellington'],
  ['Morocco', 'Rabat'],
  ['Mongolia', 'Ulaanbaatar', 'Ulan Bator'],
  ['Kyrgyzstan', 'Bishkek'],
  ['Tajikistan', 'Dushanbe'],
  ['Turkmenistan', 'Ashgabat', 'Ashkhabad'],
  ['Uzbekistan', 'Tashkent'],
  ['Azerbaijan', 'Baku'],
  ['Armenia', 'Yerevan'],
  ['Moldova', 'Chișinău', 'Kishinev'],
  ['Slovenia', 'Ljubljana'],
  ['Slovakia', 'Bratislava'],
  ['North Macedonia', 'Skopje'],
  ['Albania', 'Tirana'],
  ['Montenegro', 'Podgorica'],
  ['Bhutan', 'Thimphu'],
  ['Laos', 'Vientiane'],
  ['Papua New Guinea', 'Port Moresby'],
  ['Fiji', 'Suva'],
  ['Madagascar', 'Antananarivo'],
  ['Malawi', 'Lilongwe'],
  ['Zambia', 'Lusaka'],
  ['Mozambique', 'Maputo'],
  ['Namibia', 'Windhoek'],
  ['Botswana', 'Gaborone'],
  ['Rwanda', 'Kigali'],
  ['Eritrea', 'Asmara'],
  ['Chad', "N'Djamena"],
  ['Niger', 'Niamey'],
  ['Mali', 'Bamako'],
  ['Burkina Faso', 'Ouagadougou'],
  ['Mauritania', 'Nouakchott'],
  ['Sierra Leone', 'Freetown'],
  ['Togo', 'Lomé'],
  ['Cameroon', 'Yaoundé'],
  ['Gabon', 'Libreville'],
  ['Uruguay', 'Montevideo'],
  ['Paraguay', 'Asunción'],
  ['Suriname', 'Paramaribo'],
  ['Honduras', 'Tegucigalpa'],
  ['Belize', 'Belmopan'],
  ['Iceland', 'Reykjavík'],
  ['Oman', 'Muscat'],
  ['Bahrain', 'Manama'],
]

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function isPrime(n: number): boolean {
  if (n < 2) return false
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false
  return true
}

export function nextPrime(n: number): number {
  let p = n + 1
  while (!isPrime(p)) p++
  return p
}

export function primesBelow(n: number): number {
  let count = 0
  for (let p = 2; p < n; p++) if (isPrime(p)) count++
  return count
}

/** The nth prime, counting 2 as the first. */
export function nthPrime(n: number): number {
  let count = 0
  for (let p = 2; ; p++) {
    if (isPrime(p)) count++
    if (count === n) return p
  }
}

/**
 * Digits of pi after the decimal point, from Machin's formula in exact integer arithmetic:
 * pi = 16 arctan(1/5) - 4 arctan(1/239).
 */
export function piDigits(count: number): string {
  const unity = 10n ** BigInt(count + 10)
  const arctanInverse = (x: bigint) => {
    let power = unity / x
    let sum = power
    const square = x * x
    for (let k = 1n; power !== 0n; k++) {
      power /= square
      const term = power / (2n * k + 1n)
      sum += k % 2n === 1n ? -term : term
    }
    return sum
  }
  const pi = 16n * arctanInverse(5n) - 4n * arctanInverse(239n)
  return pi.toString().slice(1, count + 1)
}

/** Whole days from one date to a later one, from the calendar itself. */
export const daysBetween = (a: [number, number, number], b: [number, number, number]) =>
  Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86_400_000)

/** The Gregorian weekday of a date, from the calendar itself rather than anyone's memory. */
export const weekday = (year: number, month: number, day: number) =>
  WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? ''

/** One kind of question, and how to draw one. */
export type Kind =
  | 'atomic-number'
  | 'capital'
  | 'nth-prime'
  | 'primes-between'
  | 'pi-digit'
  | 'days-between'
  | 'weekday'
  | 'symbol-letter'

const ordinal = (n: number) => {
  const tens = n % 100
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
  return `${n.toLocaleString('en-US')}${suffix}`
}

const dateText = ([year, month, day]: [number, number, number]) =>
  `${day} ${MONTHS[month - 1]} ${year}`

/** Letters that start the symbol of at least five elements, with how many. */
const SYMBOL_LETTERS = [...new Set(ELEMENTS.map(([symbol]) => symbol[0] ?? ''))].flatMap(
  (letter) => {
    const count = ELEMENTS.filter(([symbol]) => symbol.startsWith(letter)).length
    return count >= 5 ? [[letter, count] as const] : []
  },
)

/**
 * The kinds of question a fight draws from. Most sit at the edge of what a model can know or work
 * out without tools, so the two corners often disagree or doubt, which is what makes the betting
 * worth watching. The atomic numbers and capitals are the easier hands.
 */
const MAKERS: Record<Kind, (rand: Rand) => Question> = {
  'atomic-number': (rand) => {
    const index = pick(
      rand,
      ELEMENTS.flatMap(([symbol], i) => (i >= 20 && !FAMOUS.has(symbol) ? [i] : [])),
    )
    const [, name] = ELEMENTS[index] ?? ['', '']
    return { text: `What is the atomic number of ${name.toLowerCase()}?`, answer: `${index + 1}` }
  },
  capital: (rand) => {
    const [country, capital, ...also] = pick(rand, CAPITALS)
    return { text: `What is the capital of ${country}?`, answer: capital, accept: also }
  },
  'nth-prime': (rand) => {
    const n = between(rand, 150, 3000)
    return { text: `What is the ${ordinal(n)} prime number?`, answer: `${nthPrime(n)}` }
  },
  'primes-between': (rand) => {
    // Round endpoints are never prime, so "between" means the same with or without them.
    const lo = between(rand, 100, 2000) * 10
    const hi = lo + pick(rand, [50, 100, 150])
    return {
      text: `How many prime numbers are there between ${lo.toLocaleString('en-US')} and ${hi.toLocaleString('en-US')}?`,
      answer: `${primesBelow(hi) - primesBelow(lo)}`,
    }
  },
  'pi-digit': (rand) => {
    const k = between(rand, 20, 60)
    return {
      text: `What is the ${ordinal(k)} digit of pi after the decimal point?`,
      answer: piDigits(k).at(-1) ?? '',
    }
  },
  'days-between': (rand) => {
    const year = between(rand, 1950, 2020)
    const a: [number, number, number] = [year, between(rand, 1, 12), between(rand, 1, 28)]
    const b: [number, number, number] = [
      year + between(rand, 1, 6),
      between(rand, 1, 12),
      between(rand, 1, 28),
    ]
    return {
      text: `How many days after ${dateText(a)} is ${dateText(b)}?`,
      answer: `${daysBetween(a, b)}`,
    }
  },
  'symbol-letter': (rand) => {
    const [letter, count] = pick(rand, SYMBOL_LETTERS)
    return {
      text: `How many chemical elements have a symbol that starts with the letter ${letter}?`,
      answer: `${count}`,
    }
  },
  weekday: (rand) => {
    const year = between(rand, 1800, 2099)
    const month = between(rand, 1, 12)
    const day = between(rand, 1, 28)
    const name = weekday(year, month, day)
    return {
      text: `On what day of the week did ${day} ${MONTHS[month - 1]} ${year} fall?`,
      answer: name,
      accept: [name.slice(0, 3)],
    }
  },
}

export const KINDS = Object.keys(MAKERS) as Kind[]

/**
 * A fight's questions: `count` of them, never two of a kind in a row and never the same question
 * twice, all from `seed`. The draw cycles through the kinds in a shuffled order, so a fight gets a
 * spread of chemistry, physics, geography and number questions.
 */
export function drawQuestions(seed: number, count: number): Question[] {
  const rand = random(seed)
  const order = shuffled(rand, KINDS)
  const out: Question[] = []
  const seen = new Set<string>()
  for (let i = 0; out.length < count; i++) {
    const kind = order[i % order.length] as Kind
    const question = MAKERS[kind](rand)
    if (seen.has(question.text)) continue
    seen.add(question.text)
    out.push(question.accept?.length ? question : { text: question.text, answer: question.answer })
  }
  return out
}
