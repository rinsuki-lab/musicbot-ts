import { YouTubeProvider } from "./providers/youtube"
import { NiconicoProvider } from "./providers/niconico"
import { IProvider } from "./interfaces/provider"
import { RichEmbedOptions } from "discord.js"
import { NotificatableError } from "./notificatable-error"
import { ProviderAndID } from "./provider-and-id"

export class ProviderManager {
    private static providers: IProvider[] = [YouTubeProvider, NiconicoProvider]

    static match(url: string): ProviderAndID | null {
        for (const provider of this.providers) {
            const id = provider.test(url)
            if (id == null) continue
            return new ProviderAndID(provider, id)
        }
        return null
    }

    // #region key generation

    static findFromKey(key: string): IProvider | undefined {
        return this.providers.find(p => p.key === key)
    }

    static piFromKey(key: string): ProviderAndID | null {
        const [pkey, id] = key.split(":")
        const provider = this.findFromKey(pkey)
        if (provider == null) return null
        return new ProviderAndID(provider, id)
    }

    // #endregion key generation
}
