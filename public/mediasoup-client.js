// public/mediasoup-client.js
class MediasoupClient {
    constructor(options) {
      // Validate required options
      if (!options.roomId) throw new Error('roomId is required');
      if (!options.videosContainer) throw new Error('videosContainer is required');
      if (!options.canvas) throw new Error('canvas is required');
      
      // Assign options
      this.options = options;
      this.debug = options.debug || false;
      this.peerId = `peer-${Math.random().toString(36).substring(2, 12)}`;
      this.roomId = options.roomId;
      this.videosContainer = options.videosContainer;
      this.canvas = options.canvas;
      this.drawingContext = this.canvas.getContext('2d');
      
      // Set initial drawing properties
      this.isDrawing = false;
      this.drawColor = options.drawColor || '#000000';
      this.drawWidth = options.drawWidth || 5;
      this.drawingContext.strokeStyle = this.drawColor;
      this.drawingContext.lineWidth = this.drawWidth;
      this.drawingContext.lineCap = 'round';
      
      // Initialize state
      this.localStream = null;
      this.peerConnections = {};
      this.localVideo = null;
      
      // Set up socket connection
      this.socket = io('/', {
        query: {
          roomId: this.roomId,
          peerId: this.peerId
        }
      });
      
      // Set up event handlers
      this._setupSocketEvents();
      this._setupCanvasEvents();
      
      this._log('MediasoupClient initialized');
    }
    
    async init() {
      try {
        // Get user media
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true
        });
        
        // Create local video element
        this._createLocalVideoElement();
        
        // Send join notification
        this.socket.emit('join', {
          roomId: this.roomId,
          peerId: this.peerId
        });
        
        this._log('Successfully initialized and joined room', this.roomId);
        
        if (this.options.onConnect) {
          this.options.onConnect();
        }
        
