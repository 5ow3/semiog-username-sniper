
# SemiOG

Fast, proxy-rotating username checker for 21 platforms. Built in Node.js.

**[Join the support Discord](https://discord.gg/f2fhhkqnW7)**

## Features

- **21 platforms** — Discord, Minecraft, GitHub, Roblox, TikTok, YouTube, Instagram, X, Kick, Pinterest, Telegram, Spotify, Steam, Linktree, Snapchat, GunsLol, OnlyFans, Pornhub, Vanity, Reddit, Twitch
- **Proxy rotation** — Supports HTTP/HTTPS/SOCKS4/SOCKS5 with automatic failover
- **32 name generators** — Custom patterns, wordlists, prefixes, suffixes, leet speak, gamer tags, and more
- **Webhook notifications** — Get pinged instantly when a name is found
- **Auto-cleanup** — Result files older than 24h are deleted on startup
- **Persistent settings** — Webhook, concurrency, count, length, and timeout saved between sessions

## Installation

```bash
git clone https://github.com/5ow3/semiog.git
cd semiog/js
npm install
```

## Usage

Place your proxies in `proxies.txt` (one per line, format: `ip:port:user:pass` or `ip:port`).

```bash
node index.js
```

### Menu

| Key | Action |
|-----|--------|
| `1` | Start checking |
| `2` | Check proxies |
| `3` | Refresh proxies |
| `0` | Settings |
| `q` | Quit |

## Settings

Press `0` from the main menu to configure:

- **Webhook URL** — Discord webhook for notifications
- **Webhook Content** — Message template (`{name}` and `{platform}` placeholders)
- **Concurrency** — Parallel requests (default: 50)
- **Count** — Names per run (default: 100)
- **Length** — Name length (default: 4)
- **Timeout** — Request timeout in seconds (default: 10)

## Name Generators

`custom` · `wordlist` · `suffix` · `prefix` · `underscore_pos` · `dot_pos` · `gamer` · `leet` · `reverse` · `double` · `vowel_swap` · `consonant_swap` · `random_caps` · `pad_left` · `pad_right` · `mix_words` · `adj_noun` · `noun_number` · `two_words` · `three_words` · `short_word` · `long_word` · `numbers` · `chars` · `alphanumeric` · `vowels_only` · `consonants_only` · `no_vowels` · `phonetic` · `syllables` · `brand` · `handle`

## Proxy Format

```
# HTTP/HTTPS
ip:port:user:pass
ip:port

# SOCKS4/SOCKS5
ip:port:user:pass
```
## Preview

<img width="1102" height="603" alt="image" src="https://github.com/user-attachments/assets/bc3736a0-e0e6-4d16-8e76-9c3b9046ad47" />


## License

 Use responsibly. Do not steal code without credits!


