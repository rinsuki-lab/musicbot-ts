import { IProvider } from "../interfaces/provider"
import { RichEmbedOptions } from "discord.js"
import { NotificatableError } from "./notificatable-error"
import { upToNLines } from "../utils/up-to-n-lines"
import { ValidationErrors } from "transform-ts"

export class ProviderAndID {
    constructor(public readonly provider: IProvider, public readonly id: string) {}

    get key() {
        return [this.provider.key, this.id].join(":")
    }

    get url() {
        return this.provider.urlFromId(this.id)
    }

    get path() {
        return this.provider.cachePath(this.id)
    }

    getRichEmbed(): Promise<RichEmbedOptions> {
        return this.provider
            .richEmbed(this.id)
            .then(embed => {
                if (!embed.description) return embed
                return {
                    ...embed,
                    description: upToNLines(embed.description, 10),
                }
            })
            .catch(e => {
                console.error(e)
                if (e instanceof NotificatableError) {
                    return {
                        title: "カード展開エラー",
                        description: e.message,
                        color: 0xff0000,
                        footer: {
                            text: "musicbot-ts",
                        },
                    } as RichEmbedOptions
                }
                if (e instanceof ValidationErrors) {
                    return {
                        title: "カード展開エラー",
                        description: "transform-ts error: \n```\n" + e.message + "\n```",
                        color: 0xff0000,
                        footer: {
                            text: "musicbot-ts",
                        },
                    }
                }
                return {
                    title: "カード展開エラー",
                    description: "JavaScriptエラー",
                    color: 0xff0000,
                    footer: {
                        text: "musicbot-ts",
                    },
                } as RichEmbedOptions
            })
    }

    downloadWithoutQueue(): Promise<string> {
        return this.provider.download(this.id)
    }
}
