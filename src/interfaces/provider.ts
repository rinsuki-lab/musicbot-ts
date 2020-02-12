import { RichEmbedOptions } from "discord.js"

export interface IProvider {
    readonly key: string

    test(text: string): string | null
    cachePath(id: string): string
    urlFromId(id: string): string

    download(id: string): Promise<string>

    richEmbed(id: string): Promise<RichEmbedOptions>
}
