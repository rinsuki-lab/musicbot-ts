import { ProviderAndID } from "../classes/provider-and-id"

export class DownloadQueue {
    static downloadPromise: { [key: string]: Promise<string> } = {}

    static registerDownloadPromise(pi: ProviderAndID, p: Promise<string>) {
        const key = pi.key
        this.downloadPromise[key] = (async () => {
            try {
                return await p
            } finally {
                delete this.downloadPromise[key]
            }
        })()
    }

    static download(pi: ProviderAndID): Promise<string> {
        const key = pi.key
        var promise = this.downloadPromise[key]
        if (promise != null) return promise

        promise = pi.downloadWithoutQueue()
        this.registerDownloadPromise(pi, promise)
        return promise
    }
}
