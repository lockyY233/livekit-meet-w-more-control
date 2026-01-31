'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { generateRoomId } from '../lib/client-utils';

export default function Page() {
  const router = useRouter();
  const [roomName, setRoomName] = React.useState(() => generateRoomId());

  const joinRoom = React.useCallback(() => {
    if (!roomName.trim()) {
      return;
    }
    router.push(`/rooms/${roomName.trim()}`);
  }, [roomName, router]);

  return (
    <main className="simple-page">
      <div className="simple-card">
        <h1>Join a room</h1>
        <div className="simple-row">
          <input
            type="text"
            value={roomName}
            onChange={(event) => setRoomName(event.target.value)}
            placeholder="room-name"
          />
          <button className="lk-button" onClick={joinRoom}>
            Join
          </button>
        </div>
        <p className="simple-help">Share the room name with others to join.</p>
      </div>
    </main>
  );
}
