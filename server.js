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

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      clients: new Set(),
      queue: [],
      state: {
        videoId: 'jfKfPfyJRdk',
        title: 'Lofi Hip Hop Radio',
        artist: 'Lofi Girl',
        thumb: 'https://i.ytimg.com/vi/jfKfPfyJRdk/mqdefault.jpg',
        duration: 240,
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
  const roomId = (url.searchParams.get('room') || 'YTM-8429').toUpperCase();
  const room = getOrCreateRoom(roomId);

  room.clients.add(ws);

  ws.send(JSON.stringify({
    type: 'ROOM_STATE',
    serverNow: Date.now(),
    payload: room.state
  }));
  ws.send(JSON.stringify({ type: 'QUEUE_UPDATE', queue: room.queue }));
  broadcast(room, { type: 'PEER_COUNT', count: room.clients.size });

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      if (data.type === 'UPDATE_STATE' && data.payload) {
        room.state = {
          ...room.state,
          ...data.payload,
          updatedAt: Date.now()
        };
        broadcast(room, {
          type: 'ROOM_STATE',
          serverNow: Date.now(),
          payload: room.state
        }, ws);
      } else if (data.type === 'ADD_TO_QUEUE' && data.track) {
        room.queue.push(data.track);
        broadcast(room, { type: 'QUEUE_UPDATE', queue: room.queue });
      } else if (data.type === 'POP_QUEUE') {
        room.queue.shift();
        broadcast(room, { type: 'QUEUE_UPDATE', queue: room.queue });
      } else if (data.type === 'REMOVE_QUEUE' && typeof data.index === 'number') {
        room.queue.splice(data.index, 1);
        broadcast(room, { type: 'QUEUE_UPDATE', queue: room.queue });
      } else if (data.type === 'REACTION' && data.emoji) {
        broadcast(room, { type: 'REACTION', emoji: data.emoji, sender: data.sender || 'Friend' });
      }
    } catch (_) {}
  });

  ws.on('close', () => {
    room.clients.delete(ws);
    if (room.clients.size === 0) {
      rooms.delete(roomId);
    } else {
      broadcast(room, { type: 'PEER_COUNT', count: room.clients.size });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Arnab MusicSync running at http://localhost:${PORT}`);
});
