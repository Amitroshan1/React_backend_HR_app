import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, RotateCw } from "lucide-react";

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const SKIP_SECONDS = 10;

function formatVideoTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function readDuration(video) {
  const d = video?.duration;
  return Number.isFinite(d) && d > 0 ? d : 0;
}

function readSeekableEnd(video) {
  try {
    const ranges = video?.seekable;
    if (!ranges || ranges.length === 0) return 0;
    const end = ranges.end(ranges.length - 1);
    return Number.isFinite(end) && end > 0 ? end : 0;
  } catch {
    return 0;
  }
}

export default function SessionRecordingPlayer({ src, videoRef, autoPlay = true }) {
  const localRef = useRef(null);
  const ref = videoRef || localRef;

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [maxSeenTime, setMaxSeenTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [seeking, setSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);

  const syncDuration = useCallback(() => {
    const video = ref.current;
    if (!video) return;
    const meta = readDuration(video);
    const seekEnd = readSeekableEnd(video);
    setDuration((prev) => Math.max(prev, meta, seekEnd));
  }, [ref]);

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setMaxSeenTime(0);
    setPlaybackRate(1);
    setSeeking(false);
    setSeekValue(0);
  }, [src]);

  useEffect(() => {
    const video = ref.current;
    if (!video) return undefined;

    const onLoadedMetadata = () => {
      syncDuration();
      video.playbackRate = playbackRate;
      if (autoPlay) {
        video.play().catch(() => {});
      }
    };
    const onDurationChange = () => syncDuration();
    const onProgress = () => syncDuration();
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTimeUpdate = () => {
      if (seeking) return;
      const t = video.currentTime || 0;
      setCurrentTime(t);
      setSeekValue(t);
      setMaxSeenTime((prev) => Math.max(prev, t));
      syncDuration();
    };
    const onEnded = () => setPlaying(false);

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("durationchange", onDurationChange);
    video.addEventListener("progress", onProgress);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("ended", onEnded);

    if (video.readyState >= 1) onLoadedMetadata();

    return () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("durationchange", onDurationChange);
      video.removeEventListener("progress", onProgress);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("ended", onEnded);
    };
  }, [src, ref, autoPlay, seeking, syncDuration, playbackRate]);

  const displayDuration = Math.max(duration, maxSeenTime, 0.001);

  const seekTo = useCallback(
    (time) => {
      const video = ref.current;
      if (!video) return;
      const cap = Math.max(displayDuration, readSeekableEnd(video), maxSeenTime);
      const next = Math.min(Math.max(0, time), cap > 0 ? cap : time);
      video.currentTime = next;
      setCurrentTime(next);
      setSeekValue(next);
    },
    [ref, displayDuration, maxSeenTime],
  );

  const togglePlay = useCallback(() => {
    const video = ref.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [ref]);

  const skip = useCallback(
    (delta) => {
      const video = ref.current;
      if (!video) return;
      seekTo((video.currentTime || 0) + delta);
    },
    [ref, seekTo],
  );

  const onRateChange = useCallback(
    (e) => {
      const rate = Number.parseFloat(e.target.value, 10);
      const video = ref.current;
      if (!video || !Number.isFinite(rate)) return;
      video.playbackRate = rate;
      setPlaybackRate(rate);
    },
    [ref],
  );

  const onSeekInput = (e) => {
    setSeeking(true);
    const v = Number.parseFloat(e.target.value, 10);
    if (Number.isFinite(v)) setSeekValue(v);
  };

  const onSeekCommit = (e) => {
    const v = Number.parseFloat(e.target.value, 10);
    setSeeking(false);
    if (Number.isFinite(v)) seekTo(v);
  };

  return (
    <div className="session-recording-player">
      <video
        ref={ref}
        key={src}
        className="session-recording-player__video"
        src={src}
        playsInline
        preload="auto"
        onClick={togglePlay}
      />
      <div className="session-recording-player__controls">
        <div className="session-recording-player__row">
          <button
            type="button"
            className="session-recording-player__btn"
            onClick={togglePlay}
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button
            type="button"
            className="session-recording-player__btn"
            onClick={() => skip(-SKIP_SECONDS)}
            aria-label={`Back ${SKIP_SECONDS} seconds`}
          >
            <RotateCcw size={18} />
            <span>{SKIP_SECONDS}s</span>
          </button>
          <button
            type="button"
            className="session-recording-player__btn"
            onClick={() => skip(SKIP_SECONDS)}
            aria-label={`Forward ${SKIP_SECONDS} seconds`}
          >
            <RotateCw size={18} />
            <span>{SKIP_SECONDS}s</span>
          </button>
          <span className="session-recording-player__time">
            {formatVideoTime(currentTime)} / {formatVideoTime(displayDuration)}
          </span>
          <label className="session-recording-player__rate">
            <span>Speed</span>
            <select value={playbackRate} onChange={onRateChange} aria-label="Playback speed">
              {PLAYBACK_RATES.map((r) => (
                <option key={r} value={r}>
                  {r}x
                </option>
              ))}
            </select>
          </label>
        </div>
        <input
          type="range"
          className="session-recording-player__seek"
          min={0}
          max={displayDuration}
          step={0.1}
          value={Math.min(seekValue, displayDuration)}
          onInput={onSeekInput}
          onChange={onSeekCommit}
          aria-label="Seek"
        />
      </div>
    </div>
  );
}
