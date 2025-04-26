import {
  ControlBar,
  GridLayout,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
  RoomContext,
} from '@livekit/components-react';
import { Room, Track } from 'livekit-client';
import '@livekit/components-styles';
import { useEffect, useState } from 'react';

// Update these with your values
const serverUrl = import.meta.env.VITE_LK_SERVER_URL;
const tokenServerUrl = import.meta.env.VITE_TOKEN_SERVER_URL || 'http://localhost:3000';

export default function App() {
  const [room] = useState(() => new Room({
    adaptiveStream: true,
    dynacast: true,
  }));
  const [identity, setIdentity] = useState('');
  const [roomName, setRoomName] = useState('default-room');
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Get a token from our backend
  const getToken = async (username, room) => {
    try {
      setIsLoading(true);
      
      const response = await fetch(`${tokenServerUrl}/api/get-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          identity: username,
          roomName: room
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to get token');
      }
      
      const data = await response.json();
      return data.token;
    } catch (error) {
      console.error('Error getting token:', error);
      alert('Failed to get access token: ' + (error.message || ''));
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnect = async (e) => {
    e.preventDefault();
    
    if (!identity.trim()) {
      alert('Please enter your name');
      return;
    }
    
    if (!roomName.trim()) {
      alert('Please enter a room name');
      return;
    }
    
    try {
      // Get a unique token for this identity and room
      const token = await getToken(identity, roomName);
      
      if (!token) {
        return; // Error already shown in getToken
      }
      
      // Connect to LiveKit room
      await room.connect(serverUrl, token);
      setIsConnected(true);
    } catch (error) {
      console.error('Error connecting to room:', error);
      alert('Failed to connect: ' + error.message);
    }
  };

  const handleDisconnect = () => {
    room.disconnect();
    setIsConnected(false);
  };

  useEffect(() => {
    return () => {
      room.disconnect();
    };
  }, [room]);

  if (!isConnected) {
    return (
      <div style={{ 
        height: '100vh', 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center',
        flexDirection: 'column'
      }}>
        <h1>Join Meeting</h1>
        <form onSubmit={handleConnect} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <input
            type="text"
            placeholder="Enter your name"
            value={identity}
            onChange={(e) => setIdentity(e.target.value)}
            style={{ padding: '10px', width: '300px' }}
          />
          <input
            type="text"
            placeholder="Enter room name"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            style={{ padding: '10px', width: '300px' }}
          />
          <button 
            type="submit" 
            disabled={isLoading}
            style={{ 
              padding: '10px', 
              backgroundColor: '#4CAF50', 
              color: 'white', 
              border: 'none',
              cursor: isLoading ? 'not-allowed' : 'pointer'
            }}
          >
            {isLoading ? 'Connecting...' : 'Join Room'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <RoomContext.Provider value={room}>
      <div data-lk-theme="default" style={{ height: '100vh' }}>
        <div style={{ padding: '10px', background: '#f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p style={{ margin: '0' }}>Connected as: <strong>{identity}</strong> in room: <strong>{roomName}</strong></p>
          <button 
            onClick={handleDisconnect}
            style={{ 
              padding: '5px 10px', 
              backgroundColor: '#f44336', 
              color: 'white', 
              border: 'none',
              cursor: 'pointer'
            }}
          >
            Leave Room
          </button>
        </div>
        <MyVideoConference />
        <RoomAudioRenderer />
        <ControlBar />
      </div>
    </RoomContext.Provider>
  );
}

function MyVideoConference() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  return (
    <GridLayout tracks={tracks} style={{ height: 'calc(100vh - var(--lk-control-bar-height) - 50px)' }}>
      <ParticipantTile />
    </GridLayout>
  );
}