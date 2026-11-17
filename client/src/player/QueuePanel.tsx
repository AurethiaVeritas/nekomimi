import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { useI18n } from "../lib/i18n";
import { usePlayer } from "./PlayerContext";
import PlayerIcon from "./PlayerIcon";

export default function QueuePanel({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const { t } = useI18n();
	const { queue, current, playing, setIndex, removeAt, moveItem, clear } =
		usePlayer();
	const panelRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const closeRef = useRef<HTMLButtonElement>(null);
	const dragRef = useRef<{ from: number; to: number; y: number } | null>(null);
	const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const closeCallback = useRef(onClose);
	closeCallback.current = onClose;

	useEffect(() => {
		if (!open) return;
		const previous = document.activeElement as HTMLElement | null;
		const focusTimer = window.setTimeout(() => {
			if (!panelRef.current?.contains(document.activeElement))
				closeRef.current?.focus();
		}, 320);
		const handleKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				closeCallback.current();
			}
		};
		document.addEventListener("keydown", handleKey);
		return () => {
			window.clearTimeout(focusTimer);
			document.removeEventListener("keydown", handleKey);
			if (previous?.closest("[inert]"))
				document
					.querySelector<HTMLButtonElement>(".playerbar__expand")
					?.focus();
			else previous?.focus();
		};
	}, [open]);

	const isDragging = drag !== null;

	// Reorder only on release so cancelling a gesture never changes playback order.
	useEffect(() => {
		if (!isDragging || !open) return;
		let frame = 0;
		const tick = () => {
			const state = dragRef.current;
			const list = listRef.current;
			if (!state || !list) return;
			const bounds = list.getBoundingClientRect();
			if (state.y < bounds.top + 40) list.scrollTop -= 8;
			else if (state.y > bounds.bottom - 40) list.scrollTop += 8;
			const rows = Array.from(
				list.querySelectorAll<HTMLElement>("[data-queue-index]"),
			);
			const target = rows.findIndex(
				(row) => state.y < row.getBoundingClientRect().bottom,
			);
			state.to = target < 0 ? rows.length - 1 : target;
			setDrag((previous) =>
				previous?.to === state.to
					? previous
					: { from: state.from, to: state.to },
			);
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [isDragging, open]);

	const cancelDrag = () => {
		dragRef.current = null;
		setDrag(null);
	};
	const finishDrag = (event: PointerEvent<HTMLButtonElement>) => {
		const state = dragRef.current;
		if (state && open) {
			moveItem(state.from, state.to);
			setAnnouncement(`${t("Moved to position")} ${state.to + 1}`);
		}
		cancelDrag();
		if (event.currentTarget.hasPointerCapture(event.pointerId))
			event.currentTarget.releasePointerCapture(event.pointerId);
	};

	return (
		<>
			<div
				className={`playerbar__queue-backdrop ${open ? "is-open" : ""}`}
				onClick={onClose}
				aria-hidden="true"
			/>
			<div
				id="player-queue"
				className={`playerbar-queue ${open ? "is-open" : ""}`}
				ref={panelRef}
				role="dialog"
				aria-label={t("Queue")}
				inert={!open}
				aria-hidden={!open}
			>
				<div className="playerbar__queue-header">
					<div>
						<h2>
							{t("Queue")} <span>{queue.length}</span>
						</h2>
						<p id="queue-help">
							{t("Drag to reorder · Use arrow keys on a handle")}
						</p>
					</div>
					<button
						type="button"
						className="playerbar__clear"
						onClick={clear}
						disabled={!queue.length}
					>
						{t("Clear All")}
					</button>
					<button
						ref={closeRef}
						type="button"
						className="player-control"
						onClick={onClose}
						aria-label={t("Close")}
					>
						<PlayerIcon name="close" />
					</button>
				</div>
				<div className={`playerbar__queue-list ${isDragging ? "is-reordering" : ""}`} ref={listRef}>
					{queue.map((track, index) => (
						<div
							key={index}
							data-queue-index={index}
							className={`queue-item ${index === current ? "queue-item--active" : ""} ${drag?.from === index ? "is-dragging" : ""} ${drag && drag.to === index && drag.from !== index ? `is-drop-target ${drag.from < index ? "is-drop-after" : ""}` : ""}`}
						>
							<button
								type="button"
								className="player-control queue-item__grip"
								aria-label={`${t("Reorder")}: ${track.title || index + 1}`}
								aria-describedby="queue-help"
								onPointerDown={(event) => {
									if (event.button !== 0) return;
									event.currentTarget.setPointerCapture(event.pointerId);
									dragRef.current = {
										from: index,
										to: index,
										y: event.clientY,
									};
									setDrag({ from: index, to: index });
								}}
								onPointerMove={(event) => {
									if (dragRef.current) dragRef.current.y = event.clientY;
								}}
								onPointerUp={finishDrag}
								onPointerCancel={cancelDrag}
								onLostPointerCapture={cancelDrag}
								onKeyDown={(event) => {
									if (
										!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
									)
										return;
									event.preventDefault();
									event.stopPropagation();
									const next =
										event.key === "Home"
											? 0
											: event.key === "End"
												? queue.length - 1
												: Math.max(
														0,
														Math.min(
															queue.length - 1,
															index + (event.key === "ArrowUp" ? -1 : 1),
														),
													);
									moveItem(index, next);
									setAnnouncement(`${t("Moved to position")} ${next + 1}`);
									requestAnimationFrame(() =>
										listRef.current
											?.querySelectorAll<HTMLButtonElement>(".queue-item__grip")
											[next]?.focus(),
									);
								}}
							>
								<PlayerIcon name="grip" />
							</button>
							<span className="queue-item__index">
								{index === current && playing ? (
									<PlayerIcon name="volume" />
								) : (
									String(index + 1).padStart(2, "0")
								)}
							</span>
							<button
								type="button"
								className="queue-item__title"
								onClick={() => setIndex(index)}
								title={track.title}
								aria-current={index === current ? "true" : undefined}
							>
								<span>{track.title || t("Untitled track")}</span>
								{index === current && (
									<small>{t(playing ? "Now playing" : "Selected track")}</small>
								)}
							</button>
							<button
								type="button"
								className="player-control queue-item__remove"
								onClick={() => removeAt(index)}
								aria-label={`${t("Remove")}: ${track.title || index + 1}`}
							>
								<PlayerIcon name="close" />
							</button>
						</div>
					))}
					{!queue.length && (
						<div className="playerbar__empty">
							<PlayerIcon name="queue" />
							<strong>{t("Queue is empty.")}</strong>
							<p>{t("Choose a track to start listening")}</p>
						</div>
					)}
				</div>
				<span className="playerbar__sr-only" role="status">
					{announcement}
				</span>
			</div>
		</>
	);
}
