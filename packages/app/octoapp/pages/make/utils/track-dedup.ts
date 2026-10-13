const CAP = 5000

export function createReportedSet(storageKey: string) {
  let set: Set<string>
  try {
    set = new Set(JSON.parse(localStorage.getItem(storageKey) ?? "[]") as string[])
  } catch {
    set = new Set()
  }

  return {
    has(key: string) {
      return set.has(key)
    },
    add(key: string) {
      if (set.has(key)) return
      set.add(key)
      if (set.size > CAP) {
        const excess = set.size - CAP
        let i = 0
        for (const k of set) {
          set.delete(k)
          if (++i >= excess) break
        }
      }
      try {
        localStorage.setItem(storageKey, JSON.stringify([...set]))
      } catch {
      }
    },
  }
}
