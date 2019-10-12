export class Set<T> {
  private _items: { [index: string]: T } = {};

  // Two items A and B are considered the same value iff getIdentifier(A) === getIdentifier(B).
  constructor(private getIdentifier: (item: T) => string, ...items: T[]) {
    this.getIdentifier = getIdentifier;
    this._items = {};
    this.add(...items);
  }

  public get size() {
    return this.items.length;
  }

  public add(...items: T[]): void {
    items.forEach(item => (this._items[this.getIdentifier(item)] = item));
  }

  public remove(item: T): void {
    if (this.has(item)) {
      delete this._items[this.getIdentifier(item)];
    }
  }

  public pop(): T {
    if (this.empty) { throw 'empty'; }
    const someKey = Object.keys(this._items)[0];
    const result = this._items[someKey];
    this.remove(result);
    return result;
  }

  public has(item: T): boolean {
    return this._items[this.getIdentifier(item)] != undefined;
  }

  public get items(): T[] {
    return Object.keys(this._items).map(k => this._items[k]);
  }

  public equals(that: Set<T>): boolean {
    return (
      this.size == that.size && this.items.every(item => that.has(item))
    );
  }

  public get empty(): boolean {
    return Object.keys(this._items).length == 0;
  }

  public union(...those: Set<T>[]): Set<T> {
    return new Set(
      this.getIdentifier,
      ...this.items.concat(...those.map(that => that.items))
    );
  }

  public intersect(that: Set<T>): Set<T> {
    return new Set(
      this.getIdentifier,
      ...this.items.filter(item => that.has(item))
    );
  }

  public filter(predicate: (item: T) => boolean): Set<T> {
    return new Set(this.getIdentifier, ...this.items.filter(predicate));
  }

  public map<U>(
    getIdentifier: (item: U) => string,
    transform: (item: T) => U
  ): Set<U> {
    return new Set(getIdentifier, ...this.items.map(transform));
  }

  public mapSame(transform: (item: T) => T) {
    return new Set(this.getIdentifier, ...this.items.map(transform));
  }

  public some(predicate: (item: T) => boolean): boolean {
    return this.items.some(predicate);
  }

  public minus(that: Set<T>): Set<T> {
    return new Set(
      this.getIdentifier,
      ...this.items.filter(x => !that.has(x))
    );
  }

  public take(): T {
    if (this.empty) {
      throw 'cannot take from an empty set';
    }
    const first = parseInt(Object.keys(this._items)[0]);
    const result = this._items[first];
    this.remove(result);
    return result;
  }

  public product(that: Set<T>): Set<[T, T]> {
    return new Set(
      ([x, y]) => this.getIdentifier(x) + that.getIdentifier(y),
      ...flatten(...this.items.map(x =>
        flatten(that.items.map<[T, T]>(y => [x, y])))));
  }
}

export class StringSet extends Set<string> {
  constructor(...items: string[]) {
    super(s => s, ...items);
  }
}

export class NumberSet extends Set<number> {
  constructor(...items: number[]) {
    super(n => n.toString(), ...items);
  }
}

export function range(min: number, max: number): Set<number> {
  const numbers: number[] = [];
  for (var i = min; i < max; i++) {
    numbers.push(i);
  }
  return new NumberSet(...numbers);
}


function flatten<T>(...items: T[][]): T[] {
  return [].concat(...items);
}