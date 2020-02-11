export interface IProvider {
    readonly key: string

    test(text: string): string | null
    cachePath(id: string): string
    urlFromId(id: string): string

    download(id: string): Promise<string>
}