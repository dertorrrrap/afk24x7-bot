# 🎮 Mineflayer Control Panel

A web-based control panel for your Mineflayer Minecraft bot.

## Setup

```bash
npm install
npm start
```

Then open: **http://localhost:3000**

---

## Features

| Feature | Details |
|---|---|
| **Connect** | Enter IP, port, username → click Connect |
| **Hotbar** | See all 9 hotbar slots with item names & icons. Click to select |
| **Movement** | Hold buttons: Forward / Back / Left / Right / Sneak / Jump |
| **Auto Eat** | Toggle — bot eats when food drops below 14 |
| **Auto Armor** | Toggle — bot auto-equips best armor |
| **Auto Tool** | Toggle — bot auto-equips best tool when mining |
| **Vault Take** | Sends `/vault`, takes the first item found |
| **Vault Deposit** | Sends `/vault`, deposits all ores & ingots from inventory |
| **Mine Ores** | Mines all ore blocks within 10 blocks radius |
| **Follow Player** | Bot continuously follows the named player |
| **Send Command** | Type any command like `/vault`, `/home`, `/tpa Steve` |

---

## Ore / Ingot Detection

The vault deposit and mining features recognize all vanilla ores including:
- All deepslate variants
- Nether ores (gold, quartz, ancient debris)
- Ingots: iron, gold, copper, netherite
- Raw materials: raw iron, raw gold, raw copper
- Gems: diamond, emerald, lapis, redstone, coal, quartz

---

## Notes

- **Auth mode** is set to `offline` by default (cracked/offline servers).  
  Change `auth: 'offline'` to `auth: 'microsoft'` in `server.js` for premium accounts.
- **Vault** works on servers with the `/vault` plugin (common on Factions/HCF/SkyBlock servers).
- **mineflayer-armor-manager** runs automatically after loading. Toggle may vary by version.

---

## Dependencies

```
express            — web server
socket.io          — real-time browser ↔ server communication
mineflayer         — core bot library
mineflayer-pathfinder — navigation / follow player / mine pathing
mineflayer-auto-eat   — automatic eating
mineflayer-armor-manager — automatic armor equip
mineflayer-tool    — auto-equip best tool
minecraft-data     — block/item data by version
```
