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
} from "discord.js"
import { YouTubeProvider } from "./providers/youtube"
import { NiconicoProvider } from "./providers/niconico"
import { dic as emojiDic } from "pictograph"
import { NotificatableError } from "./notificatable-error"
import { IProvider } from "./interfaces/provider"
import fs from "fs"

const providers: IProvider[] = [YouTubeProvider, NiconicoProvider]

const client = new Client()

interface QueueObj {
    provider: IProvider
    id: string
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

function isNotNull<T>(input: T | null | undefined): input is T {
    return input != null
}

function getProviderAndId(text: string): [IProvider, string] | null {
    for (const provider of providers) {
        const id = provider.test(text)
        if (id == null) continue
        return [provider, id]
    }
    return null
}

async function download(provider: IProvider, id: string): Promise<string> {
    const key = [provider.key, id].join(":")
    var p = downloadingPromise[key]
    if (p) return await p
    p = provider.download(id)
    downloadingPromise[key] = p
    try {
        return await p
    } finally {
        delete downloadingPromise[key]
    }
}

function isFoundInQueue(provider: IProvider, id: string): boolean {
    const allQueue = [...Object.values(nowPlaying), ...Object.values(queue).flatMap(q => q)]
    return allQueue.find(que => que.provider.key === provider.key && que.id === id) != null
}

async function getRichEmbedFromQueue(q: QueueObj): Promise<RichEmbedOptions> {
    return await q.provider.richEmbed(q.id).catch(e => {
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

    const providerKey = file[1]
    const id = file[2]
    const provider = providers.find(p => p.key === providerKey)
    if (provider == null) return await getRandomQueue(count + 1)
    try {
        const path = await provider.download(id)
        autoQueueSelectHistory.push(file[0])
        while (autoQueueSelectHistory.length >= 10) {
            autoQueueSelectHistory.shift()
        }
        return {
            provider,
            id,
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
        const url = q.provider.urlFromId(q.id)
        await channel.send("NowPlaying: " + url + " requested by <@" + q.from.msg.author.id + ">", {
            embed: await getRichEmbedFromQueue(q),
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
    try {
        const args = msg.content.split(" ")
        const commandTable = {
            async warikomi() {
                await commandTable.play(true)
            },
            async play(isWarikomi = false) {
                const vc = msg.member.voiceChannel
                if (vc == null) return await msg.reply("通話に入ってから言ってください")
                const c = vc.connection
                if (c == null) return await msg.reply("先に !join してください")
                const result = getProviderAndId(args[1])
                if (result == null) return await msg.reply("マッチしませんでした…")
                const [provider, id] = result
                const react = await msg.react(emojiDic["arrow_down"]!)
                const path = await download(provider, id)
                await react.remove()
                addQueue(
                    c,
                    {
                        provider,
                        id,
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
                const vc = msg.member.voiceChannel
                if (vc == null) return await msg.reply("通話に入ってから言ってください")
                const c = vc.connection
                if (c == null) return await msg.reply("入ってませんけど…")
                c.disconnect()
            },
            async queue() {
                const vc = msg.member.voiceChannel
                if (vc == null) return await msg.reply("通話に入ってから言ってください")
                const np = nowPlaying[vc.id]
                const qs = queue[vc.id] || []
                const m = [`${qs.length} queues`]
                if (np != null) {
                    m.push("Now Playing: " + np.provider.urlFromId(np.id))
                    m.push("-----")
                }
                for (const [i, q] of qs.entries()) {
                    m.push(`${i + 1}. ${q.provider.urlFromId(q.id)}`)
                }
                await msg.reply(m.join("\n"))
            },
            async skip() {
                const vc = msg.member.voiceChannel
                if (vc == null) return await msg.reply("通話に入ってから言ってください")
                const c = vc.connection
                if (c == null) return await msg.reply("入ってませんけど…")
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
                const url = q.provider.urlFromId(q.id)
                const requestUser =
                    q.from != null
                        ? `<@${q.from.msg.author.id}>`
                        : "autoqueue (you can disable with `!autoqueue disable`)"
                await msg.reply("NowPlaying: " + url + " requested by " + requestUser, {
                    embed: await getRichEmbedFromQueue(q),
                })
            },
            async recache() {
                const result = getProviderAndId(args[1])
                if (result == null) return await msg.reply("マッチしませんでした…")
                const [provider, id] = result
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