        return true;
      } catch (error) {
        this._error('Failed to initialize:', error);
        throw error;
      }
    }
    
    _setupSocketEvents() {
      // When connected to server
      this.socket.on('connect', () => {
        this._log('Connected to signaling server');
      });
      
      // When disconnected from server
      this.socket.on('disconnect', () => {
        this._log('Disconnected from signaling server');
        if (this.options.onDisconnect) {
          this.options.onDisconnect();
        }
      });
      
      // When server reports an error
      this.socket.on('error', (data) => {
        this._error('Server error:', data.message);
        alert(`Server error: ${data.message}`);
      });
      
      // When a new peer joins
      this.socket.on('new-peer', (data) => {
        const { peerId } = data;
        this._log('New peer joined:', peerId);
        this._createPeerConnection(peerId);
        
        if (this.options.onPeerJoined) {
          this.options.onPeerJoined(peerId);
        }
      });
      
      // When a peer disconnects
      this.socket.on('peer-disconnected', (data) => {
        const { peerId } = data;
        this._log('Peer disconnected:', peerId);
        
        // Clean up peer connection
        if (this.peerConnections[peerId]) {
          this.peerConnections[peerId].close();
          delete this.peerConnections[peerId];
        }
        
        // Remove video element
        const videoElement = document.getElementById(`video-${peerId}`);
        if (videoElement) {
          videoElement.remove();
        }
        
        // Update video layout
        this._updateVideoLayout();
        
        if (this.options.onPeerLeft) {
          this.options.onPeerLeft(peerId);
        }
      });
      
      // When we get the list of existing peers
      this.socket.on('peers', (data) => {
        const { peers } = data;
        this._log('Received peers list:', peers);
        
        // Create peer connections for existing peers
        for (const peerId of peers) {
          this._createPeerConnection(peerId);
          
          if (this.options.onPeerJoined) {
            this.options.onPeerJoined(peerId);
          }
        }
      });
      
      // When receiving drawing data
      this.socket.on('drawing', (data) => {
        this._drawRemotePath(data);
      });
      
      // When receiving previous drawings
      this.socket.on('drawings', (data) => {
        const { drawings } = data;
        for (const drawing of drawings) {
          this._drawRemotePath(drawing);
        }
      });
    }
    
    _setupCanvasEvents() {
      if (!this.canvas) return;
      
      // Mouse down event - start drawing
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
      
      // Mouse move event - continue drawing
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
      
      // Mouse up and mouse out events - stop drawing
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
      
      // Touch events for mobile
      this.canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const mouseEvent = new MouseEvent('mousedown', {
          clientX: touch.clientX,
          clientY: touch.clientY
        });
        this.canvas.dispatchEvent(mouseEvent);
      });
      
      this.canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const mouseEvent = new MouseEvent('mousemove', {
          clientX: touch.clientX,
          clientY: touch.clientY
        });
        this.canvas.dispatchEvent(mouseEvent);
      });
      
      this.canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        const mouseEvent = new MouseEvent('mouseup');
        this.canvas.dispatchEvent(mouseEvent);
      });
    }
    
    _sendDrawing(data) {
      this.socket.emit('drawing', data);
    }
    
    _drawRemotePath(data) {
      if (!this.canvas) return;
      
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
        case 'clear':
          ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
          break;
      }
    }
    
    _createLocalVideoElement() {
      // Create video element
      const videoElement = document.createElement('video');
      videoElement.id = 'local-video';
      videoElement.autoplay = true;
      videoElement.muted = true;
      videoElement.playsInline = true;
      videoElement.srcObject = this.localStream;
      
      // Add to container
      this.videosContainer.appendChild(videoElement);
      this.localVideo = videoElement;
      
      // Update layout
      this._updateVideoLayout();
    }
    
    _createPeerConnection(peerId) {
      if (this.peerConnections[peerId]) {
        this._log(`Peer connection to ${peerId} already exists`);
        return;
      }
      
      this._log(`Creating peer connection to ${peerId}`);
      
      // Create peer connection
      const peerConnection = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' }
        ]
      });
      
      // Store peer connection
      this.peerConnections[peerId] = peerConnection;
      
      // Add local stream
      this.localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, this.localStream);
      });
      
      // Set up ICE candidate handling
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          this.socket.emit('ice-candidate', {
            peerId: this.peerId,
            targetPeerId: peerId,
            candidate: event.candidate
          });
        }
      };
      
      // Set up remote stream handling
      peerConnection.ontrack = (event) => {
        this._log(`Received remote track from ${peerId}`);
        this._createRemoteVideoElement(peerId, event.streams[0]);
      };
      
      // Create offer if we're the initiator
      if (this.peerId < peerId) {
        this._createOffer(peerId, peerConnection);
      }
      
      // Handle ICE connection state changes
      peerConnection.oniceconnectionstatechange = () => {
        this._log(`ICE connection state changed to: ${peerConnection.iceConnectionState}`);
        
        if (peerConnection.iceConnectionState === 'failed' || 
            peerConnection.iceConnectionState === 'disconnected' ||
            peerConnection.iceConnectionState === 'closed') {
          
          // Clean up peer connection
          peerConnection.close();
          delete this.peerConnections[peerId];
          
          // Remove video element
          const videoElement = document.getElementById(`video-${peerId}`);
          if (videoElement) {
            videoElement.remove();
            this._updateVideoLayout();
          }
        }
      };
      
      // Handle ICE candidate messages
      this.socket.on('ice-candidate', (data) => {
        if (data.targetPeerId === this.peerId && data.peerId === peerId) {
          this._log(`Received ICE candidate from ${peerId}`);
          peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
            .catch(err => this._error('Error adding ICE candidate:', err));
        }
      });
      
      // Handle offer messages
      this.socket.on('offer', (data) => {
        if (data.targetPeerId === this.peerId && data.peerId === peerId) {
          this._log(`Received offer from ${peerId}`);
          this._handleOffer(peerId, peerConnection, data.offer);
        }
      });
      
      // Handle answer messages
      this.socket.on('answer', (data) => {
        if (data.targetPeerId === this.peerId && data.peerId === peerId) {
          this._log(`Received answer from ${peerId}`);
          this._handleAnswer(peerConnection, data.answer);
        }
      });
      
      return peerConnection;
    }
    
    _createOffer(peerId, peerConnection) {
      this._log(`Creating offer for ${peerId}`);
      
      peerConnection.createOffer()
        .then(offer => {
          this._log('Created offer');
          return peerConnection.setLocalDescription(offer);
        })
        .then(() => {
          this._log('Set local description (offer)');
          this.socket.emit('offer', {
            peerId: this.peerId,
            targetPeerId: peerId,
            offer: peerConnection.localDescription
          });
        })
        .catch(err => this._error('Error creating offer:', err));
    }
    
    _handleOffer(peerId, peerConnection, offer) {
      this._log(`Handling offer from ${peerId}`);
      
      peerConnection.setRemoteDescription(new RTCSessionDescription(offer))
        .then(() => {
          this._log('Set remote description (offer)');
          return peerConnection.createAnswer();
        })
        .then(answer => {
          this._log('Created answer');
          return peerConnection.setLocalDescription(answer);
        })
        .then(() => {
          this._log('Set local description (answer)');
          this.socket.emit('answer', {
            peerId: this.peerId,
            targetPeerId: peerId,
            answer: peerConnection.localDescription
          });
        })
        .catch(err => this._error('Error handling offer:', err));
    }
    
    _handleAnswer(peerConnection, answer) {
      this._log('Handling answer');
      
      peerConnection.setRemoteDescription(new RTCSessionDescription(answer))
        .catch(err => this._error('Error handling answer:', err));
    }
    
    _createRemoteVideoElement(peerId, stream) {
      this._log(`Creating video element for ${peerId}`);
      
      // Check if video element already exists
      let videoElement = document.getElementById(`video-${peerId}`);
      
      if (!videoElement) {
        videoElement = document.createElement('video');
        videoElement.id = `video-${peerId}`;
        videoElement.autoplay = true;
        videoElement.playsInline = true;
        
        this.videosContainer.appendChild(videoElement);
      }
      
      // Set stream as source
      videoElement.srcObject = stream;
      
      // Update layout
      this._updateVideoLayout();
    }
    
    _updateVideoLayout() {
      const videos = this.videosContainer.querySelectorAll('video');
      const numVideos = videos.length;
      
      if (numVideos === 0) return;
      
      // Calculate optimal layout
      const screenAspectRatio = this.videosContainer.clientWidth / this.videosContainer.clientHeight;
      const videoAspectRatio = 16 / 9; // Assume standard video aspect ratio
      
      let rows, cols;
      
      if (numVideos <= 2) {
        rows = 1;
        cols = numVideos;
      } else if (numVideos <= 4) {
        rows = 2;
        cols = 2;
      } else if (numVideos <= 6) {
        rows = 2;
        cols = 3;
      } else if (numVideos <= 9) {
        rows = 3;
        cols = 3;
      } else if (numVideos <= 12) {
        rows = 3;
        cols = 4;
      } else {
        rows = 4;
        cols = 4;
      }
      
      // Calculate video dimensions
      const width = `calc(${100 / cols}% - 10px)`;
      const height = `calc(${100 / rows}% - 10px)`;
      
      // Apply layout to videos
      videos.forEach(video => {
        video.style.width = width;
        video.style.height = height;
        video.style.margin = '5px';
      });
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
    
    // Logging utilities
    _log(...args) {
      if (this.debug) {
        console.log('[MediasoupClient]', ...args);
      }
    }
    
    _error(...args) {
      console.error('[MediasoupClient]', ...args);
    }
  }