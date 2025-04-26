// AdvancedDrawingModule.js
class AdvancedDrawingModule {
    constructor(options) {
      // Validate required options
      if (!options.canvas) throw new Error('canvas is required');
      
      // Main properties
      this.canvas = options.canvas;
      this.ctx = this.canvas.getContext('2d');
      this.socket = options.socket;
      this.roomId = options.roomId;
      this.debug = options.debug || false;
      
      // Drawing state
      this.isDrawing = false;
      this.lastX = 0;
      this.lastY = 0;
      this.points = [];
      this.paths = [];
      this.redoPaths = [];
      
      // Drawing settings
      this.currentColor = options.color || '#000000';
      this.currentBrush = 'pen';
      this.currentSize = options.size || 5;
      this.stabilizer = 8; // Higher = smoother, but more latency
      this.opacity = 1.0;
      this.blendMode = 'source-over';
      
      // Layers
      this.layers = [];
      this.currentLayerIndex = 0;
      this.offscreenCanvases = {};
      
      // Create default layer
      this._addLayer('Background');
      
      // Initialize
      this._setupCanvas();
      this._setupEvents();
      
      this._log('AdvancedDrawingModule initialized');
    }
    
    // Public methods
    
    // Brush settings
    setBrushType(type) {
      this.currentBrush = type;
      this._updateBrushSettings();
      
      // Send brush change to server
      if (this.socket) {
        this._sendDrawingSettings({
          type: 'brushType',
          value: type
        });
      }
    }
    
    setColor(color) {
      this.currentColor = color;
      this._updateBrushSettings();
      
      // Send color change to server
      if (this.socket) {
        this._sendDrawingSettings({
          type: 'color',
          value: color
        });
      }
    }
    
    setSize(size) {
      this.currentSize = size;
      this._updateBrushSettings();
      
      // Send size change to server
      if (this.socket) {
        this._sendDrawingSettings({
          type: 'size',
          value: size
        });
      }
    }
    
    setOpacity(opacity) {
      this.opacity = Math.max(0, Math.min(1, opacity));
      this._updateBrushSettings();
      
      // Send opacity change to server
      if (this.socket) {
        this._sendDrawingSettings({
          type: 'opacity',
          value: this.opacity
        });
      }
    }
    
    setBlendMode(mode) {
      const validModes = [
        'source-over', 'source-in', 'source-out', 'source-atop',
        'destination-over', 'destination-in', 'destination-out', 'destination-atop',
        'lighter', 'copy', 'xor', 'multiply', 'screen', 'overlay',
        'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light',
        'soft-light', 'difference', 'exclusion', 'hue', 'saturation',
        'color', 'luminosity'
      ];
      
      if (validModes.includes(mode)) {
        this.blendMode = mode;
        this._updateBrushSettings();
        
        // Send blend mode change to server
        if (this.socket) {
          this._sendDrawingSettings({
            type: 'blendMode',
            value: mode
          });
        }
      } else {
        this._error('Invalid blend mode:', mode);
      }
    }
    
    setStabilizer(level) {
      this.stabilizer = Math.max(0, Math.min(20, level));
      
      // Send stabilizer change to server
      if (this.socket) {
        this._sendDrawingSettings({
          type: 'stabilizer',
          value: this.stabilizer
        });
      }
    }
    
    // Layer management
    addLayer(name) {
      const layerIndex = this._addLayer(name);
      this.currentLayerIndex = layerIndex;
      
      // Send layer add to server
      if (this.socket) {
        this._sendLayerAction({
          type: 'add',
          name: name,
          index: layerIndex
        });
      }
      
      return layerIndex;
    }
    
    removeLayer(index) {
      if (this.layers.length <= 1) {
        this._log('Cannot remove the last layer');
        return false;
      }
      
      this.layers.splice(index, 1);
      
      // Update current layer index if needed
      if (this.currentLayerIndex >= this.layers.length) {
        this.currentLayerIndex = this.layers.length - 1;
      }
      
      // Redraw canvas
      this._redrawCanvas();
      
      // Send layer remove to server
      if (this.socket) {
        this._sendLayerAction({
          type: 'remove',
          index: index
        });
      }
      
      return true;
    }
    
