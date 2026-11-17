import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import "./PlayerBar.css";
import { useLocation, useNavigate } from "react-router-dom";
import { usePlayer } from "./PlayerContext";
import type { PlayerTrack } from "./PlayerContext";
import PlayerIcon from "./PlayerIcon";
import QueuePanel from "./QueuePanel";
import { useI18n } from "../lib/i18n";
import Modal from "../components/Modal";

const MAX_VOLUME = 2;
const SAFE_VOLUME = 1;
const VOLUME_SNAP_POINTS = [0.5, SAFE_VOLUME] as const;
// A 0.06 volume range is about 3% of the slider's full travel.
const VOLUME_SNAP_RADIUS = 0.06;

export default function PlayerBar() {
	const { t } = useI18n();
	const {
		queue,
		current,
		playing,
		setPlaying,
		playNext,
		playPrev,
		setVolume,
		volume,
	} = usePlayer();
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const barRef = useRef<HTMLDivElement | null>(null);
	const volumeSliderPointerActiveRef = useRef(false);
	const [, setProgress] = useState(0);
	const [curSec, setCurSec] = useState(0);
	const [durSec, setDurSec] = useState(0);
	const [pendingBoostedVolume, setPendingBoostedVolume] = useState<
		number | null
	>(null);
	const [volumeError, setVolumeError] = useState("");
	const [boostedVolumeAcknowledged, setBoostedVolumeAcknowledged] =
		useState(false);
	const audioContextRef = useRef<AudioContext | null>(null);
	const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
	const gainNodeRef = useRef<GainNode | null>(null);

	const currentTrack: PlayerTrack | undefined = queue[current];
	const [showQueue, setShowQueue] = useState(false);
	const [isSmall, setIsSmall] = useState(() =>
		typeof window !== "undefined"
			? !window.matchMedia("(min-width: 640px)").matches
			: true,
	);
	const [expanded, setExpanded] = useState(() =>
		typeof window !== "undefined"
			? window.matchMedia("(min-width: 640px)").matches
			: true,
	);
	const [showMobileVolume, setShowMobileVolume] = useState(false);
	const isCompact = isSmall && !expanded;
	const fullBarRef = useRef<HTMLDivElement | null>(null);
	const navigate = useNavigate();
	const location = useLocation();

	useEffect(() => {
		if (!isSmall) return;
		let lastY = window.scrollY;
		let accumulated = 0;
		const ignoreUntil = Date.now() + 350;
		const onScroll = () => {
			const y = Math.max(0, window.scrollY);
			const delta = y - lastY;
			lastY = y;
			if (Date.now() < ignoreUntil || showQueue) { accumulated = 0; return; }
			if (Math.sign(delta) !== Math.sign(accumulated)) accumulated = 0;
			accumulated += delta;
			if (Math.abs(accumulated) < 10) return;
			setExpanded(accumulated < 0 || y <= 12);
			accumulated = 0;
		};
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => window.removeEventListener('scroll', onScroll);
	}, [isSmall, showQueue, location.key]);

	useEffect(() => {
		const el = barRef.current;
		if (!el || typeof window === "undefined") return;
		const root = document.documentElement;
		const update = () => {
			const bubble = el.querySelector<HTMLElement>(".playerbar-bubble");
			const bubbleHeight = bubble
				? bubble.getBoundingClientRect().height
				: el.getBoundingClientRect().height;
			const style = window.getComputedStyle(el);
			const paddingY =
				parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
			const next = Math.ceil(bubbleHeight + paddingY);
			if (next > 0) root.style.setProperty("--playerbar-height", `${next}px`);
		};
		update();
		if (typeof ResizeObserver === "undefined") {
			window.addEventListener("resize", update);
			return () => window.removeEventListener("resize", update);
		}
		const ro = new ResizeObserver(() => update());
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	// Both layouts stay mounted so an interrupted transition reverses naturally.
	const expandWithAnim = useCallback(() => setExpanded(true), []);

	useEffect(() => {
		const content = fullBarRef.current;
		const bubble = content?.parentElement;
		if (!content || !bubble || !isSmall) return;
		const update = () => {
			bubble.style.setProperty(
				"--player-expanded-height",
				`${content.offsetHeight + 18}px`,
			);
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(content);
		return () => observer.disconnect();
	}, [isSmall]);

	const seek = useCallback((val: number | string) => {
		const a = audioRef.current;
		if (!a) return;
		const t = Math.max(0, Math.min(Number(val), a.duration || 0));
		a.currentTime = t;
		setCurSec(t);
	}, []);

	const jump = useCallback(
		(delta: number) => {
			const a = audioRef.current;
			if (!a) return;
			const base = Number.isFinite(a.currentTime) ? a.currentTime : 0;
			seek(base + delta);
		},
		[seek],
	);

	const openWorkPage = (e?: MouseEvent<HTMLElement>) => {
		if (e) e.stopPropagation?.();
		if (!currentTrack?.url) return;
		try {
			const m = /\/(files|media)\/([^/]+)/.exec(currentTrack.url);
			if (m?.[2]) {
				const id = decodeURIComponent(m[2]);
				navigate(`/work/${id}`);
			}
		} catch {}
	};

	useEffect(() => {
		const mq = window.matchMedia("(min-width: 640px)");
		const handler = (e: MediaQueryListEvent) => {
			setIsSmall(!e.matches);
			if (e.matches) setExpanded(true);
		};
		mq.addEventListener("change", handler);
		return () => {
			mq.removeEventListener("change", handler);
		};
	}, []);

	const applyBoostedVolume = useCallback(
		async (nextVolume: number) => {
			const audio = audioRef.current;
			if (!audio) return false;

			try {
				let audioContext = audioContextRef.current;
				if (!audioContext) {
					audioContext = new AudioContext();
					const source = audioContext.createMediaElementSource(audio);
					const gainNode = audioContext.createGain();
					source.connect(gainNode).connect(audioContext.destination);
					audioContextRef.current = audioContext;
					audioSourceRef.current = source;
					gainNodeRef.current = gainNode;
				}
				if (audioContext.state === "suspended") await audioContext.resume();
				audio.volume = SAFE_VOLUME;
				if (gainNodeRef.current) gainNodeRef.current.gain.value = nextVolume;
				setVolume(nextVolume);
				setVolumeError("");
				return true;
			} catch {
				setVolumeError(
					t(
						"Your browser could not enable amplified audio. Volume remains at 100%.",
					),
				);
				return false;
			}
		},
		[setVolume, t],
	);

	const requestVolume = useCallback(
		(requestedVolume: number, snapToMarks = false) => {
			const clampedVolume = Math.min(
				MAX_VOLUME,
				Math.max(0, requestedVolume),
			);
			const snapPoint = snapToMarks
				? VOLUME_SNAP_POINTS.find(
						(point) =>
							Math.abs(clampedVolume - point) <=
							VOLUME_SNAP_RADIUS + Number.EPSILON,
					)
				: undefined;
			const nextVolume = snapPoint ?? clampedVolume;
			if (nextVolume > SAFE_VOLUME) {
				if (!boostedVolumeAcknowledged) {
					setVolumeError("");
					setPendingBoostedVolume(nextVolume);
					return;
				}
				void applyBoostedVolume(nextVolume).then((applied) => {
					if (!applied) setPendingBoostedVolume(nextVolume);
				});
				return;
			}
			setVolume(nextVolume);
		},
		[applyBoostedVolume, boostedVolumeAcknowledged, setVolume],
	);

	// Keyboard shortcuts
	useEffect(() => {
		const handleKey = (e: KeyboardEvent) => {
			// Ignore if typing in input fields
			const target = e.target as HTMLElement | null;
			const tag = target?.tagName?.toUpperCase();
			if (
				tag === "INPUT" ||
				tag === "TEXTAREA" ||
				tag === "SELECT" ||
				tag === "BUTTON" ||
				e.defaultPrevented ||
				target?.isContentEditable
			) {
				return;
			}

			const key = e.key?.toLowerCase();

			if (key === "arrowright") {
				e.preventDefault();
				jump(10);
			} else if (key === "arrowleft") {
				e.preventDefault();
				jump(-10);
			} else if (key === "arrowup") {
				e.preventDefault();
				requestVolume(volume + 0.05);
			} else if (key === "arrowdown") {
				e.preventDefault();
				requestVolume(volume - 0.05);
			} else if ((key === " " || key === "k") && currentTrack) {
				e.preventDefault();
				setPlaying((p) => !p);
			}
		};

		window.addEventListener("keydown", handleKey);
		return () => window.removeEventListener("keydown", handleKey);
	}, [currentTrack, jump, requestVolume, setPlaying, volume]);

	useEffect(() => {
		const a = audioRef.current;
		if (!a) return;
		const gainNode = gainNodeRef.current;
		if (gainNode) {
			a.volume = SAFE_VOLUME;
			gainNode.gain.value = volume;
		} else {
			a.volume = Math.min(SAFE_VOLUME, volume);
		}
	}, [volume]);

	useEffect(
		() => () => {
			audioSourceRef.current?.disconnect();
			gainNodeRef.current?.disconnect();
			const audioContext = audioContextRef.current;
			if (audioContext && audioContext.state !== "closed")
				void audioContext.close();
		},
		[],
	);

	useEffect(() => {
		const a = audioRef.current;
		if (!a) return;
		if (playing) a.play().catch(() => {});
		else a.pause();
	}, [playing, currentTrack?.url]);

	// Reset progress display when queue is cleared
	useEffect(() => {
		if (!currentTrack) {
			setProgress(0);
			setCurSec(0);
			setDurSec(0);
		}
	}, [currentTrack]);

	// Sync playing state when audio is paused/played externally (e.g., media controls)
	useEffect(() => {
		const a = audioRef.current;
		if (!a) return;

		const onPlay = () => setPlaying(true);
		const onPause = () => setPlaying(false);

		a.addEventListener("play", onPlay);
		a.addEventListener("pause", onPause);

		return () => {
			a.removeEventListener("play", onPlay);
			a.removeEventListener("pause", onPause);
		};
	}, [setPlaying]);

	const onTime = () => {
		const a = audioRef.current;
		if (!a?.duration) return;
		setCurSec(a.currentTime);
		setDurSec(a.duration);
		setProgress((a.currentTime / a.duration) * 100);
		// Persist playback position periodically
		try {
			const url = currentTrack?.url;
			if (url) {
				const key = `player.time:${url}`;
				const t = Math.floor(a.currentTime);
				if (!Number.isNaN(t)) {
					// only write when changed by >=1s to reduce churn
					const last = Number(localStorage.getItem(key) || "0");
					if (!Number.isFinite(last) || Math.abs(last - t) >= 1) {
						localStorage.setItem(key, String(t));
					}
				}
			}
		} catch {}
	};

	const onLoaded = () => {
		const a = audioRef.current;
		if (!a) return;
		setDurSec(a.duration || 0);
		// Restore saved position for this track if available
		try {
			const url = currentTrack?.url;
			if (url && currentTrack?.restorePosition !== false) {
				const key = `player.time:${url}`;
				const saved = Number(localStorage.getItem(key));
				if (
					Number.isFinite(saved) &&
					a.duration &&
					saved > 0 &&
					saved < a.duration - 1
				) {
					a.currentTime = saved;
					setCurSec(saved);
					return;
				}
			}
		} catch {}
		setCurSec(a.currentTime || 0);
	};

	const fmt = (s: number) => {
		if (!Number.isFinite(s)) return "0:00";
		const m = Math.floor(s / 60);
		const ss = Math.floor(s % 60)
			.toString()
			.padStart(2, "0");
		return `${m}:${ss}`;
	};

	// Generate gradient style for slider fill effect
	const sliderGradient = (pct: number) => ({
		background: `linear-gradient(to right, var(--color-accent) 0%, var(--color-accent) ${pct}%, var(--slider-track-bg, #475569) ${pct}%, var(--slider-track-bg, #475569) 100%)`,
	});

	const enableBoostedVolume = async () => {
		const nextVolume = pendingBoostedVolume;
		if (nextVolume == null) return;

		const applied = await applyBoostedVolume(nextVolume);
		if (!applied) return;
		setBoostedVolumeAcknowledged(true);
		setPendingBoostedVolume(null);
	};

	const cancelBoostedVolume = () => {
		setPendingBoostedVolume(null);
		setVolumeError("");
	};
	const playButton = (
		<button
			type="button"
			className="player-control player-control--play"
			onClick={() => setPlaying(!playing)}
			disabled={!currentTrack}
			aria-label={t(playing ? "Pause" : "Play")}
		>
			<PlayerIcon name={playing ? "pause" : "play"} />
		</button>
	);
	const trackInfo = (
		<span className="playerbar__track-info">
			<strong>{currentTrack?.title || t("Nothing playing")}</strong>
			<span>
				{currentTrack
					? `${current + 1} / ${queue.length}`
					: t("Choose a track to start listening")}
			</span>
		</span>
	);
	const compactBar = (
		<div className="playerbar__compact">
			<button
				className="playerbar__expand"
				type="button"
				onClick={expandWithAnim}
				aria-label={t("Expand player")}
				aria-expanded={false}
			>
				{trackInfo}<PlayerIcon name="up" />
			</button>
			{playButton}
		</div>
	);
	const fullBar = (
		<div className={`playerbar__layout ${showMobileVolume ? "has-mobile-volume" : ""}`}>
			<div className="playerbar__heading">
				<button
					className="playerbar__work"
					type="button"
					onClick={openWorkPage}
					disabled={!currentTrack}
					title={t("Open work")}
				>
					{trackInfo}
					<PlayerIcon name="work" />
				</button>
				{isSmall && (
					<button
						type="button"
						className="player-control"
						onClick={() => setExpanded(false)}
						aria-label={t("Collapse player")}
						aria-expanded={true}
					>
						<PlayerIcon name="down" />
					</button>
				)}
			</div>
			<div className="playerbar__transport">
				<button
					type="button"
					className="player-control"
					onClick={playPrev}
					disabled={!currentTrack || current <= 0}
					aria-label={t("Previous track")}
					title={t("Previous track")}
				>
					<PlayerIcon name="previous" />
				</button>
				<button
					type="button"
					className="player-control"
					onClick={() => jump(-10)}
					disabled={!currentTrack}
					aria-label={t("Back 10 seconds")}
					title={t("Back 10 seconds")}
				>
					<PlayerIcon name="back" />
				</button>
				{playButton}
				<button
					type="button"
					className="player-control"
					onClick={() => jump(10)}
					disabled={!currentTrack}
					aria-label={t("Forward 10 seconds")}
					title={t("Forward 10 seconds")}
				>
					<PlayerIcon name="forward" />
				</button>
				<button
					type="button"
					className="player-control"
					onClick={() => playNext()}
					disabled={!currentTrack || current >= queue.length - 1}
					aria-label={t("Next track")}
					title={t("Next track")}
				>
					<PlayerIcon name="next" />
				</button>
			</div>
			<div className="playerbar__progress">
				<span className="playerbar__time">{fmt(curSec)}</span>
				<input
					className="grow"
					type="range"
					min="0"
					max={Math.max(1, durSec)}
					step="0.5"
					value={curSec}
					disabled={!currentTrack || !durSec}
					onChange={(e) => seek(e.target.value)}
					aria-label={t("Seek")}
					aria-valuetext={`${fmt(curSec)} / ${fmt(durSec)}`}
					style={sliderGradient(durSec > 0 ? (curSec / durSec) * 100 : 0)}
				/>
				<span className="playerbar__time">{fmt(durSec)}</span>
			</div>
			<div className="playerbar__actions">
				{isSmall && <button type="button" className="player-control playerbar__volume-toggle" aria-label={t('Volume')} aria-expanded={showMobileVolume} onClick={() => setShowMobileVolume(v => !v)}><PlayerIcon name="volume" /></button>}
				<div className="playerbar__volume" inert={isSmall && !showMobileVolume} aria-hidden={isSmall && !showMobileVolume}>
					<PlayerIcon name="volume" />
					<input
						className={`slider-volume${volume > SAFE_VOLUME ? " slider-volume--boosted" : ""}`}
						type="range"
						min="0"
						max={MAX_VOLUME}
						step="0.01"
						value={volume}
						onPointerDown={() => {
							volumeSliderPointerActiveRef.current = true;
						}}
						onPointerUp={() => {
							volumeSliderPointerActiveRef.current = false;
						}}
						onPointerCancel={() => {
							volumeSliderPointerActiveRef.current = false;
						}}
						onChange={(e) =>
							requestVolume(
								Number(e.target.value),
								volumeSliderPointerActiveRef.current,
							)
						}
						aria-label={t("Volume")}
						aria-valuetext={`${Math.round(volume * 100)}%`}
						style={sliderGradient((volume / MAX_VOLUME) * 100)}
					/>
					<output
						className={`playerbar__volume-value${volume > SAFE_VOLUME ? " is-boosted" : ""}`}
					>
						{Math.round(volume * 100)}%
					</output>
				</div>
				<button
					type="button"
					className="player-control playerbar__queue-toggle"
					title={t("Queue")}
					aria-label={t("Queue")}
					aria-expanded={showQueue}
					aria-controls="player-queue"
					onClick={() => {
						setShowQueue((s) => !s);

					}}
				>
					<PlayerIcon name="queue" />
					<span>{queue.length}</span>
				</button>
			</div>
		</div>
	);

	return (
		<div className="playerbar" ref={barRef}>
			<QueuePanel open={showQueue} onClose={() => setShowQueue(false)} />
			<div className={`playerbar-bubble ${isCompact ? "compact" : "expanded"}`}>
				{isSmall && (
					<div
						className="playerbar__compact-layer"
						inert={!isCompact}
						aria-hidden={!isCompact}
					>
						{compactBar}
					</div>
				)}
				<div
					ref={fullBarRef}
					className="playerbar__full-layer"
					inert={isCompact}
					aria-hidden={isCompact}
				>
					{fullBar}
				</div>
			</div>
			<audio
				ref={audioRef}
				src={currentTrack?.url}
				onEnded={() => {
					// Clear saved time for finished track then advance
					try {
						if (currentTrack?.url)
							localStorage.removeItem(`player.time:${currentTrack.url}`);
					} catch {}
					// Preserve playing state when auto-advancing to next track
					playNext(true);
				}}
				onTimeUpdate={onTime}
				onLoadedMetadata={onLoaded}
				onError={() => playNext()}
				preload="metadata"
			/>
			<Modal
				open={pendingBoostedVolume != null}
				onClose={cancelBoostedVolume}
				title={t("High volume warning")}
				maxWidth={520}
				resizable={false}
				fitContent
				footer={
					<>
						<button type="button" className="btn" onClick={cancelBoostedVolume}>
							{t("Cancel")}
						</button>
						<button
							type="button"
							className="btn btn-red"
							onClick={() => void enableBoostedVolume()}
						>
							{t("Enable boosted volume")}
						</button>
					</>
				}
			>
				<div className="playerbar__volume-warning">
					<div className="playerbar__volume-warning-icon" aria-hidden="true">
						!
					</div>
					<div>
						<p className="playerbar__volume-warning-lead">
							{t("You are increasing volume above 100%.")}
						</p>
						<p>
							{t(
								"Amplified audio can be unexpectedly loud, distort, and damage your hearing or equipment. Lower your device volume before continuing.",
							)}
						</p>
						{pendingBoostedVolume != null ? (
							<p className="playerbar__volume-warning-target">
								{t("Requested volume")}:{" "}
								<strong>{Math.round(pendingBoostedVolume * 100)}%</strong>
							</p>
						) : null}
						{volumeError ? (
							<p className="playerbar__volume-warning-error" role="alert">
								{volumeError}
							</p>
						) : null}
					</div>
				</div>
			</Modal>
		</div>
	);
}
