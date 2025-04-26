// components/DrawingCanvas.jsx
import React, { useRef, useState, useEffect } from 'react';
import { useDataChannel } from '@livekit/components-react';

const DrawingCanvas = ({ roomName }) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(5);
  const [prevPos, setPrevPos] = useState({ x: 0, y: 0 });
  
  const { send, messages } = useDataChannel("drawing");
  
  // Initialize the canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    
    // Set canvas to fill its container
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
    
    // Set default canvas style
    context.lineCap = 'round';
    context.lineJoin = 'round';
    
    // Handle window resize
    const handleResize = () => {
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      canvas.width = canvas.parentElement.clientWidth;
      canvas.height = canvas.parentElement.clientHeight;
      context.putImageData(imageData, 0, 0);
      context.lineCap = 'round';
      context.lineJoin = 'round';
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  // Handle received drawing data from other participants
  useEffect(() => {
    if (!messages || messages.length === 0) return;
    
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    
    // Process the latest message
    try {
      const latestMessage = messages[messages.length - 1];
      const drawData = JSON.parse(new TextDecoder().decode(latestMessage.data));
      
      if (drawData.type === 'draw') {
        context.strokeStyle = drawData.color;
        context.lineWidth = drawData.size;
        context.beginPath();
        context.moveTo(drawData.prevX, drawData.prevY);
        context.lineTo(drawData.currX, drawData.currY);
        context.stroke();
      } else if (drawData.type === 'clear') {
        context.clearRect(0, 0, canvas.width, canvas.height);
      }
    } catch (e) {
      console.error('Error processing drawing message:', e);
    }
  }, [messages]);
  
  // Drawing functions
  const startDrawing = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setIsDrawing(true);
    setPrevPos({ x, y });
  };
  
  const draw = (e) => {
    if (!isDrawing) return;
    
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const currX = e.clientX - rect.left;
    const currY = e.clientY - rect.top;
    
    // Draw on local canvas
    context.strokeStyle = color;
    context.lineWidth = brushSize;
    context.beginPath();
    context.moveTo(prevPos.x, prevPos.y);
    context.lineTo(currX, currY);
    context.stroke();
    
    // Send drawing data to other participants
    const drawData = {
      type: 'draw',
      prevX: prevPos.x,
      prevY: prevPos.y,
      currX,
      currY,
      color,
      size: brushSize,
    };
    
    send(new TextEncoder().encode(JSON.stringify(drawData)));
    
    setPrevPos({ x: currX, y: currY });
  };
  
  const stopDrawing = () => {
    setIsDrawing(false);
  };
  
  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    
    // Notify other participants
    const clearData = { type: 'clear' };
    send(new TextEncoder().encode(JSON.stringify(clearData)));
  };
  
  return (
    <div className="drawing-board">
      <div className="controls">
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
        <input
          type="range"
          min="1"
          max="20"
          value={brushSize}
          onChange={(e) => setBrushSize(parseInt(e.target.value))}
        />
        <button onClick={clearCanvas}>Clear</button>
      </div>
      <canvas
        ref={canvasRef}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseOut={stopDrawing}
        onTouchStart={(e) => {
          e.preventDefault();
          const touch = e.touches[0];
          startDrawing({ clientX: touch.clientX, clientY: touch.clientY });
        }}
        onTouchMove={(e) => {
          e.preventDefault();
          const touch = e.touches[0];
          draw({ clientX: touch.clientX, clientY: touch.clientY });
        }}
        onTouchEnd={stopDrawing}
        className="drawing-canvas"
      />
    </div>
  );
};

export default DrawingCanvas;