    setLayerVisibility(index, visible) {
      if (index >= 0 && index < this.layers.length) {
        this.layers[index].visible = visible;
        this._redrawCanvas();
        
        // Send layer visibility change to server
        if (this.socket) {
          this._sendLayerAction({
            type: 'visibility',
            index: index,
            visible: visible
          });
        }
        
        return true;
      }
      return false;
    }
    
    setLayerOpacity(index, opacity) {
      if (index >= 0 && index < this.layers.length) {
        this.layers[index].opacity = Math.max(0, Math.min(1, opacity));
        this._redrawCanvas();
        
        // Send layer opacity change to server
        if (this.socket) {
          this._sendLayerAction({
            type: 'opacity',
            index: index,
            opacity: this.layers[index].opacity
          });
        }
        
        return true;
      }
      return false;
    }
    
    selectLayer(index) {
      if (index >= 0 && index < this.layers.length) {
        this.currentLayerIndex = index;
        return true;
      }
      return false;
    }
    
    moveLayerUp(index) {
      if (index >= 0 && index < this.layers.length - 1) {
        // Swap layers
        [this.layers[index], this.layers[index + 1]] = [this.layers[index + 1], this.layers[index]];
        
        // Update current layer index if needed
        if (this.currentLayerIndex === index) {
          this.currentLayerIndex = index + 1;
        } else if (this.currentLayerIndex === index + 1) {
          this.currentLayerIndex = index;
        }
        
        // Redraw canvas
        this._redrawCanvas();
        
        // Send layer move to server
        if (this.socket) {
          this._sendLayerAction({
            type: 'move',
            index: index,
            direction: 'up'
          });
        }
        
        return true;
      }
      return false;
    }
    
    moveLayerDown(index) {
      if (index > 0 && index < this.layers.length) {
        // Swap layers
        [this.layers[index], this.layers[index - 1]] = [this.layers[index - 1], this.layers[index]];
        
        // Update current layer index if needed
        if (this.currentLayerIndex === index) {
          this.currentLayerIndex = index - 1;
        } else if (this.currentLayerIndex === index - 1) {
          this.currentLayerIndex = index;
        }
        
        // Redraw canvas
        this._redrawCanvas();
        
        // Send layer move to server
        if (this.socket) {
          this._sendLayerAction({
            type: 'move',
            index: index,
            direction: 'down'
          });
        }
        
        return true;
      }
      return false;
    }
    
    // Canvas actions
    clear() {
      // Clear the current layer
      const layerCanvas = this._getLayerCanvas(this.currentLayerIndex);
      const layerCtx = layerCanvas.getContext('2d');
      layerCtx.clearRect(0, 0, layerCanvas.width, layerCanvas.height);
      
      // Redraw main canvas
      this._redrawCanvas();
      
      // Add to history
      this._addToHistory({ type: 'clear', layerIndex: this.currentLayerIndex });
      
      // Send clear action to server
      if (this.socket) {
        this._sendDrawing({
          type: 'clear',
          layerIndex: this.currentLayerIndex
        });
      }
    }
    
    clearAll() {
      // Clear all layers
      for (let i = 0; i < this.layers.length; i++) {
        const layerCanvas = this._getLayerCanvas(i);
        const layerCtx = layerCanvas.getContext('2d');
        layerCtx.clearRect(0, 0, layerCanvas.width, layerCanvas.height);
      }
      
      // Redraw main canvas
      this._redrawCanvas();
      
      // Add to history
      this._addToHistory({ type: 'clearAll' });
      
      // Send clear all action to server
      if (this.socket) {
        this._sendDrawing({
          type: 'clearAll'
        });
      }
    }
    
