import fs from "fs"
import fetch from "node-fetch"
import rndstr from "rndstr"
import { NotificatableError } from "../classes/notificatable-error"
import { RichEmbedOptions } from "discord.js"

export class NiconicoProvider {
    static readonly key = "niconico"

    static test(text: string): string | null {
        const r = /(?:https?:\/\/(?:nico.ms|.+?\.nicovideo\.jp\/watch)\/)?((?:[sn]m|so)[0-9]+)/.exec(
            text,
        )
        if (r == null) return null
        return r[1]
    }

    static cachePath(id: string): string {
        return `${__dirname}/../../cache/niconico:${id}.m4a`
    }

    static urlFromId(id: string): string {
        return `https://nico.ms/${id}`
    }

    static async download(id: string): Promise<string> {
        const path = this.cachePath(id)
        if (fs.existsSync(path)) return path

        const headers = {
            "User-Agent": "NicoBox/1011411.280464951 CFNetwork/1121.2.2 Darwin/19.3.0",
        }

        // get guest watch params
        const info = await fetch(
            `https://public.api.nicovideo.jp/v1/ceweb/videos/${id}/trial-play.json`,
            {
                headers: {
                    ...headers,
                    "X-Frontend-Id": "76",
                    "X-Frontend-Version": "4.6.0",
                },
            },
        ).then(r => r.json())
        if (info.errorCode) {
            console.log(info)
            throw new NotificatableError(
                `niconico.trialPlay: ${info.errorMessage} (code: ${info.errorCode})`,
            )
        }

        // console.log(info, info.availableOutput)

        const guestWatchQuery: { [key: string]: string | number } = {
            ver: info.watch.ver,
            service_user_id: info.watch.serviceUserId,
            frontend_id: info.watch.frontendId,
            frontend_version: info.watch.frontendVersion,
            signature: info.watch.signature,
            audios: info.watch.audios,
            protocols: info.watch.protocols,
            action_track_id: `${rndstr("A-Za-z0-9", 10)}_${Date.now()}`,
            _format: "json",
            increment_view_counter: "false",
            heartbeat_lifetime: info.watch.heartbeatLifetime,
            content_key_timeout: info.watch.contentKeyTimeout,
            transfer_presets: info.watch.transferPresets,
            is_https: "true",
        }

        // get dmc token
        const query = Object.entries(guestWatchQuery)
            .map(i => i.map(encodeURIComponent).join("="))
            .join("&")
        const guestWatchRes = await fetch(
            `https://www.nicovideo.jp/api/guest_watch/${info.watch.id}?${query}`,
            { headers },
        ).then(r => r.json())
        if (guestWatchRes.meta["error-code"]) {
            console.error(guestWatchRes)
            throw new NotificatableError(
                `niconico.guestWatchApi: ${guestWatchRes.meta["error-message"]} (code: ${guestWatchRes.meta["error-code"]})`,
            )
        }
        const sessionApi = guestWatchRes.data.session_api
        // console.log(sessionApi)

        const dmcParams = {
            session: {
                client_info: {
                    player_id: sessionApi.player_id,
                    remote_ip: "",
                    tracking_info: "",
                },
                content_auth: {
                    auth_type: sessionApi.auth_types.http,
                    content_key_timeout: sessionApi.content_key_timeout,
                    service_id: "nicovideo",
                    service_user_id: sessionApi.service_user_id,
                },
                content_id: info.availableOutput.id,
                content_src_id_sets: sessionApi.audios.map((a: string) => ({
                    content_src_ids: [a],
                })),
                content_type: "audio",
                keep_method: {
                    heartbeat: {
                        lifetime: sessionApi.heartbeat_lifetime,
                    },
                },
                priority: sessionApi.priority,
                protocol: {
                    name: "http",
                    parameters: {
                        http_parameters: {
                            method: "GET",
                            parameters: {
                                http_output_download_parameters: {
                                    file_extension: "mp4",
                                    transfer_preset: sessionApi.transfer_presets[0],
                                    use_ssl: "yes",
                                },
                            },
                        },
                    },
                },
                recipe_id: sessionApi.recipe_id,
                session_operation_auth: {
                    session_operation_auth_by_signature: {
                        signature: sessionApi.signature,
                        token: sessionApi.token,
                    },
                },
                timing_constraint: "unlimited",
            },
        }

        console.log(dmcParams)

        // create dmc session
        const dmcRes = await fetch("https://api.dmc.nico/api/sessions?_format=json", {
            method: "POST",
            body: JSON.stringify(dmcParams),
            headers: {
                "user-agent": "NicoBox/4.6.0 (iPhone; iOS 13.3.1; Scale/2.00)",
                "content-type": "application/json",
            },
        }).then(r => r.json())
        // console.log(dmcRes)
        if (dmcRes.meta.status >= 400) {
            console.error(dmcRes.meta)
            throw new NotificatableError(
                `niconico.dmcCreate: ${dmcRes.message} (status: ${dmcRes.status})`,
            )
        }

        // download
        await fetch(dmcRes.data.session.content_uri, { headers })
            .then(r => r.buffer())
            .then(r => fs.promises.writeFile(path, r))

        // delete dmc session
        const dmcEndRes = await fetch(
            `https://api.dmc.nico/api/sessions/${dmcRes.data.session.id}?_format=json`,
            {
                headers: {
                    ...headers,
                    "user-agent": "NicoBox/4.6.0 (iPhone; iOS 13.3.1; Scale/2.00)",
                },
                method: "DELETE",
                body: JSON.stringify(dmcRes.data),
            },
        ).then(r => r.json())
        // console.log(dmcEndRes)

        if (dmcEndRes.meta.status >= 400) {
            console.error(dmcEndRes.meta)
            await fs.promises.unlink(path)
            throw new NotificatableError(
                `niconico.dmcEnd(maybe timeout?): ${dmcEndRes.meta.message} (status: ${dmcEndRes.meta.status})`,
            )
        }
        return path
    }

    static async richEmbed(id: string): Promise<RichEmbedOptions> {
        const videoInfo = await fetch(
            `https://api.ce.nicovideo.jp/nicoapi/v1/video.info?v=${id}&__format=json`,
        )
            .then(r => r.json())
            .then(r => r.nicovideo_video_response)
        if (videoInfo["@status"] !== "ok") {
            console.error(videoInfo)
            throw new NotificatableError(
                `niconico.richEmbed.videoInfo: ${videoInfo.error.description} (code: ${videoInfo.error.code})`,
            )
        }

        var thumbnailUrl = videoInfo.video.thumbnail_url.replace(/^http:/, "https:")
        if (videoInfo.video.options["@large_thumbnail"] === "1") {
            thumbnailUrl += ".M"
        }

        var description = videoInfo.video.description
        if (videoInfo.video.genre.key !== "none") {
            description = `[${videoInfo.video.genre.label}] ${description}`
        }

        return {
            title: videoInfo.video.title,
            description: description,
            url: this.urlFromId(id),
            thumbnail: {
                url: thumbnailUrl,
            },
            fields: [
                {
                    name: "マイリスト登録",
                    value: `https://www.nicovideo.jp/mylist_add/video/${id}`,
                },
            ],
            footer: {
                text: "ニコニコ動画",
                icon_url: "https://nicovideo.cdn.nimg.jp/web/images/favicon/144.png",
            },
        }
    }
}
