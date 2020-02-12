require("dotenv-safe").config()
import {
    Client,
    VoiceBroadcast,
    MessageReaction,
    Message,
    VoiceConnection,
    TextChannel,
    RichEmbed,
    RichEmbedOptions,
    VoiceChannel,
} from "discord.js"
import { YouTubeProvider } from "./providers/youtube"
import { NiconicoProvider } from "./providers/niconico"
import { dic as emojiDic } from "pictograph"
import { NotificatableError } from "./classes/notificatable-error"
import { IProvider } from "./interfaces/provider"
import fs from "fs"
import { isNotNull } from "./utils/is-not-null"
import { ProviderManager } from "./singletons/provider-manager"
import { ProviderAndID } from "./classes/provider-and-id"
import { DownloadQueue } from "./singletons/download-queue"

const client = new Client()

interface QueueObj {
    pi: ProviderAndID
    path: string
    from: {
        msg: Message
        react: MessageReaction
    } | null
}

var nowPlaying: { [key: string]: QueueObj } = {}
var queue: { [key: string]: QueueObj[] } = {}
var loggingChannel: { [key: string]: TextChannel } = {}
var autoQueue: { [key: string]: boolean } = {}
var autoQueueSelectHistory: string[] = []

var downloadingPromise: { [key: string]: Promise<string> } = {}

function isFoundInQueue(provider: IProvider, id: string): boolean {
    const allQueue = [...Object.values(nowPlaying), ...Object.values(queue).flatMap(q => q)]
    return allQueue.find(que => que.pi.provider.key === provider.key && que.pi.id === id) != null
}

async function getRandomQueue(count = 0): Promise<QueueObj | undefined> {
    if (count > 20) {
        console.log("failed to select random queue...")
        return
    }
    const r = /^([a-z]+):([^\.]+)\.[^\.]+$/

    const files = await fs.promises
        .readdir(__dirname + "/../cache")
        .then(f => f.map(f => r.exec(f)).filter(isNotNull))
    if (files.length == 0) return
    const file = files[Math.floor(Math.random() * files.length)]
    if (file == null) return
    console.log("random selected file:", file[0])
    if (autoQueueSelectHistory.includes(file[0])) return await getRandomQueue(count + 1)

    const pi = ProviderManager.piFromKey(file[1] + ":" + file[2])
    if (pi == null) return await getRandomQueue(count + 1)
    try {
        const path = await DownloadQueue.download(pi)
        autoQueueSelectHistory.push(file[0])
        while (autoQueueSelectHistory.length >= 10) {
            autoQueueSelectHistory.shift()
        }
        return {
            pi,
            path,
            from: null,
        }
    } catch (e) {
        return await getRandomQueue(count + 1)
    }
}

async function nextQueue(c: VoiceConnection) {
    if (c.dispatcher) return c.dispatcher.end()
    if (queue[c.channel.id] == null) {
        queue[c.channel.id] = []
    }
    var q = queue[c.channel.id].shift()
    if (q == null) {
        if (autoQueue[c.channel.guild.id]) {
            q = await getRandomQueue()
            if (q == null) return
        } else {
            return
        }
    }
    if (q.from != null) {
        try {
            await q.from.react.remove()
            await q.from.msg.react(emojiDic["arrow_forward"]!)
        } catch (e) {
            console.error(e)
        }
    }
    nowPlaying[c.channel.id] = q
    const dispatcher = c.playFile(q.path, {
        volume: 0.25,
    })
    dispatcher.on("end", () => {
        delete nowPlaying[c.channel.id]
        console.log("end", q)
        nextQueue(c)
    })

    const channel = loggingChannel[c.channel.guild.id]
    if (channel != null && q.from != null) {
        const url = q.pi.url
        await channel.send("NowPlaying: " + url + " requested by <@" + q.from.msg.author.id + ">", {
            embed: await q.pi.getRichEmbed(),
        })
    }
}

async function addQueue(c: VoiceConnection, q: QueueObj, isWarikomi: boolean) {
    if (queue[c.channel.id] == null) {
        queue[c.channel.id] = []
    }
    if (isWarikomi) {
        queue[c.channel.id].unshift(q)
    } else {
        queue[c.channel.id].push(q)
    }
    if (isWarikomi || (queue[c.channel.id].length == 1 && c.dispatcher == null)) {
        await nextQueue(c)
    }
}