    undo() {
      if (this.paths.length === 0) return false;
      
      const lastAction = this.paths.pop();
      this.redoPaths.push(lastAction);
      
      // Redraw all layers from scratch based on the remaining paths
      this._clearAllLayers();
      this._replayPaths(this.paths);
      
      // Send undo action to server
      if (this.socket) {
        this._sendDrawing({
          type: 'undo'
        });
      }
      
      return true;
    }
    
    redo() {
      if (this.redoPaths.length === 0) return false;
      
      const action = this.redoPaths.pop();
      this.paths.push(action);
      
      // Apply the action
      this._applyAction(action);
      
      // Send redo action to server
      if (this.socket) {
        this._sendDrawing({
          type: 'redo'
        });
      }
      
      return true;
    }
    
    // Export functions
    exportAsImage(type = 'image/png', quality = 0.92) {
      return this.canvas.toDataURL(type, quality);
    }
    
    exportAsBlob(type = 'image/png', quality = 0.92) {
      return new Promise(resolve => {
        this.canvas.toBlob(blob => {
          resolve(blob);
        }, type, quality);
      });
    }
    
    // Save and load
    saveState() {
      const state = {
        layers: this.layers.map(layer => ({
          name: layer.name,
          visible: layer.visible,
          opacity: layer.opacity,
          data: this._getLayerCanvas(layer.index).toDataURL()
        })),
        currentLayerIndex: this.currentLayerIndex
      };
      
      return JSON.stringify(state);
    }
    
    loadState(stateStr) {
      try {
        const state = JSON.parse(stateStr);
        
        // Clear current layers
        this.layers = [];
        this.offscreenCanvases = {};
        
        // Load layers
        for (let i = 0; i < state.layers.length; i++) {
          const layerData = state.layers[i];
          const layerIndex = this._addLayer(layerData.name);
          
          // Set layer properties
          this.layers[layerIndex].visible = layerData.visible;
          this.layers[layerIndex].opacity = layerData.opacity;
          
          // Load layer image data
          const layerCanvas = this._getLayerCanvas(layerIndex);
          const layerCtx = layerCanvas.getContext('2d');
          
          const img = new Image();
          img.onload = () => {
            layerCtx.clearRect(0, 0, layerCanvas.width, layerCanvas.height);
            layerCtx.drawImage(img, 0, 0);
            this._redrawCanvas();
          };
          img.src = layerData.data;
        }
        
        // Set current layer
        this.currentLayerIndex = state.currentLayerIndex;
        
        // Redraw canvas
        this._redrawCanvas();
        
        return true;
      } catch (error) {
        this._error('Failed to load state:', error);
        return false;
      }
    }
    
    // Private methods
    
    _setupCanvas() {
      // Reset canvas properties
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.globalCompositeOperation = this.blendMode;
      this.ctx.globalAlpha = this.opacity;
    }
    
    _setupEvents() {
      // Mouse events
      this.canvas.addEventListener('mousedown', this._handleMouseDown.bind(this));
      window.addEventListener('mousemove', this._handleMouseMove.bind(this));
      window.addEventListener('mouseup', this._handleMouseUp.bind(this));
      
      // Touch events
      this.canvas.addEventListener('touchstart', this._handleTouchStart.bind(this), { passive: false });
      window.addEventListener('touchmove', this._handleTouchMove.bind(this), { passive: false });
      window.addEventListener('touchend', this._handleTouchEnd.bind(this), { passive: false });
      
      // Handle socket events if socket is provided
      if (this.socket) {
        this.socket.on('drawing', this._handleRemoteDrawing.bind(this));
        this.socket.on('drawings', this._handleRemoteDrawings.bind(this));
      }
    }
    
