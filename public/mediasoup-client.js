// public/mediasoup-client.js
class MediasoupClient {
    constructor(options) {
      // Check if MediaSoup client is available
      if (typeof window.mediasoupClient === 'undefined') {
        throw new Error('MediaSoup client library not loaded');
      }
      
      this.options = options;
      this.debug = options.debug || false;
      this.peerId = `peer-${Math.random().toString(36).substring(2, 12)}`;
      this.roomId = options.roomId;
      this.localStream = null;
      this.device = null;
      this.sendTransport = null;
      this.recvTransport = null;
      this.producers = new Map(); // producerId => Producer
      this.consumers = new Map(); // consumerId => Consumer
      this.peers = new Map(); // peerId => { video: boolean, audio: boolean }
      
      // Log connection attempt
      this._log(`Connecting to room ${this.roomId} with peer ID ${this.peerId}`);
      
      this.socket = io('/', { 
        query: {
          roomId: this.roomId,
          peerId: this.peerId
        }
      });
      
      // Canvas for drawing
      this.canvas = options.canvas;
      this.drawingContext = this.canvas.getContext('2d');
      this.isDrawing = false;
      this.drawColor = options.drawColor || '#000000';
      this.drawWidth = options.drawWidth || 5;
      
      // Video container
      this.videosContainer = options.videosContainer;
      
      // Callbacks
      this.onConnect = options.onConnect || (() => {});
      this.onDisconnect = options.onDisconnect || (() => {});
      this.onPeerJoined = options.onPeerJoined || (() => {});
      this.onPeerLeft = options.onPeerLeft || (() => {});
      
      this._setupSocketEvents();
      this._setupCanvasEvents();
    }
    
    async init() {
      try {
        // Load MediaSoup device
        this.device = new window.mediasoupClient.Device();
        
        // Get router RTP capabilities
        const { rtpCapabilities } = await this._request('getRouterRtpCapabilities');
        
        // Load the device with router RTP capabilities
        await this.device.load({ routerRtpCapabilities: rtpCapabilities });
        
        // Get user media
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true
        });
        
        // Create local video element
        this._createLocalVideoElement();
        
        // Create send transport for publishing media
        await this._createSendTransport();
        
        // Create receive transport for consuming media
        await this._createReceiveTransport();
        
        // Publish audio and video
        await this._publish('audio');
        await this._publish('video');
        
        this.onConnect();
        
