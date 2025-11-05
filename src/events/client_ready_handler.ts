import { CronJob } from "cron";
import { EventBuilder } from "../data/event_manager";
import { Events, Client, TextChannel, EmbedBuilder} from "discord.js";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { GuildMap, prepareWwydEmbed, buildDailyWwydMessage, WWYD_DATA_PATH, toWwydDate, getWwyd } from "../cmds/wwyd";
import { EmbedManager } from "../data/embed_manager";
import dayjs from "dayjs";

export class ClientReadyHandler implements EventBuilder {
  getEventType(): string {
    return Events.ClientReady;
  }
  async getEventCallFunction(c: Client) {
    console.log("Client", c.user!.displayName, "online!");
    const wwydJob = new CronJob('0 10 * * *', async () => {

      console.log("Runing")
      if (!existsSync(WWYD_DATA_PATH)) {
        return;
      }
      const guilds: GuildMap = JSON.parse(
        readFileSync(WWYD_DATA_PATH, "utf-8")
      );

      for (const guildId in guilds) {
        let guildData = guilds[guildId];
        
        const channel = c.channels.cache.get(guildData.channelId) as TextChannel;
        if (!channel) continue;

        const prevMessage = guildData.currentMessageId;
        if (prevMessage) {
          try {
            const msg = await channel.messages.fetch(prevMessage);
            if (msg) {
              // Prepare yesterday's explanation embed and counts content
              const eb = new EmbedManager("wwyd", c);
              const analysisEmbed = new EmbedBuilder();
              let files = await prepareWwydEmbed(eb, analysisEmbed, 1);
              const dateStr = toWwydDate(dayjs()).subtract(1, 'day').format('YYYY-MM-DD');
              const dateCounts = guildData.dates?.[dateStr] || {};
              const entries = Object.entries(dateCounts);
              const total = entries.reduce((acc, [, c]) => acc + (c as number), 0);
              entries.sort((a, b) => (b[1] as number) - (a[1] as number));
              const summary = entries.map(([tile, count]) => `${tile}:${count}`).join(" ");

              // Determine the correct answer for yesterday and compute % correct
              const wwyds: any[] = JSON.parse(readFileSync("assets/wwyd-new.json", "utf-8"));
              const { wwyd } = getWwyd(wwyds, toWwydDate(dayjs()).subtract(1, "day"));
              const correctAnswer = wwyd?.answer as string | undefined;
              const correctCount = correctAnswer ? (dateCounts[correctAnswer] ?? 0) : 0;
              const pct = total > 0 ? ((correctCount / total) * 100).toFixed(1) : "0.0";

              const oneLine = entries.length > 0
                ? `Results ${dateStr} | ${summary} | Total:${total}`
                : `Results ${dateStr} | No responses recorded.`;
              const line2 = correctAnswer ? `Correct: ${correctAnswer} • ${pct}%` : undefined;
              const content = `||\`\`\`text\n${oneLine}${line2 ? `\n${line2}` : ""}\n\`\`\`||`;
              await msg.edit({ content, embeds: [eb, analysisEmbed], files, components: []});

              // Also send a new results-only message to the channel
              const resultsEmbed = new EmbedBuilder()
                .setTitle("Previous day's results")
                .setDescription(
                  `||${[
                    oneLine,
                    correctAnswer ? `Correct: ${correctAnswer} • ${pct}%` : undefined,
                  ]
                    .filter(Boolean)
                    .join("\n")}||`
                );
              await channel.send({ embeds: [resultsEmbed] });
            }
          } catch (e) {
            console.log("Failed to fetch previous WWYD message:", e);
          }
        }

        // Daily mode with buttons
        const eb = new EmbedBuilder();
        const { embeds, files, components } = await buildDailyWwydMessage(eb);
        const sent = await channel.send({ embeds, files, components });
        // Update the current message ID using the sent message
        guilds[guildId].currentMessageId = sent.id;

      }

      writeFileSync(WWYD_DATA_PATH, JSON.stringify(guilds, null, 2), "utf-8");
    },
    null,
    true,
    "America/Toronto"
  );
    wwydJob.start();
  }
}