    _updateBrushSettings() {
      switch (this.currentBrush) {
        case 'pen':
          this.ctx.globalAlpha = this.opacity;
          this.ctx.globalCompositeOperation = this.blendMode;
          this.ctx.lineWidth = this.currentSize;
          this.ctx.lineCap = 'round';
          this.ctx.lineJoin = 'round';
          this.ctx.strokeStyle = this.currentColor;
          break;
          
        case 'pencil':
          this.ctx.globalAlpha = this.opacity * 0.8;
          this.ctx.globalCompositeOperation = 'source-over';
          this.ctx.lineWidth = this.currentSize * 0.5;
          this.ctx.lineCap = 'round';
          this.ctx.lineJoin = 'round';
          this.ctx.strokeStyle = this.currentColor;
          break;
          
        case 'brush':
          this.ctx.globalAlpha = this.opacity * 0.9;
          this.ctx.globalCompositeOperation = this.blendMode;
          this.ctx.lineWidth = this.currentSize * 2;
          this.ctx.lineCap = 'round';
          this.ctx.lineJoin = 'round';
          this.ctx.strokeStyle = this.currentColor;
          break;
          
        case 'marker':
          this.ctx.globalAlpha = 0.6;
          this.ctx.globalCompositeOperation = 'multiply';
          this.ctx.lineWidth = this.currentSize * 3;
          this.ctx.lineCap = 'square';
          this.ctx.lineJoin = 'miter';
          this.ctx.strokeStyle = this.currentColor;
          break;
          
        case 'eraser':
          this.ctx.globalAlpha = 1.0;
          this.ctx.globalCompositeOperation = 'destination-out';
          this.ctx.lineWidth = this.currentSize * 2;
          this.ctx.lineCap = 'round';
          this.ctx.lineJoin = 'round';
          this.ctx.strokeStyle = '#000000';
          break;
          
        case 'airbrush':
          this.ctx.globalAlpha = 0.2;
          this.ctx.globalCompositeOperation = this.blendMode;
          this.ctx.lineWidth = this.currentSize * 0.5;
          this.ctx.lineCap = 'round';
          this.ctx.lineJoin = 'round';
          this.ctx.strokeStyle = this.currentColor;
          break;
          
        default:
          // Default to pen
          this.ctx.globalAlpha = this.opacity;
          this.ctx.globalCompositeOperation = this.blendMode;
          this.ctx.lineWidth = this.currentSize;
          this.ctx.lineCap = 'round';
          this.ctx.lineJoin = 'round';
          this.ctx.strokeStyle = this.currentColor;
      }
    }
    
    _addLayer(name) {
      const index = this.layers.length;
      
      this.layers.push({
        index,
        name: name || `Layer ${index + 1}`,
        visible: true,
        opacity: 1.0
      });
      
      return index;
    }
    
    _getLayerCanvas(layerIndex) {
      if (!this.offscreenCanvases[layerIndex]) {
        const canvas = document.createElement('canvas');
        canvas.width = this.canvas.width;
        canvas.height = this.canvas.height;
        this.offscreenCanvases[layerIndex] = canvas;
      }
      
      return this.offscreenCanvases[layerIndex];
    }
    
    _redrawCanvas() {
      // Clear main canvas
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      
      // Draw each visible layer
      for (const layer of this.layers) {
        if (layer.visible) {
          const layerCanvas = this._getLayerCanvas(layer.index);
          this.ctx.globalAlpha = layer.opacity;
          this.ctx.globalCompositeOperation = 'source-over';
          this.ctx.drawImage(layerCanvas, 0, 0);
        }
      }
      
      // Reset settings
      this.ctx.globalAlpha = this.opacity;
      this.ctx.globalCompositeOperation = this.blendMode;
    }
    
