const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/manifest.json', (_req, res) => {
  res.sendFile(path.join(__dirname, 'manifest.json'));
});

app.get('/icon-180.png', (_req, res) => {
  res.sendFile(path.join(__dirname, 'icon-180.png'));
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

const rooms = new Map();

function getPeersList(room) {
  const list = [];
  for (const c of room.clients) {
    list.push({ peerId: c.peerId, name: c.peerName || 'Guest', role: c.peerRole || 'guest' });
  }
  return list;
}

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      clients: new Set(),
      blockedIds: new Set(),
      hostClientKey: null,
      queue: [],
      chatHistory: [],
      state: {
        videoId: 'n61ULEU7CO0',
        title: 'Best of Lofi & Chill Beats',
        artist: 'Lofi Girl',
        thumb: 'https://i.ytimg.com/vi/n61ULEU7CO0/mqdefault.jpg',
        duration: 240,
        audioMode: 'normal',
        coDj: false,
        tracksPlayed: 1,
        playbackRate: 1.0,
        locked: false,
        status: 'paused',
        positionSeconds: 0,
        updatedAt: Date.now()
      }
    });
  }
  return rooms.get(roomId);
}

function broadcast(room, payload, excludeWs = null) {
  const msg = JSON.stringify(payload);
  for (const client of room.clients) {
    if (client !== excludeWs && client.readyState === 1) {
      client.send(msg);
    }
  }
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomId = (url.searchParams.get('room') || 'YTM-8429').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20) || 'YTM-8429';
  const room = getOrCreateRoom(roomId);

  const clientKey = (url.searchParams.get('cid') || '').slice(0, 32);
  if (clientKey && room.blockedIds.has(clientKey)) {
    ws.send(JSON.stringify({ type: 'BLOCKED' }));
    ws.close();
    return;
  }
  if (room.state.locked && room.clients.size >= 2) {
    ws.send(JSON.stringify({ type: 'ROOM_LOCKED' }));
    ws.close();
    return;
  }

  ws.peerId = Math.random().toString(36).slice(2, 10);
  ws.clientKey = clientKey || ws.peerId;
  ws.peerName = url.searchParams.get('name') || 'Listener';
  const requestedRole = url.searchParams.get('role') === 'host' ? 'host' : 'guest';
  if (!room.hostClientKey && requestedRole === 'host') {
    room.hostClientKey = ws.clientKey;
  } else if (!room.hostClientKey && room.clients.size === 0) {
    room.hostClientKey = ws.clientKey;
  }
  ws.peerRole = (room.hostClientKey === ws.clientKey) ? 'host' : 'guest';
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  // Replace any stale/zombie connection from the same device (clientKey)
  if (clientKey) {
    for (const old of room.clients) {
      if (old.clientKey === clientKey) {
        room.clients.delete(old);
        try { old.terminate(); } catch (_) {}
      }
    }
  }
  room.clients.add(ws);

  ws.send(JSON.stringify({
    type: 'ROOM_STATE',
    serverNow: Date.now(),
    payload: room.state
  }));
  ws.send(JSON.stringify({ type: 'YOUR_PEER_ID', peerId: ws.peerId }));
  ws.send(JSON.stringify({ type: 'ROLE_ASSIGNED', role: ws.peerRole }));
  ws.send(JSON.stringify({ type: 'QUEUE_UPDATE', queue: room.queue }));
  if (room.chatHistory.length) {
    ws.send(JSON.stringify({ type: 'CHAT_HISTORY', messages: room.chatHistory }));
  }
  broadcast(room, { type: 'PEER_COUNT', count: room.clients.size, peers: getPeersList(room) });

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      if (data.type === 'UPDATE_STATE' && data.payload) {
        const trackChanged = data.payload.videoId && data.payload.videoId !== room.state.videoId;
        const nextPlayed = (room.state.tracksPlayed || 1) + (trackChanged ? 1 : 0);
        room.state = {
          ...room.state,
          ...data.payload,
          tracksPlayed: nextPlayed,
          updatedAt: Date.now()
        };
        broadcast(room, {
          type: 'ROOM_STATE',
          serverNow: Date.now(),
          payload: room.state
        }, ws);
      } else if (data.type === 'ADD_TO_QUEUE' && data.track && data.track.videoId) {
        const exists = room.queue.some((q) => q.videoId === data.track.videoId);
        if (!exists && room.state.videoId !== data.track.videoId) {
          room.queue.push(data.track);
        }
        broadcast(room, { type: 'QUEUE_UPDATE', queue: room.queue });
      } else if (data.type === 'POP_QUEUE') {
        room.queue.shift();
        broadcast(room, { type: 'QUEUE_UPDATE', queue: room.queue });
      } else if (data.type === 'MOVE_QUEUE_UP' && typeof data.index === 'number' && data.index > 0 && data.index < room.queue.length) {
        const [item] = room.queue.splice(data.index, 1);
        room.queue.unshift(item);
        broadcast(room, { type: 'QUEUE_UPDATE', queue: room.queue });
      } else if (data.type === 'CLEAR_QUEUE') {
        room.queue = [];
        broadcast(room, { type: 'QUEUE_UPDATE', queue: room.queue });
      } else if (data.type === 'REMOVE_QUEUE' && typeof data.index === 'number') {
        room.queue.splice(data.index, 1);
        broadcast(room, { type: 'QUEUE_UPDATE', queue: room.queue });
      } else if ((data.type === 'RTC_OFFER' || data.type === 'RTC_ANSWER' || data.type === 'RTC_ICE') && data.targetPeerId) {
        for (const c of room.clients) {
          if (c.peerId === data.targetPeerId && c.readyState === 1) {
            c.send(JSON.stringify({ ...data, fromPeerId: ws.peerId }));
          }
        }
      } else if (data.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG', ts: data.ts, serverNow: Date.now() }));
      } else if (data.type === 'BLOCK_PEER' && data.peerId && ws.peerRole === 'host') {
        for (const c of room.clients) {
          if (c.peerId === data.peerId && c !== ws) {
            room.blockedIds.add(c.clientKey);
            if (c.readyState === 1) c.send(JSON.stringify({ type: 'BLOCKED' }));
            c.close();
            room.clients.delete(c);
          }
        }
        broadcast(room, { type: 'PEER_COUNT', count: room.clients.size, peers: getPeersList(room) });
      } else if (data.type === 'UNBLOCK_ALL' && ws.peerRole === 'host') {
        room.blockedIds.clear();
      } else if (data.type === 'REQUEST_HOST') {
        for (const c of room.clients) {
          if (c.peerRole === 'host' && c.readyState === 1) {
            c.send(JSON.stringify({ type: 'HOST_REQUEST', peerId: ws.peerId, name: ws.peerName }));
          }
        }
      } else if (data.type === 'APPROVE_HOST' && data.peerId && ws.peerRole === 'host') {
        let target = null;
        for (const c of room.clients) {
          if (c.peerId === data.peerId) target = c;
        }
        if (target) {
          room.hostClientKey = target.clientKey;
          for (const c of room.clients) {
            c.peerRole = (c === target) ? 'host' : 'guest';
            if (c.readyState === 1) c.send(JSON.stringify({ type: 'ROLE_ASSIGNED', role: c.peerRole }));
          }
          broadcast(room, { type: 'PEER_COUNT', count: room.clients.size, peers: getPeersList(room) });
        }
      } else if (data.type === 'DENY_HOST' && data.peerId && ws.peerRole === 'host') {
        for (const c of room.clients) {
          if (c.peerId === data.peerId && c.readyState === 1) {
            c.send(JSON.stringify({ type: 'HOST_DENIED' }));
          }
        }
      } else if (data.type === 'HELLO') {
        if (data.name) ws.peerName = String(data.name).slice(0, 24);
        ws.peerRole = (room.hostClientKey === ws.clientKey) ? 'host' : 'guest';
        broadcast(room, { type: 'PEER_COUNT', count: room.clients.size, peers: getPeersList(room) });
      } else if (data.type === 'CHAT_MSG' && data.text) {
        const chatItem = { sender: data.sender || 'User', text: String(data.text).slice(0, 200), ts: Date.now() };
        room.chatHistory.push(chatItem);
        if (room.chatHistory.length > 20) room.chatHistory.shift();
        broadcast(room, { type: 'CHAT_MSG', ...chatItem });
      } else if (data.type === 'SKIP_REQUEST') {
        broadcast(room, { type: 'SKIP_REQUEST', sender: data.sender || 'Friend' }, ws);
      } else if (data.type === 'REACTION' && data.emoji) {
        broadcast(room, { type: 'REACTION', emoji: data.emoji, sender: data.sender || 'Friend' });
      }
    } catch (_) {}
  });

  ws.on('error', () => {});

  ws.on('close', () => {
    room.clients.delete(ws);
    if (room.clients.size === 0) {
      rooms.delete(roomId);
    } else {
      broadcast(room, { type: 'PEER_COUNT', count: room.clients.size, peers: getPeersList(room) });
    }
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    for (const ws of room.clients) {
      if (ws.isAlive === false) {
        room.clients.delete(ws);
        try { ws.terminate(); } catch (_) {}
        broadcast(room, { type: 'PEER_COUNT', count: room.clients.size, peers: getPeersList(room) });
      } else {
        ws.isAlive = false;
        try { ws.ping(); } catch (_) {}
      }
    }
  }
}, 30000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Arnab MusicSync running at http://localhost:${PORT}`);
});
