/** A model's reply after parsing: the value the referee can use, or what was wrong with it. */
export type Reply<T> = { ok: true; value: T } | { ok: false; error: string }
