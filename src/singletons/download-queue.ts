import { ProviderAndID } from "../classes/provider-and-id"
import { NotificatableError } from "../classes/notificatable-error"

export class DownloadQueue {
    static processingNow: { [key: string]: boolean } = {}

    static async download(pi: ProviderAndID): Promise<string> {
        if (this.processingNow[pi.key])
            throw new NotificatableError("他スレッドでダウンロード中です。しばらくお待ちください")

        this.processingNow[pi.key] = true

        try {
            return await pi.downloadWithoutQueue()
        } finally {
            delete this.processingNow[pi.key]
        }
    }
}
