uconst express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { plugin: autoEatPlugin } = require('mineflayer-auto-eat');
const armorManager = require('mineflayer-armor-manager');
const { plugin: toolPlugin } = require('mineflayer-tool');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static('public'));

// ─── State ────────────────────────────────────────────────────────────────────
let bot = null;
let isMining = false;
let isFollowing = false;
let followInterval = null;
let autoToolEnabled = false;

// ─── Ore / Ingot names ────────────────────────────────────────────────────────
const ORE_SET = new Set([
  'coal_ore',        'deepslate_coal_ore',
  'iron_ore',        'deepslate_iron_ore',
  'copper_ore',      'deepslate_copper_ore',
  'gold_ore',        'deepslate_gold_ore',
  'redstone_ore',    'deepslate_redstone_ore',
  'lapis_ore',       'deepslate_lapis_ore',
  'diamond_ore',     'deepslate_diamond_ore',
  'emerald_ore',     'deepslate_emerald_ore',
  'nether_gold_ore', 'nether_quartz_ore',
  'ancient_debris',
  // ingots / raw / gems
  'iron_ingot',      'gold_ingot',      'copper_ingot',  'netherite_ingot',
  'raw_iron',        'raw_gold',        'raw_copper',
  'diamond',         'emerald',         'coal',
  'redstone',        'lapis_lazuli',    'quartz',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function log(msg) {
  console.log(msg);
  io.emit('log', msg);
}

function getHotbar() {
  if (!bot) return null;
  const items = [];
  for (let i = 0; i < 9; i++) {
    const item = bot.inventory.slots[36 + i];
    items.push(item
      ? { name: item.name, displayName: item.displayName, count: item.count }
      : null
    );
  }
  return { items, held: bot.quickBarSlot };
}

function broadcastStats() {
  if (!bot) return;
  io.emit('stats', {
    health: Math.round(bot.health * 10) / 10,
    food:   Math.round(bot.food),
  });
}

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  // Send current state to newly connected browser tab
  if (bot) {
    socket.emit('status', { connected: true });
    socket.emit('hotbar', getHotbar());
    broadcastStats();
  }

  // ── JOIN ───────────────────────────────────────────────────────────────────
  socket.on('join', ({ host, port, username }) => {
    if (bot) {
      try { bot.quit(); } catch (_) {}
      bot = null;
    }

    try {
      bot = mineflayer.createBot({
        host:     host     || 'localhost',
        port:     parseInt(port) || 25565,
        username: username || 'ControlBot',
        auth:     'offline',
        version:  false,
      });

      bot.loadPlugin(pathfinder);
      bot.loadPlugin(autoEatPlugin);
      bot.loadPlugin(armorManager);
      bot.loadPlugin(toolPlugin);

      bot.once('spawn', () => {
        const mcData = require('minecraft-data')(bot.version);
        bot.pathfinder.setMovements(new Movements(bot));

        // Auto-eat defaults
        if (bot.autoEat) {
          bot.autoEat.options = {
            priority:    'foodPoints',
            startAt:     14,
            bannedFood:  [],
          };
          bot.autoEat.disable(); // starts disabled; user toggles it on
        }

        io.emit('status', { connected: true });
        log('✅ Bot spawned!');
        io.emit('hotbar', getHotbar());
        broadcastStats();
      });

      bot.on('health', () => {
        broadcastStats();
        io.emit('hotbar', getHotbar());
      });

      bot.on('heldItemChanged', () => io.emit('hotbar', getHotbar()));

      // Inventory change → update hotbar
      bot.inventory.on('updateSlot', () => io.emit('hotbar', getHotbar()));

      bot.on('message', (msg) => log(`💬 ${msg.toString()}`));

      bot.on('error', (err) => {
        io.emit('status', { connected: false });
        log(`❌ Error: ${err.message}`);
        bot = null;
      });

      bot.on('kicked', (reason) => {
        io.emit('status', { connected: false });
        log(`👢 Kicked: ${reason}`);
        bot = null;
      });

      bot.on('end', () => {
        io.emit('status', { connected: false });
        log('🔌 Bot disconnected');
        bot = null;
      });

    } catch (e) {
      socket.emit('status', { connected: false });
      log(`❌ Failed to create bot: ${e.message}`);
    }
  });

  // ── DISCONNECT BOT ─────────────────────────────────────────────────────────
  socket.on('disconnect_bot', () => {
    isFollowing = false;
    isMining    = false;
    if (followInterval) { clearInterval(followInterval); followInterval = null; }
    if (bot) { try { bot.quit(); } catch (_) {} bot = null; }
    io.emit('status', { connected: false });
    log('🔌 Bot disconnected by user');
  });

  // ── HOTBAR SELECT ──────────────────────────────────────────────────────────
  socket.on('hotbar_select', (slot) => {
    if (!bot) return;
    bot.setQuickBarSlot(parseInt(slot));
    io.emit('hotbar', getHotbar());
  });

  // ── MOVEMENT ───────────────────────────────────────────────────────────────
  socket.on('move_start', (action) => {
    if (!bot) return;
    bot.setControlState(action, true);
  });

  socket.on('move_stop', (action) => {
    if (!bot) return;
    bot.setControlState(action, false);
  });

  socket.on('stop_all_movement', () => {
    if (!bot) return;
    ['forward','back','left','right','sneak','jump','sprint']
      .forEach(s => bot.setControlState(s, false));
  });

  // ── TOGGLES ────────────────────────────────────────────────────────────────
  socket.on('toggle_autoeat', (enabled) => {
    if (!bot?.autoEat) return;
    enabled ? bot.autoEat.enable() : bot.autoEat.disable();
    log(`🍗 Auto-eat ${enabled ? 'ON' : 'OFF'}`);
  });

  socket.on('toggle_autoarmor', (enabled) => {
    // mineflayer-armor-manager runs automatically when loaded.
    // To disable: unload events. For simplicity, we track the flag.
    if (!bot) return;
    if (enabled) {
      bot.armorManager?.start?.();
    } else {
      bot.armorManager?.stop?.();
    }
    log(`🛡️ Auto-armor ${enabled ? 'ON' : 'OFF'}`);
  });

  socket.on('toggle_autotool', (enabled) => {
    autoToolEnabled = enabled;
    log(`🔧 Auto-tool ${enabled ? 'ON' : 'OFF'}`);
  });

  // ── VAULT: TAKE FIRST ITEM ─────────────────────────────────────────────────
  socket.on('vault_take', async () => {
    if (!bot) return;
    try {
      bot.chat('/vault');
      log('📦 Sending /vault...');

      const window = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Vault did not open in time')), 6000);
        bot.once('windowOpen', (w) => { clearTimeout(timer); resolve(w); });
      });

      await bot.waitForTicks(5);

      const vaultSize = window.inventoryStart;
      let found = false;

      for (let i = 0; i < vaultSize; i++) {
        if (window.slots[i]) {
          const item = window.slots[i];
          await bot.clickWindow(i, 0, 1); // shift+click → moves to player inventory
          log(`✅ Took: ${item.displayName || item.name} ×${item.count}`);
          found = true;
          break;
        }
      }

      if (!found) log('📦 Vault appears empty!');

      await bot.waitForTicks(4);
      await bot.closeWindow(window);
      io.emit('hotbar', getHotbar());

    } catch (e) {
      log(`❌ Vault take error: ${e.message}`);
      try { if (bot.currentWindow) await bot.closeWindow(bot.currentWindow); } catch (_) {}
    }
  });

  // ── VAULT: DEPOSIT ORES / INGOTS ───────────────────────────────────────────
  socket.on('vault_deposit', async () => {
    if (!bot) return;
    try {
      bot.chat('/vault');
      log('📦 Opening vault for deposit...');

      const window = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Vault did not open in time')), 6000);
        bot.once('windowOpen', (w) => { clearTimeout(timer); resolve(w); });
      });

      await bot.waitForTicks(10);

      const vaultSize = window.inventoryStart;
      let count = 0;

      // Player inventory slots start at vaultSize within this window
      for (let i = vaultSize; i < window.slots.length; i++) {
        const item = window.slots[i];
        if (item && ORE_SET.has(item.name)) {
          await bot.clickWindow(i, 0, 1); // shift+click → moves to vault
          await bot.waitForTicks(3);
          log(`📤 Deposited: ${item.displayName || item.name} ×${item.count}`);
          count++;
        }
      }

      if (count === 0) log('📦 No ores/ingots found in inventory!');
      else log(`✅ Deposited ${count} stack(s) into vault!`);

      await bot.waitForTicks(5);
      await bot.closeWindow(window);
      io.emit('hotbar', getHotbar());

    } catch (e) {
      log(`❌ Deposit error: ${e.message}`);
      try { if (bot.currentWindow) await bot.closeWindow(bot.currentWindow); } catch (_) {}
    }
  });

  // ── MINE ORES IN RADIUS ────────────────────────────────────────────────────
  socket.on('mine_ores', async () => {
    if (!bot || isMining) return;
    isMining = true;
    io.emit('mining_state', true);
    log('⛏️ Scanning for ores within 10 blocks...');

    const ORE_BLOCK_NAMES = [
      'coal_ore',        'deepslate_coal_ore',
      'iron_ore',        'deepslate_iron_ore',
      'copper_ore',      'deepslate_copper_ore',
      'gold_ore',        'deepslate_gold_ore',
      'redstone_ore',    'deepslate_redstone_ore',
      'lapis_ore',       'deepslate_lapis_ore',
      'diamond_ore',     'deepslate_diamond_ore',
      'emerald_ore',     'deepslate_emerald_ore',
      'nether_gold_ore', 'nether_quartz_ore',
      'ancient_debris',
    ];

    try {
      const mcData = require('minecraft-data')(bot.version);
      const oreIds = ORE_BLOCK_NAMES
        .map(n => mcData.blocksByName[n]?.id)
        .filter(Boolean);

      const positions = bot.findBlocks({ matching: oreIds, maxDistance: 10, count: 64 });

      if (!positions.length) {
        log('❌ No ores found in range!');
        isMining = false;
        io.emit('mining_state', false);
        return;
      }

      log(`⛏️ Found ${positions.length} ore block(s). Starting...`);
      bot.pathfinder.setMovements(new Movements(bot));
      const { GoalBlock } = goals;

      for (const pos of positions) {
        if (!isMining) break;

        const block = bot.blockAt(pos);
        if (!block || block.name === 'air') continue;

        try {
          await bot.pathfinder.goto(new GoalBlock(pos.x, pos.y, pos.z));

          if (autoToolEnabled && bot.tool) {
            await bot.tool.equipForBlock(block);
          }

          if (bot.canDigBlock(block)) {
            await bot.dig(block);
            log(`⛏️ Mined: ${block.displayName || block.name}`);
          }

          await bot.waitForTicks(2);
        } catch (e) {
          log(`⚠️ Skipped block at ${pos.x},${pos.y},${pos.z}: ${e.message}`);
        }
      }

      log('✅ Mining complete!');
    } catch (e) {
      log(`❌ Mining error: ${e.message}`);
    }

    isMining = false;
    io.emit('mining_state', false);
    io.emit('hotbar', getHotbar());
  });

  socket.on('stop_mining', () => {
    isMining = false;
    if (bot) bot.pathfinder.setGoal(null);
    io.emit('mining_state', false);
    log('⛏️ Mining stopped');
  });

  // ── FOLLOW PLAYER ──────────────────────────────────────────────────────────
  socket.on('follow_player', ({ playerName, enabled }) => {
    if (!bot) return;

    if (!enabled) {
      isFollowing = false;
      if (followInterval) { clearInterval(followInterval); followInterval = null; }
      bot.pathfinder.setGoal(null);
      io.emit('follow_state', false);
      log('👣 Stopped following');
      return;
    }

    isFollowing = true;
    io.emit('follow_state', true);
    log(`👣 Now following: ${playerName}`);

    bot.pathfinder.setMovements(new Movements(bot));
    const { GoalFollow } = goals;

    followInterval = setInterval(() => {
      if (!isFollowing || !bot) return;
      const player = bot.players[playerName];
      if (player?.entity) {
        bot.pathfinder.setGoal(new GoalFollow(player.entity, 2), true);
      } else {
        log(`⚠️ Player "${playerName}" not visible`);
      }
    }, 500);
  });

  // ── SEND COMMAND ───────────────────────────────────────────────────────────
  socket.on('send_command', (cmd) => {
    if (!bot) return;
    bot.chat(cmd);
    log(`📤 Sent: ${cmd}`);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = 4000;
httpServer.listen(PORT, () => {
  console.log(`\n🚀 Mineflayer Control Panel running at: http://localhost:${PORT}\n`);
});