    _clearAllLayers() {
      for (let i = 0; i < this.layers.length; i++) {
        const layerCanvas = this._getLayerCanvas(i);
        const layerCtx = layerCanvas.getContext('2d');
        layerCtx.clearRect(0, 0, layerCanvas.width, layerCanvas.height);
      }
      
      // Clear main canvas
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    
    _replayPaths(paths) {
      for (const action of paths) {
        this._applyAction(action);
      }
      
      // Redraw main canvas
      this._redrawCanvas();
    }
    
    _applyAction(action) {
      switch (action.type) {
        case 'path':
          this._replayPath(action);
          break;
          
        case 'clear':
          const layerCanvas = this._getLayerCanvas(action.layerIndex);
          const layerCtx = layerCanvas.getContext('2d');
          layerCtx.clearRect(0, 0, layerCanvas.width, layerCanvas.height);
          break;
          
        case 'clearAll':
          this._clearAllLayers();
          break;
      }
      
      // Redraw main canvas
      this._redrawCanvas();
    }
    
    _replayPath(pathAction) {
      const { layerIndex, color, size, brush, opacity, blendMode, points } = pathAction;
      
      // Get layer canvas
      const layerCanvas = this._getLayerCanvas(layerIndex);
      const layerCtx = layerCanvas.getContext('2d');
      
      // Set brush properties
      layerCtx.strokeStyle = color;
      layerCtx.lineWidth = size;
      layerCtx.lineCap = 'round';
      layerCtx.lineJoin = 'round';
      layerCtx.globalAlpha = opacity;
      layerCtx.globalCompositeOperation = blendMode;
      
      // Apply special brush settings if needed
      switch (brush) {
        case 'pencil':
          layerCtx.globalAlpha = opacity * 0.8;
          layerCtx.lineWidth = size * 0.5;
          break;
          
        case 'brush':
          layerCtx.globalAlpha = opacity * 0.9;
          layerCtx.lineWidth = size * 2;
          break;
          
        case 'marker':
          layerCtx.globalAlpha = 0.6;
          layerCtx.globalCompositeOperation = 'multiply';
          layerCtx.lineWidth = size * 3;
          layerCtx.lineCap = 'square';
          layerCtx.lineJoin = 'miter';
          break;
          
        case 'eraser':
          layerCtx.globalAlpha = 1.0;
          layerCtx.globalCompositeOperation = 'destination-out';
          layerCtx.lineWidth = size * 2;
          layerCtx.strokeStyle = '#000000';
          break;
          
        case 'airbrush':
          layerCtx.globalAlpha = 0.2;
          layerCtx.lineWidth = size * 0.5;
          break;
      }
      
      // Draw the path
      if (points.length > 0) {
        layerCtx.beginPath();
        layerCtx.moveTo(points[0].x, points[0].y);
        
        // Use quadratic curves for smoother lines
        for (let i = 1; i < points.length; i++) {
          const xc = (points[i].x + points[i - 1].x) / 2;
          const yc = (points[i].y + points[i - 1].y) / 2;
          
          if (i === 1) {
            // First point
            layerCtx.lineTo(xc, yc);
          } else {
            // Middle points - use quadratic curve
            layerCtx.quadraticCurveTo(points[i - 1].x, points[i - 1].y, xc, yc);
          }
        }
        
        // Add the last point
        if (points.length > 1) {
          const lastPoint = points[points.length - 1];
          layerCtx.lineTo(lastPoint.x, lastPoint.y);
        }
        
        layerCtx.stroke();
        
        // If it's an airbrush, add some spray effect
        if (brush === 'airbrush') {
          for (const point of points) {
            for (let i = 0; i < size; i++) {
              const angle = Math.random() * Math.PI * 2;
              const radius = Math.random() * size * 3;
              const x = point.x + Math.cos(angle) * radius;
              const y = point.y + Math.sin(angle) * radius;
              
              layerCtx.beginPath();
              layerCtx.arc(x, y, Math.random() * 1.5, 0, Math.PI * 2);
              layerCtx.fillStyle = color;
              layerCtx.globalAlpha = Math.random() * 0.1;
              layerCtx.fill();
            }
          }
        }
      }
    }
    
    _addToHistory(action) {
      // Clear redo stack when new action is added
      this.redoPaths = [];
      
      // Add to history
      this.paths.push(action);
      
      // Limit history size
      if (this.paths.length > 50) {
        this.paths.shift();
      }
    }
    
    _getPointFromEvent(e) {
      let x, y;
      
      if (e.touches) {
        // Touch event
        x = e.touches[0].clientX - this.canvas.getBoundingClientRect().left;
        y = e.touches[0].clientY - this.canvas.getBoundingClientRect().top;
      } else {
        // Mouse event
        x = e.clientX - this.canvas.getBoundingClientRect().left;
        y = e.clientY - this.canvas.getBoundingClientRect().top;
      }
      
      return { x, y };
    }
    
    // Event Handlers
    _handleMouseDown(e) {
      this.isDrawing = true;
      const point = this._getPointFromEvent(e);
      this.lastX = point.x;
      this.lastY = point.y;
      
      // Reset points array
      this.points = [{ x: point.x, y: point.y }];
      
      // Update brush settings
      this._updateBrushSettings();
      
      // Get current layer canvas
      const layerCanvas = this._getLayerCanvas(this.currentLayerIndex);
      const layerCtx = layerCanvas.getContext('2d');
      
      // Apply current brush settings to layer context
      layerCtx.strokeStyle = this.ctx.strokeStyle;
      layerCtx.lineWidth = this.ctx.lineWidth;
      layerCtx.lineCap = this.ctx.lineCap;
      layerCtx.lineJoin = this.ctx.lineJoin;
      layerCtx.globalAlpha = this.ctx.globalAlpha;
      layerCtx.globalCompositeOperation = this.ctx.globalCompositeOperation;
      
      // Start path
      layerCtx.beginPath();
      layerCtx.moveTo(point.x, point.y);
      
      // Special handling for airbrush
      if (this.currentBrush === 'airbrush') {
        this._drawAirbrush(layerCtx, point.x, point.y);
      }
      
      // Send start drawing to server
      if (this.socket) {
        this._sendDrawing({
          type: 'start',
          x: point.x,
          y: point.y,
          layerIndex: this.currentLayerIndex,
          color: this.currentColor,
          size: this.currentSize,
          brush: this.currentBrush,
          opacity: this.opacity,
          blendMode: this.blendMode
        });
      }
    }
    
    _handleMouseMove(e) {
      if (!this.isDrawing) return;
      
      const point = this._getPointFromEvent(e);
      
      // Add point to stabilizer array
      this.points.push({ x: point.x, y: point.y });
      
      // Get the stabilized point
      const stablePoint = this._getStabilizedPoint();
      
      // Get current layer canvas
      const layerCanvas = this._getLayerCanvas(this.currentLayerIndex);
      const layerCtx = layerCanvas.getContext('2d');
      
      // Draw line
      layerCtx.beginPath();
      layerCtx.moveTo(this.lastX, this.lastY);
      
      // Special handling for different brushes
      switch (this.currentBrush) {
        case 'airbrush':
          this._drawAirbrush(layerCtx, stablePoint.x, stablePoint.y);
          break;
          
        default:
          layerCtx.lineTo(stablePoint.x, stablePoint.y);
          layerCtx.stroke();
      }
      
      // Update last position
      this.lastX = stablePoint.x;
      this.lastY = stablePoint.y;
      
      // Redraw main canvas
      this._redrawCanvas();
      
      // Send move drawing to server
      if (this.socket) {
        this._sendDrawing({
          type: 'move',
          x: stablePoint.x,
          y: stablePoint.y,
          layerIndex: this.currentLayerIndex
        });
      }
    }
    
    _handleMouseUp() {
      if (!this.isDrawing) return;
      
      this.isDrawing = false;
      
      // Add the path to history
      this._addToHistory({
        type: 'path',
        layerIndex: this.currentLayerIndex,
        color: this.currentColor,
        size: this.currentSize,
        brush: this.currentBrush,
        opacity: this.opacity,
        blendMode: this.blendMode,
        points: [...this.points] // Clone the points array
      });
      
      // Reset points array
      this.points = [];
      
      // Send end drawing to server
      if (this.socket) {
        this._sendDrawing({
          type: 'end',
          layerIndex: this.currentLayerIndex
        });
      }
    }
    
    _handleTouchStart(e) {
      e.preventDefault();
      this._handleMouseDown(e);
    }
    
    _handleTouchMove(e) {
      e.preventDefault();
      this._handleMouseMove(e);
    }
    
    _handleTouchEnd(e) {
      e.preventDefault();
      this._handleMouseUp();
    }
    
    _handleRemoteDrawing(data) {
      if (!data) return;
      
      switch (data.type) {
        case 'start':
          // Set up remote drawing
          this._startRemoteDrawing(data);
          break;
          
        case 'move':
          // Continue remote drawing
          this._moveRemoteDrawing(data);
          break;
          
        case 'end':
          // End remote drawing
          this._endRemoteDrawing(data);
          break;
          
        case 'clear':
          // Clear the specified layer
          if (data.layerIndex >= 0 && data.layerIndex < this.layers.length) {
            const layerCanvas = this._getLayerCanvas(data.layerIndex);
            const layerCtx = layerCanvas.getContext('2d');
            layerCtx.clearRect(0, 0, layerCanvas.width, layerCanvas.height);
            this._redrawCanvas();
          }
          break;
          
        case 'clearAll':
          // Clear all layers
          this._clearAllLayers();
          this._redrawCanvas();
          break;
          
        case 'undo':
          // Perform undo
          this.undo();
          break;
          
        case 'redo':
          // Perform redo
          this.redo();
          break;
      }
    }
    
    _handleRemoteDrawings(data) {
      if (!data || !data.drawings) return;
      
      // Process all received drawings
      for (const drawing of data.drawings) {
        this._handleRemoteDrawing(drawing);
      }
    }
    
    _startRemoteDrawing(data) {
      // Ensure we have a valid layer index
      const layerIndex = data.layerIndex || 0;
      
      // Create layer if it doesn't exist
      while (this.layers.length <= layerIndex) {
        this._addLayer(`Remote Layer ${this.layers.length + 1}`);
      }
      
      // Get layer canvas
      const layerCanvas = this._getLayerCanvas(layerIndex);
      const layerCtx = layerCanvas.getContext('2d');
      
      // Set brush properties
      layerCtx.strokeStyle = data.color || '#000000';
      layerCtx.lineWidth = data.size || 5;
      layerCtx.lineCap = 'round';
      layerCtx.lineJoin = 'round';
      layerCtx.globalAlpha = data.opacity || 1.0;
      layerCtx.globalCompositeOperation = data.blendMode || 'source-over';
      
      // Apply special brush settings if needed
      switch (data.brush) {
        case 'pencil':
          layerCtx.globalAlpha = (data.opacity || 1.0) * 0.8;
          layerCtx.lineWidth = (data.size || 5) * 0.5;
          break;
          
        case 'brush':
          layerCtx.globalAlpha = (data.opacity || 1.0) * 0.9;
          layerCtx.lineWidth = (data.size || 5) * 2;
          break;
          
        case 'marker':
          layerCtx.globalAlpha = 0.6;
          layerCtx.globalCompositeOperation = 'multiply';
          layerCtx.lineWidth = (data.size || 5) * 3;
          layerCtx.lineCap = 'square';
          layerCtx.lineJoin = 'miter';
          break;
          
        case 'eraser':
          layerCtx.globalAlpha = 1.0;
          layerCtx.globalCompositeOperation = 'destination-out';
          layerCtx.lineWidth = (data.size || 5) * 2;
          break;
          
        case 'airbrush':
          layerCtx.globalAlpha = 0.2;
          layerCtx.lineWidth = (data.size || 5) * 0.5;
          break;
      }
      
      // Start path
      layerCtx.beginPath();
      layerCtx.moveTo(data.x, data.y);
      
      // Special handling for airbrush
      if (data.brush === 'airbrush') {
        this._drawAirbrush(layerCtx, data.x, data.y);
      }
      
      // Store last position
      this._remoteLastX = data.x;
      this._remoteLastY = data.y;
      
      // Store remote drawing state
      this._remoteDrawing = {
        layerIndex,
        color: data.color || '#000000',
        size: data.size || 5,
        brush: data.brush || 'pen',
        opacity: data.opacity || 1.0,
        blendMode: data.blendMode || 'source-over',
        points: [{ x: data.x, y: data.y }]
      };
      
      // Redraw canvas
      this._redrawCanvas();
    }
    
    _moveRemoteDrawing(data) {
      if (!this._remoteDrawing) return;
      
      // Get layer canvas
      const layerIndex = this._remoteDrawing.layerIndex;
      const layerCanvas = this._getLayerCanvas(layerIndex);
      const layerCtx = layerCanvas.getContext('2d');
      
      // Add point to remote drawing
      this._remoteDrawing.points.push({ x: data.x, y: data.y });
      
      // Draw line
      layerCtx.beginPath();
      layerCtx.moveTo(this._remoteLastX, this._remoteLastY);
      
      // Special handling for different brushes
      switch (this._remoteDrawing.brush) {
        case 'airbrush':
          this._drawAirbrush(layerCtx, data.x, data.y);
          break;
          
        default:
          layerCtx.lineTo(data.x, data.y);
          layerCtx.stroke();
      }
      
      // Update last position
      this._remoteLastX = data.x;
      this._remoteLastY = data.y;
      
      // Redraw main canvas
      this._redrawCanvas();
    }
    
    _endRemoteDrawing(data) {
      if (!this._remoteDrawing) return;
      
      // Add to history
      this._addToHistory({
        type: 'path',
        layerIndex: this._remoteDrawing.layerIndex,
        color: this._remoteDrawing.color,
        size: this._remoteDrawing.size,
        brush: this._remoteDrawing.brush,
        opacity: this._remoteDrawing.opacity,
        blendMode: this._remoteDrawing.blendMode,
        points: [...this._remoteDrawing.points] // Clone the points array
      });
      
      // Reset remote drawing
      this._remoteDrawing = null;
    }
    
    _getStabilizedPoint() {
      // If stabilizer is disabled, return the latest point
      if (this.stabilizer <= 0 || this.points.length === 0) {
        return this.points[this.points.length - 1] || { x: 0, y: 0 };
      }
      
      // Calculate the number of points to use for stabilization
      const numPoints = Math.min(this.stabilizer, this.points.length);
      
      // Get the latest points
      const recentPoints = this.points.slice(-numPoints);
      
      // Calculate the weighted average
      let totalWeight = 0;
      let sumX = 0;
      let sumY = 0;
      
      for (let i = 0; i < recentPoints.length; i++) {
        // Weight is higher for more recent points
        const weight = (i + 1) / recentPoints.length;
        totalWeight += weight;
        sumX += recentPoints[i].x * weight;
        sumY += recentPoints[i].y * weight;
      }
      
      // Calculate weighted average
      return {
        x: sumX / totalWeight,
        y: sumY / totalWeight
      };
    }
    
    _drawAirbrush(ctx, x, y) {
      // Draw center point
      ctx.lineTo(x, y);
      ctx.stroke();
      
      // Draw spray particles
      const size = this.currentSize;
      for (let i = 0; i < size; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * size * 3;
        const sprayX = x + Math.cos(angle) * radius;
        const sprayY = y + Math.sin(angle) * radius;
        
        ctx.beginPath();
        ctx.arc(sprayX, sprayY, Math.random() * 1.5, 0, Math.PI * 2);
        ctx.fillStyle = this.currentColor;
        ctx.globalAlpha = Math.random() * 0.1;
        ctx.fill();
      }
      
      // Reset alpha
      ctx.globalAlpha = 0.2;
    }
    
    _sendDrawing(data) {
      if (this.socket) {
        this.socket.emit('drawing', data);
      }
    }
    
    _sendDrawingSettings(data) {
      if (this.socket) {
        this.socket.emit('drawingSettings', data);
      }
    }
    
    _sendLayerAction(data) {
      if (this.socket) {
        this.socket.emit('layerAction', data);
      }
    }
    
    // Logging utilities
    _log(...args) {
      if (this.debug) {
        console.log('[AdvancedDrawingModule]', ...args);
      }
    }
    
    _error(...args) {
      console.error('[AdvancedDrawingModule]', ...args);
    }
  }
  
  // Export for use in browser or Node.js
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = AdvancedDrawingModule;
  } else {
    window.AdvancedDrawingModule = AdvancedDrawingModule;
  }