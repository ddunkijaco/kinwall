# Where everyone is

If your family uses [Home Assistant](https://www.home-assistant.io), Kinwall can show where everyone is right now: **🏠 Home**, the name of a place you chose (like **📍 School**), or **🚶 Out**. It shows a place name only, never a position on a map, and keeps no history.

## Set it up

On a grown-up's device, open **Settings → Family → Home Assistant**.

1. **Connect Home Assistant.**
   * In the [Home Assistant add-on](../getting-started/home-assistant-add-on.md), tap **Use this Home Assistant**. Kinwall connects to the Home Assistant it runs in, and only after you tap it.
   * Anywhere else, tap **Connect Home Assistant** and enter its address and a long-lived access token. To make a token in Home Assistant, open your profile, then **Security**, and create a long-lived access token. Kinwall keeps the token encrypted and never shows it again.
   * Self-hosted Kinwall can use a home-network address like `http://homeassistant.local:8123`. Kinwall hosted for you needs a public `https` address, for example from [Nabu Casa](https://www.nabucasa.com).
2. **Link each person.** Open a person under **Members** and pick their **Home Assistant person**. Only Home Assistant *people* can be linked, and each one to a single member.
3. **Choose the places to show by name.** Under **Places shown by name**, pick the Home Assistant zones the family may see by name. Home always shows. New zones you add in Home Assistant stay hidden until you add them here.

## What it shows

| In Home Assistant | On Kinwall |
|---|---|
| Home | 🏠 Home |
| A zone you chose to show | 📍 the zone's name, as Home Assistant has it |
| A zone you didn't choose, or away | 🚶 Out |
| Unknown or unavailable (a phone that's off) | Nothing: that person is left off |

Where it shows:

* **The Board**: a row of badges in the clock's card. In a [Board layout](../settings/this-display.md) you can place a **Where everyone is** card instead. Either one hides itself when nobody's whereabouts are known.
* **Profiles**: a badge under the person's name.

Kinwall reads Home Assistant when a screen asks and keeps the answer for a minute, so open boards update about once a minute.

## Wall screens

Wall screens show nothing about where anyone is unless a grown-up turns on **Show where everyone is on wall screens** in **Settings → Family → Home Assistant**. Visitors in the room see the wall, so it's off by default. Phones and tablets that belong to someone in the family always show it.

## When Home Assistant can't be reached

The badges quietly disappear. Grown-ups see **Can't reach Home Assistant. Reconnect** in Settings → Family; tap **Reconnect** and enter a new token if the old one stopped working. Members, links and chosen places are kept.

## Privacy

* Only place names: Kinwall never asks Home Assistant for coordinates and never stores where anyone was.
* Whereabouts never go to webhooks, connected apps and AI assistants (MCP), snapshots, share links, notifications, Newscast or the [export](../your-data/export-import.md).
* For arrival and leaving alerts, use a Home Assistant automation.
* **Disconnect** (under **More…** in the Home Assistant section) forgets the token, the links and the chosen places.

See [Privacy](../your-data/privacy.md#home-assistant) for the details.
