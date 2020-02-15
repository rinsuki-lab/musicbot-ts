import $ from "transform-ts"
import fetch from "node-fetch"
import fs from "fs"
import childProcess from "child_process"
import { promisify } from "util"
import { RichEmbedOptions } from "discord.js"
import { NotificatableError } from "../classes/notificatable-error"

const execFile = promisify(childProcess.execFile)

export class YouTubeProvider {
    static readonly key = "youtube"

    static test(text: string): string | null {
        const r = /(?:https?:\/\/(?:youtu\.be\/|[a-z]+?\.youtube\.com\/watch\?v=))([A-Za-z0-9_-]{11})/.exec(
            text,
        )
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

        const ydl = await execFile("youtube-dl", [
            "-f",
            "bestaudio",
            "-o",
            path + ".%(ext)s",
            "https://www.youtube.com/watch?v=" + id,
        ])
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

    static async richEmbed(id: string): Promise<RichEmbedOptions> {
        // get video info
        const videoInfo: { [key: string]: string } = (
            await fetch(`https://www.youtube.com/get_video_info?video_id=${id}`).then(r => r.text())
        )
            .replace(/\+/g, "%20")
            .split("&")
            .map(v => v.split("=").map(decodeURIComponent))
            .reduce((prev, current) => ({ ...prev, [current[0]]: current[1] }), {})
        if (videoInfo.status !== "ok") {
            console.error(videoInfo)
            throw new NotificatableError(
                `youtube.richEmbed.getVideoInfo: ${videoInfo.reason} (code: ${videoInfo.errorcode})`,
            )
        }

        const playerInfo = $.obj({
            videoDetails: $.obj({
                title: $.string,
                shortDescription: $.string,
                thumbnail: $.obj({
                    thumbnails: $.array(
                        $.obj({
                            url: $.string,
                            width: $.number,
                            height: $.number,
                        }),
                    ),
                }),
            }),
        }).transformOrThrow(JSON.parse(videoInfo.player_response))
        console.log(playerInfo.videoDetails.thumbnail.thumbnails)

        return {
            title: playerInfo.videoDetails.title,
            description: playerInfo.videoDetails.shortDescription,
            url: this.urlFromId(id),
            thumbnail: {
                url: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
            },
            footer: {
                text: "YouTube",
                icon_url: "https://s.ytimg.com/yts/img/favicon_144-vfliLAfaB.png",
            },
        }
    }
}
