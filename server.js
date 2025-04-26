// server.js - Simplified version
const express = require('express');
const http = require('http');
const path = require('path');
const socketIO = require('socket.io');

// Create express app, HTTP server, and socket.io instance
const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Store active rooms and drawings
const rooms = new Map(); // roomId => Set of socket IDs
const drawings = new Map(); // roomId => Array of drawings

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Handle socket.io connections
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  let currentRoom = null;
  let peerId = null;
  
  // Handle room join requests
  socket.on('join', ({ roomId, peerId: clientPeerId }) => {
    // Store room and peer information
    currentRoom = roomId;
    peerId = clientPeerId;
    
    console.log(`Client ${socket.id} (Peer ${peerId}) joining room ${roomId}`);
    
    // Create room if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
      drawings.set(roomId, []);
    }
    
    // Join the socket.io room
    socket.join(roomId);
    
    // Add peer to room
    rooms.get(roomId).add(socket.id);
    
    // Get list of peers already in the room
    const peersInRoom = [];
    for (const [socketId, socketObj] of io.sockets.sockets.entries()) {
      if (socketId !== socket.id && socketObj.rooms.has(roomId)) {
        // Find peerId associated with this socket
        const peerIdForSocket = socketObj.handshake.query.peerId;
        if (peerIdForSocket) {
          peersInRoom.push(peerIdForSocket);
        }
      }
    }
    
    // Send list of peers to the new client
    socket.emit('peers', { peers: peersInRoom });
    
    // Notify other clients about the new peer
    socket.to(roomId).emit('new-peer', { peerId: clientPeerId });
    
    // Send existing drawings to the new client
    const roomDrawings = drawings.get(roomId);
    if (roomDrawings && roomDrawings.length > 0) {
      socket.emit('drawings', { drawings: roomDrawings });
    }
  });
  
  // Handle WebRTC signaling: offers
  socket.on('offer', (data) => {
    const { peerId, targetPeerId, offer } = data;
    console.log(`Received offer from ${peerId} to ${targetPeerId}`);
    
    // Forward offer to the target peer
    socket.to(currentRoom).emit('offer', {
      peerId,
      targetPeerId,
      offer
    });
  });
  
  // Handle WebRTC signaling: answers
  socket.on('answer', (data) => {
    const { peerId, targetPeerId, answer } = data;
    console.log(`Received answer from ${peerId} to ${targetPeerId}`);
    
    // Forward answer to the target peer
    socket.to(currentRoom).emit('answer', {
      peerId,
      targetPeerId,
      answer
    });
  });
  
  // Handle WebRTC signaling: ICE candidates
  socket.on('ice-candidate', (data) => {
    const { peerId, targetPeerId, candidate } = data;
    
    // Forward ICE candidate to the target peer
    socket.to(currentRoom).emit('ice-candidate', {
      peerId,
      targetPeerId,
      candidate
    });
  });
  
  // Handle drawing events
  socket.on('drawing', (data) => {
    if (!currentRoom) return;
    
    // Store drawing data
    const roomDrawings = drawings.get(currentRoom);
    if (roomDrawings) {
      // Don't store too many drawings to avoid memory issues
      if (roomDrawings.length >= 1000) {
        // If it's a clear command, reset the drawings array
        if (data.type === 'clear') {
          drawings.set(currentRoom, [data]);
        } else {
          // Otherwise, remove oldest drawings
          roomDrawings.splice(0, 100);
          roomDrawings.push(data);
        }
      } else {
        roomDrawings.push(data);
      }
    }
    
    // Broadcast drawing data to other clients in the room
    socket.to(currentRoom).emit('drawing', data);
  });
  
  // Handle disconnections
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id} (Peer ${peerId})`);
    
    if (currentRoom && peerId) {
      // Remove peer from room
      const room = rooms.get(currentRoom);
      if (room) {
        room.delete(socket.id);
        
        // If room is empty, clean up
        if (room.size === 0) {
          rooms.delete(currentRoom);
          drawings.delete(currentRoom);
          console.log(`Room ${currentRoom} is now empty and has been removed`);
        }
      }
      
      // Notify other clients about the peer disconnection
      socket.to(currentRoom).emit('peer-disconnected', { peerId });
    }
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});