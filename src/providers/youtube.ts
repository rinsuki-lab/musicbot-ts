import Axios from "axios"
import fetch from "node-fetch"
import fs from "fs"
import childProcess from "child_process"
import { promisify } from "util"

const execFile = promisify(childProcess.execFile)

export class YouTubeProvider {
    static readonly key = "youtube"

    static test(text: string): string | null {
        const r = /(?:https?:\/\/(?:youtu\.be\/|[a-z]+?\.youtube\.com\/watch\?v=))([A-Za-z0-9_-]{11})/.exec(text)
        if (r == null) return null
        return r[1]
    }

    static cachePath(id: string): string {
        return `${__dirname}/../../cache/youtube:${id}.mp4`
    }

    static urlFromId(id: string): string {
        return `https://youtu.be/${id}`
    }

    static async download(id: string): Promise<string> {
        const path = this.cachePath(id)
        if (fs.existsSync(path)) return path

        const ydl = await execFile("youtube-dl", ["-f", "bestaudio", "-o", path + ".%(ext)s", "https://www.youtube.com/watch?v=" + id])
        if (ydl.stderr !== "") throw ydl.stderr
        console.log(ydl.stdout)
        
        // find downloaded format
        const format = /\[download\][^\n]+\.([a-z4]+)/.exec(ydl.stdout)
        if (format == null) throw "Unknown format"

        // mp4に押し込める
        const ext = format[1]
        await execFile("ffmpeg", ["-i", path + "." + ext, "-codec", "copy", "-strict", "-2", path])

        // 終わり
        await fs.promises.unlink(path + "." + ext)

        console.log("downloaded")
        return path
    }
}