client.on("message", async msg => {
    if (!msg.content.startsWith("!")) return

    async function requireVCConnection(): Promise<VoiceConnection | undefined> {
        const vc = msg.member.voiceChannel
        if (vc == null) {
            await msg.reply("通話に入ってから言ってください")
            return
        }
        const c = vc.connection
        if (c == null) {
            await msg.reply("先に !join してください")
            return
        }
        return c
    }

    try {
        const args = msg.content.split(" ")
        const commandTable = {
            async warikomi() {
                await commandTable.play(true)
            },
            async play(isWarikomi = false) {
                const c = await requireVCConnection()
                if (c == null) return
                const pi = ProviderManager.match(args[1])
                if (pi == null) return await msg.reply("マッチしませんでした…")
                const react = await msg.react(emojiDic["arrow_down"]!)
                const path = await DownloadQueue.download(pi)
                await react.remove()
                addQueue(
                    c,
                    {
                        pi,
                        path,
                        from: {
                            msg,
                            react: await msg.react(emojiDic["soon"]!),
                        },
                    },
                    isWarikomi,
                )
            },
            async join() {
                const vc = msg.member.voiceChannel
                if (vc == null) return await msg.reply("通話に入ってから言ってください")
                const c = await vc.join()
                delete nowPlaying[c.channel.id]
                delete queue[c.channel.id]
                const channels = msg.guild.channels
                    .filter(c => c.type === "text")
                    .array() as TextChannel[]
                const channel = channels.find(
                    c => c.topic != null && c.topic.includes("!musicbot-ts-logging-channel"),
                )
                if (channel != null) {
                    loggingChannel[msg.guild.id] = channel
                } else {
                    delete loggingChannel[msg.guild.id]
                }
            },
            async leave() {
                const c = await requireVCConnection()
                if (c == null) return
                c.disconnect()
            },
            async queue() {
                const c = await requireVCConnection()
                if (c == null) return
                const np = nowPlaying[c.channel.id]
                const qs = queue[c.channel.id] || []
                const m = [`${qs.length} queues`]
                if (np != null) {
                    m.push("Now Playing: " + np.pi.url)
                    m.push("-----")
                }
                for (const [i, q] of qs.entries()) {
                    m.push(`${i + 1}. ${q.pi.url}`)
                }
                await msg.reply(m.join("\n"))
            },
            async skip() {
                const c = await requireVCConnection()
                if (c == null) return
                const d = c.dispatcher
                if (d == null) return await msg.reply("何も再生してなさそう")
                d.end()
                await msg.react(emojiDic["white_check_mark"]!)
            },
            async autoqueue() {
                switch (args[1]) {
                    case "enable":
                        autoQueue[msg.guild.id] = true
                        await msg.reply("autoqueue has enabled! Enjoy :)")
                        const c = msg.guild.voiceConnection
                        if (c && c.dispatcher == null) {
                            await nextQueue(c)
                        }
                        break
                    case "disable":
                        delete autoQueue[msg.guild.id]
                        await msg.reply("autoqueue has disabled.")
                        break
                    default:
                        msg.reply(
                            [
                                "Usage:",
                                "```",
                                "!autoqueue <enable|disable>",
                                "```",
                                "Current: " + (autoQueue[msg.guild.id] ? "Enabled" : "Disabled"),
                            ].join("\n"),
                        )
                }
            },
            async np() {
                const vc = msg.guild.voiceConnection
                if (vc == null) return await msg.reply("ボイスチャンネルに入っていません")
                console.log(vc.dispatcher.time, vc.dispatcher.totalStreamTime)
                const q = nowPlaying[vc.channel.id]
                if (q == null) return await msg.reply("何も再生していません")
                const url = q.pi.url
                const requestUser =
                    q.from != null
                        ? `<@${q.from.msg.author.id}>`
                        : "autoqueue (you can disable with `!autoqueue disable`)"
                await msg.reply("NowPlaying: " + url + " requested by " + requestUser, {
                    embed: await q.pi.getRichEmbed(),
                })
            },
            async recache() {
                const result = ProviderManager.match(args[1])
                if (result == null) return await msg.reply("マッチしませんでした…")
                const { provider, id } = result
                const key = [provider, id].join(":")
                if (isFoundInQueue(provider, id))
                    return await msg.reply("どこかのキューに積まれている状態でrecacheはできません")
                if (downloadingPromise[key] != null)
                    return await msg.reply("ダウンロード中にはrecacheできません")
                const path = provider.cachePath(id)
                if (!fs.existsSync(path)) return await msg.reply("それはキャッシュしていません")
                const p = (async () => {
                    await fs.promises.unlink(path)
                    try {
                        return await provider.download(id)
                    } catch (e) {
                        await fs.promises.unlink(path)
                        throw e
                    } finally {
                        delete downloadingPromise[key]
                    }
                })()
                downloadingPromise[key] = p
                const r = await msg.react(emojiDic["hourglass"]!)
                await p
                await r.remove()
                await msg.reply("recacheに成功した気がします")
            },
            async help() {
                await msg.reply(
                    [
                        "commands: ",
                        "```",
                        "!(play|warikomi) <URL or nicovideo id> (supported: YouTube, NicoVideo)",
                        "!join",
                        "!leave",
                        "!queue",
                        "!skip",
                        "!autoqueue <|enable|disable>",
                        "!np",
                        "!recache <URL or nicovideo id> (same as !play options)",
                        "!help",
                        "```",
                    ].join("\n"),
                )
            },
        }
        const command = commandTable[(args[0].slice(1) as any) as keyof typeof commandTable]

        if (typeof command !== "function") {
            await msg.reply("知らないコマンドです")
            return
        }

        await command()
    } catch (e) {
        console.error(e)
        try {
            await Promise.all(msg.reactions.filter(r => r.me).map(r => r.remove()))
            await msg.react(emojiDic["sos"]!)
            if (e instanceof NotificatableError) {
                await msg.reply("😢 " + e.message)
            } else {
                await msg.reply("JavaScript error…")
            }
        } catch (e) {
            console.error(e)
        }
    }
})

process.on("SIGINT", async () => {
    try {
        client.voiceConnections.array().forEach(c => c.disconnect())
        await client.destroy()
    } finally {
        process.exit()
    }
})

client.login(process.env.DISCORD_TOKEN)
