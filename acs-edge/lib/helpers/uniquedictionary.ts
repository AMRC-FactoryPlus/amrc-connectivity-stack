
export class UniqueDictionary<K, V extends object> {
    private map = new Map<K, V>();


    add(key: K, value: V) {
        if (!this.map.has(key)) {
            this.map.set(key, value);
        }
    }

    getFirstNItems(n: number): UniqueDictionary<K, V> {
        const newDict = new UniqueDictionary<K, V>();
        for (const [key, value] of Array.from(this.map.entries()).slice(0, n)) {
            newDict.add(key, value);
        }
        return newDict;
    }

    toJSON(): string {
        return JSON.stringify(Object.fromEntries(this.map));
    }
}