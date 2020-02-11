require("dotenv-safe").config()
import { Client, VoiceBroadcast, MessageReaction, Message, VoiceConnection } from "discord.js"
import { YouTubeProvider } from "./providers/youtube"
import { NiconicoProvider } from "./providers/niconico"
import { dic as emojiDic } from "pictograph"
import { NotificatableError } from "./notificatable-error"
import { IProvider } from "./interfaces/provider"

const providers: IProvider[] = [YouTubeProvider, NiconicoProvider]

const client = new Client()

interface QueueObj {
    provider: IProvider
    id: string
    path: string
    msg: Message
    react: MessageReaction
}

var nowPlaying: {[key: string]: QueueObj} = {}
var queue: {[key: string]: QueueObj[]} = {}

async function nextQueue(c: VoiceConnection) {
    if (c.dispatcher) return c.dispatcher.end()
    if (queue[c.channel.id] == null) return
    const q = queue[c.channel.id].shift()
    if (q == null) return
    try {
        await q.react.remove()
        await q.msg.react(emojiDic["arrow_forward"]!)
    } catch(e) {
        console.error(e)
    }
    nowPlaying[c.channel.id] = q
    const dispatcher = c.playFile(q.path, {
        volume: 0.25
    })
    dispatcher.on("end", () => {
        delete nowPlaying[c.channel.id]
        console.log("end", q)
        nextQueue(c)
    })
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
    var react: MessageReaction | null = null
    try {
        const args = msg.content.split(" ")
        var isWarikomi = false
        switch(args[0]) {
        case "!warikomi":
            isWarikomi = true
        case "!play":
            {
                const vc = msg.member.voiceChannel
                if (vc == null) return await msg.reply("通話に入ってから言ってください")
                const c = vc.connection
                if (c == null) return await msg.reply("先に !join してください")
                for (const provider of providers) {
                    const id = provider.test(args[1])
                    if (id == null) continue
                    react = await msg.react(emojiDic["arrow_down"]!)
                    const path = await provider.download(id)
                    react.remove()
                    react = null
                    addQueue(c, {
                        provider,
                        id,
                        path,
                        msg,
                        react: await msg.react(emojiDic["soon"]!),
                    }, isWarikomi)
                    return
                }
                await msg.reply("マッチしませんでした…")
            }
            break
        case "!join":
            {
                const vc = msg.member.voiceChannel
                if (vc == null) return await msg.reply("通話に入ってから言ってください")
                const c = await vc.join()
                delete nowPlaying[c.channel.id]
                delete queue[c.channel.id]
                break
            }
        case "!leave":
            {
                const vc = msg.member.voiceChannel
                if (vc == null) return await msg.reply("通話に入ってから言ってください")
                const c = vc.connection
                if (c == null) return await msg.reply("入ってませんけど…")
                c.disconnect()
                break
            }
        case "!queue":
            {
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
                    m.push(`${i+1}. ${q.provider.urlFromId(q.id)}`)
                }
                await msg.reply(m.join("\n"))
            }
            break
        case "!skip":
            {
                const vc = msg.member.voiceChannel
                if (vc == null) return await msg.reply("通話に入ってから言ってください")
                const c = vc.connection
                if (c == null) return await msg.reply("入ってませんけど…")
                const d = c.dispatcher
                if (d == null) return await msg.reply("何も再生してなさそう")
                d.end()
                await msg.react(emojiDic["white_check_mark"]!)
            }
            break
        case "!help":
            return await msg.reply([
                "commands: ",
                "```",
                "!(play|warikomi) <URL or nicovideo id> (supported: YouTube, NicoVideo)",
                "!join",
                "!leave",
                "!queue",
                "!skip",
                "!help",
                "```",
            ].join("\n"))
        default:
            await msg.reply("知らないコマンドです")
        }
    } catch(e) {
        console.error(e)
        try {
            if (react != null) {
                await react.remove()
                await msg.react(emojiDic["sos"]!)
            }
        } catch(e) {
            console.error(e)
        }
        if (e instanceof NotificatableError) {
            await msg.reply("😢 " + e.message)
        } else {
            await msg.reply("JavaScript error…")
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