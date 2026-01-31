'use client';

import React from 'react';
import { randomString } from '../../../lib/client-utils';
import { ConnectionDetails } from '../../../lib/types';
import {
  MediaDeviceMenu,
  ParticipantTile,
  RoomAudioRenderer,
  RoomContext,
  TrackToggle,
  useRoomContext,
  useTracks,
} from '@livekit/components-react';
import {
  RemoteAudioTrack,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  RoomConnectOptions,
  RoomEvent,
  ParticipantEvent,
  Track,
  VideoCodec,
  VideoPresets,
  VideoQuality,
} from 'livekit-client';
import { useRouter } from 'next/navigation';
import { useLowCPUOptimizer } from '../../../lib/usePerfomanceOptimiser';

const CONN_DETAILS_ENDPOINT =
  process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT ?? '/api/connection-details';

const isRemoteAudioTrack = (track: unknown): track is RemoteAudioTrack =>
  !!track && typeof track === 'object' && 'setVolume' in track;

const isRemoteTrackPublication = (
  publication: unknown,
): publication is RemoteTrackPublication =>
  !!publication && typeof publication === 'object' && 'setVideoQuality' in publication;

export function PageClientImpl(props: {
  roomName: string;
  region?: string;
  hq: boolean;
  codec: VideoCodec;
}) {
  const [connectionDetails, setConnectionDetails] = React.useState<ConnectionDetails | undefined>(
    undefined,
  );
  const [errorMessage, setErrorMessage] = React.useState<string | undefined>(undefined);
  const participantName = React.useMemo(() => `guest-${randomString(4)}`, []);

  React.useEffect(() => {
    let aborted = false;
    const fetchDetails = async () => {
      const url = new URL(CONN_DETAILS_ENDPOINT, window.location.origin);
      url.searchParams.append('roomName', props.roomName);
      url.searchParams.append('participantName', participantName);
      if (props.region) {
        url.searchParams.append('region', props.region);
      }
      try {
        const connectionDetailsResp = await fetch(url.toString());
        const connectionDetailsData = await connectionDetailsResp.json();
        if (!aborted) {
          setConnectionDetails(connectionDetailsData);
        }
      } catch (error) {
        if (!aborted) {
          setErrorMessage(error instanceof Error ? error.message : 'Failed to join room');
        }
      }
    };
    fetchDetails();
    return () => {
      aborted = true;
    };
  }, [participantName, props.roomName, props.region]);

  if (errorMessage) {
    return (
      <main className="simple-page">
        <div className="simple-card">
          <h1>Failed to join</h1>
          <p className="simple-help">{errorMessage}</p>
        </div>
      </main>
    );
  }

  if (!connectionDetails) {
    return (
      <main className="simple-page">
        <div className="simple-card">
          <h1>Connecting…</h1>
          <p className="simple-help">Joining room {props.roomName}</p>
        </div>
      </main>
    );
  }

  return (
    <RoomView
      connectionDetails={connectionDetails}
      options={{ codec: props.codec, hq: props.hq }}
    />
  );
}