        this._log('MediaSoup client initialized');
      } catch (error) {
        console.error('Error initializing MediaSoup client:', error);
      }
    }
    
    // Socket.IO events
    _setupSocketEvents() {
      this.socket.on('connect', () => {
        this._log('Connected to server');
      });
      
      this.socket.on('disconnect', () => {
        this._log('Disconnected from server');
        this.onDisconnect();
      });
      
      this.socket.on('peers', async ({ peers }) => {
        for (const peerId of peers) {
          this.peers.set(peerId, { video: false, audio: false });
          this.onPeerJoined(peerId);
        }
      });
      
      this.socket.on('new-peer', ({ peerId }) => {
        this._log(`New peer joined: ${peerId}`);
        this.peers.set(peerId, { video: false, audio: false });
        this.onPeerJoined(peerId);
      });
      
      this.socket.on('peer-disconnected', ({ peerId }) => {
        this._log(`Peer disconnected: ${peerId}`);
        this.peers.delete(peerId);
        
        // Remove video element
        const videoElement = document.getElementById(`video-${peerId}`);
        if (videoElement) {
          videoElement.remove();
          this._updateVideoLayout();
        }
        
        this.onPeerLeft(peerId);
      });
      
      this.socket.on('new-producer', async ({ peerId, producerId, kind }) => {
        this._log(`New producer: ${peerId}, ${kind}`);
        await this._consume(peerId, producerId);
        
        // Update peer media info
        const peerInfo = this.peers.get(peerId) || { video: false, audio: false };
        peerInfo[kind] = true;
        this.peers.set(peerId, peerInfo);
      });
      
      this.socket.on('drawing', (data) => {
        this._drawRemotePath(data);
      });
      
      this.socket.on('drawings', ({ drawings }) => {
        for (const drawing of drawings) {
          this._drawRemotePath(drawing);
        }
      });
    }
    
    // Canvas drawing events
    _setupCanvasEvents() {
      if (!this.canvas) {
        return;
      }
      
      this.canvas.addEventListener('mousedown', (e) => {
        this.isDrawing = true;
        const x = e.clientX - this.canvas.offsetLeft;
        const y = e.clientY - this.canvas.offsetTop;
        
        // Start new path
        this.drawingContext.beginPath();
        this.drawingContext.moveTo(x, y);
        
        // Send drawing start to other peers
        this._sendDrawing({
          type: 'start',
          x,
          y,
          color: this.drawColor,
          width: this.drawWidth
        });
      });
      
      this.canvas.addEventListener('mousemove', (e) => {
        if (!this.isDrawing) return;
        
        const x = e.clientX - this.canvas.offsetLeft;
        const y = e.clientY - this.canvas.offsetTop;
        
        // Continue drawing
        this.drawingContext.lineTo(x, y);
        this.drawingContext.stroke();
        
        // Send drawing move to other peers
        this._sendDrawing({
          type: 'move',
          x,
          y,
          color: this.drawColor,
          width: this.drawWidth
        });
      });
      
      ['mouseup', 'mouseout'].forEach(eventName => {
        this.canvas.addEventListener(eventName, () => {
          if (this.isDrawing) {
            this.isDrawing = false;
            
            // Send drawing end to other peers
            this._sendDrawing({
              type: 'end'
            });
          }
        });
      });
    }
    
    // Send drawing data to other peers
    _sendDrawing(data) {
      this.socket.emit('drawing', data);
    }
    
    // Draw remote path
    _drawRemotePath(data) {
      if (!this.canvas) {
        return;
      }
      
      const ctx = this.drawingContext;
      
      switch (data.type) {
        case 'start':
          ctx.beginPath();
          ctx.moveTo(data.x, data.y);
          ctx.strokeStyle = data.color;
          ctx.lineWidth = data.width;
          break;
        case 'move':
          ctx.lineTo(data.x, data.y);
          ctx.stroke();
          break;
        case 'end':
          ctx.closePath();
          break;
      }
    }
    
    // Helper to send socket.io request and wait for response
    _request(type, data = {}) {
      return new Promise((resolve, reject) => {
        this.socket.emit(type, data, (response) => {
          if (response.error) {
            reject(new Error(response.error));
          } else {
            resolve(response);
          }
        });
      });
    }
    
    // Create local video element
    _createLocalVideoElement() {
      const videoElement = document.createElement('video');
      videoElement.id = 'local-video';
      videoElement.autoplay = true;
      videoElement.muted = true;
      videoElement.playsInline = true;
      videoElement.srcObject = this.localStream;
      
      this.videosContainer.appendChild(videoElement);
      this._updateVideoLayout();
    }
    
    // Create send transport
    async _createSendTransport() {
      const transportInfo = await this._request('createWebRtcTransport', {
        producing: true,
        consuming: false
      });
      
      this.sendTransport = this.device.createSendTransport({
        id: transportInfo.id,
        iceParameters: transportInfo.iceParameters,
        iceCandidates: transportInfo.iceCandidates,
        dtlsParameters: transportInfo.dtlsParameters
      });
      
      // Set transport events
      this.sendTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          await this._request('connectWebRtcTransport', {
            transportId: this.sendTransport.id,
            dtlsParameters
          });
          callback();
        } catch (error) {
          errback(error);
        }
      });
      
      this.sendTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
        try {
          const { id } = await this._request('produce', {
            transportId: this.sendTransport.id,
            kind,
            rtpParameters
          });
          callback({ id });
        } catch (error) {
          errback(error);
        }
      });
    }
    
    // Create receive transport
    async _createReceiveTransport() {
      const transportInfo = await this._request('createWebRtcTransport', {
        producing: false,
        consuming: true
      });
      
      this.recvTransport = this.device.createRecvTransport({
        id: transportInfo.id,
        iceParameters: transportInfo.iceParameters,
        iceCandidates: transportInfo.iceCandidates,
        dtlsParameters: transportInfo.dtlsParameters
      });
      
      // Set transport events
      this.recvTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          await this._request('connectWebRtcTransport', {
            transportId: this.recvTransport.id,
            dtlsParameters
          });
          callback();
        } catch (error) {
          errback(error);
        }
      });
    }
    
    // Publish media
    async _publish(kind) {
      let track;
      
      if (kind === 'audio') {
        track = this.localStream.getAudioTracks()[0];
      } else if (kind === 'video') {
        track = this.localStream.getVideoTracks()[0];
      }
      
      if (!track) {
        throw new Error(`No ${kind} track`);
      }
      
      const producer = await this.sendTransport.produce({
        track,
        encodings: kind === 'video' ? [
          { maxBitrate: 100000 },
          { maxBitrate: 300000 },
          { maxBitrate: 900000 }
        ] : undefined
      });
      
      this.producers.set(producer.id, producer);
      
      producer.on('transportclose', () => {
        this.producers.delete(producer.id);
      });
      
      producer.on('trackended', () => {
        this._log(`${kind} track ended`);
        producer.close();
        this.producers.delete(producer.id);
      });
      
      return producer;
    }
    
    // Consume media
    async _consume(peerId, producerId) {
      const { id, kind, rtpParameters } = await this._request('consume', {
        transportId: this.recvTransport.id,
        producerId,
        rtpCapabilities: this.device.rtpCapabilities
      });
      
      const consumer = await this.recvTransport.consume({
        id,
        producerId,
        kind,
        rtpParameters
      });
      
      this.consumers.set(consumer.id, consumer);
      
      consumer.on('transportclose', () => {
        this.consumers.delete(consumer.id);
      });
      
      // Resume consumer
      await this._request('resume-consumer', { consumerId: consumer.id });
      
      // If it's video, create a video element
      if (kind === 'video') {
        this._createRemoteVideoElement(peerId, consumer);
      }
      
      return consumer;
    }
    
    // Create remote video element
    _createRemoteVideoElement(peerId, consumer) {
      let videoElement = document.getElementById(`video-${peerId}`);
      
      if (!videoElement) {
        videoElement = document.createElement('video');
        videoElement.id = `video-${peerId}`;
        videoElement.autoplay = true;
        videoElement.playsInline = true;
        
        this.videosContainer.appendChild(videoElement);
      }
      
      // Create MediaStream from track
      const stream = new MediaStream([consumer.track]);
      videoElement.srcObject = stream;
      
      this._updateVideoLayout();
    }
    
    // Update video layout
    _updateVideoLayout() {
      const videos = this.videosContainer.querySelectorAll('video');
      const width = 100 / Math.ceil(Math.sqrt(videos.length));
      const height = 100 / Math.ceil(videos.length / Math.ceil(Math.sqrt(videos.length)));
      
      for(let i = 0; i < videos.length; i++) {
        videos[i].style.width = `calc(${width}% - 10px)`;
        videos[i].style.height = `calc(${height}% - 10px)`;
      }
    }
    
    // Set drawing color
    setDrawColor(color) {
      this.drawColor = color;
      if (this.drawingContext) {
        this.drawingContext.strokeStyle = color;
      }
    }
    
    // Set drawing width
    setDrawWidth(width) {
      this.drawWidth = width;
      if (this.drawingContext) {
        this.drawingContext.lineWidth = width;
      }
    }
    
    // Clear canvas
    clearCanvas() {
      if (this.drawingContext) {
        this.drawingContext.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Send clear command to other peers
        this._sendDrawing({
          type: 'clear'
        });
      }
    }
    
    // Logger
    _log(...args) {
      if (this.debug) {
        console.log('[MediasoupClient]', ...args);
      }
    }
  }