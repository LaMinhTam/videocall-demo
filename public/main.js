// public/main.js

// DOM elements
const joinForm = document.getElementById('join-form');
const roomInput = document.getElementById('room-input');
const joinButton = document.getElementById('join-button');
const roomIdElement = document.getElementById('room-id');
const videosContainer = document.getElementById('videos');
const drawingCanvas = document.getElementById('drawing-canvas');
const colorPicker = document.getElementById('color-picker');
const widthSlider = document.getElementById('width-slider');
const clearButton = document.getElementById('clear-button');

// Global variables
let mediasoupClient = null;

// Initialize the application
function init() {
  // Set up canvas size
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  
  // Event listeners
  joinButton.addEventListener('click', joinRoom);
  roomInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      joinRoom();
    }
  });
  
  colorPicker.addEventListener('change', () => {
    if (mediasoupClient) {
      mediasoupClient.setDrawColor(colorPicker.value);
    }
  });
  
  widthSlider.addEventListener('input', () => {
    if (mediasoupClient) {
      mediasoupClient.setDrawWidth(widthSlider.value);
    }
  });
  
  clearButton.addEventListener('click', () => {
    if (mediasoupClient) {
      mediasoupClient.clearCanvas();
    }
  });
  
  // Check if there's a room in the URL
  const urlParams = new URLSearchParams(window.location.search);
  const roomFromUrl = urlParams.get('room');
  
  if (roomFromUrl) {
    roomInput.value = roomFromUrl;
    joinRoom();
  }
}

// Resize canvas to fit container
function resizeCanvas() {
  const container = drawingCanvas.parentElement;
  drawingCanvas.width = container.clientWidth;
  drawingCanvas.height = container.clientHeight;
  
  // Reset drawing context in case we already have a mediasoupClient
  if (mediasoupClient) {
    mediasoupClient.setDrawColor(colorPicker.value);
    mediasoupClient.setDrawWidth(widthSlider.value);
  }
}

// Join a room
async function joinRoom() {
  const roomId = roomInput.value.trim();
  
  if (!roomId) {
    alert('Please enter a room name');
    return;
  }
  
  // Update URL with room parameter
  const newUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
  window.history.pushState({ path: newUrl }, '', newUrl);
  
  // Show room ID in the header
  roomIdElement.textContent = roomId;
  
  // Hide join form
  joinForm.style.display = 'none';
  
  // Initialize MediaSoup client
  mediasoupClient = new MediasoupClient({
    roomId,
    debug: true,
    canvas: drawingCanvas,
    drawColor: colorPicker.value,
    drawWidth: parseInt(widthSlider.value),
    videosContainer,
    onConnect: () => {
      console.log('Connected to room:', roomId);
    },
    onDisconnect: () => {
      console.log('Disconnected from room');
      // Show join form again
      joinForm.style.display = 'flex';
    },
    onPeerJoined: (peerId) => {
      console.log('Peer joined:', peerId);
    },
    onPeerLeft: (peerId) => {
      console.log('Peer left:', peerId);
    }
  });
  
  try {
    await mediasoupClient.init();
  } catch (error) {
    console.error('Error initializing MediaSoup client:', error);
    alert(`Error joining room: ${error.message}`);
    joinForm.style.display = 'flex';
  }
}

// Start the application when the page loads
window.addEventListener('load', init);