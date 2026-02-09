'use client';

import React from 'react';
import { randomString } from '../../../lib/client-utils';
import { ConnectionDetails } from '../../../lib/types';
import {
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
  participantName?: string;
}) {
  const [connectionDetails, setConnectionDetails] = React.useState<ConnectionDetails | undefined>(
    undefined,
  );
  const [errorMessage, setErrorMessage] = React.useState<string | undefined>(undefined);
  const [participantName, setParticipantName] = React.useState(() => props.participantName?.trim() ?? '');

  React.useEffect(() => {
    if (participantName) {
      return;
    }
    const prompted = window.prompt('Enter your nickname');
    const trimmed = prompted?.trim();
    setParticipantName(trimmed ? trimmed : `guest-${randomString(4)}`);
  }, [participantName]);

  React.useEffect(() => {
    if (!participantName) {
      return;
    }
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
        const responseType = connectionDetailsResp.headers.get('content-type') ?? '';
        if (!connectionDetailsResp.ok) {
          const errorText = await connectionDetailsResp.text();
          throw new Error(errorText || `Failed to fetch connection details (${connectionDetailsResp.status})`);
        }
        if (!responseType.includes('application/json')) {
          const bodyText = await connectionDetailsResp.text();
          throw new Error(bodyText || 'Connection details response was not JSON');
        }
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
  const [audioInputs, setAudioInputs] = React.useState<MediaDeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = React.useState<MediaDeviceInfo[]>([]);
  const [selectedAudioInput, setSelectedAudioInput] = React.useState<string>('');
  const [selectedVideoInput, setSelectedVideoInput] = React.useState<string>('');
  const [showVolumeSlider, setShowVolumeSlider] = React.useState(false);
  const volumeControlRef = React.useRef<HTMLDivElement | null>(null);
  const [tileVolumeMenu, setTileVolumeMenu] = React.useState<{
    x: number;
    y: number;
    participantSid?: string;
    participantName: string;
  } | null>(null);
  const tileVolumeMenuRef = React.useRef<HTMLDivElement | null>(null);
  const longPressTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressTileClickRef = React.useRef(false);
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  const [focusedTrackId, setFocusedTrackId] = React.useState<string | null>(null);
  const [mobileFullscreenFallback, setMobileFullscreenFallback] = React.useState(false);
  const getTrackId = React.useCallback((trackRef: (typeof tracks)[number]) => {
    return (
      trackRef.publication?.trackSid ??
      `${trackRef.participant?.sid ?? 'local'}-${String(trackRef.source)}`
    );
  }, []);
  const resolvedTracks = React.useMemo(() => {
    if (!focusedTrackId) {
      return tracks;
    }
    return tracks.filter((trackRef) => {
      const id = getTrackId(trackRef);
      return id === focusedTrackId;
    });
  }, [tracks, focusedTrackId, getTrackId]);
  const toggleFocus = React.useCallback((trackId?: string) => {
    if (!trackId) {
      return;
    }
    setFocusedTrackId((current) => (current === trackId ? null : trackId));
  }, []);
  const handleTileClick = React.useCallback((trackId: string) => {
    if (suppressTileClickRef.current) {
      suppressTileClickRef.current = false;
      return;
    }
    toggleFocus(trackId);
  }, [toggleFocus]);
  const focusedTrackIndex = React.useMemo(() => {
    if (!focusedTrackId) {
      return -1;
    }
    return tracks.findIndex((trackRef) => getTrackId(trackRef) === focusedTrackId);
  }, [tracks, focusedTrackId, getTrackId]);
  const focusPreviousTrack = React.useCallback(() => {
    if (tracks.length <= 1 || focusedTrackIndex < 0) {
      return;
    }
    const nextIndex = (focusedTrackIndex - 1 + tracks.length) % tracks.length;
    setFocusedTrackId(getTrackId(tracks[nextIndex]));
  }, [tracks, focusedTrackIndex, getTrackId]);
  const focusNextTrack = React.useCallback(() => {
    if (tracks.length <= 1 || focusedTrackIndex < 0) {
      return;
    }
    const nextIndex = (focusedTrackIndex + 1) % tracks.length;
    setFocusedTrackId(getTrackId(tracks[nextIndex]));
  }, [tracks, focusedTrackIndex, getTrackId]);
  const toggleFullscreen = React.useCallback(
    async (container: HTMLElement | null, trackId: string) => {
      if (!container) {
        return;
      }
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      if (mobileFullscreenFallback) {
        setMobileFullscreenFallback(false);
        setFocusedTrackId(null);
        return;
      }
      if (typeof container.requestFullscreen === 'function') {
        try {
          await container.requestFullscreen();
          return;
        } catch {
          // Fall back for mobile browsers that reject fullscreen requests.
        }
      }
      const videoElement = container.querySelector('video') as
        | (HTMLVideoElement & {
            webkitEnterFullscreen?: () => void;
            webkitEnterFullScreen?: () => void;
          })
        | null;
      if (videoElement) {
        if (typeof videoElement.webkitEnterFullscreen === 'function') {
          videoElement.webkitEnterFullscreen();
          return;
        }
        if (typeof videoElement.webkitEnterFullScreen === 'function') {
          videoElement.webkitEnterFullScreen();
          return;
        }
      }
      setFocusedTrackId(trackId);
      setMobileFullscreenFallback(true);
    },
    [mobileFullscreenFallback],
  );

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

  const clearLongPressTimer = React.useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const openTileVolumeMenu = React.useCallback(
    (
      event: React.MouseEvent<HTMLDivElement>,
      participant?: {
        sid?: string;
        name?: string;
        identity?: string;
      },
    ) => {
      event.preventDefault();
      event.stopPropagation();
      setTileVolumeMenu({
        x: event.clientX,
        y: event.clientY,
        participantSid: participant?.sid,
        participantName: participant?.name || participant?.identity || 'Participant',
      });
    },
    [],
  );

  const refreshDevices = React.useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return;
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    setAudioInputs(devices.filter((device) => device.kind === 'audioinput'));
    setVideoInputs(devices.filter((device) => device.kind === 'videoinput'));
  }, []);

  React.useEffect(() => {
    refreshDevices().catch(console.error);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.addEventListener) {
      return;
    }
    const handleDeviceChange = () => {
      refreshDevices().catch(console.error);
    };
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [refreshDevices]);

  React.useEffect(() => {
    if (!selectedAudioInput && audioInputs.length > 0) {
      setSelectedAudioInput(audioInputs[0].deviceId);
    }
    if (selectedAudioInput && !audioInputs.some((device) => device.deviceId === selectedAudioInput)) {
      setSelectedAudioInput(audioInputs[0]?.deviceId ?? '');
    }
    if (!selectedVideoInput && videoInputs.length > 0) {
      setSelectedVideoInput(videoInputs[0].deviceId);
    }
    if (selectedVideoInput && !videoInputs.some((device) => device.deviceId === selectedVideoInput)) {
      setSelectedVideoInput(videoInputs[0]?.deviceId ?? '');
    }
  }, [audioInputs, videoInputs, selectedAudioInput, selectedVideoInput]);

  React.useEffect(() => {
    const micTrack = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track as any;
    const cameraTrack = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track as any;
    const micDeviceId = micTrack?.mediaStreamTrack?.getSettings?.()?.deviceId;
    const cameraDeviceId = cameraTrack?.mediaStreamTrack?.getSettings?.()?.deviceId;
    if (typeof micDeviceId === 'string' && micDeviceId) {
      setSelectedAudioInput(micDeviceId);
    }
    if (typeof cameraDeviceId === 'string' && cameraDeviceId) {
      setSelectedVideoInput(cameraDeviceId);
    }
  }, [room, tracks]);

  React.useEffect(() => {
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target || !volumeControlRef.current?.contains(target)) {
        setShowVolumeSlider(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, []);

  React.useEffect(() => {
    return () => {
      clearLongPressTimer();
    };
  }, [clearLongPressTimer]);

  React.useEffect(() => {
    const closeTileMenu = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || !tileVolumeMenuRef.current?.contains(target)) {
        setTileVolumeMenu(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTileVolumeMenu(null);
      }
    };
    document.addEventListener('mousedown', closeTileMenu);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeTileMenu);
      document.removeEventListener('keydown', closeOnEscape);
    };
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
      const screenShareAudio = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      };
      try {
        await room.localParticipant.setScreenShareEnabled(true, {
          audio: screenShareAudio as any,
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
      <div
        className={
          focusedTrackId
            ? `room-grid room-grid-focused${mobileFullscreenFallback ? ' room-grid-mobile-fullscreen' : ''}`
            : 'room-grid'
        }
      >
        <div className="tile-grid">
          {resolvedTracks.map((trackRef) => {
            const id = getTrackId(trackRef);
            const isScreenShareTrack =
              trackRef.source === Track.Source.ScreenShare ||
              trackRef.publication?.source === Track.Source.ScreenShare;
            return (
              <div
                className="tile-wrapper"
                onClick={() => handleTileClick(id)}
                onContextMenu={(event) => openTileVolumeMenu(event, trackRef.participant)}
                onTouchStart={(event) => {
                  if (event.touches.length !== 1) {
                    return;
                  }
                  clearLongPressTimer();
                  const touch = event.touches[0];
                  longPressTimerRef.current = setTimeout(() => {
                    suppressTileClickRef.current = true;
                    setTileVolumeMenu({
                      x: touch.clientX,
                      y: touch.clientY,
                      participantSid: trackRef.participant?.sid,
                      participantName:
                        trackRef.participant?.name ||
                        trackRef.participant?.identity ||
                        'Participant',
                    });
                  }, 500);
                }}
                onTouchEnd={clearLongPressTimer}
                onTouchCancel={clearLongPressTimer}
                onTouchMove={clearLongPressTimer}
                role="button"
                tabIndex={0}
                key={id ?? trackRef.participant?.sid ?? trackRef.source}
              >
                <ParticipantTile trackRef={trackRef} />
                {isScreenShareTrack && (
                  <button
                    className="fullscreen-toggle"
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      const wrapper = event.currentTarget.closest('.tile-wrapper') as HTMLElement | null;
                      toggleFullscreen(wrapper, id).catch(console.error);
                    }}
                    aria-label="Toggle fullscreen"
                    title="Toggle fullscreen"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <polyline points="15 3 21 3 21 9" />
                      <polyline points="9 21 3 21 3 15" />
                      <line x1="21" y1="3" x2="14" y2="10" />
                      <line x1="3" y1="21" x2="10" y2="14" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {focusedTrackId && (
          <>
            {tracks.length > 1 && (
              <>
                <button
                  className="lk-button focus-nav focus-prev"
                  type="button"
                  aria-label="Show previous tile"
                  onClick={focusPreviousTrack}
                >
                  <span aria-hidden="true">‹</span>
                </button>
                <button
                  className="lk-button focus-nav focus-next"
                  type="button"
                  aria-label="Show next tile"
                  onClick={focusNextTrack}
                >
                  <span aria-hidden="true">›</span>
                </button>
              </>
            )}
            <button
              className="lk-button focus-exit"
              onClick={() => {
                setFocusedTrackId(null);
                setMobileFullscreenFallback(false);
              }}
            >
              Exit Focus
            </button>
          </>
        )}
        {tileVolumeMenu && (
          <div
            ref={tileVolumeMenuRef}
            className="tile-volume-menu"
            style={{ left: tileVolumeMenu.x, top: tileVolumeMenu.y }}
            role="dialog"
            aria-label="Participant volume"
          >
            <div className="tile-volume-title">{tileVolumeMenu.participantName}</div>
            {tileVolumeMenu.participantSid ? (
              <>
                <label htmlFor="tile-volume-slider">
                  Volume {Math.round((participantVolumes[tileVolumeMenu.participantSid] ?? 1) * 100)}%
                </label>
                <input
                  id="tile-volume-slider"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round((participantVolumes[tileVolumeMenu.participantSid] ?? 1) * 100)}
                  onChange={(event) =>
                    setParticipantVolume(
                      tileVolumeMenu.participantSid!,
                      Math.min(1, Math.max(0, Number(event.target.value) / 100)),
                    )
                  }
                />
              </>
            ) : (
              <div className="tile-volume-help">No adjustable remote audio on this tile.</div>
            )}
          </div>
        )}
      </div>
      <div className="room-controls">
        <div className="control-group device-group">
          <TrackToggle source={Track.Source.Microphone}>Mic</TrackToggle>
          <select
            className="device-select"
            aria-label="Microphone device"
            value={selectedAudioInput}
            onChange={(event) => {
              const nextDeviceId = event.target.value;
              setSelectedAudioInput(nextDeviceId);
              room.switchActiveDevice('audioinput', nextDeviceId).catch(console.error);
            }}
          >
            {audioInputs.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || 'Microphone'}
              </option>
            ))}
          </select>
        </div>
        <div className="control-group device-group">
          <TrackToggle source={Track.Source.Camera}>Camera</TrackToggle>
          <select
            className="device-select"
            aria-label="Camera device"
            value={selectedVideoInput}
            onChange={(event) => {
              const nextDeviceId = event.target.value;
              setSelectedVideoInput(nextDeviceId);
              room.switchActiveDevice('videoinput', nextDeviceId).catch(console.error);
            }}
          >
            {videoInputs.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || 'Camera'}
              </option>
            ))}
          </select>
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
          <div className="volume-control" ref={volumeControlRef}>
            <button
              className="lk-button volume-trigger"
              type="button"
              aria-label="Adjust volume"
              aria-expanded={showVolumeSlider}
              onClick={() => setShowVolumeSlider((value) => !value)}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                <path d="M19 5a10 10 0 0 1 0 14" />
              </svg>
              {Math.round(props.playbackVolume * 100)}%
            </button>
            {showVolumeSlider && (
              <div className="volume-popover">
                <label htmlFor="playback-volume">Volume {Math.round(props.playbackVolume * 100)}%</label>
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
            )}
          </div>
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
        <div className="control-group leave-group">
          <button className="lk-button leave-button" onClick={props.onLeave}>
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}