function RoomView(props: {
  connectionDetails: ConnectionDetails;
  options: {
    hq: boolean;
    codec: VideoCodec;
  };
}) {
  const router = useRouter();
  const isMobile = React.useMemo(
    () =>
      typeof navigator !== 'undefined' &&
      /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent),
    [],
  );
  const [playbackVolume, setPlaybackVolume] = React.useState(1);
  const [remoteVideoQuality, setRemoteVideoQuality] = React.useState<VideoQuality>(
    VideoQuality.HIGH,
  );

  const roomOptions = React.useMemo(() => {
    const maxCameraBitrate = isMobile ? 900_000 : 1_500_000;
    const maxScreenShareBitrate = isMobile ? 1_200_000 : 2_500_000;
    return {
      videoCaptureDefaults: {
        resolution: isMobile
          ? VideoPresets.h720
          : props.options.hq
            ? VideoPresets.h2160
            : VideoPresets.h720,
      },
      publishDefaults: {
        dtx: false,
        videoSimulcastLayers: isMobile
          ? [VideoPresets.h540]
          : props.options.hq
            ? [VideoPresets.h1080, VideoPresets.h720]
            : [VideoPresets.h540, VideoPresets.h216],
        videoCodec: props.options.codec ?? 'vp9',
        videoEncoding: { maxBitrate: maxCameraBitrate },
        screenShareEncoding: { maxBitrate: maxScreenShareBitrate },
      } as any,
      adaptiveStream: true,
      dynacast: true,
      singlePeerConnection: true,
    };
  }, [props.options.codec, props.options.hq, isMobile]);

  const room = React.useMemo(() => new Room(roomOptions), [roomOptions]);

  const connectOptions = React.useMemo((): RoomConnectOptions => {
    return {
      autoSubscribe: true,
    };
  }, []);

  const handleDisconnected = React.useCallback(() => {
    router.push('/');
  }, [router]);

  React.useEffect(() => {
    room.on(RoomEvent.Disconnected, handleDisconnected);
    return () => {
      room.off(RoomEvent.Disconnected, handleDisconnected);
    };
  }, [room, handleDisconnected]);

  React.useEffect(() => {
    room
      .connect(
        props.connectionDetails.serverUrl,
        props.connectionDetails.participantToken,
        connectOptions,
      )
      .catch((error) => {
        console.error(error);
      });
    room.localParticipant.enableCameraAndMicrophone().catch((error) => {
      console.error(error);
    });
    return () => {
      room.disconnect();
    };
  }, [room, props.connectionDetails, connectOptions]);

  useLowCPUOptimizer(room);

  return (
    <RoomContext.Provider value={room}>
      <RoomShell
        playbackVolume={playbackVolume}
        setPlaybackVolume={setPlaybackVolume}
        remoteVideoQuality={remoteVideoQuality}
        setRemoteVideoQuality={setRemoteVideoQuality}
        defaultScreenShareQuality={isMobile ? 'medium' : 'high'}
        onLeave={() => room.disconnect()}
      />
    </RoomContext.Provider>
  );
}

