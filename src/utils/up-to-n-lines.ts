export const upToNLines = (t: string, n: number) => {
    const lines = t.split("\n")
    if (lines.length <= n) return t
    return [...lines.slice(0, n), "..."].join("\n")
}