function RoomShell(props: {
  playbackVolume: number;
  setPlaybackVolume: (value: number) => void;
  remoteVideoQuality: VideoQuality;
  setRemoteVideoQuality: (value: VideoQuality) => void;
  defaultScreenShareQuality: 'low' | 'medium' | 'high';
  onLeave: () => void;
}) {
  const room = useRoomContext();
  const [screenShareEnabled, setScreenShareEnabled] = React.useState(false);
  const [screenShareQuality, setScreenShareQuality] = React.useState<'low' | 'medium' | 'high'>(
    props.defaultScreenShareQuality,
  );
  const [participantVolumes, setParticipantVolumes] = React.useState<Record<string, number>>({});
  const [participantsVersion, bumpParticipants] = React.useReducer((value) => value + 1, 0);
  const participants = React.useMemo(
    () => Array.from(room.remoteParticipants.values()),
    [room, participantsVersion],
  );
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  const [focusedTrackId, setFocusedTrackId] = React.useState<string | null>(null);
  const resolvedTracks = React.useMemo(() => {
    if (!focusedTrackId) {
      return tracks;
    }
    return tracks.filter((trackRef) => {
      const id = trackRef.publication?.trackSid;
      return id === focusedTrackId;
    });
  }, [tracks, focusedTrackId]);
  const toggleFocus = React.useCallback((trackId?: string) => {
    if (!trackId) {
      return;
    }
    setFocusedTrackId((current) => (current === trackId ? null : trackId));
  }, []);

  const getEffectiveVolume = React.useCallback(
    (participantSid?: string) => {
      const participantVolume = participantSid ? participantVolumes[participantSid] ?? 1 : 1;
      return Math.min(1, Math.max(0, props.playbackVolume * participantVolume));
    },
    [participantVolumes, props.playbackVolume],
  );

  const screenSharePreset = React.useMemo(() => {
    switch (screenShareQuality) {
      case 'low':
        return { width: 960, height: 540, frameRate: 30 };
      case 'medium':
        return { width: 1280, height: 720, frameRate: 30 };
      case 'high':
      default:
        return { width: 1920, height: 1080, frameRate: 30 };
    }
  }, [screenShareQuality]);

  const setParticipantVolume = React.useCallback((sid: string, volume: number) => {
    setParticipantVolumes((current) => ({ ...current, [sid]: volume }));
  }, []);

  const applyScreenShare = React.useCallback(
    async (enable: boolean) => {
      if (!enable) {
        await room.localParticipant.setScreenShareEnabled(false);
        setScreenShareEnabled(false);
        return;
      }
      const baseVideo = {
        resolution: { width: screenSharePreset.width, height: screenSharePreset.height },
        frameRate: screenSharePreset.frameRate,
      };
      try {
        await room.localParticipant.setScreenShareEnabled(true, {
          audio: true,
          video: baseVideo,
        } as any);
        setScreenShareEnabled(true);
      } catch (error: any) {
        if (error?.name === 'NotAllowedError') {
          try {
            await room.localParticipant.setScreenShareEnabled(true, {
              audio: false,
              video: baseVideo,
            } as any);
            setScreenShareEnabled(true);
          } catch (retryError) {
            console.error(retryError);
            alert('Screen share failed: permission denied.');
          }
        } else {
          console.error(error);
          alert('Screen share failed.');
        }
      }
    },
    [room, screenSharePreset],
  );

  React.useEffect(() => {
    tracks.forEach((trackRef) => {
      const track = trackRef.publication?.track;
      if (track?.kind === Track.Kind.Audio && isRemoteAudioTrack(track)) {
        const participantSid = trackRef.participant?.sid;
        track.setVolume(getEffectiveVolume(participantSid));
      }
      if (
        trackRef.publication?.kind === Track.Kind.Video &&
        isRemoteTrackPublication(trackRef.publication)
      ) {
        trackRef.publication.setVideoQuality(props.remoteVideoQuality);
      }
    });
  }, [tracks, props.remoteVideoQuality, getEffectiveVolume]);

  React.useEffect(() => {
    room.remoteParticipants.forEach((participant) => {
      participant.audioTrackPublications.forEach((publication) => {
        const track = publication.track;
        if (track?.kind === Track.Kind.Audio && isRemoteAudioTrack(track)) {
          track.setVolume(getEffectiveVolume(participant.sid));
        }
      });
      participant.videoTrackPublications.forEach((publication) => {
        publication.setVideoQuality(props.remoteVideoQuality);
      });
    });
  }, [room, props.remoteVideoQuality, getEffectiveVolume]);

  React.useEffect(() => {
    const handleTrackSubscribed = (
      track: RemoteTrack,
      publication: RemoteTrackPublication,
      participant?: { sid: string },
    ) => {
      if (publication.kind === Track.Kind.Audio && isRemoteAudioTrack(track)) {
        track.setVolume(getEffectiveVolume(participant?.sid));
      }
      if (publication.kind === Track.Kind.Video) {
        publication.setVideoQuality(props.remoteVideoQuality);
      }
    };

    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
    return () => {
      room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed);
    };
  }, [room, props.remoteVideoQuality, getEffectiveVolume]);

  React.useEffect(() => {
    const handleParticipantChange = () => bumpParticipants();
    room.on(RoomEvent.ParticipantConnected, handleParticipantChange);
    room.on(RoomEvent.ParticipantDisconnected, handleParticipantChange);
    return () => {
      room.off(RoomEvent.ParticipantConnected, handleParticipantChange);
      room.off(RoomEvent.ParticipantDisconnected, handleParticipantChange);
    };
  }, [room]);

  React.useEffect(() => {
    const handleTrackPublished = (publication: { source?: Track.Source }) => {
      if (publication.source === Track.Source.ScreenShare) {
        setScreenShareEnabled(true);
      }
    };
    const handleTrackUnpublished = (publication: { source?: Track.Source }) => {
      if (publication.source === Track.Source.ScreenShare) {
        setScreenShareEnabled(false);
      }
    };
    const existingShare = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
    setScreenShareEnabled(!!existingShare);
    room.localParticipant.on(ParticipantEvent.LocalTrackPublished, handleTrackPublished);
    room.localParticipant.on(ParticipantEvent.LocalTrackUnpublished, handleTrackUnpublished);
    return () => {
      room.localParticipant.off(ParticipantEvent.LocalTrackPublished, handleTrackPublished);
      room.localParticipant.off(ParticipantEvent.LocalTrackUnpublished, handleTrackUnpublished);
    };
  }, [room]);

  // Quality changes apply next time screen share starts to avoid permission errors.

  return (
    <div className="room-shell">
      <RoomAudioRenderer />
      <div className={focusedTrackId ? 'room-grid room-grid-focused' : 'room-grid'}>
        <div className="tile-grid">
          {resolvedTracks.map((trackRef) => {
            const id = trackRef.publication?.trackSid;
            return (
              <div
                className="tile-wrapper"
                onClick={() => toggleFocus(id)}
                role="button"
                tabIndex={0}
                key={id ?? trackRef.participant?.sid ?? trackRef.source}
              >
                <ParticipantTile trackRef={trackRef} />
              </div>
            );
          })}
        </div>
        {focusedTrackId && (
          <button className="lk-button focus-exit" onClick={() => setFocusedTrackId(null)}>
            Exit Focus
          </button>
        )}
      </div>
      <div className="room-controls">
        <div className="control-group">
          <TrackToggle source={Track.Source.Microphone}>Mic</TrackToggle>
          <MediaDeviceMenu kind="audioinput" />
        </div>
        <div className="control-group">
          <TrackToggle source={Track.Source.Camera}>Camera</TrackToggle>
          <MediaDeviceMenu kind="videoinput" />
        </div>
        <div className="control-group">
          <button
            className="lk-button"
            onClick={() => applyScreenShare(!screenShareEnabled).catch(console.error)}
            aria-pressed={screenShareEnabled}
          >
            {screenShareEnabled ? 'Stop Share' : 'Share Screen'}
          </button>
        </div>
        <div className="control-group">
          <label htmlFor="screen-share-quality">Share Quality</label>
          <select
            id="screen-share-quality"
            value={screenShareQuality}
            onChange={(event) =>
              setScreenShareQuality(event.target.value as 'low' | 'medium' | 'high')
            }
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <div className="control-group">
          <label htmlFor="playback-volume">
            Volume {Math.round(props.playbackVolume * 100)}%
          </label>
          <input
            id="playback-volume"
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(props.playbackVolume * 100)}
            onChange={(event) =>
              props.setPlaybackVolume(
                Math.min(1, Math.max(0, Number(event.target.value) / 100)),
              )
            }
          />
        </div>
        <div className="control-group">
          <label htmlFor="remote-video-quality">Quality</label>
          <select
            id="remote-video-quality"
            value={props.remoteVideoQuality}
            onChange={(event) =>
              props.setRemoteVideoQuality(Number(event.target.value) as VideoQuality)
            }
          >
            <option value={VideoQuality.LOW}>Low</option>
            <option value={VideoQuality.MEDIUM}>Medium</option>
            <option value={VideoQuality.HIGH}>High</option>
          </select>
        </div>
        <div className="control-group">
          <button className="lk-button" onClick={props.onLeave}>
            Leave
          </button>
        </div>
      </div>
      <div className="participant-volumes">
        <div className="participant-volumes-title">Participant Volumes</div>
        {participants.length === 0 ? (
          <div className="participant-volumes-empty">No remote participants yet.</div>
        ) : (
          participants.map((participant) => {
            const volume = participantVolumes[participant.sid] ?? 1;
            return (
              <div className="participant-volume-row" key={participant.sid}>
                <span className="participant-name">
                  {participant.name || participant.identity || 'Guest'}
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round(volume * 100)}
                  onChange={(event) =>
                    setParticipantVolume(
                      participant.sid,
                      Math.min(1, Math.max(0, Number(event.target.value) / 100)),
                    )
                  }
                />
                <span className="participant-volume-value">{Math.round(volume * 100)}%</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
